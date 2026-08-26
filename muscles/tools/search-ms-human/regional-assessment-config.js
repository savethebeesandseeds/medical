export const HALTON_BASES = Object.freeze([
    2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37,
    41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83
]);

const COMMON = Object.freeze({
    tiers: Object.freeze([
        Object.freeze({ id: 'accessible', travelFraction: 0.38, allocationWeight: 0.28 }),
        Object.freeze({ id: 'moderate', travelFraction: 0.58, allocationWeight: 0.34 }),
        Object.freeze({ id: 'broad', travelFraction: 0.76, allocationWeight: 0.38 })
    ]),
    weights: Object.freeze({ activationPattern: 0.58, fullPose: 0.24, majorPose: 0.18 }),
    filters: Object.freeze({ maximumActivation: 0.90, maximumActivationRms: 0.24, minimumRawActivationRms: 0.012 }),
    minimumPairDistance: Object.freeze({ fullPose: 0.075, majorPose: 0.075 }),
    activationScaleFloor: 0.02,
    activationScaleCap: 1.5,
    minimumResponseRange: 0.015,
    robustSingularRatio: 0.10,
    minimumPanelCount: 12,
    maximumPanelCount: 24,
    stoppingPatience: 2,
    stoppingEffectiveRankGainFraction: 0.01
});

const config = (value) => Object.freeze({ ...COMMON, ...value });

export const REGIONAL_ASSESSMENT_CONFIGS = Object.freeze({
    'right-upper-limb': config({
        key: 'right-arm', profileId: 'primary', regionId: 'right-upper-limb', candidateCount: 384,
        majorCoordinatePatterns: [/elv_angle/, /shoulder_elv/, /shoulder_rot/, /elbow_flexion/],
        minimumPanelCount: 15, maximumPanelCount: 22,
        boundary: 'Right arm only. The rest of the body is prescribed and externally supported; no hand load or contact is modeled.'
    }),
    'left-upper-limb': config({
        key: 'left-arm', profileId: 'primary', regionId: 'left-upper-limb', candidateCount: 384,
        majorCoordinatePatterns: [/elv_angle/, /shoulder_elv/, /shoulder_rot/, /elbow_flexion/],
        minimumPanelCount: 15, maximumPanelCount: 22,
        boundary: 'Left arm only. The rest of the body is prescribed and externally supported; no hand load or contact is modeled.'
    }),
    'right-lower-limb': config({
        key: 'right-leg', profileId: 'primary', regionId: 'right-lower-limb', candidateCount: 768,
        majorCoordinatePatterns: [/hip_flexion/, /hip_adduction/, /hip_rotation/, /knee_angle/],
        minimumPanelCount: 16, maximumPanelCount: 26,
        boundary: 'Unloaded open-chain right leg. Pelvis and the rest of the body are fixed; no ground reaction, balance, stance, gait, or contact is modeled.'
    }),
    'left-lower-limb': config({
        key: 'left-leg', profileId: 'primary', regionId: 'left-lower-limb', candidateCount: 768,
        majorCoordinatePatterns: [/hip_flexion/, /hip_adduction/, /hip_rotation/, /knee_angle/],
        minimumPanelCount: 16, maximumPanelCount: 26,
        boundary: 'Unloaded open-chain left leg. Pelvis and the rest of the body are fixed; no ground reaction, balance, stance, gait, or contact is modeled.'
    }),
    'right-foot-ankle': config({
        key: 'right-foot', profileId: 'primary', regionId: 'right-foot-ankle', candidateCount: 384,
        majorCoordinatePatterns: [/.*/], minimumPanelCount: 9, maximumPanelCount: 16,
        filters: Object.freeze({ maximumActivation: 0.90, maximumActivationRms: 0.24, minimumRawActivationRms: 0.0001 }),
        boundary: 'Unloaded open-chain right foot and ankle. Tibia, knee, hip, and the rest of the body are fixed; no ground reaction or intrinsic-foot/toe isolation is modeled.'
    }),
    'left-foot-ankle': config({
        key: 'left-foot', profileId: 'primary', regionId: 'left-foot-ankle', candidateCount: 384,
        majorCoordinatePatterns: [/.*/], minimumPanelCount: 9, maximumPanelCount: 16,
        filters: Object.freeze({ maximumActivation: 0.90, maximumActivationRms: 0.24, minimumRawActivationRms: 0.0001 }),
        boundary: 'Unloaded open-chain left foot and ankle. Tibia, knee, hip, and the rest of the body are fixed; no ground reaction or intrinsic-foot/toe isolation is modeled.'
    }),
    trunk: config({
        key: 'back-trunk', profileId: 'primary', regionId: 'trunk', candidateCount: 768,
        majorCoordinatePatterns: [/.*/], minimumPanelCount: 16, maximumPanelCount: 28,
        boundary: 'Trunk coordinates only. Pelvis, limbs, and head are prescribed; no external load, contact, whole-body balance, or lifting task is modeled.'
    }),
    'head-neck': config({
        key: 'head-neck', profileId: 'primary', regionId: 'head-neck', candidateCount: 384,
        majorCoordinatePatterns: [/.*/], minimumPanelCount: 9, maximumPanelCount: 16,
        boundary: 'Head-neck coordinates only. The body below T1 is fixed; no external load, contact, jaw articulation, or subject-specific cervical mechanics is modeled.'
    }),
    'right-hand': config({
        key: 'right-hand', profileId: 'hand', regionId: 'right-hand', candidateCount: 1536,
        majorCoordinatePatterns: [/deviation/, /flexion/, /cmc_/, /2mcp_/, /3mcp_/, /4mcp_/, /5mcp_/],
        minimumPanelCount: 18, maximumPanelCount: 32,
        filters: Object.freeze({ maximumActivation: 0.92, maximumActivationRms: 0.28, minimumRawActivationRms: 0.010 }),
        minimumPairDistance: Object.freeze({ fullPose: 0.055, majorPose: 0.055 }),
        boundary: 'Unloaded open-chain right hand. The forearm is fixed and there is no object, contact, grip force, pinch force, or patient-specific tendon calibration.'
    })
});

export const DEFAULT_REGIONAL_ASSESSMENT_REGION = 'right-upper-limb';

export function regionalAssessmentConfig(regionId) {
    const result = REGIONAL_ASSESSMENT_CONFIGS[regionId];
    if (!result) throw new Error(`No deterministic assessment-search configuration exists for ${regionId}.`);
    return result;
}

export function workerUrlForProfile(profileId) {
    return profileId === 'hand'
        ? '../../public/ms-human-worker.js?profile=hand'
        : '../../public/ms-human-worker.js';
}
