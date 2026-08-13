#!/usr/bin/env node
/**
 * Generate the deterministic MS-Human-700 multi-region Explorer manifest.
 *
 * Candidate muscles are selected by their maximum equality-projected active
 * generalized-force contribution across a fixed pose sweep.  This is a model
 * inventory and mechanical relevance test; it is not clinical validation.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOL_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY = path.resolve(TOOL_DIRECTORY, '..');
const PUBLIC_MODEL_DIRECTORY = path.join(REPOSITORY, 'public', 'models', 'ms_human_700');
const RUNTIME_PATH = path.join(PUBLIC_MODEL_DIRECTORY, 'right-arm-runtime.mjb');
const GEOMETRY_PATH = path.join(PUBLIC_MODEL_DIRECTORY, 'right-arm.meshbin');
const LEGACY_METADATA_PATH = path.join(PUBLIC_MODEL_DIRECTORY, 'right-arm.json');
const OUTPUT_PATH = path.join(PUBLIC_MODEL_DIRECTORY, 'body-regions.json');
const EVIDENCE_PATH = path.join(TOOL_DIRECTORY, 'ms-human-region-evidence.json');
const MUJOCO_MODULE_PATH = path.join(REPOSITORY, 'public', 'vendor', 'mujoco.js');
const MUJOCO_WASM_PATH = path.join(REPOSITORY, 'public', 'vendor', 'mujoco.wasm');

const RADIANS_TO_DEGREES = 180 / Math.PI;
const DEGREES_TO_RADIANS = Math.PI / 180;
const ABSOLUTE_TORQUE_THRESHOLD_NM = 1e-8;
const RELATIVE_TORQUE_THRESHOLD = 1e-10;
const AXIS_SWEEP_FRACTIONS = Object.freeze([0.35, 0.7]);
const HALTON_POSE_COUNT = 16;
const HALTON_BASES = Object.freeze([2, 3, 5, 7, 11, 13, 17]);
const EXPECTED_MUJOCO_VERSION = '3.10.0';
const MANIFEST_ID = 'MS_HUMAN_700_REGION_MANIFEST_V1';

const UPPER_COORDINATES = Object.freeze([
    ['elv_angle', 'Shoulder elevation plane'],
    ['shoulder_elv', 'Shoulder elevation'],
    ['shoulder_rot', 'Shoulder rotation'],
    ['elbow_flexion', 'Elbow flexion'],
    ['pro_sup', 'Forearm rotation'],
    ['deviation', 'Wrist deviation'],
    ['flexion', 'Wrist flexion']
]);

const LOWER_COORDINATES = Object.freeze([
    ['hip_flexion', 'Hip flexion'],
    ['hip_adduction', 'Hip adduction'],
    ['hip_rotation', 'Hip rotation'],
    ['knee_angle', 'Knee flexion'],
    ['ankle_angle', 'Ankle angle'],
    ['subtalar_angle', 'Subtalar angle'],
    ['mtp_angle', 'MTP angle']
]);

const TRUNK_COORDINATES = Object.freeze([
    ['L5_S1_FE', 'Lower-trunk flexion / extension'],
    ['L5_S1_LB', 'Lower-trunk lateral bending'],
    ['L5_S1_AR', 'Lower-trunk axial rotation'],
    ['T12_L1_FE', 'Upper-trunk flexion / extension'],
    ['T12_L1_LB', 'Upper-trunk lateral bending'],
    ['T12_L1_AR', 'Upper-trunk axial rotation']
]);

const HEAD_COORDINATES = Object.freeze([
    ['T1_head_neck_FE', 'Head / neck flexion / extension'],
    ['T1_head_neck_LB', 'Head / neck lateral bending'],
    ['T1_head_neck_AR', 'Head / neck axial rotation']
]);

function upperPresetGroups(side) {
    const key = (name) => `${name}_${side}`;
    const pose = (values = {}) => Object.fromEntries(Object.entries(values).map(([name, value]) => [key(name), value]));
    return [
        {
            id: 'functional-reference', label: 'Functional reference', presets: [
                { id: 'arm-side', label: 'Arm by side', description: 'Authored neutral upper-limb posture.', coordinates: {} },
                { id: 'forward-reach', label: 'Forward reach', description: 'Moderate forward reach with a partly bent elbow.', coordinates: pose({ elv_angle: 90, shoulder_elv: 45, elbow_flexion: 30 }) },
                { id: 'hand-to-mouth', label: 'Hand to mouth', description: 'Flexed elbow with moderate forearm supination.', coordinates: pose({ elv_angle: 90, shoulder_elv: 35, elbow_flexion: 120, pro_sup: -45 }) },
                { id: 'cross-body-reach', label: 'Cross-body reach', description: 'Raised, partly bent cross-body reference.', coordinates: pose({ elv_angle: 120, shoulder_elv: 90, elbow_flexion: 30 }) },
                { id: 'hand-behind-head', label: 'Hand behind head', description: 'Raised and externally rotated shoulder reference.', coordinates: pose({ elv_angle: 30, shoulder_elv: 120, shoulder_rot: 35, elbow_flexion: 120 }) },
                { id: 'high-forward-reach', label: 'High forward reach', description: 'High forward elevation reference.', coordinates: pose({ elv_angle: 90, shoulder_elv: 110 }) }
            ]
        },
        {
            id: 'shoulder-elevation', label: 'Shoulder elevation', presets: [
                { id: 'flexion-90', label: 'Forward 90°', description: 'Forward-plane shoulder elevation reference.', coordinates: pose({ elv_angle: 90, shoulder_elv: 90 }) },
                { id: 'abduction-90', label: 'Abduction 90°', description: 'Side-plane shoulder elevation reference.', coordinates: pose({ shoulder_elv: 90 }) },
                { id: 'scaption-90', label: 'Scaption 90°', description: 'Scapular-plane shoulder elevation reference.', coordinates: pose({ elv_angle: 30, shoulder_elv: 90 }) }
            ]
        },
        {
            id: 'shoulder-rotation', label: 'Shoulder rotation', presets: [
                { id: 'external-side', label: 'External rotation', description: 'External-rotation reference with the elbow flexed.', coordinates: pose({ shoulder_rot: -35, elbow_flexion: 90 }) },
                { id: 'internal-side', label: 'Internal rotation', description: 'Internal-rotation reference with the elbow flexed.', coordinates: pose({ shoulder_rot: 45, elbow_flexion: 90 }) },
                { id: 'rotation-90-90', label: '90/90 external rotation', description: 'Elevated external-rotation reference.', coordinates: pose({ shoulder_elv: 90, shoulder_rot: -35, elbow_flexion: 90 }) },
                { id: 'scaption-ir', label: 'Scaption internal rotation', description: 'Elevated internal-rotation reference in the scapular plane.', coordinates: pose({ elv_angle: 30, shoulder_elv: 90, shoulder_rot: 45 }) }
            ]
        },
        {
            id: 'elbow-forearm', label: 'Elbow and forearm', presets: [
                { id: 'elbow-90', label: 'Elbow 90°', description: 'Isolated elbow-flexion reference.', coordinates: pose({ elbow_flexion: 90 }) },
                { id: 'elbow-120', label: 'Elbow 120°', description: 'Deep elbow-flexion reference.', coordinates: pose({ elbow_flexion: 120 }) },
                { id: 'elbow-supinated', label: 'Supinated forearm', description: 'Palm-up forearm-rotation reference.', coordinates: pose({ elbow_flexion: 90, pro_sup: -60 }) },
                { id: 'forearm-pronated', label: 'Pronated forearm', description: 'Palm-down forearm-rotation reference.', coordinates: pose({ elbow_flexion: 90, pro_sup: 60 }) }
            ]
        },
        {
            id: 'wrist', label: 'Wrist', presets: [
                { id: 'wrist-extension-30', label: 'Extension 30°', description: 'Wrist-extension coordinate reference.', coordinates: pose({ elbow_flexion: 90, flexion: -30 }) },
                { id: 'wrist-flexion-30', label: 'Flexion 30°', description: 'Wrist-flexion coordinate reference.', coordinates: pose({ elbow_flexion: 90, flexion: 30 }) },
                { id: 'wrist-deviation-positive', label: 'Deviation +20°', description: 'Positive wrist-deviation coordinate reference.', coordinates: pose({ elbow_flexion: 90, deviation: 20 }) },
                { id: 'wrist-deviation-negative', label: 'Deviation −9.7°', description: 'Negative wrist-deviation coordinate reference.', coordinates: pose({ elbow_flexion: 90, deviation: -9.7 }) }
            ]
        }
    ];
}

function lowerPresetGroups(side) {
    const key = (name) => `${name}_${side}`;
    const pose = (values = {}) => Object.fromEntries(Object.entries(values).map(([name, value]) => [key(name), value]));
    return [
        {
            id: 'combined-reference', label: 'Combined reference', presets: [
                { id: 'neutral', label: 'Neutral', description: 'Authored neutral lower-limb posture.', coordinates: {} },
                { id: 'early-flexion', label: 'Early flexion', description: 'Moderate hip and knee flexion reference; not a gait prescription.', coordinates: pose({ hip_flexion: 25, knee_angle: 15, ankle_angle: -5 }) },
                { id: 'deep-flexion', label: 'Deep flexion', description: 'Deeper hip and knee flexion reference; not a movement instruction.', coordinates: pose({ hip_flexion: 55, knee_angle: 80, ankle_angle: 5 }) },
                { id: 'extended-reference', label: 'Extended reference', description: 'Mild hip extension with a small knee bend.', coordinates: pose({ hip_flexion: -15, knee_angle: 10, ankle_angle: 5 }) }
            ]
        },
        {
            id: 'hip', label: 'Hip', presets: [
                { id: 'hip-flexion-45', label: 'Flexion 45°', description: 'Isolated hip-flexion coordinate reference.', coordinates: pose({ hip_flexion: 45 }) },
                { id: 'hip-extension-15', label: 'Extension 15°', description: 'Isolated hip-extension coordinate reference.', coordinates: pose({ hip_flexion: -15 }) },
                { id: 'hip-abduction-20', label: 'Abduction reference', description: 'Negative hip-adduction coordinate reference.', coordinates: pose({ hip_adduction: -20 }) },
                { id: 'hip-adduction-20', label: 'Adduction reference', description: 'Positive hip-adduction coordinate reference.', coordinates: pose({ hip_adduction: 20 }) },
                { id: 'hip-rotation-negative', label: 'Rotation −20°', description: 'Negative hip-rotation coordinate reference.', coordinates: pose({ hip_rotation: -20 }) },
                { id: 'hip-rotation-positive', label: 'Rotation +20°', description: 'Positive hip-rotation coordinate reference.', coordinates: pose({ hip_rotation: 20 }) }
            ]
        },
        {
            id: 'knee-ankle-foot', label: 'Knee, ankle and foot', presets: [
                { id: 'knee-45', label: 'Knee 45°', description: 'Moderate knee-flexion coordinate reference.', coordinates: pose({ knee_angle: 45 }) },
                { id: 'knee-90', label: 'Knee 90°', description: 'Deeper knee-flexion coordinate reference.', coordinates: pose({ knee_angle: 90 }) },
                { id: 'ankle-negative-20', label: 'Ankle −20°', description: 'Negative ankle-coordinate reference.', coordinates: pose({ ankle_angle: -20 }) },
                { id: 'ankle-positive-20', label: 'Ankle +20°', description: 'Positive ankle-coordinate reference.', coordinates: pose({ ankle_angle: 20 }) },
                { id: 'subtalar-negative-10', label: 'Subtalar −10°', description: 'Negative subtalar-coordinate reference.', coordinates: pose({ subtalar_angle: -10 }) },
                { id: 'subtalar-positive-10', label: 'Subtalar +10°', description: 'Positive subtalar-coordinate reference.', coordinates: pose({ subtalar_angle: 10 }) },
                { id: 'mtp-positive-20', label: 'MTP +20°', description: 'Positive MTP-coordinate reference.', coordinates: pose({ mtp_angle: 20 }) }
            ]
        }
    ];
}

const TRUNK_PRESET_GROUPS = Object.freeze([
    {
        id: 'combined-reference', label: 'Combined reference', presets: [
            { id: 'neutral', label: 'Neutral', description: 'Authored neutral trunk posture.', coordinates: {} },
            { id: 'combined-flexion', label: 'Combined flexion', description: 'Matched lower- and upper-trunk flexion reference.', coordinates: { L5_S1_FE: 10, T12_L1_FE: 10 } },
            { id: 'combined-extension', label: 'Combined extension', description: 'Matched lower- and upper-trunk extension reference.', coordinates: { L5_S1_FE: -8, T12_L1_FE: -8 } },
            { id: 'combined-side-positive', label: 'Side bend +', description: 'Matched positive lateral-bending coordinate reference.', coordinates: { L5_S1_LB: 8, T12_L1_LB: 8 } },
            { id: 'combined-side-negative', label: 'Side bend −', description: 'Matched negative lateral-bending coordinate reference.', coordinates: { L5_S1_LB: -8, T12_L1_LB: -8 } },
            { id: 'combined-rotation-positive', label: 'Rotation +', description: 'Matched positive axial-rotation coordinate reference.', coordinates: { L5_S1_AR: 8, T12_L1_AR: 8 } },
            { id: 'combined-rotation-negative', label: 'Rotation −', description: 'Matched negative axial-rotation coordinate reference.', coordinates: { L5_S1_AR: -8, T12_L1_AR: -8 } }
        ]
    },
    {
        id: 'lower-trunk', label: 'Lower trunk', presets: [
            { id: 'lower-flexion', label: 'Flexion +15°', description: 'Lower-trunk flexion coordinate reference.', coordinates: { L5_S1_FE: 15 } },
            { id: 'lower-extension', label: 'Extension −10°', description: 'Lower-trunk extension coordinate reference.', coordinates: { L5_S1_FE: -10 } },
            { id: 'lower-side-positive', label: 'Side bend +10°', description: 'Positive lower-trunk lateral-bending reference.', coordinates: { L5_S1_LB: 10 } },
            { id: 'lower-side-negative', label: 'Side bend −10°', description: 'Negative lower-trunk lateral-bending reference.', coordinates: { L5_S1_LB: -10 } },
            { id: 'lower-rotation-positive', label: 'Rotation +10°', description: 'Positive lower-trunk axial-rotation reference.', coordinates: { L5_S1_AR: 10 } },
            { id: 'lower-rotation-negative', label: 'Rotation −10°', description: 'Negative lower-trunk axial-rotation reference.', coordinates: { L5_S1_AR: -10 } }
        ]
    },
    {
        id: 'upper-trunk', label: 'Upper trunk', presets: [
            { id: 'upper-flexion', label: 'Flexion +15°', description: 'Upper-trunk flexion coordinate reference.', coordinates: { T12_L1_FE: 15 } },
            { id: 'upper-extension', label: 'Extension −10°', description: 'Upper-trunk extension coordinate reference.', coordinates: { T12_L1_FE: -10 } },
            { id: 'upper-side-positive', label: 'Side bend +10°', description: 'Positive upper-trunk lateral-bending reference.', coordinates: { T12_L1_LB: 10 } },
            { id: 'upper-side-negative', label: 'Side bend −10°', description: 'Negative upper-trunk lateral-bending reference.', coordinates: { T12_L1_LB: -10 } },
            { id: 'upper-rotation-positive', label: 'Rotation +10°', description: 'Positive upper-trunk axial-rotation reference.', coordinates: { T12_L1_AR: 10 } },
            { id: 'upper-rotation-negative', label: 'Rotation −10°', description: 'Negative upper-trunk axial-rotation reference.', coordinates: { T12_L1_AR: -10 } }
        ]
    }
]);

const HEAD_PRESET_GROUPS = Object.freeze([
    {
        id: 'head-neck-reference', label: 'Head and neck', presets: [
            { id: 'neutral', label: 'Neutral', description: 'Authored neutral head and neck posture.', coordinates: {} },
            { id: 'flexion', label: 'Flexion +15°', description: 'Head / neck flexion coordinate reference.', coordinates: { T1_head_neck_FE: 15 } },
            { id: 'extension', label: 'Extension −10°', description: 'Head / neck extension coordinate reference.', coordinates: { T1_head_neck_FE: -10 } },
            { id: 'side-positive', label: 'Side bend +10°', description: 'Positive lateral-bending coordinate reference.', coordinates: { T1_head_neck_LB: 10 } },
            { id: 'side-negative', label: 'Side bend −10°', description: 'Negative lateral-bending coordinate reference.', coordinates: { T1_head_neck_LB: -10 } },
            { id: 'rotation-positive', label: 'Rotation +10°', description: 'Positive axial-rotation coordinate reference.', coordinates: { T1_head_neck_AR: 10 } },
            { id: 'rotation-negative', label: 'Rotation −10°', description: 'Negative axial-rotation coordinate reference.', coordinates: { T1_head_neck_AR: -10 } }
        ]
    }
]);

const REGION_DEFINITIONS = Object.freeze([
    {
        id: 'right-upper-limb', presentationName: 'Right upper limb', area: 'upper-limb', laterality: 'right',
        bodyRoot: 'clavicle_r', coordinatePairs: UPPER_COORDINATES.map(([name, label]) => [`${name}_r`, label]),
        presetGroups: upperPresetGroups('r'), legacyRightArm: true,
        defaultSelectedMuscleName: 'DELT1_r', camera: { fit: 'active-bodies', viewDirection: [1, 0, 0], up: [0, 0, 1], padding: 1.18 }
    },
    {
        id: 'left-upper-limb', presentationName: 'Left upper limb', area: 'upper-limb', laterality: 'left',
        bodyRoot: 'clavicle_l', coordinatePairs: UPPER_COORDINATES.map(([name, label]) => [`${name}_l`, label]),
        presetGroups: upperPresetGroups('l'), defaultSelectedMuscleName: 'DELT1_l',
        camera: { fit: 'active-bodies', viewDirection: [-1, 0, 0], up: [0, 0, 1], padding: 1.18 }
    },
    {
        id: 'right-lower-limb', presentationName: 'Right lower limb', area: 'lower-limb', laterality: 'right',
        bodyRoot: 'femur_r', coordinatePairs: LOWER_COORDINATES.map(([name, label]) => [`${name}_r`, label]),
        presetGroups: lowerPresetGroups('r'), camera: { fit: 'active-bodies', viewDirection: [0, -1, 0], up: [0, 0, 1], padding: 1.16 }
    },
    {
        id: 'left-lower-limb', presentationName: 'Left lower limb', area: 'lower-limb', laterality: 'left',
        bodyRoot: 'femur_l', coordinatePairs: LOWER_COORDINATES.map(([name, label]) => [`${name}_l`, label]),
        presetGroups: lowerPresetGroups('l'), camera: { fit: 'active-bodies', viewDirection: [0, -1, 0], up: [0, 0, 1], padding: 1.16 }
    },
    {
        id: 'trunk', presentationName: 'Trunk', area: 'trunk', laterality: 'midline',
        explicitBodyNames: ['pelvis', 'sacrum', 'Abdomen', 'lumbar5', 'lumbar4', 'lumbar3', 'lumbar2', 'lumbar1', 'thoracic12', 'thoracic11', 'thoracic10', 'thoracic9', 'thoracic8', 'thoracic7', 'thoracic6', 'thoracic5', 'thoracic4', 'thoracic3', 'thoracic2', 'thoracic1', 'sternum', 'rib1_R', 'rib1_L', 'rib2_R', 'rib2_L', 'rib3_R', 'rib3_L', 'rib4_R', 'rib4_L', 'rib5_R', 'rib5_L', 'rib6_R', 'rib6_L', 'rib7_R', 'rib7_L', 'rib8_R', 'rib8_L', 'rib9_R', 'rib9_L', 'rib10_R', 'rib10_L', 'rib11_R', 'rib11_L', 'rib12_R', 'rib12_L'],
        coordinatePairs: TRUNK_COORDINATES, presetGroups: TRUNK_PRESET_GROUPS,
        camera: { fit: 'active-bodies', viewDirection: [0, -1, 0], up: [0, 0, 1], padding: 1.14 }
    },
    {
        id: 'head-neck', presentationName: 'Head and neck', area: 'head-neck', laterality: 'midline',
        explicitBodyNames: ['head_neck'], coordinatePairs: HEAD_COORDINATES, presetGroups: HEAD_PRESET_GROUPS,
        camera: { fit: 'active-bodies', viewDirection: [0, -1, 0], up: [0, 0, 1], padding: 1.2 }
    }
]);

function sha256Bytes(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
    }
    return value;
}

export function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
}

function contentDigest(manifest) {
    const { contentDigestSha256: _ignored, ...content } = manifest;
    return sha256Bytes(Buffer.from(canonicalJson(content), 'utf8'));
}

function digestObject(value) {
    return sha256Bytes(Buffer.from(canonicalJson(value), 'utf8'));
}

const CONTRACT_DEFINITION = Object.freeze({
    id: 'MS_HUMAN_700_REGION_CONTRACT_V1',
    schemaVersion: 1,
    exactRuntimeIdentifiers: true,
    coordinateUnits: 'degrees',
    generalizedForceUnits: 'N·m',
    requiredRegionFields: [
        'id', 'label', 'presentationName', 'area', 'laterality', 'calculationSide',
        'activeBodyIds', 'coordinates', 'candidateMuscles', 'defaultSelectedMuscle',
        'presetGroups', 'semantics', 'contractDigestSha256'
    ],
    digestRules: {
        contractDigestSha256: 'SHA-256 of canonical JSON for the region mechanical contract subset.',
        runtimeRegionDigest: 'The browser engine computes SHA-256 over canonical JSON for the complete region object and exposes it as region.digest.',
        contentDigestSha256: 'SHA-256 of canonical JSON for the complete manifest with contentDigestSha256 omitted.'
    }
});

function round(value, digits = 9) {
    const scale = 10 ** digits;
    const result = Math.round(value * scale) / scale;
    return Object.is(result, -0) ? 0 : result;
}

function halton(index, base) {
    let result = 0;
    let fraction = 1 / base;
    let remaining = index;
    while (remaining > 0) {
        result += fraction * (remaining % base);
        remaining = Math.floor(remaining / base);
        fraction /= base;
    }
    return result;
}

function descendants(model, rootId) {
    const result = [];
    for (let bodyId = 1; bodyId < model.nbody; bodyId += 1) {
        let current = bodyId;
        while (current > 0 && current !== rootId) current = model.body_parentid[current];
        if (current === rootId) result.push(bodyId);
    }
    return result;
}

function polynomialValueAndDerivative(coefficients, value) {
    let result = 0;
    let derivative = 0;
    let power = 1;
    for (let degree = 0; degree < 5; degree += 1) {
        result += coefficients[degree] * power;
        if (degree) derivative += degree * coefficients[degree] * (value ** (degree - 1));
        power *= value;
    }
    return { value: result, derivative };
}

function poseSweep(coordinates) {
    const defaults = Object.fromEntries(coordinates.map((coordinate) => [coordinate.name, coordinate.defaultDegrees]));
    const poses = [{ id: 'default', coordinates: { ...defaults } }];
    for (const coordinate of coordinates) {
        for (const [direction, bound] of [['minimum', coordinate.minimumDegrees], ['maximum', coordinate.maximumDegrees]]) {
            for (const fraction of AXIS_SWEEP_FRACTIONS) {
                const value = coordinate.defaultDegrees + (bound - coordinate.defaultDegrees) * fraction;
                if (Math.abs(value - coordinate.defaultDegrees) < 1e-10) continue;
                poses.push({
                    id: `${coordinate.name}-${direction}-${String(fraction).replace('.', '_')}`,
                    coordinates: { ...defaults, [coordinate.name]: round(value, 7) }
                });
            }
        }
    }
    for (let sample = 1; sample <= HALTON_POSE_COUNT; sample += 1) {
        const values = { ...defaults };
        for (const [index, coordinate] of coordinates.entries()) {
            const unit = 0.1 + 0.8 * halton(sample, HALTON_BASES[index]);
            values[coordinate.name] = round(coordinate.minimumDegrees + unit * (coordinate.maximumDegrees - coordinate.minimumDegrees), 7);
        }
        poses.push({ id: `halton-${String(sample).padStart(2, '0')}`, coordinates: values });
    }
    return poses;
}

function equalityRecords(mujoco, model, nameFor) {
    const records = [];
    const stride = model.neq ? model.eq_data.length / model.neq : 0;
    for (let equalityId = 0; equalityId < model.neq; equalityId += 1) {
        if (model.eq_type[equalityId] !== mujoco.mjtEq.mjEQ_JOINT.value) continue;
        const dependentJointId = model.eq_obj1id[equalityId];
        const sourceJointId = model.eq_obj2id[equalityId];
        records.push({
            equalityId,
            dependentJointId,
            dependentJoint: nameFor(mujoco.mjtObj.mjOBJ_JOINT, dependentJointId),
            sourceJointId,
            sourceJoint: nameFor(mujoco.mjtObj.mjOBJ_JOINT, sourceJointId),
            coefficients: Float64Array.from(model.eq_data.slice(equalityId * stride, equalityId * stride + 5))
        });
    }
    return records;
}

function realizePose(mujoco, model, data, coordinates, pose, equalities) {
    mujoco.mj_resetDataKeyframe(model, data, 0);
    data.qvel.fill(0);
    data.qacc.fill(0);
    data.ctrl.fill(0);
    data.act.fill(0);
    for (const coordinate of coordinates) data.qpos[coordinate.qposAddress] = pose.coordinates[coordinate.name] * DEGREES_TO_RADIANS;
    for (const equality of equalities) {
        const sourceQpos = model.jnt_qposadr[equality.sourceJointId];
        const dependentQpos = model.jnt_qposadr[equality.dependentJointId];
        data.qpos[dependentQpos] = polynomialValueAndDerivative(equality.coefficients, data.qpos[sourceQpos]).value;
    }
    mujoco.mj_forward(model, data);
    const reduction = coordinates.map((coordinate) => {
        const column = new Float64Array(model.nv);
        column[coordinate.dofAddress] = 1;
        return column;
    });
    const coordinateIndexByJoint = new Map(coordinates.map((coordinate, index) => [coordinate.jointId, index]));
    for (const equality of equalities) {
        const index = coordinateIndexByJoint.get(equality.sourceJointId);
        if (index === undefined) continue;
        const sourceValue = data.qpos[model.jnt_qposadr[equality.sourceJointId]];
        const derivative = polynomialValueAndDerivative(equality.coefficients, sourceValue).derivative;
        reduction[index][model.jnt_dofadr[equality.dependentJointId]] += derivative;
    }
    return reduction;
}

function projectedGradient(momentMatrix, actuatorId, model, reduction) {
    let result = 0;
    if (momentMatrix.dense) {
        const offset = actuatorId * model.nv;
        for (let dof = 0; dof < model.nv; dof += 1) result += momentMatrix.values[offset + dof] * reduction[dof];
        return result;
    }
    const start = momentMatrix.rowAddress[actuatorId];
    const count = momentMatrix.rowNonzero[actuatorId];
    for (let index = start; index < start + count; index += 1) {
        result += momentMatrix.values[index] * reduction[momentMatrix.columnIndex[index]];
    }
    return result;
}

function snapshotMomentMatrix(data, model) {
    if (data.actuator_moment.length >= model.nu * model.nv) {
        return { dense: true, values: Float64Array.from(data.actuator_moment) };
    }
    if (data.moment_rownnz?.length >= model.nu && data.moment_rowadr?.length >= model.nu && data.moment_colind?.length >= data.actuator_moment.length) {
        return {
            dense: false,
            values: Float64Array.from(data.actuator_moment),
            rowNonzero: Int32Array.from(data.moment_rownnz),
            rowAddress: Int32Array.from(data.moment_rowadr),
            columnIndex: Int32Array.from(data.moment_colind)
        };
    }
    throw new Error('Neither dense nor sparse actuator moment data is available.');
}

function tendonBodyIds(mujoco, model, tendonId) {
    const result = new Set();
    const start = model.tendon_adr[tendonId];
    const end = start + model.tendon_num[tendonId];
    for (let wrapIndex = start; wrapIndex < end; wrapIndex += 1) {
        const type = model.wrap_type[wrapIndex];
        const objectId = model.wrap_objid[wrapIndex];
        if (type === mujoco.mjtWrap.mjWRAP_SITE.value) result.add(model.site_bodyid[objectId]);
        else if (type === mujoco.mjtWrap.mjWRAP_SPHERE.value || type === mujoco.mjtWrap.mjWRAP_CYLINDER.value) result.add(model.geom_bodyid[objectId]);
        else if (type === mujoco.mjtWrap.mjWRAP_JOINT.value) result.add(model.jnt_bodyid[objectId]);
    }
    return [...result].sort((left, right) => left - right);
}

function validatePresets(region) {
    const coordinateByName = new Map(region.coordinates.map((coordinate) => [coordinate.name, coordinate]));
    const presetIds = new Set();
    for (const group of region.presetGroups) {
        for (const preset of group.presets) {
            if (presetIds.has(preset.id)) throw new Error(`${region.id} repeats preset ${preset.id}`);
            presetIds.add(preset.id);
            for (const [name, value] of Object.entries(preset.coordinates)) {
                const coordinate = coordinateByName.get(name);
                if (!coordinate) throw new Error(`${region.id}/${preset.id} references unknown coordinate ${name}`);
                if (!Number.isFinite(value) || value < coordinate.minimumDegrees - 1e-8 || value > coordinate.maximumDegrees + 1e-8) {
                    throw new Error(`${region.id}/${preset.id}: ${name}=${value} is outside [${coordinate.minimumDegrees}, ${coordinate.maximumDegrees}]`);
                }
            }
        }
    }
}

function mechanicallyRelevantMuscles(mujoco, model, data, region, equalities, nameFor) {
    const sweep = poseSweep(region.coordinates);
    const stats = Array.from({ length: model.nu }, () => ({ maximum: 0, poseCount: 0, byCoordinate: new Float64Array(region.coordinates.length) }));
    for (const pose of sweep) {
        const reduction = realizePose(mujoco, model, data, region.coordinates, pose, equalities);
        const moments = snapshotMomentMatrix(data, model);
        const baselineForce = Float64Array.from(data.actuator_force);
        data.act.fill(1);
        mujoco.mj_forward(model, data);
        const activeForce = Float64Array.from(data.actuator_force, (value, actuatorId) => value - baselineForce[actuatorId]);
        for (let actuatorId = 0; actuatorId < model.nu; actuatorId += 1) {
            let poseMaximum = 0;
            for (const [coordinateIndex, column] of reduction.entries()) {
                const torque = Math.abs(projectedGradient(moments, actuatorId, model, column) * activeForce[actuatorId]);
                if (!Number.isFinite(torque)) throw new Error(`${region.id}: non-finite projected torque for actuator ${actuatorId}`);
                stats[actuatorId].byCoordinate[coordinateIndex] = Math.max(stats[actuatorId].byCoordinate[coordinateIndex], torque);
                poseMaximum = Math.max(poseMaximum, torque);
            }
            stats[actuatorId].maximum = Math.max(stats[actuatorId].maximum, poseMaximum);
            if (poseMaximum >= ABSOLUTE_TORQUE_THRESHOLD_NM) stats[actuatorId].poseCount += 1;
        }
    }
    const regionMaximum = Math.max(...stats.map((entry) => entry.maximum));
    const threshold = Math.max(ABSOLUTE_TORQUE_THRESHOLD_NM, regionMaximum * RELATIVE_TORQUE_THRESHOLD);
    const candidates = [];
    for (let actuatorId = 0; actuatorId < model.nu; actuatorId += 1) {
        if (stats[actuatorId].maximum < threshold) continue;
        const tendonId = model.actuator_trnid[actuatorId * 2];
        if (model.actuator_trntype[actuatorId] !== mujoco.mjtTrn.mjTRN_TENDON.value) continue;
        candidates.push({ actuatorId, tendonId, stats: stats[actuatorId] });
    }
    return { candidates, stats, sweep, regionMaximum, threshold };
}

function muscleDescriptor(mujoco, model, region, item, result, nameFor, legacyMuscle = null) {
    const pathBodyIds = tendonBodyIds(mujoco, model, item.tendonId);
    const group = legacyMuscle?.group ?? regionalMuscleGroup(
        region,
        nameFor(mujoco.mjtObj.mjOBJ_ACTUATOR, item.actuatorId),
        item.actuatorId,
        pathBodyIds
    );
    const maximumByCoordinateNm = Object.fromEntries(region.coordinates.map((coordinate, index) => [coordinate.name, round(item.stats.byCoordinate[index], 9)]));
    return {
        actuatorId: item.actuatorId,
        name: nameFor(mujoco.mjtObj.mjOBJ_ACTUATOR, item.actuatorId),
        tendonId: item.tendonId,
        tendon: nameFor(mujoco.mjtObj.mjOBJ_TENDON, item.tendonId),
        group,
        visibleByDefault: legacyMuscle?.visibleByDefault ?? false,
        pathBodyIds,
        selection: {
            method: 'equality-projected-active-generalized-force',
            maximumProjectedMomentNmPerUnitActivation: round(item.stats.maximum, 9),
            maximumRelativeContribution: result.regionMaximum ? round(item.stats.maximum / result.regionMaximum, 12) : 0,
            posesWithContribution: item.stats.poseCount,
            maximumByCoordinateNm
        }
    };
}

function assignDefaultVisibility(region, muscles) {
    const eligible = region.area === 'upper-limb'
        ? muscles.filter((muscle) => muscle.group !== 'Long torso origin')
        : muscles;
    const ranked = [...eligible].sort((left, right) => right.selection.maximumProjectedMomentNmPerUnitActivation - left.selection.maximumProjectedMomentNmPerUnitActivation || left.actuatorId - right.actuatorId);
    const visibleCount = region.area === 'upper-limb' ? ranked.length : Math.min(36, ranked.length);
    const visible = new Set(ranked.slice(0, visibleCount).map((muscle) => muscle.actuatorId));
    for (const muscle of muscles) muscle.visibleByDefault = visible.has(muscle.actuatorId);
}

function regionalMuscleGroup(region, muscleName, actuatorId, pathBodyIds) {
    const outside = pathBodyIds.some((bodyId) => !region.activeBodyIds.includes(bodyId));
    if (region.area === 'upper-limb') {
        if (muscleName.startsWith('LD_')) return 'Long torso origin';
        const firstArmActuator = region.laterality === 'right' ? 100 : 161;
        if (actuatorId >= firstArmActuator && actuatorId < firstArmActuator + 61) return 'Arm';
        return 'Shoulder stabilizer';
    }
    if (region.area === 'lower-limb') return outside ? 'Pelvis-spanning muscle' : 'Lower-limb muscle';
    if (region.area === 'trunk') return outside ? 'Hip/shoulder-spanning muscle' : 'Trunk muscle';
    if (region.area === 'head-neck') return 'Head and neck mover';
    return outside ? 'Cross-region mover' : 'Regional mover';
}

function regionSemantics(definition, coordinateNames) {
    const gravityMPerS2 = [0, 0, -9.81];
    const solved = `Static equilibrium is solved only for ${coordinateNames.join(', ')} after projecting authored joint equalities.`;
    const common = {
        calculationSide: definition.laterality,
        gravityMPerS2,
        externalLoad: 'none',
        contact: 'none',
        generalizedForceUnits: `N·m for the ${coordinateNames.length} selected rotational coordinates`,
        solvedCoordinates: solved,
        equilibrium: `${solved} Small reserve generalized forces are numerical balance variables, not measured support or strength.`,
        interpretationBoundary: 'Generic, non-patient-specific, static model output only. It is not measured activation, tissue load, pain evidence, a movement prescription, a diagnosis, or clinical validation.',
        clinicalValidation: false
    };
    if (definition.area === 'upper-limb') {
        const opposite = definition.laterality === 'right' ? 'left' : 'right';
        const fixedSupport = `Pelvis, both lower limbs, trunk, head/neck, and the ${opposite} upper limb remain prescribed at the authored keyframe; every non-selected coordinate is fixed except equality-dependent joints driven by the selected coordinates.`;
        return {
            ...common,
            fixedSupport,
            supportDescription: `${fixedSupport} Their support reactions are not solved or interpreted.`,
            assumptions: [
                fixedSupport,
                'Static posture: zero velocity and zero acceleration.',
                'Gravity and model self-weight only; no held load, contact, or measured external force.',
                'Authored passive muscle and joint forces are included.',
                'Candidate-muscle membership is mechanical inventory selection, not clinical validation.'
            ]
        };
    }
    if (definition.area === 'lower-limb') {
        const opposite = definition.laterality === 'right' ? 'left' : 'right';
        const fixedSupport = `The pelvis is fixed, the ${opposite} lower limb and all upper-body coordinates remain prescribed at the authored keyframe, and every non-selected coordinate is fixed except knee and patellar equality-dependent joints driven by knee flexion.`;
        return {
            ...common,
            fixedSupport,
            supportDescription: `${fixedSupport} There is no foot contact or ground-reaction model, so this is not stance, gait, balance, or weight-bearing analysis.`,
            interpretationBoundary: `${common.interpretationBoundary} In particular, the result must not be interpreted as stance, gait, balance, ground reaction, or weight-bearing capacity.`,
            assumptions: [
                fixedSupport,
                'No foot contact, floor reaction, balance constraint, or stance phase is modeled.',
                'Static posture: zero velocity and zero acceleration.',
                'Gravity and model self-weight only; no held load or measured external force.',
                'Authored passive muscle and joint forces are included.',
                'Candidate-muscle membership is mechanical inventory selection, not clinical validation.'
            ]
        };
    }
    if (definition.area === 'trunk') {
        const fixedSupport = 'Pelvis translation and orientation, both limbs, head/neck, and every non-selected model coordinate remain prescribed at the authored keyframe.';
        return {
            ...common,
            fixedSupport,
            supportDescription: `${fixedSupport} The selected L5/S1 and T12/L1 coordinates are the only solved trunk coordinates; support reactions elsewhere are not interpreted.`,
            assumptions: [
                fixedSupport,
                'Static posture: zero velocity and zero acceleration.',
                'Gravity and model self-weight only; no contact, carried load, or measured external force.',
                'Authored passive muscle and joint forces are included.',
                'Candidate-muscle membership is mechanical inventory selection, not clinical validation.'
            ]
        };
    }
    const fixedSupport = 'The model is fixed below T1: thoracic1 and every body and coordinate below it remain prescribed at the authored keyframe while only the three T1-to-head/neck rotational coordinates are solved.';
    return {
        ...common,
        fixedSupport,
        supportDescription: `${fixedSupport} MS-Human represents the skull, jaw, and cervical surface meshes on one articulated head_neck body; the region active-body count is therefore one.`,
        assumptions: [
            fixedSupport,
            'The skull, jaw, and cervical surfaces share the single head_neck body in this model.',
            'Static posture: zero velocity and zero acceleration.',
            'Gravity and model self-weight only; no contact, carried load, or measured external force.',
            'Authored passive muscle and joint forces are included.',
            'Candidate-muscle membership is mechanical inventory selection, not clinical validation.'
        ]
    };
}

function regionContractDigest(region) {
    return digestObject({
        contractId: CONTRACT_DEFINITION.id,
        regionId: region.id,
        activeBodyIds: region.activeBodyIds,
        coordinates: region.coordinates.map(({ name, engineName, jointId, qposAddress, dofAddress, minimumDegrees, maximumDegrees, defaultDegrees, equalityDependents }) => ({ name, engineName, jointId, qposAddress, dofAddress, minimumDegrees, maximumDegrees, defaultDegrees, equalityDependents })),
        candidateMuscles: region.candidateMuscles.map(({ actuatorId, name, tendonId, tendon }) => ({ actuatorId, name, tendonId, tendon })),
        semantics: region.semantics
    });
}

function buildCoordinate(model, data, equalities, name, label, nameFor) {
    const jointId = nameFor.id(mjt('JOINT'), name);
    if (jointId < 0) throw new Error(`Joint not found: ${name}`);
    if (equalities.some((equality) => equality.dependentJointId === jointId)) throw new Error(`${name} is equality-dependent and cannot be a region control`);
    const qposAddress = model.jnt_qposadr[jointId];
    const [minimum, maximum] = [model.jnt_range[jointId * 2], model.jnt_range[jointId * 2 + 1]];
    return {
        name,
        engineName: name,
        label,
        jointId,
        qposAddress,
        dofAddress: model.jnt_dofadr[jointId],
        minimumDegrees: round(minimum * RADIANS_TO_DEGREES, 4),
        maximumDegrees: round(maximum * RADIANS_TO_DEGREES, 4),
        defaultDegrees: round(data.qpos[qposAddress] * RADIANS_TO_DEGREES, 4),
        equalityDependents: equalities.filter((equality) => equality.sourceJointId === jointId).map((equality) => ({
            equalityId: equality.equalityId,
            jointId: equality.dependentJointId,
            name: equality.dependentJoint
        }))
    };
}

let currentMujoco = null;
function mjt(name) {
    return currentMujoco.mjtObj[`mjOBJ_${name}`];
}

export async function buildRegionArtifacts() {
    const [{ default: loadMujoco }, legacyMetadata] = await Promise.all([
        import(pathToFileURL(MUJOCO_MODULE_PATH).href),
        Promise.resolve(JSON.parse(fs.readFileSync(LEGACY_METADATA_PATH, 'utf8')))
    ]);
    const wasmBinary = fs.readFileSync(MUJOCO_WASM_PATH);
    const mujoco = await loadMujoco({ wasmBinary });
    currentMujoco = mujoco;
    const virtualFileSystem = new mujoco.MjVFS();
    virtualFileSystem.addBuffer('right-arm-runtime.mjb', new Uint8Array(fs.readFileSync(RUNTIME_PATH)));
    const model = mujoco.MjModel.from_binary_path('right-arm-runtime.mjb', virtualFileSystem);
    const data = new mujoco.MjData(model);
    const nameFor = (type, id) => mujoco.mj_id2name(model, type.value, id) || `unnamed_${id}`;
    nameFor.id = (type, name) => mujoco.mj_name2id(model, type.value, name);
    try {
        if (model.nu !== 700) throw new Error(`Expected 700 actuators; found ${model.nu}`);
        const mujocoVersion = legacyMetadata.source?.mujocoVersion;
        if (mujocoVersion !== EXPECTED_MUJOCO_VERSION) throw new Error(`Expected metadata MuJoCo ${EXPECTED_MUJOCO_VERSION}; found ${mujocoVersion}`);
        mujoco.mj_resetDataKeyframe(model, data, 0);
        mujoco.mj_forward(model, data);
        const equalities = equalityRecords(mujoco, model, nameFor);
        const legacyMuscleById = new Map(legacyMetadata.muscles.map((muscle) => [muscle.actuatorId, muscle]));
        const regions = [];
        const evidenceRegions = [];
        for (const definition of REGION_DEFINITIONS) {
            let activeBodyIds;
            if (definition.bodyRoot) {
                const rootId = nameFor.id(mujoco.mjtObj.mjOBJ_BODY, definition.bodyRoot);
                if (rootId < 0) throw new Error(`Body root not found: ${definition.bodyRoot}`);
                activeBodyIds = descendants(model, rootId);
            } else {
                activeBodyIds = definition.explicitBodyNames.map((name) => {
                    const id = nameFor.id(mujoco.mjtObj.mjOBJ_BODY, name);
                    if (id < 0) throw new Error(`Body not found: ${name}`);
                    return id;
                }).sort((left, right) => left - right);
            }
            const activeBodies = activeBodyIds.map((bodyId) => ({
                bodyId,
                name: nameFor(mujoco.mjtObj.mjOBJ_BODY, bodyId),
                parentBodyId: model.body_parentid[bodyId]
            }));
            const coordinates = definition.coordinatePairs.map(([name, label]) => buildCoordinate(model, data, equalities, name, label, nameFor));
            const region = {
                id: definition.id,
                label: definition.presentationName,
                presentationName: definition.presentationName,
                description: `${definition.presentationName} regional posture and generic static muscle-mechanics inventory.`,
                area: definition.area,
                laterality: definition.laterality,
                calculationSide: definition.laterality,
                status: 'data-ready',
                activeBodyRootNames: definition.bodyRoot ? [definition.bodyRoot] : [],
                activeBodyIds,
                activeBodies,
                coordinates,
                candidateMuscles: [],
                defaultSelectedMuscle: null,
                presetGroups: JSON.parse(JSON.stringify(definition.presetGroups)),
                camera: definition.camera,
                assessment: {
                    supported: definition.id === 'right-upper-limb',
                    protocolId: definition.id === 'right-upper-limb' ? 'MSH700-RIGHT-ARM-PAIRED-CONTRAST-V1' : null,
                    reason: definition.id === 'right-upper-limb'
                        ? 'The existing separately versioned right-upper-limb observation protocol may reference this region.'
                        : 'No versioned, evidence-recorded assessment protocol exists for this region.'
                },
                semantics: {
                    ...regionSemantics(definition, coordinates.map((coordinate) => coordinate.name)),
                    activeBodies: 'Anatomical surfaces emphasized for this region; downstream bodies moved by the kinematic chain are not thereby region-active.',
                    candidateMuscles: 'Actuators with non-negligible equality-projected active generalized-force contribution over the deterministic pose sweep.'
                }
            };
            validatePresets(region);
            const mechanical = mechanicallyRelevantMuscles(mujoco, model, data, region, equalities, nameFor);
            let candidateItems = mechanical.candidates;
            if (definition.legacyRightArm) {
                const mechanicalIds = new Set(mechanical.candidates.map((item) => item.actuatorId));
                const legacyIds = legacyMetadata.muscles.map((muscle) => muscle.actuatorId);
                const missingMechanical = legacyIds.filter((actuatorId) => !mechanicalIds.has(actuatorId));
                if (missingMechanical.length) throw new Error(`Legacy right-arm actuators lack projected contribution: ${missingMechanical.join(', ')}`);
                candidateItems = legacyIds.map((actuatorId) => ({
                    actuatorId,
                    tendonId: model.actuator_trnid[actuatorId * 2],
                    stats: mechanical.stats[actuatorId]
                }));
            }
            region.candidateMuscles = candidateItems.map((item) => muscleDescriptor(
                mujoco,
                model,
                region,
                item,
                mechanical,
                nameFor,
                definition.legacyRightArm ? legacyMuscleById.get(item.actuatorId) : null
            ));
            if (!definition.legacyRightArm) assignDefaultVisibility(region, region.candidateMuscles);
            const requestedDefault = definition.defaultSelectedMuscleName
                ? region.candidateMuscles.find((muscle) => muscle.name === definition.defaultSelectedMuscleName)
                : null;
            const rankedDefault = [...region.candidateMuscles].sort((left, right) => right.selection.maximumProjectedMomentNmPerUnitActivation - left.selection.maximumProjectedMomentNmPerUnitActivation || left.actuatorId - right.actuatorId)[0];
            const defaultMuscle = requestedDefault ?? rankedDefault;
            if (!defaultMuscle) throw new Error(`${region.id} has no candidate muscle`);
            region.defaultSelectedMuscle = { actuatorId: defaultMuscle.actuatorId, name: defaultMuscle.name };
            region.contractDigestSha256 = regionContractDigest(region);
            const runtimeRegionDigestSha256 = digestObject(region);
            regions.push(region);
            evidenceRegions.push({
                id: region.id,
                presentationName: region.presentationName,
                coordinateCount: region.coordinates.length,
                activeBodyCount: region.activeBodyIds.length,
                candidateMuscleCount: region.candidateMuscles.length,
                mechanicallyQualifiedMuscleCount: mechanical.candidates.length,
                defaultVisibleMuscleCount: region.candidateMuscles.filter((muscle) => muscle.visibleByDefault).length,
                presetCount: region.presetGroups.reduce((sum, group) => sum + group.presets.length, 0),
                sweepPoseCount: mechanical.sweep.length,
                selectionThresholdNmPerUnitActivation: round(mechanical.threshold, 12),
                maximumProjectedMomentNmPerUnitActivation: round(mechanical.regionMaximum, 9),
                defaultSelectedMuscle: region.defaultSelectedMuscle,
                contractDigestSha256: region.contractDigestSha256,
                runtimeRegionDigestSha256,
                coordinateEvidence: region.coordinates.map((coordinate) => ({
                    name: coordinate.name,
                    candidateMuscles: region.candidateMuscles.filter((muscle) => muscle.selection.maximumByCoordinateNm[coordinate.name] >= mechanical.threshold).length,
                    maximumProjectedMomentNmPerUnitActivation: round(Math.max(...region.candidateMuscles.map((muscle) => muscle.selection.maximumByCoordinateNm[coordinate.name])), 9)
                })),
                legacyCompatibility: definition.legacyRightArm ? {
                    expectedMuscleCount: legacyMetadata.muscles.length,
                    mechanicallyQualifiedMuscleCount: mechanical.candidates.length,
                    exactActuatorIdsPreserved: true,
                    exactNamesPreserved: true,
                    compatibilityExcludedMechanicallyQualifiedActuatorIds: mechanical.candidates
                        .map((item) => item.actuatorId)
                        .filter((actuatorId) => !legacyMuscleById.has(actuatorId))
                } : null
            });
        }

        const manifest = {
            schemaVersion: 1,
            manifestId: MANIFEST_ID,
            defaultRegionId: 'right-upper-limb',
            generatedAt: null,
            sourceTreeSha256: legacyMetadata.source.sourceTreeSha256,
            contract: CONTRACT_DEFINITION,
            contractDigestSha256: digestObject(CONTRACT_DEFINITION),
            model: {
                modelId: 'MS_HUMAN_700_PRIMARY_REGIONS_V1',
                name: legacyMetadata.model.name,
                variant: 'primary / deterministic regional Explorer inventory',
                sourceTreeSha256: legacyMetadata.source.sourceTreeSha256,
                sourceCommit: legacyMetadata.source.commit,
                mujocoVersion: legacyMetadata.source.mujocoVersion,
                runtime: { url: './right-arm-runtime.mjb', sha256: sha256Bytes(fs.readFileSync(RUNTIME_PATH)) },
                geometry: { url: './right-arm.meshbin', sha256: sha256Bytes(fs.readFileSync(GEOMETRY_PATH)) }
            },
            provenance: {
                generator: 'tools/export_ms_human_regions.mjs',
                sourcePackage: legacyMetadata.source.package,
                sourceOfTruth: legacyMetadata.source.sourceOfTruth,
                sourceCommit: legacyMetadata.source.commit,
                sourceTreeSha256: legacyMetadata.source.sourceTreeSha256,
                modelLicense: legacyMetadata.source.modelLicense,
                runtimeLicense: legacyMetadata.source.runtimeLicense,
                localCorrections: legacyMetadata.source.localCorrections,
                statement: 'Generated from the pinned compiled model. No clinical validation is claimed.'
            },
            selectionMethod: {
                id: 'equality-projected-active-generalized-force-sweep-v1',
                description: 'At each deterministic pose, the actuator length gradient is projected through authored joint equalities and multiplied by the actuator force change from activation 0 to 1. An actuator is a candidate when its maximum absolute projected contribution clears the stated threshold.',
                poseSweep: {
                    defaultPose: true,
                    perAxisFractionsTowardEachBound: AXIS_SWEEP_FRACTIONS,
                    coupledSequence: 'Halton',
                    coupledPoseCount: HALTON_POSE_COUNT,
                    coupledRangeFraction: [0.1, 0.9],
                    bases: HALTON_BASES
                },
                projection: 'Virtual-work reduction using the derivative of every authored joint equality sourced by a region coordinate.',
                absoluteThresholdNmPerUnitActivation: ABSOLUTE_TORQUE_THRESHOLD_NM,
                relativeThreshold: RELATIVE_TORQUE_THRESHOLD,
                defaultVisibility: 'Upper limbs show every Arm and Shoulder stabilizer candidate while hiding Long torso origin paths by default; the right upper limb preserves the existing right-arm metadata. Other regions show the 36 largest maximum projected contributors, or every candidate when fewer than 36 exist.',
                clinicalValidation: false
            },
            compatibility: {
                legacyRightArmMetadataUrl: './right-arm.json',
                rightUpperLimb: {
                    legacyFunctionalMuscleCount: 88,
                    preserveExactActuatorIds: true,
                    preserveExactNamesGroupsAndVisibility: true,
                    canonicalCoordinateAliases: Object.fromEntries(UPPER_COORDINATES.map(([name]) => [name, `${name}_r`]))
                }
            },
            regions,
            contentDigestSha256: null
        };
        manifest.contentDigestSha256 = contentDigest(manifest);
        const evidence = {
            schemaVersion: 1,
            manifestId: MANIFEST_ID,
            manifestContentDigestSha256: manifest.contentDigestSha256,
            generatedAt: null,
            clinicalValidation: false,
            selectionMethod: manifest.selectionMethod,
            runtimeInventory: {
                bodies: model.nbody,
                joints: model.njnt,
                generalizedCoordinates: model.nq,
                generalizedVelocities: model.nv,
                actuators: model.nu,
                tendons: model.ntendon,
                equalities: model.neq,
                jointEqualities: equalities.length
            },
            regions: evidenceRegions
        };
        return { manifest, evidence };
    } finally {
        data.delete();
        model.delete();
        virtualFileSystem.delete();
        currentMujoco = null;
    }
}

export function validateRegionArtifacts(manifest, evidence) {
    if (manifest.schemaVersion !== 1 || manifest.manifestId !== MANIFEST_ID) throw new Error('Unexpected region manifest identity.');
    if (manifest.defaultRegionId !== 'right-upper-limb') throw new Error('Unexpected default region.');
    if (manifest.contractDigestSha256 !== digestObject(manifest.contract)) throw new Error('Region contract digest does not match its canonical definition.');
    if (manifest.contentDigestSha256 !== contentDigest(manifest)) throw new Error('Region manifest content digest does not match canonical content.');
    if (evidence.manifestContentDigestSha256 !== manifest.contentDigestSha256) throw new Error('Region evidence references a different manifest digest.');
    const expectedOrder = REGION_DEFINITIONS.map((region) => region.id);
    if (JSON.stringify(manifest.regions.map((region) => region.id)) !== JSON.stringify(expectedOrder)) throw new Error('Region order or inventory changed.');
    const ids = new Set();
    for (const region of manifest.regions) {
        if (ids.has(region.id)) throw new Error(`Duplicate region id: ${region.id}`);
        ids.add(region.id);
        if (!region.coordinates.length || !region.activeBodyIds.length || !region.candidateMuscles.length) throw new Error(`${region.id} has an empty required inventory.`);
        if (!region.candidateMuscles.some((muscle) => muscle.actuatorId === region.defaultSelectedMuscle.actuatorId && muscle.name === region.defaultSelectedMuscle.name)) throw new Error(`${region.id} default muscle is not a candidate.`);
        if (region.contractDigestSha256 !== regionContractDigest(region)) throw new Error(`${region.id} contract digest does not match its mechanical contract.`);
        for (const field of ['fixedSupport', 'supportDescription', 'externalLoad', 'contact', 'equilibrium', 'solvedCoordinates', 'generalizedForceUnits', 'interpretationBoundary']) {
            if (typeof region.semantics?.[field] !== 'string' || !region.semantics[field].trim()) throw new Error(`${region.id} is missing semantics.${field}.`);
        }
        if (!Array.isArray(region.semantics.gravityMPerS2) || region.semantics.gravityMPerS2.length !== 3 || region.semantics.gravityMPerS2.some((value) => !Number.isFinite(value))) throw new Error(`${region.id} has invalid gravity semantics.`);
        if (region.semantics.clinicalValidation !== false) throw new Error(`${region.id} must not claim clinical validation.`);
        if (!Array.isArray(region.semantics.assumptions) || !region.semantics.assumptions.length) throw new Error(`${region.id} has no explicit assumptions.`);
        validatePresets(region);
    }
    for (const regionEvidence of evidence.regions) {
        const region = manifest.regions.find((candidate) => candidate.id === regionEvidence.id);
        if (!region || regionEvidence.runtimeRegionDigestSha256 !== digestObject(region)) throw new Error(`${regionEvidence.id} runtime-region evidence digest mismatch.`);
    }
    const right = manifest.regions.find((region) => region.id === 'right-upper-limb');
    const legacy = JSON.parse(fs.readFileSync(LEGACY_METADATA_PATH, 'utf8'));
    if (canonicalJson(right.candidateMuscles.map(({ actuatorId, name, tendonId, tendon, group, visibleByDefault }) => ({ actuatorId, name, tendonId, tendon, group, visibleByDefault }))) !== canonicalJson(legacy.muscles)) {
        throw new Error('Right-upper-limb compatibility inventory differs from right-arm.json.');
    }
    const expectedUpperGroups = { Arm: 47, 'Long torso origin': 14, 'Shoulder stabilizer': 27 };
    for (const regionId of ['right-upper-limb', 'left-upper-limb']) {
        const region = manifest.regions.find((candidate) => candidate.id === regionId);
        const groups = Object.fromEntries([...new Set(region.candidateMuscles.map((muscle) => muscle.group))].map((group) => [group, region.candidateMuscles.filter((muscle) => muscle.group === group).length]));
        if (canonicalJson(groups) !== canonicalJson(expectedUpperGroups)) throw new Error(`${regionId} has unexpected display groups.`);
        if (region.candidateMuscles.filter((muscle) => muscle.group === 'Long torso origin' && muscle.visibleByDefault).length) throw new Error(`${regionId} exposes a long torso origin by default.`);
        if (region.candidateMuscles.filter((muscle) => muscle.visibleByDefault).length !== 74) throw new Error(`${regionId} must expose all 74 Arm and Shoulder stabilizer candidates by default.`);
    }
    return true;
}

export async function writeOrCheckRegionArtifacts({ check = false } = {}) {
    const { manifest, evidence } = await buildRegionArtifacts();
    validateRegionArtifacts(manifest, evidence);
    const serializedManifest = `${JSON.stringify(manifest, null, 2)}\n`;
    const serializedEvidence = `${JSON.stringify(evidence, null, 2)}\n`;
    if (check) {
        if (!fs.existsSync(OUTPUT_PATH) || fs.readFileSync(OUTPUT_PATH, 'utf8') !== serializedManifest) throw new Error(`Generated manifest differs from ${OUTPUT_PATH}`);
        if (!fs.existsSync(EVIDENCE_PATH) || fs.readFileSync(EVIDENCE_PATH, 'utf8') !== serializedEvidence) throw new Error(`Generated evidence differs from ${EVIDENCE_PATH}`);
    } else {
        fs.writeFileSync(OUTPUT_PATH, serializedManifest, 'utf8');
        fs.writeFileSync(EVIDENCE_PATH, serializedEvidence, 'utf8');
    }
    return {
        check,
        manifest: OUTPUT_PATH,
        evidence: EVIDENCE_PATH,
        contentDigestSha256: manifest.contentDigestSha256,
        regions: evidence.regions.map(({ id, coordinateCount, activeBodyCount, candidateMuscleCount, defaultVisibleMuscleCount, presetCount, sweepPoseCount }) => ({ id, coordinateCount, activeBodyCount, candidateMuscleCount, defaultVisibleMuscleCount, presetCount, sweepPoseCount }))
    };
}

const processArguments = globalThis.process?.argv ?? [];
const isMain = processArguments[1] && import.meta.url === pathToFileURL(path.resolve(processArguments[1])).href;
if (isMain) {
    const result = await writeOrCheckRegionArtifacts({ check: processArguments.includes('--check') });
    globalThis.process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
