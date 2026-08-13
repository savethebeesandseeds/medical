import { MOVEMENT_MODEL_REFERENCE } from '/movement-reference.js';
import {
    REPORT_SCHEMA_VERSION,
    buildReportV5,
    createAssessmentId,
    fullReportExport,
    mainReportExport,
    migrateReportToV5
} from '/report-v5.js';

const DIAGNOSIS_DRAFT_KEY = 'waajacu-medical.diagnosis-draft.v1';
const DIAGNOSIS_REPORTS_KEY = 'waajacu-medical.patient-reports.v1';
const MAX_SAVED_REPORTS = 100;

// MoBL-ARMS coordinate convention used by both Explorer presets and Diagnosis:
// shoulder_rot: negative external, positive internal;
// pro_sup: negative supination, positive pronation.
export const MOBL_ARMS_ROTATION_SIGN = Object.freeze({
    shoulderExternal: -1,
    shoulderInternal: 1,
    forearmSupination: -1,
    forearmPronation: 1
});

const POSE_KEYS = [
    'elv_angle',
    'shoulder_elv',
    'shoulder_rot',
    'elbow_flexion',
    'pro_sup',
    'deviation',
    'flexion'
];

const NEUTRAL_POSE = Object.freeze({
    elv_angle: 0,
    shoulder_elv: 0,
    shoulder_rot: 0,
    elbow_flexion: 0,
    pro_sup: 0,
    deviation: 0,
    flexion: 0
});

const MUSCLE_GROUPS = Object.freeze({
    deltoid: ['DELT1', 'DELT2', 'DELT3'],
    cuff: ['SUPSP', 'INFSP', 'SUBSC', 'TMIN']
});

const ADVANCED_CAPACITY_POSITIONS = Object.freeze([
    { id: 'D1', name: 'High elevation · internal rotation', instruction: 'Discrimination position selected for model separation. This is an extreme research posture; do not attempt it without appropriate professional supervision.', coordinates: { elv_angle: -52.19735649, shoulder_elv: 125.74419034, shoulder_rot: 88.52052318, elbow_flexion: 119.07245252, pro_sup: -41.73916481, deviation: 5.13902301, flexion: 37.40828524 } },
    { id: 'D2', name: 'High side elevation · bent elbow', instruction: 'Discrimination position selected for model separation. This is an extreme research posture; do not attempt it without appropriate professional supervision.', coordinates: { elv_angle: 9.85342476, shoulder_elv: 113.42973722, shoulder_rot: -41.13767995, elbow_flexion: 109.2970619, pro_sup: 1.85458519, deviation: 23.7669527, flexion: 39.40047274 } },
    { id: 'D3', name: 'High diagonal elevation · rotated forearm', instruction: 'Discrimination position selected for model separation. This is an extreme research posture; do not attempt it without appropriate professional supervision.', coordinates: { elv_angle: 31.65029976, shoulder_elv: 97.68754972, shoulder_rot: 55.54200755, elbow_flexion: 18.3986244, pro_sup: 79.97958519, deviation: 13.78648395, flexion: 40.80672274 } },
    { id: 'D4', name: 'Diagonal reach · external rotation', instruction: 'Discrimination position selected for model separation. This is an extreme research posture; do not attempt it without appropriate professional supervision.', coordinates: { elv_angle: 44.74600288, shoulder_elv: 60.17290128, shoulder_rot: -58.93553151, elbow_flexion: 12.95428846, pro_sup: -63.69228981, deviation: 12.84654254, flexion: -53.58780851 } },
    { id: 'D5', name: 'High rear-plane elevation · bent elbow', instruction: 'Discrimination position selected for model separation. This is an extreme research posture; do not attempt it without appropriate professional supervision.', coordinates: { elv_angle: -47.18759087, shoulder_elv: 105.74907316, shoulder_rot: 40.18360911, elbow_flexion: 69.37030409, pro_sup: -34.16103981, deviation: 17.0506441, flexion: 27.62312899 } },
    { id: 'D6', name: 'Diagonal elevation · external rotation', instruction: 'Discrimination position selected for model separation. This is an extreme research posture; do not attempt it without appropriate professional supervision.', coordinates: { elv_angle: 39.69229194, shoulder_elv: 76.85014738, shoulder_rot: -55.82273854, elbow_flexion: 85.01727674, pro_sup: 19.23739769, deviation: -6.67860394, flexion: 5.44539462 } },
    { id: 'D7', name: 'High forward reach · bent elbow', instruction: 'Discrimination position selected for model separation. This is an extreme research posture; do not attempt it without appropriate professional supervision.', coordinates: { elv_angle: 92.14151069, shoulder_elv: 110.66850675, shoulder_rot: -38.97703542, elbow_flexion: 118.91376112, pro_sup: 35.64364769, deviation: 18.44346637, flexion: 45.17195712 } }
]);

const MODERATE_CAPACITY_POSITIONS = Object.freeze([
    { id: 'M1', name: 'Arm relaxed at side', instruction: 'Use this as the starting reference. No hold is required if the position is uncomfortable.', coordinates: { ...NEUTRAL_POSE } },
    { id: 'M2', name: 'Elbow bend 45°', instruction: 'Keep the upper arm comfortably beside the body and bend the elbow halfway.', coordinates: { ...NEUTRAL_POSE, elbow_flexion: 45 } },
    { id: 'M3', name: 'Elbow bend 90°', instruction: 'Keep the upper arm beside the body and bend the elbow to a right angle.', coordinates: { ...NEUTRAL_POSE, elbow_flexion: 90 } },
    { id: 'M4', name: 'Forward raise 30° · elbow bent', instruction: 'With the elbow bent, lift the upper arm a small distance forward.', coordinates: { ...NEUTRAL_POSE, elv_angle: 90, shoulder_elv: 30, elbow_flexion: 90 } },
    { id: 'M5', name: 'Forward raise 45° · elbow bent', instruction: 'With the elbow bent, lift the upper arm forward to about halfway to horizontal.', coordinates: { ...NEUTRAL_POSE, elv_angle: 90, shoulder_elv: 45, elbow_flexion: 90 } },
    { id: 'M6', name: 'Forward raise 60° · elbow bent', instruction: 'With the elbow bent, lift forward only to the displayed moderate angle.', coordinates: { ...NEUTRAL_POSE, elv_angle: 90, shoulder_elv: 60, elbow_flexion: 90 } },
    { id: 'M7', name: 'Diagonal raise 30° · elbow bent', instruction: 'Lift the bent arm diagonally, midway between forward and sideways.', coordinates: { ...NEUTRAL_POSE, elv_angle: 45, shoulder_elv: 30, elbow_flexion: 90 } },
    { id: 'M8', name: 'Diagonal raise 45° · elbow bent', instruction: 'Lift the bent arm diagonally to about halfway to horizontal.', coordinates: { ...NEUTRAL_POSE, elv_angle: 45, shoulder_elv: 45, elbow_flexion: 90 } },
    { id: 'M9', name: 'Diagonal raise 60° · elbow bent', instruction: 'Lift the bent arm diagonally only to the displayed moderate angle.', coordinates: { ...NEUTRAL_POSE, elv_angle: 45, shoulder_elv: 60, elbow_flexion: 90 } },
    { id: 'M10', name: 'Side raise 30° · elbow bent', instruction: 'With the elbow bent, move the upper arm a small distance sideways.', coordinates: { ...NEUTRAL_POSE, shoulder_elv: 30, elbow_flexion: 90 } },
    { id: 'M11', name: 'Side raise 45° · elbow bent', instruction: 'With the elbow bent, lift sideways to about halfway to horizontal.', coordinates: { ...NEUTRAL_POSE, shoulder_elv: 45, elbow_flexion: 90 } },
    { id: 'M12', name: 'Side raise 60° · elbow bent', instruction: 'With the elbow bent, lift sideways only to the displayed moderate angle.', coordinates: { ...NEUTRAL_POSE, shoulder_elv: 60, elbow_flexion: 90 } },
    { id: 'M13', name: 'Internal rotation 20°', instruction: 'Keep the elbow bent and close to the body; rotate the forearm inward slightly.', coordinates: { ...NEUTRAL_POSE, shoulder_elv: 15, shoulder_rot: MOBL_ARMS_ROTATION_SIGN.shoulderInternal * 20, elbow_flexion: 90 } },
    { id: 'M14', name: 'Internal rotation 40°', instruction: 'Keep the elbow bent and close to the body; rotate the forearm inward without forcing it.', coordinates: { ...NEUTRAL_POSE, shoulder_elv: 15, shoulder_rot: MOBL_ARMS_ROTATION_SIGN.shoulderInternal * 40, elbow_flexion: 90 } },
    { id: 'M15', name: 'External rotation 20°', instruction: 'Keep the elbow bent and close to the body; rotate the forearm outward slightly.', coordinates: { ...NEUTRAL_POSE, shoulder_elv: 15, shoulder_rot: MOBL_ARMS_ROTATION_SIGN.shoulderExternal * 20, elbow_flexion: 90 } },
    { id: 'M16', name: 'External rotation 40°', instruction: 'Keep the elbow bent and close to the body; rotate the forearm outward without forcing it.', coordinates: { ...NEUTRAL_POSE, shoulder_elv: 15, shoulder_rot: MOBL_ARMS_ROTATION_SIGN.shoulderExternal * 40, elbow_flexion: 90 } },
    { id: 'M17', name: 'Forearm supination 45°', instruction: 'Keep the elbow at 90 degrees and turn the palm partly upward.', coordinates: { ...NEUTRAL_POSE, elbow_flexion: 90, pro_sup: MOBL_ARMS_ROTATION_SIGN.forearmSupination * 45 } },
    { id: 'M18', name: 'Forearm pronation 45°', instruction: 'Keep the elbow at 90 degrees and turn the palm partly downward.', coordinates: { ...NEUTRAL_POSE, elbow_flexion: 90, pro_sup: MOBL_ARMS_ROTATION_SIGN.forearmPronation * 45 } }
]);

const ALL_CAPACITY_POSITIONS = Object.freeze([...MODERATE_CAPACITY_POSITIONS, ...ADVANCED_CAPACITY_POSITIONS]);
const ASSESSMENT_POSITIONS = MODERATE_CAPACITY_POSITIONS;

function emptyPositionResponse() {
    return {
        answered: false,
        completion: 'not_recorded',
        pain: 'not_recorded',
        weakness: 'not_recorded',
        stiffness: 'not_recorded',
        compensation: 'not_recorded',
        painScore: '',
        weaknessScore: '',
        painLocation: '',
        limitingFactor: '',
        compensationDetail: '',
        notes: '',
        result: 'not_tested'
    };
}

// Codes come from exact complete-capacity-loss re-solves at the seven selected
// postures. `null` means the weakened model was numerically indeterminate and
// therefore contributes no match or contradiction.
const CAPACITY_SIGNATURES = Object.freeze({
    'No modeled capacity loss': [0, 0, 0, 0, 0, 0, 0],
    'Anterior deltoid': [1, 0, 1, 0, null, 0, null],
    'Biceps': [null, 0, 0, 0, null, 1, 0],
    'Coracobrachialis': [0, 0, 0, 1, 0, 0, 0],
    'Infraspinatus': [0, null, 0, null, 0, 0, 1],
    'Latissimus dorsi': [1, 0, 0, 0, 0, 0, 0],
    'Middle deltoid': [0, 0, null, null, 1, 0, null],
    'Pectoralis major': [0, 1, 0, null, 0, 1, 0],
    'Posterior deltoid': [0, null, 1, 0, 0, 0, null],
    'Subscapularis': [0, 1, 0, 0, 1, 0, 0],
    'Supraspinatus': [0, 1, 0, 0, 0, 0, 0],
    'Teres minor': [0, 0, 0, null, 0, 1, 1],
    'Triceps': [0, 1, 1, 0, null, 1, 0],
    'Brachialis / brachioradialis / teres major': [0, 0, 0, 0, 0, 0, 0]
});

const CAPACITY_ANGLE_LABELS = Object.freeze({
    elv_angle: 'Plane',
    shoulder_elv: 'Shoulder',
    shoulder_rot: 'Rotation',
    elbow_flexion: 'Elbow',
    pro_sup: 'Forearm',
    deviation: 'Wrist dev.',
    flexion: 'Wrist flex.'
});

const RED_FLAGS = Object.freeze([
    { id: 'cardiopulmonary', urgency: 'emergency', label: 'Chest pain, shortness of breath, faintness, or pain spreading toward the jaw' },
    { id: 'deformity', urgency: 'emergency', label: 'Visible deformity or apparent dislocation after an injury' },
    { id: 'circulation', urgency: 'emergency', label: 'Major sudden swelling, complete loss of sensation, or an unusually cold/discoloured arm' },
    { id: 'trauma', urgency: 'urgent', label: 'Recent fall or trauma with substantial pain, weakness, or inability to lift the arm' },
    { id: 'neurological', urgency: 'urgent', label: 'Persistent numbness, pins and needles, or new marked weakness down the arm' },
    { id: 'infection', urgency: 'urgent', label: 'Hot, red, swollen shoulder with fever or feeling systemically unwell' },
    { id: 'restPain', urgency: 'review', label: 'Intense or worsening pain at rest, especially with persistent loss of function' },
    { id: 'systemicHistory', urgency: 'review', label: 'Unexplained weight loss/night sweats or relevant cancer, TB, HIV, or inflammatory-disease history' }
]);

function pathSamples(base, key, values) {
    return values.map((value, index) => ({
        progress: values.length === 1 ? 0 : index / (values.length - 1),
        coordinates: { ...NEUTRAL_POSE, ...base, [key]: value }
    }));
}

function targetFromObservation(response, fallback, minimum = 0) {
    const entered = Number(response?.maxAngle);
    if (!Number.isFinite(entered) || entered <= minimum) return fallback;
    return Math.min(Math.max(entered, minimum), fallback);
}

function elevationPath(plane, fallbackTarget, response, extra = {}) {
    const target = targetFromObservation(response, fallbackTarget);
    const values = [0, target * 0.25, target * 0.5, target * 0.75, target];
    return pathSamples({ elv_angle: plane, ...extra }, 'shoulder_elv', values);
}

export const DIAGNOSIS_TESTS = Object.freeze([
    {
        id: 0,
        name: 'Safety screen',
        short: 'Red flags before movement',
        purpose: 'Check for warning signs that should pause this observation workflow.',
        start: 'No movement is needed.',
        movement: 'Review each item before attempting a shoulder movement.',
        target: 'Stop and seek appropriate medical assessment when a warning sign applies.',
        hint: 'This screen cannot rule out an urgent condition.',
        model: { kind: 'none', reason: 'Safety observations do not use a biomechanical model.' }
    },
    {
        id: 1,
        name: 'Neutral baseline',
        short: 'Arm relaxed by the side',
        purpose: 'Record symptoms at rest and show the generic gravity-only neutral posture estimate.',
        start: 'Sit or stand upright with the arm naturally relaxed.',
        movement: 'No movement. Hold only if comfortable.',
        target: 'A comfortable neutral posture; no required five-second hold.',
        hint: 'The model cannot measure resting activation or left-right asymmetry.',
        model: { kind: 'static', label: 'Neutral gravity-only posture', samples: () => pathSamples({}, 'shoulder_elv', [0]) }
    },
    {
        id: 2,
        name: 'Slow lateral elevation',
        short: 'Arm sideways, comfortable range',
        purpose: 'Compare symptoms during frontal-plane elevation with other elevation planes.',
        start: 'Arm by the side, thumb forward or slightly up, trunk upright.',
        movement: 'Slowly lift sideways. Stop at the first sharp, unfamiliar, or increasing pain; do not chase 90°.',
        target: 'Comfortable range up to 90°.',
        hint: 'Symptoms during a DELT2-demanding task do not identify DELT2 as the painful tissue.',
        model: { kind: 'static-path', label: 'Unloaded quasi-static abduction', samples: (r) => elevationPath(0, 90, r) }
    },
    {
        id: 3,
        name: 'Scaption, thumb up',
        short: 'Raise 30° forward of the side',
        purpose: 'Compare a scapular-plane posture with pure lateral elevation.',
        start: 'Arm by the side, thumb up.',
        movement: 'Raise about 30° forward of the side, only through a comfortable range.',
        target: 'Comfortable range up to 90°.',
        hint: 'A difference from lateral elevation shows posture/load sensitivity, not its anatomical cause.',
        model: { kind: 'static-path', label: 'Unloaded quasi-static scaption', samples: (r) => elevationPath(30, 90, r) }
    },
    {
        id: 4,
        name: 'Forward elevation',
        short: 'Raise the arm forward',
        purpose: 'Compare forward elevation with lateral elevation and scaption.',
        start: 'Arm by the side, thumb up, trunk upright.',
        movement: 'Raise forward slowly and stop before sharp, unfamiliar, or increasing pain.',
        target: 'Comfortable range up to 120°.',
        hint: 'Differences between elevation planes are descriptive; they do not isolate a tissue.',
        model: { kind: 'static-path', label: 'Unloaded quasi-static forward elevation', samples: (r) => elevationPath(90, 120, r) }
    },
    {
        id: 5,
        name: 'Isometric abduction at 30°',
        short: 'Gentle outward press',
        purpose: 'Record symptom response to a resisted abduction task.',
        start: 'Arm about 30° from the side.',
        movement: 'Clinician-guided only. Do not perform resistance if it is unsafe or unfamiliar.',
        target: 'No model target; resistance must be measured to model this task.',
        hint: 'Pain during resistance cannot identify deltoid versus supraspinatus by itself.',
        model: { kind: 'unavailable', pose: { shoulder_elv: 30 }, reason: 'Model demand unavailable: resistance magnitude, direction, and contact point were not measured.' }
    },
    {
        id: 6,
        name: 'Isometric abduction at 60°',
        short: 'Gentle outward press',
        purpose: 'Record symptom response at a higher abduction posture.',
        start: 'Arm about 60° from the side, thumb up.',
        movement: 'Clinician-guided only. Do not push through pain.',
        target: 'No model target; resistance must be measured to model this task.',
        hint: 'The current solver cannot represent an unmeasured wall or hand force.',
        model: { kind: 'unavailable', pose: { shoulder_elv: 60 }, reason: 'Model demand unavailable: resistance magnitude, direction, and contact point were not measured.' }
    },
    {
        id: 7,
        name: 'External rotation at side',
        short: 'Elbow tucked, forearm outward',
        purpose: 'Observe an unloaded motion with greater external-rotator demand.',
        start: 'Upper arm at the side, elbow bent 90° and comfortably tucked.',
        movement: 'Rotate the forearm outward slowly without forcing the range.',
        target: 'Comfortable external rotation up to about 45°.',
        hint: 'Symptom reproduction is not specific to one rotator-cuff tissue.',
        model: {
            kind: 'static-path',
            label: 'Unloaded quasi-static external rotation',
            samples: () => pathSamples({ elbow_flexion: 90 }, 'shoulder_rot', [0, 11.25, 22.5, 33.75, 45].map((value) => value * MOBL_ARMS_ROTATION_SIGN.shoulderExternal))
        }
    },
    {
        id: 8,
        name: 'Isometric external rotation',
        short: 'Outward press without motion',
        purpose: 'Record symptoms during resisted external rotation.',
        start: 'Elbow at the side and bent 90°.',
        movement: 'Clinician-guided only. Avoid unmeasured resistance in this model workflow.',
        target: 'No model target; resistance must be measured to model this task.',
        hint: 'The posture-only solver would not represent the performed resistance.',
        model: { kind: 'unavailable', pose: { elbow_flexion: 90 }, reason: 'Model demand unavailable: external resistance was not measured.' }
    },
    {
        id: 9,
        name: 'Empty-can posture, gentle',
        short: 'Scaption, thumb down, no resistance',
        purpose: 'Compare a gentle thumb-down posture with thumb-up scaption.',
        start: 'Arm 45–60° in scaption. Use thumb-down only if comfortable.',
        movement: 'Hold briefly without added resistance. Stop if symptoms increase.',
        target: 'A comfortable 60° posture; do not force thumb-down rotation.',
        hint: 'This posture co-activates several muscles and cannot isolate supraspinatus.',
        model: { kind: 'static', label: 'Gravity-only posture; no test resistance', samples: () => [{ progress: 0, coordinates: { ...NEUTRAL_POSE, elv_angle: 30, shoulder_elv: 60, shoulder_rot: MOBL_ARMS_ROTATION_SIGN.shoulderInternal * 45 } }] }
    },
    {
        id: 10,
        name: 'Full-can posture, gentle',
        short: 'Scaption, thumb up, no resistance',
        purpose: 'Compare a gentle thumb-up posture with the empty-can posture.',
        start: 'Arm 45–60° in scaption, thumb up.',
        movement: 'Hold briefly without added resistance.',
        target: 'A comfortable 60° posture.',
        hint: 'A symptom difference is descriptive and does not diagnose a cuff condition.',
        model: { kind: 'static', label: 'Gravity-only posture; no test resistance', samples: () => [{ progress: 0, coordinates: { ...NEUTRAL_POSE, elv_angle: 30, shoulder_elv: 60 } }] }
    },
    {
        id: 11,
        name: 'Cross-body movement',
        short: 'Arm across the chest',
        purpose: 'Record top-of-shoulder or other symptoms during horizontal cross-body movement.',
        start: 'Raise the arm in front only as far as comfortable.',
        movement: 'Move the arm gently across the body without forcing it.',
        target: 'Comfortable cross-body range.',
        hint: 'Top-of-shoulder symptoms can be recorded as an AC-region pattern, not an AC-joint diagnosis.',
        model: {
            kind: 'static-path',
            label: 'Unloaded quasi-static cross-body path',
            samples: () => pathSamples({ shoulder_elv: 90, elbow_flexion: 20 }, 'elv_angle', [90, 100, 110, 120, 130])
        }
    },
    {
        id: 12,
        name: 'Supported elevation',
        short: 'Arm sliding on a surface',
        purpose: 'Compare supported and unsupported symptom response.',
        start: 'Support the forearm on a comfortable sliding surface.',
        movement: 'Slide only through an easy range; do not load through pain.',
        target: 'Comfortable supported range.',
        hint: 'A difference suggests load sensitivity but does not identify a structure.',
        model: { kind: 'unavailable', pose: { elv_angle: 30, shoulder_elv: 60 }, reason: 'Model demand unavailable: the support force was not measured.' }
    },
    {
        id: 13,
        name: 'Self-assisted elevation',
        short: 'Other hand assists gently',
        purpose: 'Compare active and self-assisted range without forcing the shoulder.',
        start: 'Affected arm relaxed as much as possible; use the other hand for gentle assistance.',
        movement: 'Self-assist through a small comfortable range. Never have a helper force the arm.',
        target: 'Comfortable self-assisted range.',
        hint: 'Active muscle demand is not meaningful when assistance force is unknown.',
        model: { kind: 'unavailable', pose: { elv_angle: 30, shoulder_elv: 60 }, reason: 'Model demand unavailable: assistance force was not measured.' }
    },
    {
        id: 14,
        name: 'Other-side comparison',
        short: 'Repeat one informative movement',
        purpose: 'Compare reported pain, reach, and onset angle with the other side.',
        start: 'Use the same comfortable setup as the chosen comparison movement.',
        movement: 'Repeat only a safe, gentle, unloaded movement. Do not reproduce a severe response.',
        target: 'Record observations, not model-derived asymmetry.',
        hint: 'Mirror view is the same generic right-arm model and cannot calculate biological side differences.',
        model: { kind: 'none', reason: 'Observation comparison only: visual mirroring is not a left-arm computation.' }
    }
]);

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function finiteOrNull(value) {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function ratio(numerator, denominator) {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) ||
            numerator <= 0.011 || denominator < 0.02) return null;
    return numerator / denominator;
}

function trapezoid(samples, field, muscle) {
    if (!samples.length) return null;
    if (samples.length === 1) return samples[0][field]?.[muscle] ?? null;
    let total = 0;
    for (let index = 1; index < samples.length; index += 1) {
        const previous = samples[index - 1];
        const current = samples[index];
        const a = previous[field]?.[muscle];
        const b = current[field]?.[muscle];
        if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
        total += 0.5 * (a + b) * (current.progress - previous.progress);
    }
    return total;
}

function computeMetrics(samples, attempted, muscleNames) {
    if (!samples.length) return null;
    const peak = {};
    const pathIntegral = {};
    const peakActiveForceN = {};
    const normalizedActiveForcePathIntegralN = {};
    const forceAvailable = samples.every((sample) => muscleNames.every(
        (name) => Number.isFinite(sample.activeForceN?.[name])
    ));
    for (const name of muscleNames) {
        peak[name] = Math.max(...samples.map((sample) => sample.activation[name]));
        pathIntegral[name] = trapezoid(samples, 'activation', name);
        if (forceAvailable) peakActiveForceN[name] = Math.max(...samples.map((sample) => sample.activeForceN[name]));
        if (forceAvailable) normalizedActiveForcePathIntegralN[name] = trapezoid(samples, 'activeForceN', name);
    }
    const d2 = pathIntegral.DELT2;
    const totalDeltoid = MUSCLE_GROUPS.deltoid.reduce((sum, name) => sum + pathIntegral[name], 0);
    const cuffMean = MUSCLE_GROUPS.cuff.reduce((sum, name) => sum + pathIntegral[name], 0) / MUSCLE_GROUPS.cuff.length;
    const topPeak = Object.entries(peak).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topPath = Object.entries(pathIntegral).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topForce = forceAvailable
        ? Object.entries(peakActiveForceN).sort((a, b) => b[1] - a[1]).slice(0, 5)
        : [];
    const topForcePath = forceAvailable
        ? Object.entries(normalizedActiveForcePathIntegralN).sort((a, b) => b[1] - a[1]).slice(0, 5)
        : [];
    return {
        validSamples: samples.length,
        attemptedSamples: attempted,
        coverage: attempted ? samples.length / attempted : 0,
        peakActivation: peak,
        peakRotatorCuffActivation: Math.max(...MUSCLE_GROUPS.cuff.map((name) => peak[name])),
        normalizedActivationPathIntegral: pathIntegral,
        ratios: {
            delt2ToSupraspinatus: ratio(d2, pathIntegral.SUPSP),
            delt2DeltoidShare: ratio(d2, totalDeltoid),
            delt2ToCuffMean: ratio(d2, cuffMean)
        },
        topPeak,
        topPath,
        activeActuatorForceAvailable: forceAvailable,
        peakActiveActuatorForceN: forceAvailable ? peakActiveForceN : null,
        normalizedActiveActuatorForcePathIntegralN: forceAvailable ? normalizedActiveForcePathIntegralN : null,
        topForce,
        topForcePath,
        jointReactionAvailable: false
    };
}

function formatMetric(value, digits = 3) {
    return Number.isFinite(value) ? Number(value).toFixed(digits) : 'Not interpretable';
}

function slimSample(state, progress, requestedCoordinates) {
    const activation = {};
    const activeForceN = {};
    for (const muscle of state.muscles ?? []) {
        activation[muscle.name] = finiteOrNull(muscle.activation);
        if (Number.isFinite(Number(muscle.activeActuatorForceN))) {
            activeForceN[muscle.name] = Number(muscle.activeActuatorForceN);
        }
    }
    return {
        progress,
        requestedCoordinates,
        returnedCoordinates: state.coordinates,
        activation,
        activeForceN,
        solver: state.staticHolding?.solver ?? null,
        quality: state.staticHolding?.quality ?? null,
        assumptions: state.staticHolding?.assumptions ?? null
    };
}

function completeStaticState(state, muscleNames) {
    if (state?.mode !== 'static' || state.staticHolding?.solver?.converged !== true ||
            state.staticHolding?.quality?.usable !== true || !Array.isArray(state.muscles)) return false;
    const values = new Map(state.muscles.map((muscle) => [muscle.name, Number(muscle.activation)]));
    return muscleNames.length > 0 && muscleNames.every((name) => Number.isFinite(values.get(name)));
}

function defaultResponse() {
    return {
        status: 'not_attempted',
        reached: 'not_tested',
        pain: 'not_tested',
        painScore: '',
        maxAngle: '',
        onsetAngle: '',
        location: '',
        locationOther: '',
        familiar: 'unsure',
        compensation: 'none_observed',
        severe: false,
        sharpOrUnfamiliar: false,
        neurological: false,
        escalating: false,
        notes: ''
    };
}

export function createDiagnosisWorkflow(controller) {
    const byId = (id) => document.getElementById(id);
    const state = {
        schemaVersion: REPORT_SCHEMA_VERSION,
        assessmentId: createAssessmentId(),
        workflowMode: 'observations',
        activeTestId: 0,
        activeCapacityIndex: 0,
        capacityResponses: Object.fromEntries(ALL_CAPACITY_POSITIONS.map((position) => [position.id, emptyPositionResponse()])),
        capacityModelStates: {},
        testedSide: 'right',
        redFlags: Object.fromEntries(RED_FLAGS.map((flag) => [flag.id, null])),
        safetyReviewed: false,
        intakeCompleted: false,
        intake: {},
        responses: {},
        runs: {},
        runGeneration: 0,
        running: false,
        ready: false,
        report: null,
        reportAnnex: null,
        reportStored: false,
        legacySymptomAssessment: null,
        previewGeneration: 0,
        assessmentOpen: false,
        phase: 'safety',
        draftUpdatedAt: null,
        viewingSavedReport: false,
        dialogAction: null
    };

    function readStoredJson(key, fallback) {
        try {
            const value = JSON.parse(window.localStorage.getItem(key) ?? 'null');
            return value ?? fallback;
        } catch {
            return fallback;
        }
    }

    function savedReports() {
        const reports = readStoredJson(DIAGNOSIS_REPORTS_KEY, []);
        if (!Array.isArray(reports)) return [];
        return reports.map((entry) => {
            const patient = entry?.patient ?? entry?.report?.intake ?? {};
            const migrated = migrateReportToV5(entry?.report, entry?.technicalAnnex ?? null);
            return { ...entry, patient, report: migrated.report, technicalAnnex: migrated.technicalAnnex };
        }).filter((entry) => entry?.report?.generatedAt && entry.patient);
    }

    function restoreDraft() {
        const draft = readStoredJson(DIAGNOSIS_DRAFT_KEY, null);
        if (!draft || ![4, state.schemaVersion].includes(Number(draft.schemaVersion))) return false;
        const emptyResponses = Object.fromEntries(ALL_CAPACITY_POSITIONS.map((position) => [position.id, emptyPositionResponse()]));
        const migrateLegacyResponse = (response = {}) => {
            if (Number(draft.schemaVersion) !== 4) return response;
            const completion = ({ able: 'full', pain_limited: 'stopped', unable: 'unable', uncertain: 'stopped', not_tested: response.answered ? 'skipped' : 'not_recorded' })[response.result] ?? 'not_recorded';
            return {
                completion,
                pain: response.result === 'pain_limited' || Number(response.painScore) > 0 ? 'yes' : 'not_recorded',
                weakness: response.weakness === 'yes' || Number(response.weaknessScore) > 0 ? 'yes' : 'not_recorded',
                stiffness: 'not_recorded',
                compensation: 'not_recorded',
                painScore: response.painScore ?? '',
                weaknessScore: response.weaknessScore ?? '',
                painLocation: response.painLocation ?? '',
                limitingFactor: '',
                compensationDetail: '',
                notes: response.notes ?? '',
                answered: completion === 'skipped',
                migratedFromDraftVersion: 4
            };
        };
        state.activeCapacityIndex = Math.max(0, Math.min(ASSESSMENT_POSITIONS.length - 1, Number(draft.activeCapacityIndex) || 0));
        state.capacityResponses = Object.fromEntries(ALL_CAPACITY_POSITIONS.map((position) => [
            position.id,
            { ...emptyResponses[position.id], ...migrateLegacyResponse(draft.capacityResponses?.[position.id] ?? {}) }
        ]));
        for (const response of Object.values(state.capacityResponses)) {
            response.answered = capacityResponseComplete(response);
            response.result = legacyCapacityResult(response);
        }
        const firstUnansweredIndex = ASSESSMENT_POSITIONS.findIndex((position) => !state.capacityResponses[position.id].answered);
        if (firstUnansweredIndex !== -1) state.activeCapacityIndex = Math.min(state.activeCapacityIndex, firstUnansweredIndex);
        state.testedSide = draft.testedSide === 'left' ? 'left' : 'right';
        state.redFlags = Object.fromEntries(RED_FLAGS.map((flag) => [flag.id, typeof draft.redFlags?.[flag.id] === 'boolean' ? draft.redFlags[flag.id] : null]));
        state.safetyReviewed = Boolean(draft.safetyReviewed);
        state.intakeCompleted = Boolean(draft.intakeCompleted);
        state.intake = draft.intake && typeof draft.intake === 'object' ? { ...draft.intake } : {};
        state.legacySymptomAssessment = Number(draft.schemaVersion) === 4 && (draft.responses || draft.runs)
            ? {
                sourceSchemaVersion: 4,
                sourceCollection: 'draft.responses-and-runs',
                readOnly: true,
                interpretationExcluded: true,
                mayContainFreeTextIdentifiers: true,
                responses: structuredClone(draft.responses ?? {}),
                runs: structuredClone(draft.runs ?? {})
            }
            : (draft.legacySymptomAssessment ?? null);
        state.assessmentId = draft.assessmentId || createAssessmentId();
        state.assessmentOpen = Boolean(draft.assessmentOpen);
        state.phase = ['safety', 'intake', 'assessment', 'report'].includes(draft.phase) ? draft.phase : 'safety';
        state.draftUpdatedAt = draft.updatedAt ?? null;
        return true;
    }

    function persistDraft() {
        if (state.phase === 'report' && !state.viewingSavedReport && state.reportStored) {
            try { window.localStorage.removeItem(DIAGNOSIS_DRAFT_KEY); } catch { /* storage unavailable */ }
            state.draftUpdatedAt = null;
            updateSavedRecordsUi();
            return;
        }
        const hasData = Object.values(state.redFlags).some((value) => typeof value === 'boolean')
            || Object.values(state.intake).some((value) => value !== '' && value !== null && value !== false)
            || Object.values(state.capacityResponses).some((response) => response.answered || response.notes);
        if (!hasData) {
            try { window.localStorage.removeItem(DIAGNOSIS_DRAFT_KEY); } catch { /* storage unavailable */ }
            state.draftUpdatedAt = null;
            updateSavedRecordsUi();
            return;
        }
        const draft = {
            schemaVersion: state.schemaVersion,
            assessmentId: state.assessmentId,
            updatedAt: new Date().toISOString(),
            phase: state.phase,
            activeCapacityIndex: state.activeCapacityIndex,
            capacityResponses: state.capacityResponses,
            testedSide: state.testedSide,
            redFlags: state.redFlags,
            safetyReviewed: state.safetyReviewed,
            intakeCompleted: state.intakeCompleted,
            intake: state.intake,
            legacySymptomAssessment: state.legacySymptomAssessment,
            assessmentOpen: state.assessmentOpen
        };
        try {
            window.localStorage.setItem(DIAGNOSIS_DRAFT_KEY, JSON.stringify(draft));
            state.draftUpdatedAt = draft.updatedAt;
        } catch {
            // The workflow remains usable when browser storage is unavailable.
        }
        updateSavedRecordsUi();
    }

    function clearDraft() {
        try { window.localStorage.removeItem(DIAGNOSIS_DRAFT_KEY); } catch { /* storage unavailable */ }
        state.draftUpdatedAt = null;
        updateSavedRecordsUi();
    }

    function fillIntakeForm(intake = {}) {
        const form = byId('diagnosis-intake-form');
        for (const element of form.elements) {
            if (!element.name || !(element.name in intake)) continue;
            if (element.type === 'checkbox') element.checked = Boolean(intake[element.name]);
            else element.value = intake[element.name] ?? '';
        }
    }

    function reportPatientKey(intake = {}) {
        const email = String(intake.email ?? '').trim().toLowerCase();
        if (email) return `email:${email}`;
        return `name:${String(intake.name ?? '').trim().toLowerCase()}|city:${String(intake.city ?? '').trim().toLowerCase()}`;
    }

    function archiveReport(report) {
        if (!report?.generatedAt || !state.intake?.name) return false;
        const patient = { ...state.intake };
        const assessmentId = report.assessment?.assessmentId || report.generatedAt;
        const entry = { id: assessmentId, patientKey: reportPatientKey(patient), patient, report, technicalAnnex: state.reportAnnex };
        const reports = savedReports().filter((item) => (item.report?.assessment?.assessmentId || item.id) !== assessmentId);
        reports.unshift(entry);
        if (reports.length > MAX_SAVED_REPORTS) return false;
        try {
            window.localStorage.setItem(DIAGNOSIS_REPORTS_KEY, JSON.stringify(reports));
        } catch {
            return false;
        }
        updateSavedRecordsUi();
        return true;
    }

    function closeAppDialog() {
        state.dialogAction = null;
        byId('app-dialog').classList.add('hidden');
        byId('app-dialog').querySelector('.app-dialog-card').classList.remove('danger');
    }

    function showAppDialog({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm }) {
        state.dialogAction = onConfirm;
        byId('app-dialog-title').textContent = title;
        byId('app-dialog-message').textContent = message;
        byId('app-dialog-confirm').textContent = confirmLabel;
        byId('app-dialog').querySelector('.app-dialog-card').classList.toggle('danger', danger);
        byId('app-dialog').classList.remove('hidden');
        byId('app-dialog-cancel').focus();
    }

    function importPatientDetails(entry) {
        const prior = entry.patient ?? entry.report.intake ?? {};
        const demographics = ['name', 'ageYears', 'gender', 'heightCm', 'weightKg', 'assessedArm', 'email', 'city'];
        for (const field of demographics) state.intake[field] = prior[field] ?? '';
        state.intakeCompleted = false;
        fillIntakeForm(state.intake);
        persistDraft();
        if (state.safetyReviewed && !selectedRedFlags().length) showIntake();
        else byId('diagnosis-draft-state').textContent = `${state.intake.name} selected · complete the safety check`;
    }

    function updateSavedRecordsUi() {
        const reports = savedReports();
        const answered = ASSESSMENT_POSITIONS.filter((position) => state.capacityResponses[position.id]?.answered).length;
        const patient = state.intake?.name ? `${state.intake.name} · ` : '';
        byId('diagnosis-draft-state').textContent = state.draftUpdatedAt
            ? `${patient}${answered} of ${ASSESSMENT_POSITIONS.length} positions saved`
            : 'No unfinished assessment';

        const host = byId('diagnosis-saved-report-list');
        host.replaceChildren();
        if (!reports.length) {
            const empty = document.createElement('p');
            empty.className = 'saved-report-empty';
            empty.textContent = 'No reports have been generated in this browser.';
            host.append(empty);
            return;
        }
        const table = document.createElement('table');
        table.className = 'saved-report-table';
        table.innerHTML = '<thead><tr><th>Patient</th><th>Assessment date</th><th>Age</th><th>Arm</th><th>City</th><th>Actions</th></tr></thead>';
        const body = document.createElement('tbody');
        for (const entry of reports) {
            const row = document.createElement('tr');
            const patientCell = document.createElement('td');
            patientCell.className = 'saved-report-patient';
            const patientName = document.createElement('strong');
            patientName.textContent = entry.patient?.name || 'Unnamed';
            const patientEmail = document.createElement('span');
            patientEmail.textContent = entry.patient?.email || 'No email';
            patientCell.append(patientName, patientEmail);
            row.append(patientCell);
            const values = [
                new Date(entry.report.generatedAt).toLocaleString(),
                Number.isFinite(entry.patient?.ageYears) ? String(entry.patient.ageYears) : '—',
                entry.patient?.assessedArm || entry.report.assessment?.testedSide || '—',
                entry.patient?.city || '—'
            ];
            for (const value of values) {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.append(cell);
            }
            const actions = document.createElement('td');
            actions.className = 'saved-report-actions';
            const use = document.createElement('button');
            use.type = 'button';
            use.className = 'quiet-button';
            use.textContent = 'Import details';
            use.addEventListener('click', () => importPatientDetails(entry));
            const view = document.createElement('button');
            view.type = 'button';
            view.className = 'quiet-button';
            view.textContent = 'View';
            view.addEventListener('click', () => showSavedReport(entry));
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'quiet-button';
            remove.textContent = 'Delete';
            remove.addEventListener('click', () => {
                showAppDialog({
                    title: 'Delete patient report?',
                    message: `This will permanently remove the report for ${entry.patient?.name || 'this patient'} dated ${new Date(entry.report.generatedAt).toLocaleString()} from this browser.`,
                    confirmLabel: 'Delete report',
                    danger: true,
                    onConfirm: () => {
                        try {
                            window.localStorage.setItem(DIAGNOSIS_REPORTS_KEY, JSON.stringify(savedReports().filter((item) => item.id !== entry.id)));
                        } catch { /* storage unavailable */ }
                        updateSavedRecordsUi();
                    }
                });
            });
            actions.append(use, view, remove);
            row.append(actions);
            body.append(row);
        }
        table.append(body);
        host.append(table);
    }

    function showSavedReport(entry) {
        stopCurrentRun();
        state.viewingSavedReport = true;
        state.reportStored = true;
        state.report = entry.report;
        state.reportAnnex = entry.technicalAnnex ?? null;
        byId('diagnosis-safety-landing').classList.add('hidden');
        byId('diagnosis-intake').classList.add('hidden');
        byId('diagnosis-assessment').classList.add('hidden');
        byId('diagnosis-report-screen').classList.remove('hidden');
        byId('diagnosis-report-back').textContent = 'Back';
        renderMovementReport(state.report);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function showSafetyLanding() {
        stopCurrentRun();
        state.assessmentOpen = false;
        state.phase = 'safety';
        state.viewingSavedReport = false;
        byId('diagnosis-safety-landing').classList.remove('hidden');
        byId('diagnosis-intake').classList.add('hidden');
        byId('diagnosis-assessment').classList.add('hidden');
        byId('diagnosis-report-screen').classList.add('hidden');
        renderSafetyForm();
        updateWarning();
        persistDraft();
        window.requestAnimationFrame(controller.resizeViewer);
    }

    function readIntake() {
        const form = byId('diagnosis-intake-form');
        const data = new FormData(form);
        state.intake = {
            name: String(data.get('name') ?? '').trim(),
            ageYears: finiteOrNull(data.get('ageYears')),
            gender: String(data.get('gender') ?? ''),
            heightCm: finiteOrNull(data.get('heightCm')),
            weightKg: finiteOrNull(data.get('weightKg')),
            assessedArm: String(data.get('assessedArm') ?? ''),
            email: String(data.get('email') ?? '').trim(),
            city: String(data.get('city') ?? '').trim(),
            painDuration: String(data.get('painDuration') ?? ''),
            painOnset: String(data.get('painOnset') ?? ''),
            painNow: finiteOrNull(data.get('painNow')),
            painWorst: finiteOrNull(data.get('painWorst')),
            primaryPainLocation: String(data.get('primaryPainLocation') ?? ''),
            painAtRest: data.has('painAtRest'),
            nightPain: data.has('nightPain'),
            radiatingPain: data.has('radiatingPain'),
            clickingInstability: data.has('clickingInstability'),
            privacyAccepted: data.has('privacyAccepted'),
            onsetDetails: String(data.get('onsetDetails') ?? '').trim(),
            aggravatingRelieving: String(data.get('aggravatingRelieving') ?? '').trim(),
            relevantHistory: String(data.get('relevantHistory') ?? '').trim()
        };
        state.report = null;
    }

    function showIntake() {
        if (!state.safetyReviewed || selectedRedFlags().length) {
            showSafetyLanding();
            return;
        }
        state.assessmentOpen = false;
        state.phase = 'intake';
        state.viewingSavedReport = false;
        byId('diagnosis-safety-landing').classList.add('hidden');
        byId('diagnosis-intake').classList.remove('hidden');
        byId('diagnosis-assessment').classList.add('hidden');
        byId('diagnosis-report-screen').classList.add('hidden');
        fillIntakeForm(state.intake);
        byId('diagnosis-intake-state').textContent = state.intakeCompleted ? 'Details saved. Review or continue.' : 'Complete the required fields.';
        persistDraft();
        window.requestAnimationFrame(controller.resizeViewer);
    }

    function showAssessment() {
        if (!state.safetyReviewed || selectedRedFlags().length) {
            showSafetyLanding();
            return;
        }
        if (!state.intakeCompleted) {
            showIntake();
            return;
        }
        state.assessmentOpen = true;
        state.phase = 'assessment';
        state.viewingSavedReport = false;
        if (state.activeTestId === 0) state.activeTestId = 1;
        byId('diagnosis-safety-landing').classList.add('hidden');
        byId('diagnosis-intake').classList.add('hidden');
        byId('diagnosis-assessment').classList.remove('hidden');
        byId('diagnosis-report-screen').classList.add('hidden');
        setWorkflowMode('capacity');
        persistDraft();
        window.requestAnimationFrame(controller.resizeViewer);
    }

    function showReportScreen() {
        stopCurrentRun();
        state.assessmentOpen = false;
        state.phase = 'report';
        state.viewingSavedReport = false;
        state.report = buildReport();
        byId('diagnosis-safety-landing').classList.add('hidden');
        byId('diagnosis-intake').classList.add('hidden');
        byId('diagnosis-assessment').classList.add('hidden');
        byId('diagnosis-report-screen').classList.remove('hidden');
        byId('diagnosis-report-back').textContent = 'Back to assessment';
        renderMovementReport(state.report);
        state.reportStored = archiveReport(state.report);
        if (state.reportStored) {
            clearDraft();
        } else {
            persistDraft();
            showAppDialog({
                title: 'Report could not be stored',
                message: 'The resumable assessment has been kept. Download the deidentified report now, or return to the assessment and try again after freeing browser storage.',
                confirmLabel: 'Keep resumable assessment',
                danger: false,
                onConfirm: () => {}
            });
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
        window.requestAnimationFrame(controller.resizeViewer);
    }

    function resetAssessmentData() {
        stopCurrentRun();
        state.assessmentId = createAssessmentId();
        state.activeTestId = 0;
        state.activeCapacityIndex = 0;
        state.capacityResponses = Object.fromEntries(ALL_CAPACITY_POSITIONS.map((position) => [position.id, emptyPositionResponse()]));
        state.capacityModelStates = {};
        state.testedSide = 'right';
        state.redFlags = Object.fromEntries(RED_FLAGS.map((flag) => [flag.id, null]));
        state.safetyReviewed = false;
        state.intakeCompleted = false;
        state.intake = {};
        state.responses = {};
        state.runs = {};
        state.report = null;
        state.reportAnnex = null;
        state.reportStored = false;
        state.legacySymptomAssessment = null;
        byId('diagnosis-intake-form').reset();
        clearDraft();
        setSide('right');
        renderCapacityList();
        showSafetyLanding();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function restartAssessment() {
        const hasAssessmentData = state.intakeCompleted
            || Object.values(state.redFlags).some((value) => typeof value === 'boolean')
            || Object.values(state.intake).some((value) => value !== '' && value !== null && value !== false)
            || Object.values(state.capacityResponses).some((response) => response.answered || response.notes);
        if (!hasAssessmentData) {
            resetAssessmentData();
            return;
        }
        showAppDialog({
            title: 'Start a new assessment?',
            message: 'The unfinished personal details and position responses will be removed. Completed diagnosis records will remain available.',
            confirmLabel: 'Start new assessment',
            danger: true,
            onConfirm: resetAssessmentData
        });
    }

    function setWorkflowMode(mode) {
        const nextMode = 'capacity';
        if (nextMode === 'capacity' && !state.safetyReviewed) {
            state.workflowMode = 'observations';
            showSafetyLanding();
            return;
        }
        stopCurrentRun();
        state.workflowMode = nextMode;
        const capacity = nextMode === 'capacity';
        for (const element of document.querySelectorAll('.diagnosis-standard-only')) element.classList.toggle('hidden', capacity);
        for (const element of document.querySelectorAll('.diagnosis-capacity-only')) element.classList.toggle('hidden', !capacity);
        if (capacity) {
            renderCapacityList();
            renderCapacityPosition();
        } else {
            selectTest(state.activeTestId);
        }
    }

    function renderCapacityList() {
        const tableBody = byId('capacity-position-list');
        tableBody.replaceChildren();
        const firstUnansweredIndex = ASSESSMENT_POSITIONS.findIndex((position) => !state.capacityResponses[position.id]?.answered);
        const unlockedThrough = firstUnansweredIndex === -1 ? ASSESSMENT_POSITIONS.length - 1 : firstUnansweredIndex;
        const fieldOptions = {
            completion: [
                ['not_recorded', 'Select'],
                ['full', 'Full'],
                ['partial', 'Partial'],
                ['unable', 'Unable'],
                ['stopped', 'Stopped'],
                ['skipped', 'Skipped']
            ],
            pain: [['not_recorded', 'Select'], ['no', 'No'], ['yes', 'Yes']],
            weakness: [['not_recorded', 'Select'], ['no', 'No'], ['yes', 'Yes']],
            stiffness: [['not_recorded', 'Select'], ['no', 'No'], ['yes', 'Yes']],
            compensation: [['not_recorded', 'Select'], ['no', 'No'], ['yes', 'Yes'], ['uncertain', 'Unsure']],
            limitingFactor: [
                ['', 'Select'], ['pain', 'Pain'], ['weakness', 'Weakness'], ['stiffness', 'Stiffness'],
                ['instability', 'Instability'], ['fear', 'Fear'], ['coordination', 'Coordination'], ['other', 'Other']
            ]
        };
        const fieldLabels = {
            completion: 'Completion',
            pain: 'Pain',
            weakness: 'Weakness',
            stiffness: 'Stiffness',
            compensation: 'Compensation'
        };
        const optionLabel = (field, value) => fieldOptions[field].find(([option]) => option === value)?.[1] ?? '—';
        const responseSelect = (field, response, position) => {
            const select = document.createElement('select');
            select.className = 'capacity-record-select';
            select.setAttribute('aria-label', `${fieldLabels[field]} for ${position.name}`);
            for (const [value, label] of fieldOptions[field]) {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = label;
                option.selected = response[field] === value;
                select.append(option);
            }
            select.addEventListener('change', () => updateCapacityResponse(field, select.value));
            return select;
        };
        const addDetailSelect = (host, { label, field, value, options, required = false }) => {
            const wrapper = document.createElement('label');
            wrapper.className = 'capacity-detail-field';
            const caption = document.createElement('span');
            caption.textContent = `${label}${required ? ' *' : ''}`;
            const select = document.createElement('select');
            select.setAttribute('aria-label', label);
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Select';
            select.append(placeholder);
            for (const [optionValue, optionLabelText] of options) {
                const option = document.createElement('option');
                option.value = optionValue;
                option.textContent = optionLabelText;
                option.selected = String(value ?? '') === String(optionValue);
                select.append(option);
            }
            select.addEventListener('change', () => updateCapacityResponse(field, select.value));
            wrapper.append(caption, select);
            host.append(wrapper);
        };
        ASSESSMENT_POSITIONS.forEach((position, index) => {
            const response = { ...emptyPositionResponse(), ...state.capacityResponses[position.id] };
            state.capacityResponses[position.id] = response;
            const active = index === state.activeCapacityIndex;
            const locked = index > unlockedThrough;
            const row = document.createElement('tr');
            row.classList.toggle('active', active);
            row.classList.toggle('locked', locked);
            if (!locked) {
                row.classList.add('clickable');
                row.tabIndex = 0;
                row.setAttribute('role', 'button');
                row.setAttribute('aria-label', `Open ${position.name}`);
                const openPosition = () => {
                    state.activeCapacityIndex = index;
                    renderCapacityList();
                    renderCapacityPosition();
                    persistDraft();
                };
                row.addEventListener('click', (event) => {
                    if (event.target.closest('input, textarea, button, select, a')) return;
                    openPosition();
                });
                row.addEventListener('keydown', (event) => {
                    if (event.target !== row || !['Enter', ' '].includes(event.key)) return;
                    event.preventDefault();
                    openPosition();
                });
            }
            const positionCell = document.createElement('th');
            positionCell.scope = 'row';
            const positionButton = document.createElement('button');
            positionButton.type = 'button';
            positionButton.className = 'capacity-position-open';
            positionButton.disabled = locked;
            positionButton.setAttribute('aria-current', active ? 'step' : 'false');
            if (locked) positionButton.setAttribute('aria-label', `${position.name}, locked until the previous posture is completed`);
            positionButton.innerHTML = `<span>${escapeHtml(position.id)}</span><strong>${escapeHtml(position.name)}</strong>`;
            positionButton.addEventListener('click', () => {
                state.activeCapacityIndex = index;
                renderCapacityList();
                renderCapacityPosition();
                persistDraft();
            });
            positionCell.append(positionButton);
            row.append(positionCell);
            ['completion', 'pain', 'weakness', 'stiffness', 'compensation'].forEach((field) => {
                const cell = document.createElement('td');
                if (active) {
                    cell.append(responseSelect(field, response, position));
                } else if (response[field] && response[field] !== 'not_recorded') {
                    const value = document.createElement('span');
                    value.className = 'capacity-record-value';
                    value.textContent = `X ${optionLabel(field, response[field])}`;
                    value.setAttribute('aria-label', `${fieldLabels[field]}: ${optionLabel(field, response[field])}`);
                    cell.append(value);
                }
                row.append(cell);
            });
            const commentsCell = document.createElement('td');
            if (active) {
                const notes = document.createElement('textarea');
                notes.className = 'capacity-record-comments';
                notes.maxLength = 500;
                notes.rows = 2;
                notes.placeholder = 'Optional';
                notes.setAttribute('aria-label', `Comments for ${position.name}`);
                notes.value = response.notes;
                notes.addEventListener('input', (event) => {
                    response.notes = event.target.value.trim();
                    state.report = null;
                    persistDraft();
                });
                commentsCell.append(notes);
            } else if (response.notes) {
                const note = document.createElement('span');
                note.className = 'capacity-record-comment-text';
                note.textContent = response.notes;
                commentsCell.append(note);
            }
            row.append(commentsCell);
            tableBody.append(row);

            const showDetails = active && response.completion !== 'skipped'
                && (['partial', 'unable', 'stopped'].includes(response.completion)
                    || response.pain === 'yes' || response.weakness === 'yes' || response.compensation === 'yes');
            if (showDetails) {
                const detailRow = document.createElement('tr');
                detailRow.className = 'capacity-detail-row';
                const detailCell = document.createElement('td');
                detailCell.colSpan = 7;
                const details = document.createElement('div');
                details.className = 'capacity-detail-fields';
                if (['partial', 'unable', 'stopped'].includes(response.completion)) {
                    addDetailSelect(details, {
                        label: 'Limiting factor',
                        field: 'limitingFactor',
                        value: response.limitingFactor,
                        options: fieldOptions.limitingFactor.slice(1),
                        required: true
                    });
                }
                if (response.pain === 'yes') {
                    addDetailSelect(details, {
                        label: 'Pain 1–10',
                        field: 'painScore',
                        value: response.painScore,
                        options: Array.from({ length: 10 }, (_, value) => [String(value + 1), String(value + 1)]),
                        required: true
                    });
                    addDetailSelect(details, {
                        label: 'Pain location',
                        field: 'painLocation',
                        value: response.painLocation,
                        options: [
                            ['front_shoulder', 'Front shoulder'],
                            ['top_shoulder', 'Top / AC region'],
                            ['back_shoulder', 'Back shoulder'],
                            ['lateral_upper_arm', 'Lateral upper arm'],
                            ['neck_arm', 'Neck / radiating'],
                            ['other', 'Other']
                        ],
                        required: true
                    });
                }
                if (response.weakness === 'yes') {
                    addDetailSelect(details, {
                        label: 'Weakness 1–10',
                        field: 'weaknessScore',
                        value: response.weaknessScore,
                        options: Array.from({ length: 10 }, (_, value) => [String(value + 1), String(value + 1)]),
                        required: true
                    });
                }
                if (response.compensation === 'yes') {
                    addDetailSelect(details, {
                        label: 'Movement difference',
                        field: 'compensationDetail',
                        value: response.compensationDetail,
                        options: [
                            ['shoulder_hike', 'Shoulder hike'],
                            ['trunk_lean', 'Trunk lean'],
                            ['scapular_difference', 'Scapular difference'],
                            ['other', 'Other']
                        ],
                        required: true
                    });
                }
                const help = document.createElement('span');
                help.className = 'capacity-detail-help';
                help.textContent = 'Complete the marked detail fields to continue.';
                details.append(help);
                detailCell.append(details);
                detailRow.append(detailCell);
                tableBody.append(detailRow);
            }
        });
        const answeredCount = ASSESSMENT_POSITIONS.filter((position) => state.capacityResponses[position.id]?.answered).length;
        const reportRow = document.createElement('tr');
        reportRow.className = 'capacity-report-list-item';
        const reportCell = document.createElement('td');
        reportCell.colSpan = 7;
        const reportButton = document.createElement('button');
            reportButton.type = 'button';
            reportButton.className = 'capacity-report-list-button';
            reportButton.disabled = answeredCount !== ASSESSMENT_POSITIONS.length;
            reportButton.innerHTML = `<span class="diagnosis-test-number" aria-hidden="true">✓</span><span class="diagnosis-test-copy"><strong>Review results</strong><span>${answeredCount} of ${ASSESSMENT_POSITIONS.length} positions complete</span></span>`;
        reportButton.addEventListener('click', showReportScreen);
        reportCell.append(reportButton);
        reportRow.append(reportCell);
        tableBody.append(reportRow);
    }

    function capacityRanking() {
        const observed = ADVANCED_CAPACITY_POSITIONS.map((position) => {
            const result = state.capacityResponses[position.id]?.result;
            return result === 'able' ? 0 : result === 'unable' ? 1 : null;
        });
        const testedCount = observed.filter((value) => value !== null).length;
        return Object.entries(CAPACITY_SIGNATURES).map(([name, signature]) => {
            let compared = 0;
            let contradictions = 0;
            for (let index = 0; index < observed.length; index += 1) {
                if (observed[index] === null || signature[index] === null) continue;
                compared += 1;
                if (observed[index] !== signature[index]) contradictions += 1;
            }
            return { name, compared, contradictions, compatible: compared > 0 && contradictions === 0 };
        }).sort((left, right) => left.contradictions - right.contradictions || right.compared - left.compared || left.name.localeCompare(right.name));
    }

    async function previewCapacityPose() {
        if (!state.ready || state.workflowMode !== 'capacity') return;
        const position = ASSESSMENT_POSITIONS[state.activeCapacityIndex];
        if (!position) return;
        const preview = ++state.previewGeneration;
        const loading = byId('capacity-view-loading');
        loading.querySelector('strong').textContent = 'Loading posture…';
        loading.classList.remove('hidden');
        controller.neutralizeActivation();
        try {
            const geometry = await controller.fetchJson(buildUrl('/api/pose', position.coordinates));
            if (preview !== state.previewGeneration || state.workflowMode !== 'capacity') return;
            geometry.mode = 'pose';
            for (const muscle of geometry.muscles ?? []) delete muscle.activation;
            controller.applyState(geometry);
            controller.resetView();
            loading.querySelector('strong').textContent = 'Calculating activation…';

            const result = await controller.fetchJson(buildUrl('/api/static-hold', position.coordinates));
            if (preview !== state.previewGeneration || state.workflowMode !== 'capacity') return;
            state.capacityModelStates[position.id] = result;
            controller.applyState(result);
        } catch {
            if (preview !== state.previewGeneration || state.workflowMode !== 'capacity') return;
            controller.neutralizeActivation();
        } finally {
            if (preview === state.previewGeneration) loading.classList.add('hidden');
        }
    }

    function renderCapacityPosition() {
        const positions = ASSESSMENT_POSITIONS;
        state.activeCapacityIndex = Math.max(0, Math.min(positions.length - 1, state.activeCapacityIndex));
        const position = positions[state.activeCapacityIndex];
        const response = state.capacityResponses[position.id];
        byId('capacity-position-id').textContent = `Position ${state.activeCapacityIndex + 1} of ${positions.length}`;
        byId('capacity-position-title').textContent = position.name;
        byId('capacity-position-instruction').textContent = position.instruction ?? 'Do not attempt this posture if it is uncomfortable or unsuitable.';
        byId('capacity-angle-grid').innerHTML = POSE_KEYS.map((key) => `<div><dt>${escapeHtml(CAPACITY_ANGLE_LABELS[key])}</dt><dd>${Number(position.coordinates[key]).toFixed(1)}°</dd></div>`).join('');
        byId('capacity-save-state').textContent = capacityResponseStatus(response);
        byId('capacity-previous').disabled = state.activeCapacityIndex === 0;
        previewCapacityPose();
    }

    function capacityResponseComplete(response) {
        if (response.completion === 'skipped') return true;
        if (!['full', 'partial', 'unable', 'stopped'].includes(response.completion)) return false;
        if (!['no', 'yes'].includes(response.pain) || !['no', 'yes'].includes(response.weakness) || !['no', 'yes'].includes(response.stiffness)) return false;
        if (!['no', 'yes', 'uncertain'].includes(response.compensation)) return false;
        if (['partial', 'unable', 'stopped'].includes(response.completion) && !response.limitingFactor) return false;
        if (response.pain === 'yes' && (!response.painScore || !response.painLocation)) return false;
        if (response.weakness === 'yes' && !response.weaknessScore) return false;
        return response.compensation !== 'yes' || Boolean(response.compensationDetail);
    }

    function legacyCapacityResult(response) {
        if (response.completion === 'skipped') return 'not_tested';
        if (response.completion === 'unable') return 'unable';
        if (response.pain === 'yes') return 'pain_limited';
        if (response.completion === 'stopped' || response.completion === 'partial' || response.weakness === 'yes' || response.stiffness === 'yes' || response.compensation === 'uncertain') return 'uncertain';
        return response.completion === 'full' ? 'able' : 'not_tested';
    }

    function capacityResponseStatus(response) {
        if (response.completion === 'skipped') return 'Position skipped';
        if (response.answered) return 'Observations saved';
        if (response.pain === 'yes' && (!response.painScore || !response.painLocation)) return 'Record pain score and location';
        if (response.weakness === 'yes' && !response.weaknessScore) return 'Record perceived weakness';
        if (response.compensation === 'yes' && !response.compensationDetail) return 'Record the movement difference';
        if (['partial', 'unable', 'stopped'].includes(response.completion) && !response.limitingFactor) return 'Record the limiting factor';
        return 'Record completion, pain, weakness, stiffness, and compensation';
    }

    function updateCapacityResponse(field, value) {
        const position = ASSESSMENT_POSITIONS[state.activeCapacityIndex];
        if (!position) return;
        const previous = { ...emptyPositionResponse(), ...state.capacityResponses[position.id] };
        const wasAnswered = previous.answered;
        const response = { ...previous, [field]: value };
        if (field === 'completion' && value === 'skipped') {
            response.pain = 'not_recorded';
            response.weakness = 'not_recorded';
            response.stiffness = 'not_recorded';
            response.compensation = 'not_recorded';
            response.painScore = '';
            response.painLocation = '';
            response.weaknessScore = '';
            response.limitingFactor = '';
            response.compensationDetail = '';
        }
        if (field === 'completion' && !['partial', 'unable', 'stopped'].includes(value)) response.limitingFactor = '';
        if (field === 'pain' && value !== 'yes') {
            response.painScore = '';
            response.painLocation = '';
        }
        if (field === 'weakness' && value !== 'yes') response.weaknessScore = '';
        if (field === 'compensation' && value !== 'yes') response.compensationDetail = '';
        response.answered = capacityResponseComplete(response);
        response.result = legacyCapacityResult(response);
        state.capacityResponses[position.id] = response;
        state.report = null;
        renderCapacityList();
        byId('capacity-save-state').textContent = capacityResponseStatus(response);
        persistDraft();
        if (!response.answered || wasAnswered) return;
        byId('capacity-save-state').textContent = response.completion === 'skipped' ? 'Skipped · opening next position…' : 'Saved · opening next position…';
        const completedIndex = state.activeCapacityIndex;
        window.setTimeout(() => {
            if (state.activeCapacityIndex !== completedIndex || !state.capacityResponses[position.id]?.answered) return;
            if (state.activeCapacityIndex < ASSESSMENT_POSITIONS.length - 1) {
                state.activeCapacityIndex += 1;
                renderCapacityList();
                renderCapacityPosition();
                persistDraft();
            } else {
                showReportScreen();
            }
        }, 220);
    }

    function activeTest() {
        return DIAGNOSIS_TESTS[state.activeTestId];
    }

    function selectedRedFlags() {
        return RED_FLAGS.filter((flag) => state.redFlags[flag.id]);
    }

    function safetyAnswersComplete() {
        return RED_FLAGS.every((flag) => typeof state.redFlags[flag.id] === 'boolean');
    }

    function updateSafetyGate() {
        const answered = RED_FLAGS.filter((flag) => typeof state.redFlags[flag.id] === 'boolean').length;
        const flags = selectedRedFlags();
        const complete = safetyAnswersComplete();
        const button = byId('diagnosis-continue');
        button.disabled = !complete;
        button.textContent = flags.length ? 'Record warnings and stop' : 'Continue to personal details';
        if (!complete) {
            byId('diagnosis-safety-state').textContent = `${answered} of ${RED_FLAGS.length} answered · complete every row`;
        } else if (state.safetyReviewed) {
            byId('diagnosis-safety-state').textContent = flags.length ? 'Warnings recorded · assessment paused' : 'Safety reviewed';
        } else {
            byId('diagnosis-safety-state').textContent = flags.length ? `${flags.length} warning${flags.length === 1 ? '' : 's'} selected` : 'All items answered · no warnings selected';
        }
    }

    function stopReasons(response = state.responses[state.activeTestId]) {
        if (!response) return [];
        const reasons = [];
        if (response.severe) reasons.push('severe pain or inability to continue');
        if (response.sharpOrUnfamiliar) reasons.push('sharp or unfamiliar pain');
        if (response.neurological) reasons.push('numbness, tingling, or new weakness');
        if (response.escalating) reasons.push('increasing pain');
        return reasons;
    }

    function workflowBlocked() {
        return selectedRedFlags().length > 0 || Object.values(state.responses).some((response) => stopReasons(response).length > 0);
    }

    function stopCurrentRun() {
        state.runGeneration += 1;
        state.running = false;
        const button = byId('diagnosis-run-model');
        if (button) button.setAttribute('aria-busy', 'false');
    }

    function updateWarning() {
        const warning = byId('diagnosis-stop-warning');
        const safetyWarning = byId('diagnosis-safety-warning');
        const flags = selectedRedFlags();
        const reasons = stopReasons();
        if (!flags.length && !reasons.length) {
            warning.classList.add('hidden');
            warning.textContent = '';
            safetyWarning.classList.add('hidden');
            safetyWarning.textContent = '';
            return;
        }
        stopCurrentRun();
        let message = '';
        if (flags.length) {
            const emergency = flags.some((flag) => flag.urgency === 'emergency');
            message = emergency
                ? 'Testing paused. A reported warning sign may require emergency assessment now. This tool cannot rule out a serious condition.'
                : 'Testing paused. A reported warning sign may require urgent medical assessment before more movement testing.';
        } else {
            message = `Stop this test: ${reasons.join(', ')}. Do not continue through these symptoms.`;
        }
        warning.classList.remove('hidden');
        warning.textContent = message;
        if (flags.length) {
            safetyWarning.classList.remove('hidden');
            safetyWarning.textContent = message;
        } else {
            safetyWarning.classList.add('hidden');
            safetyWarning.textContent = '';
        }
    }

    function testStatusText(test) {
        if (test.id === 0) return state.safetyReviewed ? (selectedRedFlags().length ? 'Paused' : 'Reviewed') : 'Required first';
        const response = state.responses[test.id];
        const run = state.runs[test.id];
        if (stopReasons(response).length) return 'Stopped';
        if (response?.pain === 'yes') return `Pain ${response.painScore === '' ? 'recorded' : `${response.painScore}/10`}`;
        if (response?.status === 'completed') return run?.metrics ? 'Recorded + modelled' : 'Recorded';
        if (run?.metrics) return 'Modelled';
        return 'Not attempted';
    }

    function renderTestList() {
        const list = byId('diagnosis-test-list');
        list.replaceChildren();
        for (const test of DIAGNOSIS_TESTS.slice(1)) {
            const item = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.classList.toggle('active', test.id === state.activeTestId);
            button.setAttribute('aria-current', test.id === state.activeTestId ? 'step' : 'false');
            const number = document.createElement('span');
            number.className = 'diagnosis-test-number';
            number.textContent = `T${test.id}`;
            const copy = document.createElement('span');
            copy.className = 'diagnosis-test-copy';
            const name = document.createElement('strong');
            name.textContent = test.name;
            const status = document.createElement('span');
            status.textContent = testStatusText(test);
            if (status.textContent.startsWith('Pain') || status.textContent === 'Stopped' || status.textContent === 'Paused') status.className = 'pain';
            else if (status.textContent !== 'Not attempted' && status.textContent !== 'Required first') status.className = 'complete';
            copy.append(name, status);
            button.append(number, copy);
            button.addEventListener('click', () => selectTest(test.id));
            item.append(button);
            list.append(item);
        }
    }

    function renderSafetyForm() {
        const host = byId('diagnosis-safety-form');
        host.innerHTML = `<table class="diagnosis-safety-table">
            <thead><tr><th scope="col">Warning sign</th><th scope="col">No</th><th scope="col">Yes</th></tr></thead>
            <tbody>${RED_FLAGS.map((flag) => {
                const heading = flag.urgency === 'emergency' ? 'Emergency warning' : flag.urgency === 'urgent' ? 'Urgent warning' : 'Review before testing';
                return `<tr>
                    <th scope="row"><strong>${heading}</strong><span>${escapeHtml(flag.label)}</span></th>
                    <td><label><input type="radio" name="safety-${flag.id}" value="no" data-red-flag="${flag.id}" ${state.redFlags[flag.id] === false ? 'checked' : ''}><span>No</span></label></td>
                    <td><label class="warning-answer"><input type="radio" name="safety-${flag.id}" value="yes" data-red-flag="${flag.id}" ${state.redFlags[flag.id] === true ? 'checked' : ''}><span>Yes</span></label></td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
        for (const input of host.querySelectorAll('[data-red-flag]')) {
            input.addEventListener('change', () => {
                state.redFlags[input.dataset.redFlag] = input.value === 'yes';
                state.safetyReviewed = false;
                state.report = null;
                updateSafetyGate();
                updateWarning();
                renderTestList();
                updateRunAvailability();
                persistDraft();
            });
        }
        updateSafetyGate();
    }

    function readResponseForm() {
        const host = byId('diagnosis-observation-form');
        const response = state.responses[state.activeTestId] ?? defaultResponse();
        for (const field of host.querySelectorAll('[data-field]')) {
            response[field.dataset.field] = field.type === 'checkbox' ? field.checked : field.value;
        }
        state.responses[state.activeTestId] = response;
        state.report = null;
        byId('diagnosis-save-state').textContent = 'Saved in this session';
        if (stopReasons(response).length && response.status !== 'stopped') response.status = 'stopped';
        updateWarning();
        renderTestList();
        updateRunAvailability();
    }

    function renderObservationForm() {
        if (state.activeTestId === 0) {
            renderSafetyForm();
            return;
        }
        const response = state.responses[state.activeTestId] ?? defaultResponse();
        state.responses[state.activeTestId] = response;
        const selected = (name, value) => response[name] === value ? 'selected' : '';
        const checked = (name) => response[name] ? 'checked' : '';
        byId('diagnosis-observation-form').innerHTML = `
            <div class="diagnosis-form-grid">
                <label class="diagnosis-field"><span>Test status</span><select data-field="status">
                    <option value="not_attempted" ${selected('status', 'not_attempted')}>Not attempted</option>
                    <option value="completed" ${selected('status', 'completed')}>Completed</option>
                    <option value="stopped" ${selected('status', 'stopped')}>Stopped early</option>
                </select></label>
                <label class="diagnosis-field"><span>Target reached?</span><select data-field="reached">
                    <option value="not_tested" ${selected('reached', 'not_tested')}>Not tested</option>
                    <option value="yes" ${selected('reached', 'yes')}>Yes</option>
                    <option value="partly" ${selected('reached', 'partly')}>Partly</option>
                    <option value="no" ${selected('reached', 'no')}>No</option>
                    <option value="not_applicable" ${selected('reached', 'not_applicable')}>Not applicable</option>
                </select></label>
                <label class="diagnosis-field"><span>Pain?</span><select data-field="pain">
                    <option value="not_tested" ${selected('pain', 'not_tested')}>Not tested</option>
                    <option value="no" ${selected('pain', 'no')}>No</option>
                    <option value="yes" ${selected('pain', 'yes')}>Yes</option>
                </select></label>
                <label class="diagnosis-field"><span>Pain score (0–10)</span><input data-field="painScore" type="number" min="0" max="10" step="1" value="${escapeHtml(response.painScore)}"></label>
                <label class="diagnosis-field"><span>Maximum reported angle (°)</span><input data-field="maxAngle" type="number" min="0" max="180" step="1" value="${escapeHtml(response.maxAngle)}"></label>
                <label class="diagnosis-field"><span>Pain onset angle (°)</span><input data-field="onsetAngle" type="number" min="0" max="180" step="1" value="${escapeHtml(response.onsetAngle)}"></label>
                <label class="diagnosis-field"><span>Pain location</span><select data-field="location">
                    <option value="" ${selected('location', '')}>Not recorded</option>
                    <option value="lateral_upper_arm" ${selected('location', 'lateral_upper_arm')}>Lateral upper arm</option>
                    <option value="front_shoulder" ${selected('location', 'front_shoulder')}>Front of shoulder</option>
                    <option value="top_shoulder" ${selected('location', 'top_shoulder')}>Top / AC region</option>
                    <option value="back_shoulder" ${selected('location', 'back_shoulder')}>Back of shoulder</option>
                    <option value="neck_arm" ${selected('location', 'neck_arm')}>Neck or radiating down arm</option>
                    <option value="other" ${selected('location', 'other')}>Other</option>
                </select></label>
                <label class="diagnosis-field"><span>Familiar symptom?</span><select data-field="familiar">
                    <option value="unsure" ${selected('familiar', 'unsure')}>Unsure</option>
                    <option value="yes" ${selected('familiar', 'yes')}>Yes</option>
                    <option value="no" ${selected('familiar', 'no')}>No</option>
                </select></label>
                <label class="diagnosis-field full"><span>Visible movement difference</span><select data-field="compensation">
                    <option value="none_observed" ${selected('compensation', 'none_observed')}>None observed</option>
                    <option value="trunk_lean" ${selected('compensation', 'trunk_lean')}>Trunk lean</option>
                    <option value="shoulder_hike" ${selected('compensation', 'shoulder_hike')}>Shoulder hike</option>
                    <option value="scapular_difference" ${selected('compensation', 'scapular_difference')}>Scapular movement difference</option>
                    <option value="other" ${selected('compensation', 'other')}>Other</option>
                </select></label>
                <div class="diagnosis-checks">
                    <label class="diagnosis-check stop"><input data-field="severe" type="checkbox" ${checked('severe')}><span>Severe pain or unable to continue</span></label>
                    <label class="diagnosis-check stop"><input data-field="sharpOrUnfamiliar" type="checkbox" ${checked('sharpOrUnfamiliar')}><span>Sharp or unfamiliar pain</span></label>
                    <label class="diagnosis-check stop"><input data-field="neurological" type="checkbox" ${checked('neurological')}><span>Numbness, tingling, or new weakness</span></label>
                    <label class="diagnosis-check stop"><input data-field="escalating" type="checkbox" ${checked('escalating')}><span>Pain increasing during the test</span></label>
                </div>
                <label class="diagnosis-field full"><span>Location detail</span><input data-field="locationOther" type="text" maxlength="160" value="${escapeHtml(response.locationOther)}"></label>
                <label class="diagnosis-field full"><span>Notes</span><textarea data-field="notes" maxlength="1000">${escapeHtml(response.notes)}</textarea></label>
            </div>`;
        for (const field of byId('diagnosis-observation-form').querySelectorAll('[data-field]')) {
            field.addEventListener('change', readResponseForm);
            if (field.tagName === 'TEXTAREA' || field.type === 'text' || field.type === 'number') field.addEventListener('input', readResponseForm);
        }
        byId('diagnosis-save-state').textContent = response.status === 'not_attempted' ? 'Not recorded' : 'Saved in this session';
    }

    function setModelStatus(text, kind = '') {
        const element = byId('diagnosis-model-status');
        element.textContent = text;
        element.className = `diagnosis-model-status${kind ? ` ${kind}` : ''}`;
    }

    function renderMetrics(run = state.runs[state.activeTestId]) {
        const host = byId('diagnosis-model-metrics');
        host.replaceChildren();
        if (!run?.metrics) return;
        const metrics = run.metrics;
        const summary = document.createElement('div');
        summary.className = 'diagnosis-metric-summary';
        summary.innerHTML = `<dl>
            <dt>Valid model postures</dt><dd>${metrics.validSamples}/${metrics.attemptedSamples}</dd>
            <dt>Peak DELT2 activation</dt><dd>${formatMetric(metrics.peakActivation.DELT2)}</dd>
            <dt>Peak cuff activation</dt><dd>${formatMetric(metrics.peakRotatorCuffActivation)}</dd>
            <dt>DELT2 path demand index</dt><dd>${formatMetric(metrics.normalizedActivationPathIntegral.DELT2)}</dd>
            <dt>DELT2 / SUPSP index</dt><dd>${formatMetric(metrics.ratios.delt2ToSupraspinatus, 2)}</dd>
            <dt>DELT2 deltoid share</dt><dd>${formatMetric(metrics.ratios.delt2DeltoidShare, 2)}</dd>
            <dt>DELT2 / cuff mean index</dt><dd>${formatMetric(metrics.ratios.delt2ToCuffMean, 2)}</dd>
            <dt>Active actuator force</dt><dd>${metrics.activeActuatorForceAvailable ? 'Available below' : 'Unavailable'}</dd>
            <dt>Shoulder joint reaction</dt><dd>Unavailable</dd>
        </dl>
        <strong>Highest peak activations</strong>
        <ol class="diagnosis-top-muscles">${metrics.topPeak.map(([name, value]) => `<li>${escapeHtml(name)} · ${formatMetric(value)}</li>`).join('')}</ol>
        <strong>Highest path demand indices</strong>
        <ol class="diagnosis-top-muscles">${metrics.topPath.map(([name, value]) => `<li>${escapeHtml(name)} · ${formatMetric(value)}</li>`).join('')}</ol>
        ${metrics.activeActuatorForceAvailable ? `<strong>Highest active actuator force estimates</strong><ol class="diagnosis-top-muscles">${metrics.topForce.map(([name, value]) => `<li>${escapeHtml(name)} · ${formatMetric(value, 1)} N peak</li>`).join('')}</ol><strong>Highest normalized force-path indices</strong><ol class="diagnosis-top-muscles">${metrics.topForcePath.map(([name, value]) => `<li>${escapeHtml(name)} · ${formatMetric(value, 1)} N</li>`).join('')}</ol>` : ''}`;
        host.append(summary);
    }

    function updateRunAvailability() {
        const test = activeTest();
        const button = byId('diagnosis-run-model');
        const available = ['static', 'static-path'].includes(test.model.kind);
        const blocked = workflowBlocked();
        button.disabled = !state.ready || !state.safetyReviewed || blocked || !available;
        button.textContent = state.running ? 'Stop model run' : (available ? 'Run model reference' : 'Model unavailable');
        button.setAttribute('aria-busy', String(state.running));
        byId('diagnosis-model-caveat').textContent = available
            ? `${test.model.label}. Generic right-arm model; gravity and segment weight only, no external hand load. Ratios are descriptive and have no diagnostic cutoff.`
            : test.model.reason;
        if (state.running) setModelStatus('Calculating sequential model postures…', 'running');
        else if (!state.safetyReviewed) setModelStatus('Complete Test 0 before running a model reference.', 'unavailable');
        else if (blocked) setModelStatus('Model run disabled while a stop warning is active.', 'unavailable');
        else if (!available) setModelStatus(test.model.reason, 'unavailable');
        else if (state.runs[test.id]?.metrics) setModelStatus(`${state.runs[test.id].metrics.validSamples} validated posture(s) · descriptive model estimate only.`);
        else setModelStatus('Ready when observations and a comfortable range are recorded.');
        renderMetrics();
    }

    function selectTest(id) {
        if (!DIAGNOSIS_TESTS[id]) return;
        if (id === 0) {
            showSafetyLanding();
            return;
        }
        stopCurrentRun();
        state.activeTestId = id;
        const test = activeTest();
        byId('diagnosis-current-id').textContent = `Test ${test.id}`;
        byId('diagnosis-current-title').textContent = test.name;
        byId('diagnosis-purpose').textContent = test.purpose;
        byId('diagnosis-start').textContent = test.start;
        byId('diagnosis-movement').textContent = test.movement;
        byId('diagnosis-target').textContent = test.target;
        byId('diagnosis-interpretation-hint').textContent = test.hint;
        renderTestList();
        renderObservationForm();
        updateWarning();
        updateRunAvailability();
        previewTestPose();
    }

    function buildUrl(path, coordinates) {
        const parameters = new URLSearchParams();
        for (const key of POSE_KEYS) parameters.set(key, String(coordinates[key] ?? 0));
        parameters.set('muscle', controller.getSelectedMuscle());
        return `${path}?${parameters.toString()}`;
    }

    async function previewTestPose() {
        const test = activeTest();
        if (!state.ready || state.running) return;
        if (test.id === 0 || test.id === 14) {
            controller.neutralizeActivation();
            return;
        }
        let coordinates = null;
        if (test.model.pose) coordinates = { ...NEUTRAL_POSE, ...test.model.pose };
        else if (typeof test.model.samples === 'function') {
            const samples = test.model.samples(state.responses[test.id] ?? defaultResponse());
            coordinates = samples.at(-1)?.coordinates ?? null;
        }
        if (!coordinates) return;
        const preview = ++state.previewGeneration;
        try {
            const result = await controller.fetchJson(buildUrl('/api/pose', coordinates));
            if (preview !== state.previewGeneration || state.activeTestId !== test.id || state.running) return;
            controller.applyState(result);
        } catch {
            // A preview is optional. Model-run errors are reported separately.
        }
    }

    async function runModel() {
        if (state.running) {
            stopCurrentRun();
            setModelStatus('Model run stopped. Late results will be ignored.', 'unavailable');
            updateRunAvailability();
            return;
        }
        const test = activeTest();
        if (!['static', 'static-path'].includes(test.model.kind) || !state.safetyReviewed || workflowBlocked()) return;
        const generation = ++state.runGeneration;
        state.running = true;
        const response = state.responses[test.id] ?? defaultResponse();
        const samples = test.model.samples(response);
        const valid = [];
        const failures = [];
        updateRunAvailability();
        for (let index = 0; index < samples.length; index += 1) {
            if (generation !== state.runGeneration) return;
            const sample = samples[index];
            setModelStatus(`Calculating posture ${index + 1} of ${samples.length}…`, 'running');
            try {
                const result = await controller.fetchJson(buildUrl('/api/static-hold', sample.coordinates));
                if (generation !== state.runGeneration) return;
                controller.applyState(result);
                if (completeStaticState(result, controller.getModel().muscles)) {
                    valid.push(slimSample(result, sample.progress, sample.coordinates));
                } else {
                    failures.push({
                        progress: sample.progress,
                        requestedCoordinates: sample.coordinates,
                        reason: result.staticHolding?.quality?.reason ?? 'The model quality gate rejected this posture.',
                        solver: result.staticHolding?.solver ?? null,
                        quality: result.staticHolding?.quality ?? null
                    });
                }
            } catch (error) {
                failures.push({ progress: sample.progress, requestedCoordinates: sample.coordinates, reason: error.message });
            }
        }
        if (generation !== state.runGeneration) return;
        const metrics = computeMetrics(valid, samples.length, controller.getModel().muscles);
        state.runs[test.id] = {
            testId: test.id,
            source: 'on-demand-static-hold',
            label: test.model.label,
            requestedAt: new Date().toISOString(),
            assumptions: 'Generic right-arm model; static gravity and modeled segment weights; no external hand load; independently solved postures.',
            validSamples: valid,
            failedSamples: failures,
            metrics,
            forceAvailability: metrics?.activeActuatorForceAvailable
                ? 'Generic-model linearized active actuator force; passive muscle-fiber force and external loads excluded.'
                : 'Active actuator force was not returned by the solver.',
            jointReactionAvailability: 'Unavailable; no validated JointReaction pipeline is implemented.'
        };
        state.running = false;
        if (metrics) setModelStatus(`${metrics.validSamples}/${metrics.attemptedSamples} postures passed all model quality checks.`);
        else setModelStatus('No posture passed all model quality checks; no activation metrics are shown.', 'unavailable');
        state.report = null;
        renderTestList();
        updateRunAvailability();
    }

    function observationSummary(testId) {
        const response = state.responses[testId] ?? defaultResponse();
        return {
            status: response.status,
            reached: response.reached,
            pain: response.pain,
            painScore: finiteOrNull(response.painScore),
            maxReportedAngleDegrees: finiteOrNull(response.maxAngle),
            painOnsetAngleDegrees: finiteOrNull(response.onsetAngle),
            painLocation: response.location || null,
            painLocationDetail: response.locationOther || null,
            familiar: response.familiar,
            visibleMovementDifference: response.compensation,
            stopIndicators: stopReasons(response),
            notes: response.notes || null
        };
    }

    function classifyPattern() {
        const pain = (id) => state.responses[id]?.pain === 'yes';
        const noPain = (id) => state.responses[id]?.status === 'completed' && state.responses[id]?.pain === 'no';
        const limited = (id) => ['no', 'partly'].includes(state.responses[id]?.reached);
        const reasons = [];
        const flags = selectedRedFlags();
        if (flags.length) {
            return {
                category: 'Testing paused — medical evaluation recommended',
                clarity: 'Not applicable',
                reasons: flags.map((flag) => flag.label),
                counterEvidence: [],
                statement: 'Reported warning signs take priority over biomechanical pattern interpretation.'
            };
        }
        const cuffPainCount = [3, 7, 9, 10].filter(pain).length;
        const elevationPainCount = [2, 3, 4, 9, 10].filter(pain).length;
        let category = 'Non-specific or inconclusive pattern';
        if ((pain(13) || limited(13)) && ([2, 3, 4].some(pain) || [2, 3, 4].some(limited))) {
            category = 'Motion-limited symptom pattern';
            reasons.push('Active and self-assisted observations were both symptom-limited.');
        } else if (pain(2) && [3, 4, 7].filter(noPain).length >= 2) {
            category = 'DELT2-demand-associated symptom pattern';
            reasons.push('Symptoms were reported during lateral elevation but not during several comparison movements.');
        } else if (cuffPainCount >= 2) {
            category = 'Rotator-cuff-demand-associated symptom pattern';
            reasons.push('Symptoms were reproduced in multiple tasks that demand rotator-cuff activity.');
        } else if (elevationPainCount >= 3 ||
                (['yes', 'no'].includes(state.responses[12]?.pain) &&
                 ['yes', 'no'].includes(state.responses[2]?.pain) &&
                 pain(12) !== pain(2))) {
            category = 'Broad elevation/load-sensitive symptom pattern';
            reasons.push('Symptoms varied with elevation and/or support conditions across several observations.');
        } else {
            reasons.push('The recorded observations do not consistently separate the predefined movement patterns.');
        }
        const completed = Object.values(state.responses).filter((response) => response.status === 'completed').length;
        const clarity = completed >= 8 && category !== 'Non-specific or inconclusive pattern' ? 'Medium' : 'Low';
        const modeled = Object.values(state.runs).filter((run) => run.metrics).length;
        const statement = category === 'DELT2-demand-associated symptom pattern'
            ? 'Symptoms were associated with a movement for which the generic model may predict DELT2 demand. This does not establish DELT2 as the pain source.'
            : category === 'Rotator-cuff-demand-associated symptom pattern'
                ? 'Symptoms were associated with several cuff-demanding movements. These observations do not identify a specific tendon, muscle, or subacromial structure.'
                : category === 'Motion-limited symptom pattern'
                    ? 'Active and assisted ranges were symptom-limited; the limiting structure cannot be inferred.'
                    : 'This is a descriptive movement pattern, not a tissue diagnosis.';
        return {
            category,
            clarity,
            reasons,
            counterEvidence: modeled ? [] : ['Few or no validated model references were available.'],
            statement
        };
    }

    function summarizeCapacityModel(position) {
        const packaged = MOVEMENT_MODEL_REFERENCE.positions[position.id];
        const modelState = state.capacityModelStates[position.id];
        if (packaged?.muscles?.length === 50) {
            const muscles = packaged.muscles.map((muscle) => ({ ...muscle }));
            return {
                available: true,
                source: 'packaged-exact-search-reference',
                sourceSampleId: packaged.sourceSampleId,
                solverDurationMs: packaged.solverDurationMs,
                maximumReserveTorqueNm: packaged.maximumReserveTorqueNm,
                muscles,
                topActivation: [...muscles].sort((a, b) => b.activation - a.activation).slice(0, 5),
                topActiveActuatorForceN: [...muscles].sort((a, b) => b.activeActuatorForceN - a.activeActuatorForceN).slice(0, 5)
            };
        }
        if (!modelState || modelState.mode !== 'static' || modelState.staticHolding?.quality?.usable !== true) {
            return { available: false, reason: modelState?.staticHolding?.quality?.reason ?? 'Validated static model result not captured' };
        }
        const muscles = (modelState.muscles ?? []).map((muscle) => ({
            name: muscle.name,
            activation: finiteOrNull(muscle.activation),
            activeActuatorForceN: finiteOrNull(muscle.activeActuatorForceN)
        })).filter((muscle) => Number.isFinite(muscle.activation));
        if (muscles.length !== 50) return { available: false, reason: 'Incomplete muscle activation vector' };
        return {
            available: true,
            solverDurationMs: finiteOrNull(modelState.staticHolding?.solver?.durationMs),
            maximumReserveTorqueNm: finiteOrNull(modelState.staticHolding?.quality?.maxReserveTorqueNm),
            muscles,
            topActivation: [...muscles].sort((a, b) => b.activation - a.activation).slice(0, 5),
            topActiveActuatorForceN: [...muscles].filter((muscle) => Number.isFinite(muscle.activeActuatorForceN)).sort((a, b) => b.activeActuatorForceN - a.activeActuatorForceN).slice(0, 5)
        };
    }

    function movementPositionRecords() {
        return ALL_CAPACITY_POSITIONS.map((position, index) => ({
            sequence: index < MODERATE_CAPACITY_POSITIONS.length ? index + 1 : null,
            id: position.id,
            executionMode: index < MODERATE_CAPACITY_POSITIONS.length ? 'person_attempted' : 'model_only',
            name: position.name,
            instruction: position.instruction,
            coordinatesDegrees: position.coordinates,
            rawObservation: { ...state.capacityResponses[position.id] },
            modelEstimate: summarizeCapacityModel(position)
        }));
    }

    function buildReport() {
        const model = controller.getModel() ?? {};
        const result = buildReportV5({
            assessmentId: state.assessmentId,
            testedSide: state.testedSide,
            safetyReviewed: state.safetyReviewed,
            redFlags: selectedRedFlags(),
            intake: state.intake,
            positionRecords: movementPositionRecords(),
            model: {
                id: model.id ?? null,
                name: model.name ?? null,
                scope: model.scope ?? null,
                source: model.source ?? null,
                solverConfigurationId: model.solverConfigurationId ?? null,
                appCommit: model.appCommit ?? null
            },
            capacityLossCompatibility: capacityRanking(),
            syntheticData: false,
            legacySymptomAssessment: state.legacySymptomAssessment
        });
        state.reportAnnex = result.technicalAnnex;
        return result.report;
    }

    function renderReport(report) {
        renderMovementReport(report);
    }
    function renderMovementReport(report) {
        const host = byId('diagnosis-report-content');
        const trials = (report.trials ?? []).filter((trial) => trial.includeInHumanProtocol);
        const attempted = trials.filter((trial) => trial.observation?.attempted);
        const quality = report.dataQuality ?? {};
        const associations = report.analyses?.symptomAssociations ?? {};
        const label = (value) => escapeHtml(String(value ?? '—').replaceAll('_', ' '));
        const stateLabel = (symptom) => ({ positive: 'Yes', recorded_zero: 'No', not_recorded: 'Not recorded' }[symptom?.state] ?? label(symptom?.state));
        const scoreLabel = (symptom) => symptom?.state === 'recorded_zero'
            ? '0/10'
            : Number.isFinite(symptom?.score) ? `${symptom.score}/10` : '—';
        const ranking = (association, kind) => {
            if (!association?.computable) return `<p><strong>Not computable.</strong> ${escapeHtml(association?.notComputableReason || `Required ${kind} observations were not recorded.`)}</p>`;
            return `<ol>${association.ranking.slice(0, 8).map((row) => `<li><strong>${escapeHtml(row.name)}</strong> · model-control contrast ${row.associationContrast >= 0 ? '+' : ''}${formatMetric(row.associationContrast)} · evidence ${row.supportingTrialIds.map(escapeHtml).join(', ')} · comparison ${row.comparisonTrialIds.map(escapeHtml).join(', ')}</li>`).join('')}</ol>`;
        };
        const comparisonRows = (report.matchedComparisons ?? []).filter((comparison) => comparison.observationsComplete);
        const reportStatus = ({ insufficient_data: 'Insufficient data', interpretable: 'Interpretable observations', conflicting: 'Conflicting observations' })[quality.interpretabilityStatus] || 'Data status unavailable';
        host.innerHTML = `
            <div class="diagnosis-report-summary">
                <div><span>Data status</span><strong>${escapeHtml(reportStatus)}</strong></div>
                <div><span>Postures attempted</span><strong>${attempted.length}/${quality.requiredTrialCount ?? trials.length}</strong></div>
                <div><span>Pain answered</span><strong>${quality.painAnsweredCount ?? 0}/${quality.attemptedTrialCount ?? 0}</strong></div>
                <div><span>Weakness answered</span><strong>${quality.weaknessAnsweredCount ?? 0}/${quality.attemptedTrialCount ?? 0}</strong></div>
                <div><span>Stiffness answered</span><strong>${quality.stiffnessAnsweredCount ?? 0}/${quality.attemptedTrialCount ?? 0}</strong></div>
            </div>
            <p><strong>${escapeHtml(report.summary?.statement || 'No interpretation is available.')}</strong></p>
            <p>Assessment ID: <code>${escapeHtml(report.assessment?.assessmentId || '—')}</code>. This main report is deidentified. Names, email addresses, and cities remain only in the local patient record.</p>
            ${quality.warnings?.length ? `<h3>Data-quality warnings</h3><ul>${quality.warnings.map((warning) => `<li>${escapeHtml(warning.trialId ? `${warning.trialId}: ${warning.message}` : warning.message)}</li>`).join('')}</ul>` : ''}
            ${quality.missingRequiredFields?.length ? `<details><summary>Missing required observations (${quality.missingRequiredFields.length})</summary><p>${quality.missingRequiredFields.map(escapeHtml).join(' · ')}</p></details>` : ''}
            <h3>Assessment context</h3>
            <div class="diagnosis-report-table-wrap"><table><tbody>
                <tr><th>Age</th><td>${Number.isFinite(report.intake?.ageYears) ? report.intake.ageYears : '—'}</td><th>Gender</th><td>${label(report.intake?.gender)}</td></tr>
                <tr><th>Assessed side</th><td>${label(report.intake?.assessedSide)}</td><th>Height / weight</th><td>${Number.isFinite(report.intake?.heightCm) ? `${report.intake.heightCm} cm` : '—'} / ${Number.isFinite(report.intake?.weightKg) ? `${report.intake.weightKg} kg` : '—'}</td></tr>
                <tr><th>Symptom duration</th><td>${label(report.intake?.symptomDuration)}</td><th>Onset</th><td>${label(report.intake?.symptomOnset)}</td></tr>
                <tr><th>Safety screen</th><td colspan="3">${report.safety?.positiveFlags?.length ? `${report.safety.positiveFlags.length} warning item(s) selected` : report.safety?.reviewed ? 'Reviewed; no warning item selected' : 'Not reviewed'}</td></tr>
            </tbody></table></div>
            <h3>Recorded posture observations</h3>
            <div class="diagnosis-report-table-wrap"><table>
                <thead><tr><th>Posture</th><th>Completion</th><th>Pain</th><th>Weakness</th><th>Stiffness</th><th>Compensation</th><th>Notes</th><th>Generic model reference</th></tr></thead>
                <tbody>${trials.map((trial) => `<tr>
                    <td><strong>${escapeHtml(trial.id)} · ${escapeHtml(trial.name)}</strong></td>
                    <td>${label(trial.observation.completion)}${trial.observation.limitingFactors?.length ? ` · ${trial.observation.limitingFactors.map(label).join(', ')}` : ''}</td>
                    <td>${stateLabel(trial.observation.pain)}${trial.observation.pain.state !== 'not_recorded' ? ` · ${scoreLabel(trial.observation.pain)}` : ''}</td>
                    <td>${stateLabel(trial.observation.weakness)}${trial.observation.weakness.state !== 'not_recorded' ? ` · ${scoreLabel(trial.observation.weakness)}` : ''}</td>
                    <td>${stateLabel(trial.observation.stiffness)}</td>
                    <td>${stateLabel(trial.observation.compensation)}</td>
                    <td>${escapeHtml(trial.observation.notes || '—')}</td>
                    <td>${trial.modelReference?.available
                        ? trial.modelReference.topRelevantPredictedControls.slice(0, 3).map((muscle) => `${escapeHtml(muscle.name)} ${formatMetric(muscle.predictedModelControl)}`).join(' · ')
                        : escapeHtml(trial.modelReference?.notComputableReason || 'Unavailable')}</td>
                </tr>`).join('')}</tbody>
            </table></div>
            <h3>Matched posture comparisons</h3>
            <p>Each comparison changes one principal posture variable while keeping the listed protocol variables fixed. Numeric symptom deltas appear only when explicit scores are present.</p>
            ${comparisonRows.length ? `<div class="diagnosis-report-table-wrap"><table><thead><tr><th>Comparison</th><th>Trials</th><th>Changed variable</th><th>Pain Δ</th><th>Weakness Δ</th><th>Status</th></tr></thead><tbody>${comparisonRows.map((comparison) => `<tr>
                <td>${escapeHtml(comparison.name)}</td><td>${comparison.trialIds.map(escapeHtml).join(' → ')}</td><td>${label(comparison.changedVariable)}</td>
                <td>${Number.isFinite(comparison.observationDelta.painScore) ? `${comparison.observationDelta.painScore >= 0 ? '+' : ''}${formatMetric(comparison.observationDelta.painScore, 1)}` : '—'}</td>
                <td>${Number.isFinite(comparison.observationDelta.weaknessScore) ? `${comparison.observationDelta.weaknessScore >= 0 ? '+' : ''}${formatMetric(comparison.observationDelta.weaknessScore, 1)}` : '—'}</td>
                <td>${escapeHtml(comparison.observationDelta.notComputableReason || 'Complete')}</td>
            </tr>`).join('')}</tbody></table></div>` : '<p>No matched comparison has complete observations.</p>'}
            <h3>Pain-linked generic model demand</h3>
            ${ranking(associations.pain, 'pain')}
            <h3>Weakness-linked generic model demand</h3>
            ${ranking(associations.weakness, 'weakness')}
            <h3>Protocol demand—not symptom evidence</h3>
            <p>This ranking describes which muscles the moderate posture protocol demands in the generic model. It does not identify a painful or impaired muscle.</p>
            ${report.analyses?.protocolDemandRanking?.length ? `<ol>${report.analyses.protocolDemandRanking.slice(0, 8).map((row) => `<li><strong>${escapeHtml(row.name)}</strong> · mean predicted model control ${formatMetric(row.meanPredictedModelControl)} · peak ${formatMetric(row.peakPredictedModelControl)}</li>`).join('')}</ol>` : '<p>No validated reference vectors are available.</p>'}
            <h3>Model coverage and limitations</h3>
            <p><strong>Scapular-control coverage:</strong> trapezius and serratus anterior are not independent actuators in this model. Shoulder-hiking or scapular compensation therefore cannot be interpreted from the model reference.</p>
            <ul>${(report.limitations ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
            <p><strong>Research separation:</strong> extreme D1–D7 postures and capacity-loss compatibility are model-only material in the separate technical annex. They are excluded from this human protocol and every symptom association.</p>`;
        byId('diagnosis-report-title').textContent = 'Biomechanical observation report';
        byId('diagnosis-report-time').textContent = new Date(report.generatedAt).toLocaleString();
        byId('diagnosis-report').classList.remove('hidden');
        byId('diagnosis-copy-json').disabled = false;
        byId('diagnosis-download-json').disabled = false;
        byId('capacity-copy-json').disabled = false;
        byId('capacity-download-json').disabled = false;
        byId('diagnosis-copy-json').textContent = 'Copy deidentified report';
        byId('diagnosis-download-json').textContent = 'Download deidentified report';
        byId('capacity-copy-json').textContent = 'Copy report + technical annex';
        byId('capacity-download-json').textContent = 'Download report + technical annex';
    }

    function generateReport(view = 'all') {
        stopCurrentRun();
        state.report = buildReport();
        if (view === 'movement') renderMovementReport(state.report);
        else renderReport(state.report);
    }

    async function copyJson(buttonId = 'diagnosis-copy-json') {
        if (!state.report) return;
        const full = buttonId === 'capacity-copy-json';
        const payload = full ? fullReportExport(state.report, state.reportAnnex) : mainReportExport(state.report);
        const text = JSON.stringify(payload, null, 2);
        await navigator.clipboard.writeText(text);
        const button = byId(buttonId);
        button.textContent = 'Copied';
        const original = full ? 'Copy report + technical annex' : 'Copy deidentified report';
        window.setTimeout(() => { button.textContent = original; }, 1400);
    }

    function downloadJson(full = false) {
        if (!state.report) return;
        const payload = full ? fullReportExport(state.report, state.reportAnnex) : mainReportExport(state.report);
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const assessmentId = state.report.assessment?.assessmentId ?? 'assessment';
        link.download = full ? `${assessmentId}-report-and-technical-annex.json` : `${assessmentId}-deidentified-report.json`;
        link.click();
        URL.revokeObjectURL(url);
    }

    function setSide(side) {
        state.testedSide = side === 'left' ? 'left' : 'right';
        controller.setMirroredView(state.testedSide === 'left');
        state.report = null;
    }

    function enter() {
        controller.enterDiagnosis();
        byId('tab-explorer').classList.remove('active');
        byId('tab-explorer').setAttribute('aria-selected', 'false');
        byId('tab-diagnosis').classList.add('active');
        byId('tab-diagnosis').setAttribute('aria-selected', 'true');
        byId('explorer-workspace').classList.add('hidden');
        byId('diagnosis-workspace').classList.remove('hidden');
        document.body.classList.add('diagnosis-active');
        byId('mirror-view').hidden = true;
        controller.setMirroredView(state.testedSide === 'left');
        window.requestAnimationFrame(controller.resizeViewer);
        if (state.phase === 'report' && state.intakeCompleted) showReportScreen();
        else if (state.phase === 'assessment' && state.intakeCompleted) showAssessment();
        else if (state.phase === 'intake' && state.safetyReviewed) showIntake();
        else showSafetyLanding();
    }

    function leave() {
        stopCurrentRun();
        persistDraft();
        controller.leaveDiagnosis();
        byId('tab-diagnosis').classList.remove('active');
        byId('tab-diagnosis').setAttribute('aria-selected', 'false');
        byId('tab-explorer').classList.add('active');
        byId('tab-explorer').setAttribute('aria-selected', 'true');
        byId('diagnosis-workspace').classList.add('hidden');
        byId('explorer-workspace').classList.remove('hidden');
        document.body.classList.remove('diagnosis-active');
        byId('mirror-view').hidden = false;
        window.requestAnimationFrame(controller.resizeViewer);
    }

    function returnFromReport() {
        if (!state.viewingSavedReport) {
            showAssessment();
            return;
        }
        state.viewingSavedReport = false;
        state.report = null;
        if (state.phase === 'assessment' && state.intakeCompleted) showAssessment();
        else if (state.phase === 'intake' && state.safetyReviewed) showIntake();
        else showSafetyLanding();
    }

    byId('tab-diagnosis').addEventListener('click', enter);
    byId('tab-explorer').addEventListener('click', leave);
    byId('diagnosis-continue').addEventListener('click', () => {
        if (!safetyAnswersComplete()) return;
        state.safetyReviewed = true;
        state.report = null;
        updateWarning();
        renderTestList();
        updateRunAvailability();
        if (selectedRedFlags().length) {
            byId('diagnosis-safety-state').textContent = 'Warning recorded · assessment paused';
            return;
        }
        showIntake();
    });
    byId('diagnosis-restart').addEventListener('click', restartAssessment);
    byId('diagnosis-report-restart').addEventListener('click', restartAssessment);
    byId('diagnosis-report-back').addEventListener('click', returnFromReport);
    byId('diagnosis-intake-back').addEventListener('click', showSafetyLanding);
    byId('diagnosis-intake-form').addEventListener('input', () => {
        readIntake();
        persistDraft();
        byId('diagnosis-intake-state').textContent = 'Saved in this browser.';
    });
    byId('diagnosis-intake-form').addEventListener('change', () => {
        readIntake();
        persistDraft();
    });
    byId('diagnosis-intake-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const form = byId('diagnosis-intake-form');
        if (!form.reportValidity()) {
            byId('diagnosis-intake-state').textContent = 'Complete the highlighted required fields.';
            return;
        }
        readIntake();
        state.intakeCompleted = true;
        setSide(state.intake.assessedArm);
        persistDraft();
        showAssessment();
    });
    byId('capacity-previous').addEventListener('click', () => {
        if (state.activeCapacityIndex > 0) {
            state.activeCapacityIndex -= 1;
            renderCapacityList();
            renderCapacityPosition();
            persistDraft();
        }
    });
    byId('diagnosis-run-model').addEventListener('click', runModel);
    byId('diagnosis-generate-report').addEventListener('click', () => generateReport('all'));
    byId('diagnosis-copy-json').addEventListener('click', () => copyJson().catch(() => {}));
    byId('diagnosis-download-json').addEventListener('click', () => downloadJson(false));
    byId('capacity-copy-json').addEventListener('click', () => copyJson('capacity-copy-json').catch(() => {}));
    byId('capacity-download-json').addEventListener('click', () => downloadJson(true));
    byId('diagnosis-new-assessment').addEventListener('click', restartAssessment);
    byId('app-dialog-cancel').addEventListener('click', closeAppDialog);
    byId('app-dialog-backdrop').addEventListener('click', closeAppDialog);
    byId('app-dialog-confirm').addEventListener('click', () => {
        const action = state.dialogAction;
        closeAppDialog();
        action?.();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !byId('app-dialog').classList.contains('hidden')) closeAppDialog();
    });
    const restoredDraft = restoreDraft();
    fillIntakeForm(state.intake);
    updateSavedRecordsUi();
    renderSafetyForm();
    if (!restoredDraft) selectTest(0);
    else {
        renderTestList();
        updateRunAvailability();
    }
    renderCapacityList();

    return {
        setReady(ready) {
            state.ready = Boolean(ready);
            updateRunAvailability();
        },
        cancel: stopCurrentRun,
        getState: () => state
    };
}
