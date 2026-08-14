import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const protocolPath = join(root, 'public', 'ms-human-assessment-protocol.js');
const atlasPath = join(root, 'tools', 'ms-human-assessment-atlas-384.json');
const evidencePath = join(root, 'tools', 'ms-human-assessment-protocol-solver-evidence.json');
const EXPECTED_POSITION_COUNT = 20;

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const rms = (values) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / Math.max(1, values.length));

function quantile(values, probability) {
    const sorted = [...values].sort((left, right) => left - right);
    const position = (sorted.length - 1) * probability;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
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
const coordinateKeys = [...module.MS_HUMAN_ASSESSMENT_COORDINATE_KEYS];
const protocolDigest = sha256(stableStringify(content));
const atlasBytes = await readFile(atlasPath);
const atlas = JSON.parse(atlasBytes.toString('utf8'));
const candidates = new Map(atlas.usableCandidates.map((candidate) => [candidate.id, candidate]));
const selectionEligibleCandidates = atlas.usableCandidates.filter((candidate) => (
    candidate.quality.capacityLimited !== true
    && Math.max(...candidate.vectors.activation) <= 0.85
    && rms(candidate.vectors.activation) <= 0.15
));
const selectionActivationScales = atlas.muscles.map((muscle, actuator) => ({
    index: actuator,
    name: muscle.name,
    actuatorId: muscle.actuatorId,
    percentile95Activation: Math.max(0.02, quantile(
        selectionEligibleCandidates.map((candidate) => candidate.vectors.activation[actuator]),
        0.95
    ))
}));
const sourceCoordinateFor = Object.freeze({
    elv_angle_r: 'elv_angle',
    shoulder_elv_r: 'shoulder_elv',
    shoulder_rot_r: 'shoulder_rot',
    elbow_flexion_r: 'elbow_flexion',
    pro_sup_r: 'pro_sup',
    deviation_r: 'deviation',
    flexion_r: 'flexion'
});

assert.equal(protocol.schemaVersion, 2);
assert.equal(protocol.positions.length, EXPECTED_POSITION_COUNT);
assert.equal(protocol.comparisons.length, 0);
assert.equal(atlas.model.modelId, protocol.model.modelId);
assert.equal(atlas.model.modelDigest, protocol.model.modelDigest);
assert.equal(atlas.model.runtimeModelSha256, protocol.model.runtimeModelSha256);

const positions = protocol.positions.map((position) => {
    const candidate = candidates.get(position.sourceCandidateId);
    assert(candidate, `Missing atlas candidate ${position.sourceCandidateId} for ${position.id}.`);
    for (const key of coordinateKeys) {
        assert.equal(candidate.coordinates[sourceCoordinateFor[key]], position.coordinates[key], `${position.id} ${key} differs from its atlas candidate.`);
    }
    const activations = candidate.vectors.activation;
    const activeForceN = candidate.vectors.activeForceN;
    assert.equal(activations.length, atlas.muscles.length);
    assert.equal(activeForceN.length, atlas.muscles.length);
    return {
        id: position.id,
        sourceCandidateId: candidate.id,
        tier: candidate.tier,
        designRole: position.designRole,
        coordinates: position.coordinates,
        usable: true,
        status: candidate.quality.status,
        activationCount: activations.length,
        maximumActivation: Math.max(...activations),
        activationRms: rms(activations),
        maximumResidualNm: candidate.quality.maximumResidualNm,
        maximumReserveNm: candidate.quality.maximumReserveNm,
        capacityLimited: candidate.quality.capacityLimited,
        solverDurationMs: candidate.quality.solverDurationMs,
        activations,
        activeForceN
    };
});

const maximum = (key) => Math.max(...positions.map((position) => position[key]));
const evidence = {
    schemaVersion: 2,
    classification: atlas.classification,
    interpretationBoundary: atlas.interpretationBoundary,
    protocolId: protocol.id,
    protocolVersion: protocol.version,
    protocolDigestSha256: protocolDigest,
    modelId: protocol.model.modelId,
    modelDigest: protocol.model.modelDigest,
    runtimeModelSha256: protocol.model.runtimeModelSha256,
    solverConfigurationId: atlas.model.solverConfigId,
    solverConfigurationDigest: atlas.model.solverConfigDigest,
    solverQualityLimits: {
        maximumResidualNm: 0.0001,
        maximumReserveNm: 0.05,
        capacityActivation: 0.995,
        selectionMaximumActivation: 0.85,
        selectionMaximumActivationRms: 0.15
    },
    atlas: {
        sha256: sha256(atlasBytes),
        algorithm: atlas.search.algorithm,
        deterministic: atlas.search.deterministic,
        candidateCount: atlas.search.candidateCount,
        usableCandidateCount: atlas.run.usableCandidateCount,
        rejectedCandidateCount: atlas.run.failedCandidateCount,
        coordinateOrder: atlas.search.coordinateOrder,
        haltonBases: atlas.search.haltonBases
    },
    selection: {
        algorithm: 'constrained-deterministic-weighted-maximin-continuation-v2.1',
        weights: { activationPattern: 0.55, fullPose: 0.20, proximalPose: 0.25 },
        filters: {
            maximumActivation: 0.85,
            maximumActivationRms: 0.15,
            maximumCapacityActivation: 0.995,
            minimumRawActivationRmsFromSelected: 0.025,
            minimumNormalizedFullPoseRms: 0.11,
            minimumNormalizedProximalPoseRms: 0.10
        },
        basePositionCount: 15,
        supplementalPositionCount: 5,
        marginalSelectionOrder: [
            'MSH-EXP-0335',
            'MSH-EXP-0237',
            'MSH-EXP-0168',
            'MSH-EXP-0341',
            'MSH-EXP-0313'
        ],
        stoppingRule: 'Stop after five additions: the next eligible candidate improved effective rank by less than one percent and did not improve robust numerical rank or family discrimination.',
        measuredGain: {
            effectiveRankBefore: 7.14819068,
            effectiveRankAfter: 8.09698074,
            robustNumericalRankBefore: 13,
            robustNumericalRankAfter: 16
        },
        eligibleCandidateCount: selectionEligibleCandidates.length,
        activationScaleByMuscle: selectionActivationScales,
        sourceCandidateIds: positions.map((position) => position.sourceCandidateId),
        note: 'Selection optimizes generic-model experiment diversity. Supplemental rows are sequenced from lower to higher demand. It does not establish clinical muscle isolation or diagnostic validity.'
    },
    muscles: atlas.muscles,
    summary: {
        attemptedCandidates: atlas.run.evaluatedCandidateCount,
        usableCandidates: atlas.run.usableCandidateCount,
        rejectedCandidates: atlas.run.failedCandidateCount,
        selectedPositions: positions.length,
        passedPositions: positions.filter((position) => position.usable).length,
        maximumObservedActivation: maximum('maximumActivation'),
        maximumObservedActivationRms: maximum('activationRms'),
        maximumObservedResidualNm: maximum('maximumResidualNm'),
        maximumObservedReserveNm: maximum('maximumReserveNm')
    },
    positions,
    comparisons: [],
    qualification: 'Mechanical solver and generic-model experiment-design evidence only; not clinical validation, an individual measurement, a diagnosis, or proof of anatomical muscle isolation.'
};

await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
    status: 'written',
    evidencePath,
    protocolDigestSha256: protocolDigest,
    positions: positions.length,
    muscles: atlas.muscles.length,
    maximumObservedActivation: evidence.summary.maximumObservedActivation,
    maximumObservedActivationRms: evidence.summary.maximumObservedActivationRms
}, null, 2));
