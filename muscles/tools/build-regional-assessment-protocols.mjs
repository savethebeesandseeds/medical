#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    mechanicalEvidenceDigest,
    regionalModelIdentity,
    sha256,
    stableStringify
} from './search-ms-human/regional-assessment-provenance.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_DIRECTORY = join(ROOT, 'tools', 'regional-assessment-evidence');
const OUTPUT_PATH = join(ROOT, 'public', 'generated-regional-assessment-protocols.js');

const REGION_SPECS = Object.freeze([
    {
        file: 'left-upper-limb-atlas.json', key: 'left-upper-limb', code: 'MSH-LARM', side: 'left',
        title: 'Left upper limb', shortTitle: 'Left arm', positionNoun: 'arm',
        description: 'Activation-diverse, unloaded left-arm observation sequence.',
        intakeLocationOptions: ['Front of shoulder', 'Side of shoulder', 'Back of shoulder', 'Upper arm', 'Elbow', 'Forearm', 'Wrist or hand', 'Diffuse or uncertain']
    },
    {
        file: 'right-lower-limb-atlas.json', key: 'right-lower-limb', code: 'MSH-RLEG', side: 'right',
        title: 'Right lower limb', shortTitle: 'Right leg', positionNoun: 'leg',
        description: 'Activation-diverse, unloaded open-chain right-leg observation sequence.',
        intakeLocationOptions: ['Hip or groin', 'Front of thigh', 'Back of thigh', 'Knee', 'Shin or calf', 'Ankle', 'Foot', 'Diffuse or uncertain']
    },
    {
        file: 'left-lower-limb-atlas.json', key: 'left-lower-limb', code: 'MSH-LLEG', side: 'left',
        title: 'Left lower limb', shortTitle: 'Left leg', positionNoun: 'leg',
        description: 'Activation-diverse, unloaded open-chain left-leg observation sequence.',
        intakeLocationOptions: ['Hip or groin', 'Front of thigh', 'Back of thigh', 'Knee', 'Shin or calf', 'Ankle', 'Foot', 'Diffuse or uncertain']
    },
    {
        file: 'right-foot-ankle-atlas.json', key: 'right-foot-ankle', code: 'MSH-RFOOT', side: 'right',
        title: 'Right foot and ankle', shortTitle: 'Right foot', positionNoun: 'foot-and-ankle',
        description: 'Unloaded right foot-and-ankle observation sequence with limited response diversity in the sampled poses.',
        intakeLocationOptions: ['Front of ankle', 'Back of ankle or Achilles', 'Inside ankle', 'Outside ankle', 'Heel', 'Arch or sole', 'Forefoot or toes', 'Diffuse or uncertain']
    },
    {
        file: 'left-foot-ankle-atlas.json', key: 'left-foot-ankle', code: 'MSH-LFOOT', side: 'left',
        title: 'Left foot and ankle', shortTitle: 'Left foot', positionNoun: 'foot-and-ankle',
        description: 'Unloaded left foot-and-ankle observation sequence with limited response diversity in the sampled poses.',
        intakeLocationOptions: ['Front of ankle', 'Back of ankle or Achilles', 'Inside ankle', 'Outside ankle', 'Heel', 'Arch or sole', 'Forefoot or toes', 'Diffuse or uncertain']
    },
    {
        file: 'trunk-atlas.json', key: 'trunk', code: 'MSH-TRUNK', side: 'both',
        title: 'Back and trunk', shortTitle: 'Back and trunk', positionNoun: 'trunk',
        description: 'Activation-diverse trunk observation sequence with the pelvis, limbs, and head fixed.',
        intakeLocationOptions: ['Upper back', 'Mid back', 'Lower back', 'Side of trunk', 'Front of trunk', 'Across several areas', 'Diffuse or uncertain']
    },
    {
        file: 'head-neck-atlas.json', key: 'head-neck', code: 'MSH-NECK', side: 'midline',
        title: 'Head and neck', shortTitle: 'Head and neck', positionNoun: 'head-and-neck',
        description: 'Activation-diverse head-and-neck observation sequence with the body below T1 fixed.',
        intakeLocationOptions: ['Front of neck', 'Side of neck', 'Back of neck', 'Base of skull', 'Upper shoulder', 'Across several areas', 'Diffuse or uncertain']
    },
    {
        file: 'right-hand-atlas.json', key: 'right-hand', code: 'MSH-RHAND', side: 'right',
        title: 'Right hand', shortTitle: 'Right hand', positionNoun: 'hand',
        description: 'Activation-diverse, unloaded right-hand observation sequence without grip or contact.',
        intakeLocationOptions: ['Wrist', 'Palm', 'Back of hand', 'Thumb', 'Index finger', 'Middle finger', 'Ring finger', 'Little finger', 'Diffuse or uncertain']
    }
]);

const COORDINATE_LABELS = Object.freeze({
    elv_angle_l: 'Shoulder elevation plane', shoulder_elv_l: 'Shoulder elevation', shoulder_rot_l: 'Shoulder rotation',
    elbow_flexion_l: 'Elbow flexion', pro_sup_l: 'Forearm rotation', deviation_l: 'Wrist deviation', flexion_l: 'Wrist flexion',
    hip_flexion_r: 'Hip flexion', hip_adduction_r: 'Hip adduction', hip_rotation_r: 'Hip rotation', knee_angle_r: 'Knee flexion',
    ankle_angle_r: 'Ankle angle', subtalar_angle_r: 'Subtalar angle', mtp_angle_r: 'Toe angle',
    hip_flexion_l: 'Hip flexion', hip_adduction_l: 'Hip adduction', hip_rotation_l: 'Hip rotation', knee_angle_l: 'Knee flexion',
    ankle_angle_l: 'Ankle angle', subtalar_angle_l: 'Subtalar angle', mtp_angle_l: 'Toe angle',
    L5_S1_FE: 'Lower-trunk flexion / extension', L5_S1_LB: 'Lower-trunk lateral bending', L5_S1_AR: 'Lower-trunk rotation',
    T12_L1_FE: 'Upper-trunk flexion / extension', T12_L1_LB: 'Upper-trunk lateral bending', T12_L1_AR: 'Upper-trunk rotation',
    T1_head_neck_FE: 'Neck flexion / extension', T1_head_neck_LB: 'Neck lateral bending', T1_head_neck_AR: 'Neck rotation',
    deviation: 'Wrist deviation', flexion: 'Wrist flexion', cmc_flexion: 'Thumb CMC flexion', cmc_abduction: 'Thumb CMC abduction',
    mp_flexion: 'Thumb MP flexion', ip_flexion: 'Thumb IP flexion',
    '2mcp_abduction': 'Index MCP abduction', '2mcp_flexion': 'Index MCP flexion', '2pm_flexion': 'Index PIP flexion', '2md_flexion': 'Index DIP flexion',
    '3mcp_abduction': 'Middle MCP abduction', '3mcp_flexion': 'Middle MCP flexion', '3pm_flexion': 'Middle PIP flexion', '3md_flexion': 'Middle DIP flexion',
    '4cmc_flexion': 'Ring CMC flexion', '4mcp_abduction': 'Ring MCP abduction', '4mcp_flexion': 'Ring MCP flexion', '4pm_flexion': 'Ring PIP flexion', '4md_flexion': 'Ring DIP flexion',
    '5mcp_abduction': 'Little MCP abduction', '5mcp_flexion': 'Little MCP flexion', '5pm_flexion': 'Little PIP flexion', '5md_flexion': 'Little DIP flexion'
});

function round(value, digits = 8) {
    if (!Number.isFinite(value)) return null;
    return Number(value.toFixed(digits));
}

function humanizeCoordinate(key) {
    return COORDINATE_LABELS[key] || key.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function coordinateRanges(evidence) {
    return Object.fromEntries(evidence.search.coordinateOrder.map((key) => {
        const range = evidence.search.authoredRangesDegrees[key];
        assert(range, `${evidence.model.regionId}: missing range for ${key}.`);
        return [key, {
            label: humanizeCoordinate(key),
            minimum: range.minimumDegrees,
            maximum: range.maximumDegrees,
            default: range.defaultDegrees
        }];
    }));
}

function largestCoordinateChanges(position, ranges) {
    return Object.entries(position.coordinates).map(([key, value]) => {
        const range = ranges[key];
        const denominator = value < range.default
            ? range.default - range.minimum
            : range.maximum - range.default;
        return {
            key,
            label: range.label,
            value,
            delta: value - range.default,
            normalized: denominator > 0 ? Math.abs(value - range.default) / denominator : 0
        };
    }).filter((item) => item.normalized >= 0.05)
        .sort((left, right) => right.normalized - left.normalized || left.key.localeCompare(right.key))
        .slice(0, 2);
}

function describePosition(spec, position, ranges, index) {
    if (index === 0) {
        return {
            name: `${spec.shortTitle} neutral reference`,
            instruction: `Begin in the displayed neutral ${spec.positionNoun} posture. Do not hold it if it is uncomfortable.`
        };
    }
    const changes = largestCoordinateChanges(position, ranges);
    const tier = position.tier === 'accessible' ? 'Accessible'
        : position.tier === 'moderate' ? 'Moderate'
            : position.tier === 'broad' ? 'Broader' : 'Reference';
    const shortChanges = changes.map((item) => item.label.toLowerCase()).join(' + ') || 'combined coordinates';
    const exactChanges = changes.map((item) => `${item.label} ${item.delta >= 0 ? '+' : ''}${round(item.delta, 1)}°`).join(' and ');
    return {
        name: `${tier} ${shortChanges} posture`,
        instruction: `Match the displayed ${spec.positionNoun} posture${exactChanges ? `; its largest changes from neutral are ${exactChanges}` : ''}. Move only within a comfortable range; stop or skip if symptoms increase.`
    };
}

function median(values) {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function buildLimitations(spec, evidence, responsiveFraction) {
    const result = [
        evidence.interpretationBoundary,
        'Static generic-model estimates are not patient measurements, muscle-isolation proof, diagnostic evidence, or treatment guidance.',
        'The sequence does not model speed, acceleration, fatigue, pain, compensation, co-contraction, or subject-specific anatomy.'
    ];
    if (spec.key.includes('lower-limb')) {
        result.unshift('This is an unloaded open-chain sequence. It does not represent standing, walking, balance, or ground-reaction forces.');
    }
    if (spec.key.includes('foot-ankle')) {
        result.unshift(`Limited activation response diversity: only ${evidence.selection.responseDiversity.responsiveInSampledPosesCount} of ${evidence.selection.responseDiversity.sampledMuscleCount} modeled muscle actuators changed by at least ${evidence.selection.responseDiversity.responseRangeThreshold} across the sampled unloaded postures. Do not use this panel for muscle-specific inference.`);
        result.push('Intrinsic foot muscles and individual toe articulations are not represented by this regional model.');
    }
    if (spec.key === 'right-hand') result.unshift('No object, grip, pinch, or contact force is modeled.');
    if (spec.key === 'trunk') result.unshift('The pelvis, limbs, and head are fixed; this is not a lifting or whole-body balance task.');
    if (spec.key === 'head-neck') result.unshift('The body below T1 is fixed; jaw motion and subject-specific cervical mechanics are not modeled.');
    assert(responsiveFraction >= 0 && responsiveFraction <= 1);
    return result;
}

function buildProtocol(spec, evidence, evidenceBytes) {
    assert.equal(evidence.schemaVersion, 2, `${spec.file}: unsupported evidence schema.`);
    assert.equal(evidence.model.regionId, spec.key, `${spec.file}: region mismatch.`);
    assert.equal(evidence.run.status, 'complete', `${spec.file}: search is not complete.`);
    const ranges = coordinateRanges(evidence);
    const tierOrder = new Map([['neutral-reference', 0], ['accessible', 1], ['moderate', 2], ['broad', 3]]);
    const selected = [...evidence.selection.selectedPositions].sort((left, right) => (
        (tierOrder.get(left.tier) ?? 9) - (tierOrder.get(right.tier) ?? 9)
        || left.selectionOrder - right.selectionOrder
        || left.id.localeCompare(right.id)
    ));
    assert(selected.length >= evidence.selection.objective.stoppingRule.minimumPanelCount, `${spec.file}: panel stopped below its minimum.`);
    assert(selected.length <= evidence.selection.objective.stoppingRule.maximumPanelCount, `${spec.file}: panel exceeds its maximum.`);
    const sourceIds = new Set();
    const positions = selected.map((source, index) => {
        assert(!sourceIds.has(source.id), `${spec.file}: duplicate source candidate ${source.id}.`);
        sourceIds.add(source.id);
        assert.deepEqual(Object.keys(source.coordinates), evidence.search.coordinateOrder, `${source.id}: coordinate order mismatch.`);
        const description = describePosition(spec, source, ranges, index);
        return {
            id: `${spec.code}-V1-${String(index + 1).padStart(2, '0')}`,
            ...description,
            coordinates: source.coordinates,
            designRole: index === 0 ? 'reference' : source.tier === 'broad' ? 'optional-advanced' : 'core',
            sourceCandidateId: source.id,
            tier: source.tier,
            evidence: {
                searchSelectionOrder: source.selectionOrder,
                maximumActivation: source.maximumActivation,
                activationRms: source.activationRms,
                selectionScore: source.selection?.score ?? null
            }
        };
    });
    const responseDiversity = evidence.selection.responseDiversity;
    const responsiveFraction = responseDiversity.responsiveInSampledPosesCount / responseDiversity.sampledMuscleCount;
    const activationRanges = responseDiversity.muscleRanges.map((muscle) => muscle.range);
    const limitedResponseDiversity = responsiveFraction < 0.5;
    const limitations = buildLimitations(spec, evidence, responsiveFraction);
    const content = {
        schemaVersion: 3,
        id: `MSH700-${spec.key.toUpperCase()}-GLOBAL-ACTIVATION-V1`,
        version: '1.0.0',
        key: spec.key,
        regionId: spec.key,
        profileId: evidence.model.profileId,
        side: spec.side,
        classification: evidence.classification,
        model: {
            ...regionalModelIdentity(evidence.model),
            sideMode: 'native'
        },
        derivation: {
            algorithm: evidence.search.algorithm,
            selectionAlgorithm: evidence.selection.objective.algorithm,
            deterministic: evidence.search.deterministic,
            candidateCount: evidence.search.candidateCount,
            evaluatedCandidateCount: evidence.run.evaluatedCandidateCount,
            usableCandidateCount: evidence.run.usableCandidateCount,
            rejectedCandidateCount: evidence.run.failedCandidateCount,
            coordinateRoundingDegrees: evidence.search.coordinateRoundingDegrees,
            tiers: evidence.search.tiers,
            weights: evidence.selection.objective.weights,
            filters: evidence.selection.objective.filters,
            minimumPairDistance: evidence.selection.objective.minimumPairDistance,
            stoppingRule: evidence.selection.objective.stoppingRule,
            interpretation: evidence.interpretationBoundary
        },
        coordinateOrder: evidence.search.coordinateOrder,
        coordinateRanges: ranges,
        positions,
        comparisons: [],
        evidence: {
            mechanicalEvidenceDigestSha256: mechanicalEvidenceDigest(evidence),
            selectedSourceCandidateIds: positions.map((position) => position.sourceCandidateId),
            effectiveRank: evidence.selection.rankEvidence.effectiveRank,
            robustRank: evidence.selection.rankEvidence.robustRank,
            minimumActivationPatternDistance: evidence.selection.panelDiversity.activationPattern.minimum,
            responsiveInSampledPosesCount: responseDiversity.responsiveInSampledPosesCount,
            sampledMuscleCount: responseDiversity.sampledMuscleCount,
            responsiveInSampledPosesFraction: round(responsiveFraction),
            responseRangeThreshold: responseDiversity.responseRangeThreshold,
            maximumMuscleActivationRange: round(Math.max(...activationRanges)),
            medianMuscleActivationRange: round(median(activationRanges)),
            responseDiversityStatus: limitedResponseDiversity ? 'limited' : 'activation-diverse'
        },
        limitations
    };
    const digest = sha256(stableStringify(content));
    const protocol = { ...content, contentDigestSha256: digest };
    return {
        key: spec.key,
        regionId: spec.key,
        profileId: evidence.model.profileId,
        side: spec.side,
        sideOptions: [spec.side],
        titleKey: `assessment.protocol.${spec.key}.title`,
        shortTitleKey: `assessment.protocol.${spec.key}.short-title`,
        descriptionKey: `assessment.protocol.${spec.key}.description`,
        title: spec.title,
        shortTitle: spec.shortTitle,
        description: spec.description,
        positionI18nPrefix: `assessment.protocol.${spec.key}.position`,
        angleLabels: Object.fromEntries(Object.entries(ranges).map(([key, range]) => [key, range.label])),
        responseProfile: 'movement-observation-v1',
        intakeLocationOptions: spec.intakeLocationOptions,
        movementDifferenceOptions: ['No difference observed', 'Pain', 'Perceived weakness', 'Stiffness', 'Compensation', 'Unable to complete', 'Stopped for safety', 'Not attempted'],
        model: protocol.model,
        limitations,
        evidence: {
            ...protocol.evidence,
            sourceFile: `tools/regional-assessment-evidence/${spec.file}`,
            evidenceFileSha256: sha256(evidenceBytes)
        },
        protocol
    };
}

const generated = [];
for (const spec of REGION_SPECS) {
    const path = join(EVIDENCE_DIRECTORY, spec.file);
    const bytes = await readFile(path);
    generated.push(buildProtocol(spec, JSON.parse(bytes.toString('utf8')), bytes));
}

const source = `/**\n * Generated by tools/build-regional-assessment-protocols.mjs.\n * Do not edit by hand; edit the search evidence/configuration and rebuild.\n */\n\nfunction deepFreeze(value) {\n    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;\n    for (const child of Object.values(value)) deepFreeze(child);\n    return Object.freeze(value);\n}\n\nconst RECORDS = ${JSON.stringify(generated, null, 4)};\n\nexport const GENERATED_REGIONAL_ASSESSMENT_PROTOCOLS = deepFreeze(RECORDS.map((entry) => ({\n    ...entry,\n    positions: entry.protocol.positions,\n    reportProtocol: {\n        id: entry.protocol.id,\n        version: entry.protocol.version,\n        digest: \`sha256:\${entry.protocol.contentDigestSha256}\`,\n        name: \`MS-Human activation-diverse \${entry.title.toLowerCase()} observation panel\`,\n        trialIds: entry.protocol.positions.map((position) => position.id),\n        matchedComparisons: entry.protocol.comparisons\n    }\n})));\n\nexport default GENERATED_REGIONAL_ASSESSMENT_PROTOCOLS;\n`;

if (process.argv.includes('--stdout')) {
    process.stdout.write(source);
} else {
    await writeFile(OUTPUT_PATH, source, 'utf8');
    process.stdout.write(`${generated.length} regional protocols -> ${relative(ROOT, OUTPUT_PATH)}\n`);
    for (const entry of generated) {
        process.stdout.write(`${entry.key}: ${entry.protocol.positions.length} positions; ${entry.protocol.contentDigestSha256}\n`);
    }
}
