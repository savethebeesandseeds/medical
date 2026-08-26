#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    ASSESSMENT_PROTOCOLS,
    DEFAULT_ASSESSMENT_PROTOCOL_KEY,
    assessmentProtocolByIdentity,
    assessmentProtocolByKey
} from '../public/assessment-protocol-registry.js';
import {
    MS_HUMAN_ASSESSMENT_POSITIONS,
    MS_HUMAN_ASSESSMENT_PROTOCOL,
    MS_HUMAN_ASSESSMENT_REPORT_PROTOCOL
} from '../public/ms-human-assessment-protocol.js';
import { GENERATED_REGIONAL_ASSESSMENT_PROTOCOLS } from '../public/generated-regional-assessment-protocols.js';
import { REGIONAL_ASSESSMENT_CONFIGS } from './search-ms-human/regional-assessment-config.js';
import { selectPanel } from './search-ms-human/regional-assessment-core.js';
import {
    mechanicalEvidenceDigest,
    regionalModelIdentity,
    sha256,
    stableStringify
} from './search-ms-human/regional-assessment-provenance.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED_PATH = join(ROOT, 'public', 'generated-regional-assessment-protocols.js');
const BUILDER_PATH = join(ROOT, 'tools', 'build-regional-assessment-protocols.mjs');
const TIER_ORDER = Object.freeze({
    'neutral-reference': 0,
    accessible: 1,
    moderate: 2,
    broad: 3
});

function bareDigest(value) {
    return String(value).replace(/^sha256:/i, '').toLowerCase();
}

assert.equal(DEFAULT_ASSESSMENT_PROTOCOL_KEY, 'right-upper-limb');
assert.equal(ASSESSMENT_PROTOCOLS.length, 9);
assert.equal(GENERATED_REGIONAL_ASSESSMENT_PROTOCOLS.length, 8);
assert.equal(new Set(ASSESSMENT_PROTOCOLS.map((entry) => entry.key)).size, ASSESSMENT_PROTOCOLS.length);
assert.equal(new Set(ASSESSMENT_PROTOCOLS.map((entry) => entry.reportProtocol.id)).size, ASSESSMENT_PROTOCOLS.length);
assert.equal(new Set(ASSESSMENT_PROTOCOLS.map((entry) => entry.reportProtocol.digest)).size, ASSESSMENT_PROTOCOLS.length);

const rightArm = assessmentProtocolByKey('right-upper-limb');
assert(rightArm);
assert.strictEqual(rightArm.positions, MS_HUMAN_ASSESSMENT_POSITIONS);
assert.strictEqual(rightArm.protocol, MS_HUMAN_ASSESSMENT_PROTOCOL);
assert.strictEqual(rightArm.reportProtocol, MS_HUMAN_ASSESSMENT_REPORT_PROTOCOL);
assert.equal(rightArm.positions.length, 20);

for (const entry of ASSESSMENT_PROTOCOLS) {
    assert(Object.isFrozen(entry), entry.key + ': registry entry must be frozen.');
    assert.strictEqual(assessmentProtocolByKey(entry.key), entry);
    assert.strictEqual(assessmentProtocolByIdentity({
        id: entry.reportProtocol.id,
        version: entry.reportProtocol.version,
        digest: entry.reportProtocol.digest
    }), entry);
    assert.strictEqual(assessmentProtocolByIdentity({
        id: entry.reportProtocol.id,
        version: entry.reportProtocol.version,
        digest: bareDigest(entry.reportProtocol.digest)
    }), entry);
    assert.equal(entry.model.sideMode, 'native', entry.key + ': a protocol must use native geometry, not a visual mirror.');
    assert.equal(entry.reportProtocol.trialIds.length, entry.positions.length);
    assert.deepEqual(entry.reportProtocol.trialIds, entry.positions.map((position) => position.id));
}

assert.equal(assessmentProtocolByKey('not-a-protocol'), null);
assert.equal(assessmentProtocolByIdentity({
    id: rightArm.reportProtocol.id,
    version: rightArm.reportProtocol.version,
    digest: 'sha256:' + '0'.repeat(64)
}), null);
assert.equal(assessmentProtocolByIdentity({
    id: 'UNKNOWN',
    version: rightArm.reportProtocol.version,
    digest: rightArm.reportProtocol.digest
}), null);

for (const entry of GENERATED_REGIONAL_ASSESSMENT_PROTOCOLS) {
    const evidencePath = join(ROOT, entry.evidence.sourceFile);
    const evidenceBytes = await readFile(evidencePath);
    const evidence = JSON.parse(evidenceBytes.toString('utf8'));
    const protocol = entry.protocol;

    assert.equal(evidence.schemaVersion, 2, entry.key + ': unsupported evidence schema.');
    assert.equal(evidence.run.status, 'complete', entry.key + ': incomplete search.');
    assert.equal(evidence.model.regionId, entry.key, entry.key + ': evidence region mismatch.');
    assert.equal(protocol.schemaVersion, 3, entry.key + ': unsupported generated protocol schema.');
    assert.equal(protocol.key, entry.key);
    assert.equal(protocol.regionId, entry.regionId);
    assert.equal(protocol.profileId, entry.profileId);
    const { contentDigestSha256, ...protocolContent } = protocol;
    assert.equal(contentDigestSha256, sha256(stableStringify(protocolContent)));
    assert.equal(entry.evidence.evidenceFileSha256, sha256(evidenceBytes), entry.key + ': evidence file digest mismatch.');
    assert.equal(protocol.evidence.mechanicalEvidenceDigestSha256, mechanicalEvidenceDigest(evidence),
        entry.key + ': stable mechanical evidence digest mismatch.');
    assert(!Object.hasOwn(protocol.evidence, 'evidenceFileSha256'),
        entry.key + ': volatile evidence-file digest must not feed protocol identity.');
    assert(!Object.hasOwn(protocol.evidence, 'sourceFile'),
        entry.key + ': repository path must not feed protocol identity.');
    assert.equal(entry.evidenceUrl, undefined, entry.key + ': non-public evidence URL must not be exposed.');
    assert.equal(bareDigest(entry.reportProtocol.digest), protocol.contentDigestSha256);
    assert.deepEqual(protocol.model, entry.model);
    assert.deepEqual(protocol.model, { ...regionalModelIdentity(evidence.model), sideMode: 'native' });
    assert.equal(protocol.model.modelId, entry.key === 'right-hand'
        ? 'MS_HUMAN_700_RIGHT_HAND_STATIC_V1'
        : 'MS_HUMAN_700_PRIMARY_REGIONS_V1');
    assert.equal(protocol.model.sourceModelId, evidence.model.modelId);
    assert.deepEqual(protocol.coordinateOrder, evidence.search.coordinateOrder);
    assert.deepEqual(protocol.evidence.selectedSourceCandidateIds, entry.positions.map((position) => position.sourceCandidateId));

    const config = REGIONAL_ASSESSMENT_CONFIGS[entry.key];
    assert(config, entry.key + ': regional selection configuration is missing.');
    const replayRegion = {
        id: entry.key,
        coordinates: evidence.search.coordinateOrder.map((name) => ({
            name,
            minimumDegrees: evidence.search.authoredRangesDegrees[name].minimumDegrees,
            maximumDegrees: evidence.search.authoredRangesDegrees[name].maximumDegrees,
            defaultDegrees: evidence.search.authoredRangesDegrees[name].defaultDegrees
        })),
        muscles: evidence.muscles
    };
    const replay = selectPanel(evidence.usableCandidates, replayRegion, config);
    assert.deepEqual(replay.selectedPositions.map((position) => position.id),
        evidence.selection.selectedPositions.map((position) => position.id),
        entry.key + ': selection replay source ids differ.');
    assert.deepEqual(replay.selectedPositions.map((position) => position.selectionOrder),
        evidence.selection.selectedPositions.map((position) => position.selectionOrder),
        entry.key + ': selection replay order differs.');
    assert.deepEqual(replay.rankEvidence, evidence.selection.rankEvidence,
        entry.key + ': selection replay rank metrics differ.');
    assert.deepEqual(replay.panelDiversity, evidence.selection.panelDiversity,
        entry.key + ': selection replay diversity metrics differ.');
    assert.deepEqual(replay.responseDiversity, evidence.selection.responseDiversity,
        entry.key + ': selection replay response-range metrics differ.');
    assert.deepEqual(replay, evidence.selection, entry.key + ': complete selection replay differs.');

    const timingPerturbed = structuredClone(evidence);
    timingPerturbed.run.observedRoundTripMs = { median: 9876, percentile95: 12345, total: 67890 };
    for (const candidate of timingPerturbed.usableCandidates) {
        candidate.quality.solverDurationMs = 7654.3;
        candidate.quality.observedRoundTripMs = 8765.4;
    }
    assert.equal(mechanicalEvidenceDigest(timingPerturbed), mechanicalEvidenceDigest(evidence),
        entry.key + ': timing noise changed semantic evidence identity.');

    const bySourceId = new Map(evidence.selection.selectedPositions.map((position) => [position.id, position]));
    let previousTier = -1;
    const actualTierCounts = { accessible: 0, moderate: 0, broad: 0 };
    for (const position of entry.positions) {
        const source = bySourceId.get(position.sourceCandidateId);
        assert(source, entry.key + ': missing evidence for ' + position.sourceCandidateId + '.');
        assert.deepEqual(position.coordinates, source.coordinates, position.id + ': coordinates differ from evidence.');
        assert.equal(position.tier, source.tier, position.id + ': tier differs from evidence.');
        assert.notEqual(position.tier, 'outside-envelope', position.id + ': outside-envelope posture was admitted.');
        const tier = TIER_ORDER[position.tier];
        assert(Number.isInteger(tier), position.id + ': unknown tier ' + position.tier + '.');
        assert(tier >= previousTier, entry.key + ': positions must progress from accessible to broad.');
        previousTier = tier;
        if (position.tier in actualTierCounts) actualTierCounts[position.tier] += 1;
        for (const [coordinate, value] of Object.entries(position.coordinates)) {
            const range = protocol.coordinateRanges[coordinate];
            assert(range, position.id + ': missing coordinate range for ' + coordinate + '.');
            assert(value >= range.minimum && value <= range.maximum, position.id + ': ' + coordinate + ' is out of range.');
        }
    }
    assert.deepEqual(actualTierCounts, evidence.selection.objective.selectedByTier, entry.key + ': tier quota result mismatch.');
    assert.equal(entry.positions[0].tier, 'neutral-reference', entry.key + ': first posture must be neutral.');
    assert.equal(entry.positions.length, evidence.selection.selectedPositions.length);
    assert(entry.positions.length >= evidence.selection.objective.stoppingRule.minimumPanelCount);
    assert(entry.positions.length <= evidence.selection.objective.stoppingRule.maximumPanelCount);

    const responseDiversity = evidence.selection.responseDiversity;
    assert.equal(protocol.evidence.responsiveInSampledPosesCount, responseDiversity.responsiveInSampledPosesCount);
    assert.equal(protocol.evidence.sampledMuscleCount, responseDiversity.sampledMuscleCount);
    assert.equal(protocol.evidence.effectiveRank, evidence.selection.rankEvidence.effectiveRank);
    assert.equal(protocol.evidence.robustRank, evidence.selection.rankEvidence.robustRank);
    assert(entry.limitations.some((text) => /not patient|not a patient|not patient measurements/i.test(text)),
        entry.key + ': patient-data limitation is missing.');

    if (entry.key === 'right-foot-ankle' || entry.key === 'left-foot-ankle') {
        assert.equal(protocol.evidence.responseDiversityStatus, 'limited');
        assert.equal(protocol.evidence.responsiveInSampledPosesCount, 1);
        assert.equal(protocol.evidence.sampledMuscleCount, 11);
        assert(entry.limitations.some((text) => /do not use.*muscle-specific inference/i.test(text)),
            entry.key + ': limited-response-diversity warning is missing.');
    }
}

const generatedBytes = await readFile(GENERATED_PATH, 'utf8');
const rebuiltBytes = execFileSync(process.execPath, [BUILDER_PATH, '--stdout'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
});
assert.equal(rebuiltBytes, generatedBytes, 'Generated protocol module is stale; run the builder.');

process.stdout.write('Validated 9 protocols (1 preserved right-arm V2 + 8 generated regional protocols).\n');
