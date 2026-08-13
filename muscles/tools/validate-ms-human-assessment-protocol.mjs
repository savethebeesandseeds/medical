import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const protocolPath = join(root, 'public', 'ms-human-assessment-protocol.js');
const metadataPath = join(root, 'public', 'models', 'ms_human_700', 'right-arm.json');
const evidencePath = join(root, 'tools', 'ms-human-assessment-protocol-solver-evidence.json');

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

async function importBrowserModule(path) {
    const source = await readFile(path, 'utf8');
    const temporary = join(tmpdir(), `${basename(path, '.js')}-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
    await writeFile(temporary, source, 'utf8');
    try {
        return await import(`${pathToFileURL(temporary).href}?t=${Date.now()}`);
    } finally {
        await unlink(temporary).catch(() => {});
    }
}

const module = await importBrowserModule(protocolPath);
const protocol = module.MS_HUMAN_ASSESSMENT_PROTOCOL;
const content = module.MS_HUMAN_ASSESSMENT_PROTOCOL_CONTENT;
const reportProtocol = module.MS_HUMAN_ASSESSMENT_REPORT_PROTOCOL;
const coordinateKeys = [...module.MS_HUMAN_ASSESSMENT_COORDINATE_KEYS];
const metadataBytes = await readFile(metadataPath);
const metadata = JSON.parse(metadataBytes.toString('utf8'));
const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));

assert.equal(protocol.schemaVersion, 1);
assert.match(protocol.id, /^MSH700-/);
assert.match(protocol.version, /^1\.0\.0$/);
assert.match(protocol.contentDigestSha256, /^[0-9a-f]{64}$/);
assert.equal(sha256(stableStringify(content)), protocol.contentDigestSha256, 'Protocol content digest is stale.');
assert.equal(sha256(metadataBytes), protocol.model.coordinateMetadataSha256, 'Pinned coordinate metadata digest changed.');
assert.match(protocol.derivation.interpretation, /not clinical validation/i);
assert.match(protocol.derivation.solverScreen, /never admitted by weakening a gate/i);

const runtimeCoordinates = new Map(metadata.coordinates.map((coordinate) => [coordinate.name, coordinate]));
assert.deepEqual([...runtimeCoordinates.keys()], coordinateKeys);
for (const key of coordinateKeys) {
    const expected = protocol.coordinateRanges[key];
    const actual = runtimeCoordinates.get(key);
    assert.deepEqual(
        [actual.minimumDegrees, actual.maximumDegrees, actual.defaultDegrees],
        [expected.minimum, expected.maximum, expected.default],
        `${key} no longer matches the pinned authored range.`
    );
}

assert.equal(protocol.positions.length, 15);
const positions = new Map();
for (const position of protocol.positions) {
    assert.match(position.id, /^MSH-A\d{2}$/);
    assert.doesNotMatch(position.id, /^M\d+$/);
    assert(!positions.has(position.id), `Duplicate position ${position.id}.`);
    assert.equal(typeof position.name, 'string');
    assert.equal(typeof position.instruction, 'string');
    assert.deepEqual(Object.keys(position.coordinates), coordinateKeys);
    for (const key of coordinateKeys) {
        const value = position.coordinates[key];
        const range = protocol.coordinateRanges[key];
        assert(Number.isFinite(value), `${position.id} ${key} is not finite.`);
        assert(value >= range.minimum && value <= range.maximum, `${position.id} ${key} is outside the authored range.`);
        assert(Math.abs(value * 10 - Math.round(value * 10)) < 1e-9, `${position.id} ${key} is not on the 0.1 degree control step.`);
        if (value !== range.default) {
            const bound = value < range.default ? range.minimum : range.maximum;
            const travel = Math.abs((value - range.default) / (bound - range.default));
            assert(travel <= protocol.derivation.maximumAuthoredTravelFraction + 0.001, `${position.id} ${key} exceeds the moderate travel envelope.`);
        }
    }
    positions.set(position.id, position);
}

assert.equal(protocol.comparisons.length, coordinateKeys.length);
const coveredCoordinates = new Set();
const pairedPositionIds = new Set();
for (const comparison of protocol.comparisons) {
    assert.match(comparison.id, /^MSH-C\d{2}$/);
    const first = positions.get(comparison.firstPositionId);
    const second = positions.get(comparison.secondPositionId);
    assert(first && second, `${comparison.id} references a missing position.`);
    const changed = coordinateKeys.filter((key) => first.coordinates[key] !== second.coordinates[key]);
    assert.deepEqual(changed, [comparison.changedCoordinate], `${comparison.id} must change exactly its declared coordinate.`);
    assert.deepEqual(comparison.heldCoordinates, Object.fromEntries(coordinateKeys.filter((key) => key !== comparison.changedCoordinate).map((key) => [key, first.coordinates[key]])));
    assert(!coveredCoordinates.has(comparison.changedCoordinate), `${comparison.changedCoordinate} has more than one paired contrast.`);
    coveredCoordinates.add(comparison.changedCoordinate);
    pairedPositionIds.add(first.id);
    pairedPositionIds.add(second.id);
}
assert.deepEqual([...coveredCoordinates].sort(), [...coordinateKeys].sort());
assert.equal(pairedPositionIds.size, 14);
assert(!pairedPositionIds.has('MSH-A01'));

assert.equal(evidence.protocolId, protocol.id);
assert.equal(evidence.protocolVersion, protocol.version);
assert.equal(evidence.protocolDigestSha256, protocol.contentDigestSha256);
assert.equal(evidence.modelId, protocol.model.modelId);
assert.equal(evidence.modelDigest, protocol.model.modelDigest);
assert.equal(evidence.runtimeModelSha256, protocol.model.runtimeModelSha256);
assert.equal(evidence.summary.attempted, protocol.positions.length);
assert.equal(evidence.summary.passed, protocol.positions.length);
assert.match(evidence.qualification, /not clinical validation/i);
assert.deepEqual(evidence.positions.map((item) => item.id), protocol.positions.map((item) => item.id));
for (const record of evidence.positions) {
    assert.equal(record.usable, true, `${record.id} failed the recorded solver quality gate.`);
    assert.equal(record.status, 'usable');
    assert.equal(record.activationCount, 88);
    assert.equal(record.capacityLimited, false);
    assert(record.maximumActivation < evidence.solverQualityLimits.capacityActivation);
    assert(record.maximumResidualNm <= evidence.solverQualityLimits.maximumResidualNm);
    assert(record.maximumReserveNm <= evidence.solverQualityLimits.maximumReserveNm);
}
assert.deepEqual(evidence.comparisons.map((item) => item.id), protocol.comparisons.map((item) => item.id));
for (const item of evidence.comparisons) assert(item.activationEuclideanDistance > 0.01);

assert.equal(reportProtocol.id, protocol.id);
assert.equal(reportProtocol.version, protocol.version);
assert.equal(reportProtocol.digest, `sha256:${protocol.contentDigestSha256}`);
assert.deepEqual(reportProtocol.trialIds, protocol.positions.map((item) => item.id));
assert.deepEqual(reportProtocol.matchedComparisons.map((item) => item.id), protocol.comparisons.map((item) => item.id));
for (const comparison of reportProtocol.matchedComparisons) {
    assert.equal(comparison.trialIds.length, 2);
    assert.equal(comparison.controlledVariables.length, 6);
    assert(coordinateKeys.includes(comparison.changedVariable));
}

console.log(JSON.stringify({
    status: 'ok',
    protocolId: protocol.id,
    version: protocol.version,
    digest: protocol.contentDigestSha256,
    positions: protocol.positions.length,
    pairedContrasts: protocol.comparisons.length,
    coordinatesCovered: coveredCoordinates.size,
    solverPassed: evidence.summary.passed,
    maximumObservedActivation: evidence.summary.maximumObservedActivation,
    maximumObservedResidualNm: evidence.summary.maximumObservedResidualNm,
    maximumObservedReserveNm: evidence.summary.maximumObservedReserveNm,
    qualification: evidence.qualification
}, null, 2));
