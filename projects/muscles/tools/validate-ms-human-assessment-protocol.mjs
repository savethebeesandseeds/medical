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
const atlasPath = join(root, 'tools', 'ms-human-assessment-atlas-384.json');

const POSITION_COUNT = 20;
const ACTIVATION_COUNT = 88;
const PROXIMAL_COORDINATE_KEYS = Object.freeze([
    'elv_angle_r',
    'shoulder_elv_r',
    'shoulder_rot_r',
    'elbow_flexion_r'
]);
const SOURCE_COORDINATE_FOR = Object.freeze({
    elv_angle_r: 'elv_angle',
    shoulder_elv_r: 'shoulder_elv',
    shoulder_rot_r: 'shoulder_rot',
    elbow_flexion_r: 'elbow_flexion',
    pro_sup_r: 'pro_sup',
    deviation_r: 'deviation',
    flexion_r: 'flexion'
});
const DIVERSITY_GATES = Object.freeze({
    minimumRawActivationRms: 0.04,
    minimumAtlasScaledActivationRms: 0.35,
    minimumPanelNormalizedActivationRms: 0.20,
    minimumNormalizedFullPoseRms: 0.11,
    minimumNormalizedProximalPoseRms: 0.10,
    minimumObservableActuators: 80,
    observableActivationRange: 0.02,
    minimumEffectiveRank: 8,
    minimumRobustNumericalRank: 16,
    robustSingularValueRatio: 0.10
});

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

function rmsDistance(first, second) {
    assert.equal(first.length, second.length);
    return Math.sqrt(first.reduce((sum, value, index) => {
        const difference = value - second[index];
        return sum + difference * difference;
    }, 0) / first.length);
}

function pairwiseStats(vectors) {
    const distances = [];
    for (let first = 0; first < vectors.length; first += 1) {
        for (let second = first + 1; second < vectors.length; second += 1) {
            distances.push(rmsDistance(vectors[first], vectors[second]));
        }
    }
    distances.sort((left, right) => left - right);
    const middle = Math.floor(distances.length / 2);
    return {
        pairCount: distances.length,
        minimum: distances[0],
        median: distances.length % 2 === 0
            ? (distances[middle - 1] + distances[middle]) / 2
            : distances[middle],
        maximum: distances.at(-1)
    };
}

function quantile(values, probability) {
    const sorted = [...values].sort((left, right) => left - right);
    const position = (sorted.length - 1) * probability;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function approximatelyEqual(actual, expected, tolerance = 1e-9) {
    return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(actual), Math.abs(expected));
}

function assertFiniteVector(vector, length, label) {
    assert(Array.isArray(vector), `${label} must be an array.`);
    assert.equal(vector.length, length, `${label} must contain ${length} values.`);
    for (const value of vector) assert(Number.isFinite(value), `${label} contains a non-finite value.`);
}

// Jacobi diagonalization is sufficient here because the centered activation
// The Gram matrix is only POSITION_COUNT x POSITION_COUNT. It avoids a runtime
// numeric dependency while still checking the full posture-by-actuator matrix.
function symmetricEigenvalues(matrix) {
    const size = matrix.length;
    const values = matrix.map((row) => [...row]);
    const maximumIterations = 100 * size * size;
    for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
        let rowIndex = 0;
        let columnIndex = 1;
        let largest = 0;
        for (let row = 0; row < size; row += 1) {
            for (let column = row + 1; column < size; column += 1) {
                const magnitude = Math.abs(values[row][column]);
                if (magnitude > largest) {
                    largest = magnitude;
                    rowIndex = row;
                    columnIndex = column;
                }
            }
        }
        if (largest <= 1e-12) break;

        const app = values[rowIndex][rowIndex];
        const aqq = values[columnIndex][columnIndex];
        const apq = values[rowIndex][columnIndex];
        const angle = 0.5 * Math.atan2(2 * apq, aqq - app);
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);

        for (let index = 0; index < size; index += 1) {
            if (index === rowIndex || index === columnIndex) continue;
            const aip = values[index][rowIndex];
            const aiq = values[index][columnIndex];
            values[index][rowIndex] = cosine * aip - sine * aiq;
            values[rowIndex][index] = values[index][rowIndex];
            values[index][columnIndex] = sine * aip + cosine * aiq;
            values[columnIndex][index] = values[index][columnIndex];
        }
        values[rowIndex][rowIndex] = cosine * cosine * app
            - 2 * sine * cosine * apq
            + sine * sine * aqq;
        values[columnIndex][columnIndex] = sine * sine * app
            + 2 * sine * cosine * apq
            + cosine * cosine * aqq;
        values[rowIndex][columnIndex] = 0;
        values[columnIndex][rowIndex] = 0;
    }
    return values.map((row, index) => Math.max(0, row[index])).sort((left, right) => right - left);
}

function activationMatrixRankMetrics(vectors) {
    const actuatorMeans = Array.from({ length: ACTIVATION_COUNT }, (_, actuator) => (
        vectors.reduce((sum, vector) => sum + vector[actuator], 0) / vectors.length
    ));
    const centered = vectors.map((vector) => vector.map((value, actuator) => value - actuatorMeans[actuator]));
    const gram = centered.map((first) => centered.map((second) => (
        first.reduce((sum, value, actuator) => sum + value * second[actuator], 0)
    )));
    const eigenvalues = symmetricEigenvalues(gram);
    const totalEnergy = eigenvalues.reduce((sum, value) => sum + value, 0);
    assert(totalEnergy > 0, 'Activation evidence has no centered variation.');
    const probabilities = eigenvalues.filter((value) => value > 1e-15).map((value) => value / totalEnergy);
    const effectiveRank = Math.exp(-probabilities.reduce((sum, probability) => (
        sum + probability * Math.log(probability)
    ), 0));
    const largestEigenvalue = eigenvalues[0];
    const robustEigenvalueThreshold = largestEigenvalue * DIVERSITY_GATES.robustSingularValueRatio ** 2;
    return {
        effectiveRank,
        stableRank: totalEnergy / largestEigenvalue,
        robustNumericalRank: eigenvalues.filter((value) => value >= robustEigenvalueThreshold).length
    };
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
const computedProtocolDigest = sha256(stableStringify(content));

// This mode lets the evidence builder intentionally pin a changed protocol
// before normal validation requires the matching evidence artifact.
if (process.argv.includes('--print-digest')) {
    console.log(computedProtocolDigest);
    process.exit(0);
}

const metadataBytes = await readFile(metadataPath);
const metadata = JSON.parse(metadataBytes.toString('utf8'));
const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
const atlasBytes = await readFile(atlasPath);
const atlas = JSON.parse(atlasBytes.toString('utf8'));

assert.equal(protocol.schemaVersion, 2);
assert.match(protocol.id, /^MSH700-.*-V2$/);
assert.match(protocol.version, /^2\.\d+\.\d+$/);
assert.match(protocol.contentDigestSha256, /^[0-9a-f]{64}$/);
assert.notEqual(protocol.contentDigestSha256, '0'.repeat(64), 'Protocol digest is still the V2 placeholder.');
assert.equal(computedProtocolDigest, protocol.contentDigestSha256, 'Protocol content digest is stale.');
assert.equal(sha256(metadataBytes), protocol.model.coordinateMetadataSha256, 'Pinned coordinate metadata digest changed.');
assert.match(protocol.derivation.interpretation, /not clinical validation/i);
assert.match(protocol.derivation.interpretation, /not .*diagnos|diagnostic evidence/i);
assert.match(protocol.derivation.solverScreen, /never admitted by weakening a gate/i);
assert.match(protocol.derivation.design, /independent postures/i);

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

assert.equal(protocol.positions.length, POSITION_COUNT);
const positions = new Map();
const sourceCandidateIds = new Set();
for (const position of protocol.positions) {
    assert.match(position.id, /^MSH-V2-\d{2}$/);
    assert(!positions.has(position.id), `Duplicate position ${position.id}.`);
    assert.match(position.sourceCandidateId, /^MSH-EXP-\d{4}$/);
    assert(!sourceCandidateIds.has(position.sourceCandidateId), `Duplicate atlas source ${position.sourceCandidateId}.`);
    assert.equal(typeof position.name, 'string');
    assert(position.name.trim().length >= 3, `${position.id} has no useful name.`);
    assert.equal(typeof position.instruction, 'string');
    assert(position.instruction.trim().length >= 20, `${position.id} has no useful instruction.`);
    assert.equal(typeof position.designRole, 'string');
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
    sourceCandidateIds.add(position.sourceCandidateId);
}
assert.equal(protocol.positions.filter((position) => position.designRole === 'reference').length, 1);
assert(protocol.positions.filter((position) => position.designRole === 'core').length >= 8);
assert(protocol.positions.some((position) => position.designRole === 'optional-advanced'));
assert.deepEqual(protocol.comparisons, [], 'V2 uses independently selected postures, not matched-pair claims.');

assert.equal(evidence.schemaVersion, 2);
assert.equal(evidence.protocolId, protocol.id);
assert.equal(evidence.protocolVersion, protocol.version);
assert.equal(evidence.protocolDigestSha256, protocol.contentDigestSha256);
assert.equal(evidence.modelId, protocol.model.modelId);
assert.equal(evidence.modelDigest, protocol.model.modelDigest);
assert.equal(evidence.runtimeModelSha256, protocol.model.runtimeModelSha256);
assert.match(evidence.qualification, /not clinical validation/i);
assert.match(evidence.qualification, /not .*diagnos|diagnosis/i);
assert.match(evidence.qualification, /not .*isolation|proof of anatomical muscle isolation/i);
assert.equal(evidence.atlas.sha256, sha256(atlasBytes), 'Evidence no longer points to the recorded atlas bytes.');
assert.equal(evidence.atlas.candidateCount, atlas.search.candidateCount);
assert.equal(evidence.atlas.usableCandidateCount, atlas.run.usableCandidateCount);
assert.equal(evidence.atlas.rejectedCandidateCount, atlas.run.failedCandidateCount);
assert.equal(evidence.summary.attemptedCandidates, atlas.run.evaluatedCandidateCount);
assert.equal(evidence.summary.usableCandidates, atlas.run.usableCandidateCount);
assert.equal(evidence.summary.rejectedCandidates, atlas.run.failedCandidateCount);
assert.equal(evidence.summary.selectedPositions, POSITION_COUNT);
assert.equal(evidence.summary.passedPositions, POSITION_COUNT);

assert(Array.isArray(evidence.muscles));
assert.equal(evidence.muscles.length, ACTIVATION_COUNT);
assert.deepEqual(evidence.muscles, atlas.muscles, 'Evidence actuator order differs from the atlas.');
const muscleNames = evidence.muscles.map((muscle) => typeof muscle === 'string' ? muscle : muscle.name);
assert.equal(new Set(muscleNames).size, ACTIVATION_COUNT, 'Evidence actuator names are not unique.');
for (let index = 0; index < evidence.muscles.length; index += 1) {
    const muscle = evidence.muscles[index];
    if (typeof muscle === 'object') assert.equal(muscle.index, index, `Muscle ${index} has a stale index.`);
}

assert.deepEqual(evidence.positions.map((item) => item.id), protocol.positions.map((item) => item.id));
assert.deepEqual(evidence.selection.sourceCandidateIds, protocol.positions.map((item) => item.sourceCandidateId));
assert.equal(evidence.positions.length, POSITION_COUNT);
const atlasCandidates = new Map(atlas.usableCandidates.map((candidate) => [candidate.id, candidate]));
const activationVectors = [];
for (const record of evidence.positions) {
    const position = positions.get(record.id);
    const atlasCandidate = atlasCandidates.get(record.sourceCandidateId);
    assert(atlasCandidate, `${record.id} references missing atlas candidate ${record.sourceCandidateId}.`);
    assert.equal(record.sourceCandidateId, position.sourceCandidateId);
    assert.equal(record.usable, true, `${record.id} failed the recorded solver quality gate.`);
    assert.equal(record.status, 'usable');
    assert.equal(record.activationCount, ACTIVATION_COUNT);
    assert.equal(record.capacityLimited, false);
    assert.deepEqual(record.coordinates, position.coordinates, `${record.id} evidence coordinates differ from the protocol.`);
    for (const key of coordinateKeys) {
        assert.equal(
            atlasCandidate.coordinates[SOURCE_COORDINATE_FOR[key]],
            position.coordinates[key],
            `${record.id} ${key} differs from its atlas candidate.`
        );
    }
    assertFiniteVector(record.activations, ACTIVATION_COUNT, `${record.id} activations`);
    assert(record.activations.every((value) => value >= 0), `${record.id} contains a negative activation.`);
    assert.deepEqual(record.activations, atlasCandidate.vectors.activation, `${record.id} activation vector differs from its atlas source.`);
    assertFiniteVector(record.activeForceN, ACTIVATION_COUNT, `${record.id} active-force vector`);
    assert.deepEqual(record.activeForceN, atlasCandidate.vectors.activeForceN, `${record.id} force vector differs from its atlas source.`);
    const maximumActivation = Math.max(...record.activations);
    const activationRms = Math.sqrt(record.activations.reduce((sum, value) => sum + value * value, 0) / ACTIVATION_COUNT);
    assert(approximatelyEqual(record.maximumActivation, maximumActivation), `${record.id} maximum activation is stale.`);
    assert(approximatelyEqual(record.activationRms, activationRms), `${record.id} activation RMS is stale.`);
    assert(record.maximumActivation < evidence.solverQualityLimits.capacityActivation);
    assert(record.maximumActivation <= evidence.solverQualityLimits.selectionMaximumActivation);
    assert(record.activationRms <= evidence.solverQualityLimits.selectionMaximumActivationRms);
    assert(record.maximumResidualNm <= evidence.solverQualityLimits.maximumResidualNm);
    assert(record.maximumReserveNm <= evidence.solverQualityLimits.maximumReserveNm);
    activationVectors.push(record.activations);
}
assert.deepEqual(evidence.comparisons, []);

const coordinateVectors = protocol.positions.map((position) => coordinateKeys.map((key) => {
    const range = protocol.coordinateRanges[key];
    return (position.coordinates[key] - range.minimum) / (range.maximum - range.minimum);
}));
const proximalIndices = PROXIMAL_COORDINATE_KEYS.map((key) => coordinateKeys.indexOf(key));
const proximalCoordinateVectors = coordinateVectors.map((vector) => proximalIndices.map((index) => vector[index]));
const rawActivationDiversity = pairwiseStats(activationVectors);
const fullPoseDiversity = pairwiseStats(coordinateVectors);
const proximalPoseDiversity = pairwiseStats(proximalCoordinateVectors);

const activationMinimums = Array.from({ length: ACTIVATION_COUNT }, (_, actuator) => (
    Math.min(...activationVectors.map((vector) => vector[actuator]))
));
const activationRanges = Array.from({ length: ACTIVATION_COUNT }, (_, actuator) => (
    Math.max(...activationVectors.map((vector) => vector[actuator])) - activationMinimums[actuator]
));
const panelNormalizedActivations = activationVectors.map((vector) => vector.map((value, actuator) => (
    (value - activationMinimums[actuator]) / Math.max(activationRanges[actuator], DIVERSITY_GATES.observableActivationRange)
)));
const panelNormalizedActivationDiversity = pairwiseStats(panelNormalizedActivations);
const observableActuators = activationRanges.filter((range) => range >= DIVERSITY_GATES.observableActivationRange).length;
const rankMetrics = activationMatrixRankMetrics(panelNormalizedActivations);

const eligibleAtlasCandidates = atlas.usableCandidates.filter((candidate) => {
    const activationRms = Math.sqrt(candidate.vectors.activation.reduce((sum, value) => sum + value * value, 0) / ACTIVATION_COUNT);
    return candidate.quality.capacityLimited !== true
        && Math.max(...candidate.vectors.activation) <= evidence.selection.filters.maximumActivation
        && activationRms <= evidence.selection.filters.maximumActivationRms;
});
assert.equal(evidence.selection.eligibleCandidateCount, eligibleAtlasCandidates.length);
const atlasScales = evidence.selection.activationScaleByMuscle;
assert.equal(atlasScales.length, ACTIVATION_COUNT);
for (let index = 0; index < atlasScales.length; index += 1) {
    assert.equal(atlasScales[index].index, index);
    assert.equal(atlasScales[index].name, muscleNames[index]);
    assert(atlasScales[index].percentile95Activation >= DIVERSITY_GATES.observableActivationRange);
    const recomputed = Math.max(DIVERSITY_GATES.observableActivationRange, quantile(
        eligibleAtlasCandidates.map((candidate) => candidate.vectors.activation[index]),
        0.95
    ));
    assert(approximatelyEqual(atlasScales[index].percentile95Activation, recomputed),
        `Filtered activation scale for ${muscleNames[index]} is stale.`);
}
const atlasScaledActivations = activationVectors.map((vector) => vector.map((value, actuator) => (
    Math.min(1.5, value / atlasScales[actuator].percentile95Activation)
)));
const atlasScaledActivationDiversity = pairwiseStats(atlasScaledActivations);

assert(rawActivationDiversity.minimum >= DIVERSITY_GATES.minimumRawActivationRms,
    `Raw activation diversity regressed to ${rawActivationDiversity.minimum}.`);
assert(atlasScaledActivationDiversity.minimum >= DIVERSITY_GATES.minimumAtlasScaledActivationRms,
    `Atlas-scaled activation diversity regressed to ${atlasScaledActivationDiversity.minimum}.`);
assert(panelNormalizedActivationDiversity.minimum >= DIVERSITY_GATES.minimumPanelNormalizedActivationRms,
    `Panel-normalized activation diversity regressed to ${panelNormalizedActivationDiversity.minimum}.`);
assert(fullPoseDiversity.minimum >= DIVERSITY_GATES.minimumNormalizedFullPoseRms,
    `Full-pose diversity regressed to ${fullPoseDiversity.minimum}.`);
assert(proximalPoseDiversity.minimum >= DIVERSITY_GATES.minimumNormalizedProximalPoseRms,
    `Proximal-pose diversity regressed to ${proximalPoseDiversity.minimum}.`);
assert(observableActuators >= DIVERSITY_GATES.minimumObservableActuators,
    `Only ${observableActuators} actuators vary by at least ${DIVERSITY_GATES.observableActivationRange}.`);
assert(rankMetrics.effectiveRank >= DIVERSITY_GATES.minimumEffectiveRank,
    `Activation effective rank regressed to ${rankMetrics.effectiveRank}.`);
assert(rankMetrics.robustNumericalRank >= DIVERSITY_GATES.minimumRobustNumericalRank,
    `Activation robust numerical rank regressed to ${rankMetrics.robustNumericalRank}.`);

assert.equal(reportProtocol.id, protocol.id);
assert.equal(reportProtocol.version, protocol.version);
assert.equal(reportProtocol.digest, `sha256:${protocol.contentDigestSha256}`);
assert.deepEqual(reportProtocol.trialIds, protocol.positions.map((item) => item.id));
assert.deepEqual(reportProtocol.matchedComparisons, []);

console.log(JSON.stringify({
    status: 'ok',
    protocolId: protocol.id,
    version: protocol.version,
    digest: protocol.contentDigestSha256,
    positions: protocol.positions.length,
    independentPostures: protocol.comparisons.length === 0,
    solverPassed: evidence.summary.passedPositions,
    diversity: {
        rawActivationRms: rawActivationDiversity,
        atlasScaledActivationRms: atlasScaledActivationDiversity,
        panelNormalizedActivationRms: panelNormalizedActivationDiversity,
        normalizedFullPoseRms: fullPoseDiversity,
        normalizedProximalPoseRms: proximalPoseDiversity,
        observableActuators,
        effectiveRank: rankMetrics.effectiveRank,
        stableRank: rankMetrics.stableRank,
        robustNumericalRank: rankMetrics.robustNumericalRank
    },
    solver: {
        maximumObservedActivation: evidence.summary.maximumObservedActivation,
        maximumObservedActivationRms: evidence.summary.maximumObservedActivationRms,
        maximumObservedResidualNm: evidence.summary.maximumObservedResidualNm,
        maximumObservedReserveNm: evidence.summary.maximumObservedReserveNm
    },
    qualification: evidence.qualification
}, null, 2));
