import { MOVEMENT_MODEL_REFERENCE } from '/movement-reference.js';

const DIAGNOSIS_DRAFT_KEY = 'waajacu-medical.diagnosis-draft.v1';
const DIAGNOSIS_REPORTS_KEY = 'waajacu-medical.patient-reports.v1';
const MAX_SAVED_REPORTS = 100;

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
    { id: 'D1', name: 'High elevation · external rotation', instruction: 'Discrimination position selected for model separation. This is an extreme research posture; do not attempt it without appropriate professional supervision.', coordinates: { elv_angle: -52.19735649, shoulder_elv: 125.74419034, shoulder_rot: 88.52052318, elbow_flexion: 119.07245252, pro_sup: -41.73916481, deviation: 5.13902301, flexion: 37.40828524 } },
    { id: 'D2', name: 'High side elevation · bent elbow', instruction: 'Discrimination position selected for model separation. This is an extreme research posture; do not attempt it without appropriate professional supervision.', coordinates: { elv_angle: 9.85342476, shoulder_elv: 113.42973722, shoulder_rot: -41.13767995, elbow_flexion: 109.2970619, pro_sup: 1.85458519, deviation: 23.7669527, flexion: 39.40047274 } },
    { id: 'D3', name: 'High diagonal elevation · rotated forearm', instruction: 'Discrimination position selected for model separation. This is an extreme research posture; do not attempt it without appropriate professional supervision.', coordinates: { elv_angle: 31.65029976, shoulder_elv: 97.68754972, shoulder_rot: 55.54200755, elbow_flexion: 18.3986244, pro_sup: 79.97958519, deviation: 13.78648395, flexion: 40.80672274 } },
    { id: 'D4', name: 'Diagonal reach · internal rotation', instruction: 'Discrimination position selected for model separation. This is an extreme research posture; do not attempt it without appropriate professional supervision.', coordinates: { elv_angle: 44.74600288, shoulder_elv: 60.17290128, shoulder_rot: -58.93553151, elbow_flexion: 12.95428846, pro_sup: -63.69228981, deviation: 12.84654254, flexion: -53.58780851 } },
    { id: 'D5', name: 'High rear-plane elevation · bent elbow', instruction: 'Discrimination position selected for model separation. This is an extreme research posture; do not attempt it without appropriate professional supervision.', coordinates: { elv_angle: -47.18759087, shoulder_elv: 105.74907316, shoulder_rot: 40.18360911, elbow_flexion: 69.37030409, pro_sup: -34.16103981, deviation: 17.0506441, flexion: 27.62312899 } },
    { id: 'D6', name: 'Diagonal elevation · internal rotation', instruction: 'Discrimination position selected for model separation. This is an extreme research posture; do not attempt it without appropriate professional supervision.', coordinates: { elv_angle: 39.69229194, shoulder_elv: 76.85014738, shoulder_rot: -55.82273854, elbow_flexion: 85.01727674, pro_sup: 19.23739769, deviation: -6.67860394, flexion: 5.44539462 } },
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
    { id: 'M13', name: 'External rotation 20°', instruction: 'Keep the elbow bent and close to the body; rotate the forearm outward slightly.', coordinates: { ...NEUTRAL_POSE, shoulder_elv: 15, shoulder_rot: 20, elbow_flexion: 90 } },
    { id: 'M14', name: 'External rotation 40°', instruction: 'Keep the elbow bent and close to the body; rotate the forearm outward without forcing it.', coordinates: { ...NEUTRAL_POSE, shoulder_elv: 15, shoulder_rot: 40, elbow_flexion: 90 } },
    { id: 'M15', name: 'Internal rotation 20°', instruction: 'Keep the elbow bent and close to the body; rotate the forearm inward slightly.', coordinates: { ...NEUTRAL_POSE, shoulder_elv: 15, shoulder_rot: -20, elbow_flexion: 90 } },
    { id: 'M16', name: 'Internal rotation 40°', instruction: 'Keep the elbow bent and close to the body; rotate the forearm inward without forcing it.', coordinates: { ...NEUTRAL_POSE, shoulder_elv: 15, shoulder_rot: -40, elbow_flexion: 90 } },
    { id: 'M17', name: 'Forearm pronation 45°', instruction: 'Keep the elbow at 90 degrees and turn the palm partly downward.', coordinates: { ...NEUTRAL_POSE, elbow_flexion: 90, pro_sup: -45 } },
    { id: 'M18', name: 'Forearm supination 45°', instruction: 'Keep the elbow at 90 degrees and turn the palm partly upward.', coordinates: { ...NEUTRAL_POSE, elbow_flexion: 90, pro_sup: 45 } }
]);

const ALL_CAPACITY_POSITIONS = Object.freeze([...MODERATE_CAPACITY_POSITIONS, ...ADVANCED_CAPACITY_POSITIONS]);

function emptyPositionResponse() {
    return { answered: false, result: 'not_tested', painScore: '', weaknessScore: '', painLocation: '', notes: '' };
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
            samples: () => pathSamples({ elbow_flexion: 90 }, 'shoulder_rot', [0, -11.25, -22.5, -33.75, -45])
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
        model: { kind: 'static', label: 'Gravity-only posture; no test resistance', samples: () => [{ progress: 0, coordinates: { ...NEUTRAL_POSE, elv_angle: 30, shoulder_elv: 60, shoulder_rot: 45 } }] }
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
        schemaVersion: 4,
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
        return Array.isArray(reports) ? reports.filter((entry) => entry?.report?.generatedAt && entry.report?.intake) : [];
    }

    function restoreDraft() {
        const draft = readStoredJson(DIAGNOSIS_DRAFT_KEY, null);
        if (!draft || draft.schemaVersion !== state.schemaVersion) return false;
        const emptyResponses = Object.fromEntries(ALL_CAPACITY_POSITIONS.map((position) => [position.id, emptyPositionResponse()]));
        state.activeCapacityIndex = Math.max(0, Math.min(ALL_CAPACITY_POSITIONS.length - 1, Number(draft.activeCapacityIndex) || 0));
        state.capacityResponses = Object.fromEntries(ALL_CAPACITY_POSITIONS.map((position) => [
            position.id,
            { ...emptyResponses[position.id], ...(draft.capacityResponses?.[position.id] ?? {}) }
        ]));
        state.testedSide = draft.testedSide === 'left' ? 'left' : 'right';
        state.redFlags = Object.fromEntries(RED_FLAGS.map((flag) => [flag.id, typeof draft.redFlags?.[flag.id] === 'boolean' ? draft.redFlags[flag.id] : null]));
        state.safetyReviewed = Boolean(draft.safetyReviewed);
        state.intakeCompleted = Boolean(draft.intakeCompleted);
        state.intake = draft.intake && typeof draft.intake === 'object' ? { ...draft.intake } : {};
        state.assessmentOpen = Boolean(draft.assessmentOpen);
        state.phase = ['safety', 'intake', 'assessment', 'report'].includes(draft.phase) ? draft.phase : 'safety';
        state.draftUpdatedAt = draft.updatedAt ?? null;
        return true;
    }

    function persistDraft() {
        if (state.phase === 'report' && !state.viewingSavedReport) {
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
            updatedAt: new Date().toISOString(),
            phase: state.phase,
            activeCapacityIndex: state.activeCapacityIndex,
            capacityResponses: state.capacityResponses,
            testedSide: state.testedSide,
            redFlags: state.redFlags,
            safetyReviewed: state.safetyReviewed,
            intakeCompleted: state.intakeCompleted,
            intake: state.intake,
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

    function reportPatientKey(report) {
        const intake = report?.intake ?? {};
        const email = String(intake.email ?? '').trim().toLowerCase();
        if (email) return `email:${email}`;
        return `name:${String(intake.name ?? '').trim().toLowerCase()}|city:${String(intake.city ?? '').trim().toLowerCase()}`;
    }

    function archiveReport(report) {
        if (!report?.generatedAt || !report?.intake?.name) return;
        const entry = { id: report.generatedAt, patientKey: reportPatientKey(report), report };
        let reports = savedReports().filter((item) => item.id !== entry.id);
        reports.unshift(entry);
        reports = reports.slice(0, MAX_SAVED_REPORTS);
        while (reports.length) {
            try {
                window.localStorage.setItem(DIAGNOSIS_REPORTS_KEY, JSON.stringify(reports));
                break;
            } catch {
                reports.pop();
            }
        }
        updateSavedRecordsUi();
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
        const prior = entry.report.intake;
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
        const answered = ALL_CAPACITY_POSITIONS.filter((position) => state.capacityResponses[position.id]?.answered).length;
        const patient = state.intake?.name ? `${state.intake.name} · ` : '';
        byId('diagnosis-draft-state').textContent = state.draftUpdatedAt
            ? `${patient}${answered} of ${ALL_CAPACITY_POSITIONS.length} responses saved`
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
            patientName.textContent = entry.report.intake.name || 'Unnamed';
            const patientEmail = document.createElement('span');
            patientEmail.textContent = entry.report.intake.email || 'No email';
            patientCell.append(patientName, patientEmail);
            row.append(patientCell);
            const values = [
                new Date(entry.report.generatedAt).toLocaleString(),
                Number.isFinite(entry.report.intake.ageYears) ? String(entry.report.intake.ageYears) : '—',
                entry.report.intake.assessedArm || entry.report.testedSide || '—',
                entry.report.intake.city || '—'
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
            view.addEventListener('click', () => showSavedReport(entry.report));
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'quiet-button';
            remove.textContent = 'Delete';
            remove.addEventListener('click', () => {
                showAppDialog({
                    title: 'Delete patient report?',
                    message: `This will permanently remove the report for ${entry.report.intake.name} dated ${new Date(entry.report.generatedAt).toLocaleString()} from this browser.`,
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

    function showSavedReport(report) {
        stopCurrentRun();
        state.viewingSavedReport = true;
        state.report = report;
        byId('diagnosis-safety-landing').classList.add('hidden');
        byId('diagnosis-intake').classList.add('hidden');
        byId('diagnosis-assessment').classList.add('hidden');
        byId('diagnosis-report-screen').classList.remove('hidden');
        byId('diagnosis-report-back').textContent = 'Back';
        renderMovementReport(report);
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
        archiveReport(state.report);
        clearDraft();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        window.requestAnimationFrame(controller.resizeViewer);
    }

    function resetAssessmentData() {
        stopCurrentRun();
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
        const responseOptions = [
            ['able', 'Completed'],
            ['pain_limited', 'Pain-limited'],
            ['unable', 'Weak / unable'],
            ['uncertain', 'Stopped / unsure'],
            ['not_tested', 'Skip']
        ];
        ALL_CAPACITY_POSITIONS.forEach((position, index) => {
            if (index === MODERATE_CAPACITY_POSITIONS.length) {
                const divider = document.createElement('tr');
                divider.className = 'capacity-section-divider';
                divider.innerHTML = '<th colspan="7" scope="rowgroup"><strong>Discrimination positions</strong><span>7 maximum-separation research postures</span></th>';
                tableBody.append(divider);
            }
            const response = state.capacityResponses[position.id];
            const active = index === state.activeCapacityIndex;
            const row = document.createElement('tr');
            row.classList.toggle('active', active);
            const positionCell = document.createElement('th');
            positionCell.scope = 'row';
            const positionButton = document.createElement('button');
            positionButton.type = 'button';
            positionButton.className = 'capacity-position-open';
            positionButton.setAttribute('aria-current', active ? 'step' : 'false');
            positionButton.innerHTML = `<span>${escapeHtml(position.id)}</span><strong>${escapeHtml(position.name)}</strong>`;
            positionButton.addEventListener('click', () => {
                state.activeCapacityIndex = index;
                renderCapacityList();
                renderCapacityPosition();
                persistDraft();
            });
            positionCell.append(positionButton);
            row.append(positionCell);
            responseOptions.forEach(([value, label]) => {
                const cell = document.createElement('td');
                if (active) {
                    const input = document.createElement('input');
                    input.type = 'radio';
                    input.name = 'capacity-response';
                    input.value = value;
                    input.checked = response.answered && response.result === value;
                    input.setAttribute('aria-label', `${label}: ${position.name}`);
                    input.addEventListener('change', () => recordCapacityResult(value));
                    cell.append(input);
                } else if (response.answered && response.result === value) {
                    const mark = document.createElement('span');
                    mark.className = 'capacity-record-mark';
                    mark.textContent = 'X';
                    mark.setAttribute('aria-label', label);
                    cell.append(mark);
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
        });
        const answeredCount = ALL_CAPACITY_POSITIONS.filter((position) => state.capacityResponses[position.id]?.answered).length;
        const reportRow = document.createElement('tr');
        reportRow.className = 'capacity-report-list-item';
        const reportCell = document.createElement('td');
        reportCell.colSpan = 7;
        const reportButton = document.createElement('button');
        reportButton.type = 'button';
        reportButton.className = 'capacity-report-list-button';
        reportButton.innerHTML = `<span class="diagnosis-test-number" aria-hidden="true">✓</span><span class="diagnosis-test-copy"><strong>Review results</strong><span>${answeredCount} of ${ALL_CAPACITY_POSITIONS.length} answered</span></span>`;
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
        const position = ALL_CAPACITY_POSITIONS[state.activeCapacityIndex];
        const preview = ++state.previewGeneration;
        try {
            const result = await controller.fetchJson(buildUrl('/api/static-hold', position.coordinates));
            if (preview !== state.previewGeneration || state.workflowMode !== 'capacity') return;
            state.capacityModelStates[position.id] = result;
            controller.applyState(result);
        } catch {
            controller.neutralizeActivation();
        }
    }

    function renderCapacityPosition() {
        const positions = ALL_CAPACITY_POSITIONS;
        const position = positions[state.activeCapacityIndex];
        const response = state.capacityResponses[position.id];
        const discrimination = state.activeCapacityIndex >= MODERATE_CAPACITY_POSITIONS.length;
        byId('capacity-position-id').textContent = `${discrimination ? 'Discrimination' : 'Progressive'} ${state.activeCapacityIndex + 1} of ${positions.length}`;
        byId('capacity-position-title').textContent = position.name;
        byId('capacity-position-instruction').textContent = position.instruction ?? 'Do not attempt this posture if it is uncomfortable or unsuitable.';
        byId('capacity-angle-grid').innerHTML = POSE_KEYS.map((key) => `<div><dt>${escapeHtml(CAPACITY_ANGLE_LABELS[key])}</dt><dd>${Number(position.coordinates[key]).toFixed(1)}°</dd></div>`).join('');
        byId('capacity-save-state').textContent = !response.answered ? 'Select a response in the assessment record' : response.result === 'not_tested' ? 'Skipped' : 'Response saved';
        byId('capacity-previous').disabled = state.activeCapacityIndex === 0;
        byId('capacity-next').disabled = !response.answered;
        byId('capacity-next').textContent = state.activeCapacityIndex === positions.length - 1 ? 'Review results' : 'Next position';
        previewCapacityPose();
    }

    function recordCapacityResult(result) {
        const position = ALL_CAPACITY_POSITIONS[state.activeCapacityIndex];
        const previous = state.capacityResponses[position.id];
        state.capacityResponses[position.id] = {
            answered: true,
            result,
            painScore: '',
            weaknessScore: '',
            painLocation: '',
            notes: previous.notes
        };
        state.report = null;
        renderCapacityList();
        byId('capacity-save-state').textContent = result === 'not_tested' ? 'Skipped' : 'Response saved';
        byId('capacity-next').disabled = false;
        persistDraft();
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
            sequence: index + 1,
            id: position.id,
            section: index < MODERATE_CAPACITY_POSITIONS.length ? 'progressive-movement' : 'discrimination',
            name: position.name,
            instruction: position.instruction,
            coordinatesDegrees: position.coordinates,
            observation: {
                answered: Boolean(state.capacityResponses[position.id].answered),
                result: state.capacityResponses[position.id].result,
                painScore: finiteOrNull(state.capacityResponses[position.id].painScore),
                perceivedWeaknessScore: finiteOrNull(state.capacityResponses[position.id].weaknessScore),
                painLocation: state.capacityResponses[position.id].painLocation || null,
                notes: state.capacityResponses[position.id].notes || null
            },
            modelEstimate: summarizeCapacityModel(position)
        }));
    }

    function mean(values) {
        return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
    }

    function movementMuscleAnalysis(records) {
        const modeled = records.filter((record) => record.observation.result !== 'not_tested' && record.modelEstimate.available);
        if (!modeled.length) return { modeledPositionCount: 0, muscles: [], painRanking: [], weaknessRanking: [], overallRanking: [] };
        const names = modeled[0].modelEstimate.muscles.map((muscle) => muscle.name);
        const rows = names.map((name) => {
            const samples = modeled.map((record) => ({
                record,
                muscle: record.modelEstimate.muscles.find((muscle) => muscle.name === name)
            })).filter((sample) => sample.muscle);
            const pain = samples.filter((sample) => sample.record.observation.result === 'pain_limited' || (sample.record.observation.painScore ?? 0) > 0);
            const noPain = samples.filter((sample) => sample.record.observation.result !== 'pain_limited' && (sample.record.observation.painScore ?? 0) === 0);
            const weakness = samples.filter((sample) => sample.record.observation.result === 'unable' || (sample.record.observation.perceivedWeaknessScore ?? 0) > 0);
            const noWeakness = samples.filter((sample) => sample.record.observation.result === 'able' && (sample.record.observation.perceivedWeaknessScore ?? 0) === 0);
            const painMean = mean(pain.map((sample) => sample.muscle.activation));
            const noPainMean = mean(noPain.map((sample) => sample.muscle.activation));
            const weaknessMean = mean(weakness.map((sample) => sample.muscle.activation));
            const noWeaknessMean = mean(noWeakness.map((sample) => sample.muscle.activation));
            return {
                name,
                modeledSamples: samples.length,
                overallMeanActivation: mean(samples.map((sample) => sample.muscle.activation)),
                overallPeakActivation: Math.max(...samples.map((sample) => sample.muscle.activation)),
                painAssociatedSamples: pain.length,
                painAssociatedMeanActivation: painMean,
                painAssociationDelta: Number.isFinite(painMean) && Number.isFinite(noPainMean) ? painMean - noPainMean : null,
                weaknessAssociatedSamples: weakness.length,
                weaknessAssociatedMeanActivation: weaknessMean,
                weaknessAssociationDelta: Number.isFinite(weaknessMean) && Number.isFinite(noWeaknessMean) ? weaknessMean - noWeaknessMean : null,
                overallMeanActiveActuatorForceN: mean(samples.map((sample) => sample.muscle.activeActuatorForceN).filter(Number.isFinite))
            };
        });
        const rank = (field, sampleField) => [...rows].filter((row) => row[sampleField] > 0 && Number.isFinite(row[field])).sort((a, b) => b[field] - a[field]).slice(0, 10);
        return {
            modeledPositionCount: modeled.length,
            muscles: rows,
            overallRanking: [...rows].sort((a, b) => b.overallMeanActivation - a.overallMeanActivation).slice(0, 10),
            painRanking: rank('painAssociatedMeanActivation', 'painAssociatedSamples'),
            weaknessRanking: rank('weaknessAssociatedMeanActivation', 'weaknessAssociatedSamples')
        };
    }

    function movementPatternSummary(records) {
        const recorded = records.filter((record) => record.observation.result !== 'not_tested');
        const familyName = (record) => {
            if (record.id === 'M1') return 'Baseline';
            const name = record.name.toLowerCase();
            if (name.includes('forward')) return 'Forward elevation';
            if (name.includes('diagonal')) return 'Diagonal/scaption elevation';
            if (name.includes('side') || name.includes('rear-plane')) return 'Lateral/rear-plane elevation';
            if (name.includes('rotation')) return 'Shoulder rotation';
            if (name.includes('elbow')) return 'Elbow motion';
            if (name.includes('forearm')) return 'Forearm rotation';
            return 'Baseline/combined posture';
        };
        const families = {};
        const locations = {};
        for (const record of recorded) {
            const family = familyName(record);
            families[family] ??= { recorded: 0, painAssociated: 0, weaknessAssociated: 0, meanPainScore: null, meanWeaknessScore: null, painScores: [], weaknessScores: [] };
            const entry = families[family];
            entry.recorded += 1;
            if (record.observation.result === 'pain_limited' || (record.observation.painScore ?? 0) > 0) entry.painAssociated += 1;
            if (record.observation.result === 'unable' || (record.observation.perceivedWeaknessScore ?? 0) > 0) entry.weaknessAssociated += 1;
            if (Number.isFinite(record.observation.painScore)) entry.painScores.push(record.observation.painScore);
            if (Number.isFinite(record.observation.perceivedWeaknessScore)) entry.weaknessScores.push(record.observation.perceivedWeaknessScore);
            if (record.observation.painLocation) locations[record.observation.painLocation] = (locations[record.observation.painLocation] ?? 0) + 1;
        }
        for (const entry of Object.values(families)) {
            entry.meanPainScore = mean(entry.painScores);
            entry.meanWeaknessScore = mean(entry.weaknessScores);
            delete entry.painScores;
            delete entry.weaknessScores;
        }
        return {
            recordedPositionCount: recorded.length,
            families,
            painLocations: Object.entries(locations).map(([location, count]) => ({ location, count })).sort((a, b) => b.count - a.count || a.location.localeCompare(b.location))
        };
    }

    function buildReport() {
        const classification = classifyPattern();
        const timestamp = new Date().toISOString();
        const tests = DIAGNOSIS_TESTS.map((test) => ({
            id: test.id,
            name: test.name,
            observation: test.id === 0 ? null : observationSummary(test.id),
            modelRun: state.runs[test.id] ?? null,
            modelApplicability: test.model.kind,
            modelLimitation: test.model.reason ?? null
        }));
        const painful = tests.filter((test) => test.observation?.pain === 'yes');
        const unreachable = tests.filter((test) => ['no', 'partly'].includes(test.observation?.reached));
        const movementPositions = movementPositionRecords();
        const movementAnalysis = movementMuscleAnalysis(movementPositions);
        const movementPatterns = movementPatternSummary(movementPositions);
        return {
            schema: 'mobl-arms-biomechanical-observation-report',
            schemaVersion: 4,
            generatedAt: timestamp,
            framing: 'Biomechanical hypothesis generator; not a medical diagnosis or treatment recommendation.',
            testedSide: state.testedSide,
            modelSide: state.testedSide === 'left' ? 'right-model-visually-mirrored' : 'right',
            redFlags: selectedRedFlags(),
            safetyReviewed: state.safetyReviewed,
            intake: { ...state.intake },
            summary: {
                pattern: classification,
                painfulTests: painful.map((test) => ({ id: test.id, name: test.name, score: test.observation.painScore, onsetAngleDegrees: test.observation.painOnsetAngleDegrees })),
                unreachableTests: unreachable.map((test) => ({ id: test.id, name: test.name, reached: test.observation.reached, maxReportedAngleDegrees: test.observation.maxReportedAngleDegrees }))
            },
            tests,
            modelInterpretation: {
                activation: 'Generic model control from 0–1. Quasi-static path indices integrate independently solved postures over normalized path progress, not time.',
                controlFloor: 0.01,
                activeActuatorForce: 'When present: generic-model linearized active actuator force in newtons; passive muscle-fiber force and external loads excluded.',
                jointReaction: 'Unavailable.',
                missingMuscles: 'Trapezius and serratus anterior are not represented as independent actuators in this model.',
                leftRight: 'Mirror mode is visual only; model-derived biological side asymmetry is unavailable.'
            },
            model: {
                id: controller.getModel()?.id ?? null,
                name: controller.getModel()?.name ?? null,
                scope: controller.getModel()?.scope ?? null,
                source: controller.getModel()?.source ?? null
            },
            capacityScreen: {
                status: 'research-only-unvalidated',
                protocol: 'One 25-position assessment: eighteen progressive movement positions followed by seven discrimination positions. Only the discrimination section has exact complete-capacity-loss model signatures.',
                positions: movementPositions,
                numericMuscleAnalysis: movementAnalysis,
                movementPatternSummary: movementPatterns,
                moderateResponses: MODERATE_CAPACITY_POSITIONS.map((position) => ({
                    id: position.id,
                    coordinates: position.coordinates,
                    result: state.capacityResponses[position.id].result,
                    notes: state.capacityResponses[position.id].notes || null
                })),
                advancedResponses: ADVANCED_CAPACITY_POSITIONS.map((position) => ({
                    id: position.id,
                    coordinates: position.coordinates,
                    result: state.capacityResponses[position.id].result,
                    notes: state.capacityResponses[position.id].notes || null
                })),
                rankedCompatiblePatterns: capacityRanking(),
                inseparableClass: ['Brachialis', 'Brachioradialis', 'Teres major', 'No modeled capacity loss'],
                limitations: [
                    'Across all 39 exact moderate-posture simulations, complete loss of any one modeled target group did not cause mechanical inability; other modeled muscles compensated.',
                    'No independent one-error-correcting panel exists under the tested gravity-only protocol.',
                    'Unable/able is a user observation and is not equivalent to modeled complete muscle-capacity loss.',
                    'The screen does not identify pain, injury, or diagnosis.'
                ]
            },
            limitations: [
                'No single shoulder movement or model ratio identifies the painful tissue.',
                'Predictions are generic and not measured from the observed person.',
                'Resistance, support, and assistance are not modeled unless measured external loads are implemented.',
                'Pain, weakness, movement quality, and reach are user observations rather than sensor measurements.',
                'Static optimization uses an assumed recruitment objective and does not reproduce dynamic neuromuscular control.'
            ]
        };
    }

    function renderReport(report) {
        const host = byId('diagnosis-report-content');
        const observations = report.tests.filter((test) => test.observation);
        const completed = observations.filter((test) => test.observation.status === 'completed').length;
        const painful = report.summary.painfulTests;
        const unavailable = report.tests.filter((test) => ['unavailable', 'none'].includes(test.modelApplicability)).length;
        const painfulModeled = report.tests.filter((test) => test.observation?.pain === 'yes' && test.modelRun?.metrics);
        const otherSide = report.tests.find((test) => test.id === 14)?.observation;
        const capacityResponses = report.capacityScreen?.advancedResponses ?? [];
        const capacityCompleted = capacityResponses.filter((item) => ['able', 'unable'].includes(item.result)).length;
        const capacityRanking = report.capacityScreen?.rankedCompatiblePatterns ?? [];
        const capacityCompatible = capacityRanking.filter((item) => item.compatible);
        const capacityDisplay = capacityCompatible.length ? capacityCompatible : capacityRanking.slice(0, 5);
        const movementPositions = report.capacityScreen?.positions ?? [];
        const movementRecorded = movementPositions.filter((position) => position.observation.result !== 'not_tested');
        const movementModeled = movementRecorded.filter((position) => position.modelEstimate.available);
        const movementAnalysis = report.capacityScreen?.numericMuscleAnalysis ?? {};
        const movementPatterns = report.capacityScreen?.movementPatternSummary ?? { families: {}, painLocations: [] };
        const painPositions = movementRecorded.filter((position) => position.observation.result === 'pain_limited' || (position.observation.painScore ?? 0) > 0);
        const weaknessPositions = movementRecorded.filter((position) => position.observation.result === 'unable' || (position.observation.perceivedWeaknessScore ?? 0) > 0);
        const associationRows = (rows, meanField, deltaField) => rows?.length
            ? `<ol>${rows.slice(0, 8).map((row) => `<li><strong>${escapeHtml(row.name)}</strong> · mean ${formatMetric(row[meanField])}${Number.isFinite(row[deltaField]) ? ` · contrast ${row[deltaField] >= 0 ? '+' : ''}${formatMetric(row[deltaField])}` : ''}</li>`).join('')}</ol>`
            : '<p>Insufficient contrasting observations for a numeric ranking.</p>';
        host.innerHTML = `
            <div class="diagnosis-report-summary">
                <div><span>Pattern</span><strong>${escapeHtml(report.summary.pattern.category)}</strong></div>
                <div><span>Pattern clarity</span><strong>${escapeHtml(report.summary.pattern.clarity)}</strong></div>
                <div><span>Observation coverage</span><strong>${completed}/${observations.length} tests completed</strong></div>
            </div>
            <p><strong>Not a diagnosis.</strong> ${escapeHtml(report.summary.pattern.statement)}</p>
            <h3>Reasons</h3>
            <ul>${report.summary.pattern.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>
            <h3>Safety screen</h3>
            ${report.redFlags.length
                ? `<ul>${report.redFlags.map((flag) => `<li>${escapeHtml(flag.label)}</li>`).join('')}</ul>`
                : `<p>${report.safetyReviewed ? 'Reviewed; no warning item was selected.' : 'Not reviewed.'}</p>`}
            <h3>Recorded observations</h3>
            <div class="diagnosis-report-table-wrap"><table>
                <thead><tr><th>Test</th><th>Status</th><th>Reached</th><th>Pain</th><th>Onset</th><th>Movement difference</th><th>Model reference</th></tr></thead>
                <tbody>${observations.map((test) => `<tr>
                    <td>T${test.id} · ${escapeHtml(test.name)}</td>
                    <td>${escapeHtml(test.observation.status)}</td>
                    <td>${escapeHtml(test.observation.reached)}${Number.isFinite(test.observation.maxReportedAngleDegrees) ? ` · ${test.observation.maxReportedAngleDegrees}°` : ''}</td>
                    <td>${escapeHtml(test.observation.pain)}${Number.isFinite(test.observation.painScore) ? ` · ${test.observation.painScore}/10` : ''}</td>
                    <td>${Number.isFinite(test.observation.painOnsetAngleDegrees) ? `${test.observation.painOnsetAngleDegrees}°` : '—'}</td>
                    <td>${escapeHtml(test.observation.visibleMovementDifference)}</td>
                    <td>${test.modelRun?.metrics ? `${test.modelRun.metrics.validSamples}/${test.modelRun.metrics.attemptedSamples} valid` : escapeHtml(test.modelLimitation || 'Not run')}</td>
                </tr>`).join('')}</tbody>
            </table></div>
            <h3>Model estimates for painful tests</h3>
            ${painfulModeled.length ? painfulModeled.map((test) => {
                const metrics = test.modelRun.metrics;
                return `<section class="diagnosis-report-model-test">
                    <h4>T${test.id} · ${escapeHtml(test.name)}</h4>
                    <p>${metrics.validSamples}/${metrics.attemptedSamples} validated generic-model postures. DELT2 peak ${formatMetric(metrics.peakActivation.DELT2)}; DELT2 path demand index ${formatMetric(metrics.normalizedActivationPathIntegral.DELT2)}; DELT2/SUPSP index ${formatMetric(metrics.ratios.delt2ToSupraspinatus, 2)}. These ratios have no diagnostic cutoff.</p>
                    <p><strong>Peak activation:</strong> ${metrics.topPeak.map(([name, value]) => `${escapeHtml(name)} ${formatMetric(value)}`).join(' · ')}</p>
                    <p><strong>Path demand:</strong> ${metrics.topPath.map(([name, value]) => `${escapeHtml(name)} ${formatMetric(value)}`).join(' · ')}</p>
                    <p><strong>Active actuator force:</strong> ${metrics.activeActuatorForceAvailable ? metrics.topForce.map(([name, value]) => `${escapeHtml(name)} ${formatMetric(value, 1)} N`).join(' · ') : 'Unavailable'}.</p>
                </section>`;
            }).join('') : '<p>No painful test has a validated model reference.</p>'}
            <h3>Other-side comparison</h3>
            <p>${otherSide?.status === 'completed'
                ? `Recorded as observations only: reached ${escapeHtml(otherSide.reached)}, pain ${escapeHtml(otherSide.pain)}${Number.isFinite(otherSide.painScore) ? ` (${otherSide.painScore}/10)` : ''}${Number.isFinite(otherSide.maxReportedAngleDegrees) ? `, maximum reported angle ${otherSide.maxReportedAngleDegrees}°` : ''}.`
                : 'Not completed. Visual mirroring cannot calculate biological side asymmetry.'}</p>
            <h3>Research capacity screen</h3>
            <p>${capacityCompleted}/7 discrimination positions have an informative able/unable observation. ${capacityCompleted
                ? (capacityCompatible.length ? 'Compatible modeled patterns are shown below.' : 'No exact modeled pattern is compatible; the closest patterns are shown below.')
                : 'The screen was not completed.'}</p>
            ${capacityDisplay.length ? `<ol>${capacityDisplay.map((item) => `<li><strong>${escapeHtml(item.name)}</strong> · ${item.contradictions} contradiction(s) across ${item.compared} comparable observation(s)</li>`).join('')}</ol>` : ''}
            <p><strong>Research-only result.</strong> This compares observations with complete modeled capacity loss under gravity only. It does not identify pain, injury, or diagnosis. Brachialis, brachioradialis, teres major, and no modeled capacity loss are inseparable in this screen.</p>
            <h3>25-position movement assessment</h3>
            <p>${movementRecorded.length}/25 positions recorded; ${movementModeled.length} have a validated generic-model activation vector. ${painPositions.length} pain-associated and ${weaknessPositions.length} weakness-associated positions were recorded.</p>
            <div class="diagnosis-report-table-wrap"><table>
                <thead><tr><th>Position</th><th>Section</th><th>Result</th><th>Pain</th><th>Weakness</th><th>Location</th><th>Top model activations</th></tr></thead>
                <tbody>${movementRecorded.map((position) => `<tr>
                    <td>${position.sequence}. ${escapeHtml(position.name)}</td>
                    <td>${position.section === 'discrimination' ? 'Discrimination' : 'Progressive movement'}</td>
                    <td>${escapeHtml(position.observation.result)}</td>
                    <td>${Number.isFinite(position.observation.painScore) ? `${position.observation.painScore}/10` : '—'}</td>
                    <td>${Number.isFinite(position.observation.perceivedWeaknessScore) ? `${position.observation.perceivedWeaknessScore}/10` : '—'}</td>
                    <td>${escapeHtml(position.observation.painLocation || '—')}</td>
                    <td>${position.modelEstimate.available ? position.modelEstimate.topActivation.map((muscle) => `${escapeHtml(muscle.name)} ${formatMetric(muscle.activation)}`).join(' · ') : escapeHtml(position.modelEstimate.reason)}</td>
                </tr>`).join('')}</tbody>
            </table></div>
            <h3>Pain-associated model activation</h3>
            <p>Ranked by generic-model mean activation in pain-associated positions, with the contrast against recorded painless positions where available. This is association, not localization of the pain source.</p>
            ${associationRows(movementAnalysis.painRanking, 'painAssociatedMeanActivation', 'painAssociationDelta')}
            <h3>Weakness-associated model activation</h3>
            <p>Ranked by generic-model mean activation in weakness-associated positions, with the contrast against reached/held positions where available. This does not establish impaired muscle capacity.</p>
            ${associationRows(movementAnalysis.weaknessRanking, 'weaknessAssociatedMeanActivation', 'weaknessAssociationDelta')}
            <h3>Movement-family pattern</h3>
            ${Object.keys(movementPatterns.families).length ? `<div class="diagnosis-report-table-wrap"><table><thead><tr><th>Movement family</th><th>Recorded</th><th>Pain-associated</th><th>Weakness-associated</th><th>Mean pain</th><th>Mean weakness</th></tr></thead><tbody>${Object.entries(movementPatterns.families).map(([name, item]) => `<tr><td>${escapeHtml(name)}</td><td>${item.recorded}</td><td>${item.painAssociated}</td><td>${item.weaknessAssociated}</td><td>${Number.isFinite(item.meanPainScore) ? `${formatMetric(item.meanPainScore, 1)}/10` : '—'}</td><td>${Number.isFinite(item.meanWeaknessScore) ? `${formatMetric(item.meanWeaknessScore, 1)}/10` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p>No movement-family observations recorded.</p>'}
            <p><strong>Pain locations:</strong> ${movementPatterns.painLocations?.length ? movementPatterns.painLocations.map((item) => `${escapeHtml(item.location)} (${item.count})`).join(' · ') : 'None recorded'}.</p>
            <h3>Overall modeled demand</h3>
            ${movementAnalysis.overallRanking?.length ? `<ol>${movementAnalysis.overallRanking.slice(0, 10).map((row) => `<li><strong>${escapeHtml(row.name)}</strong> · mean activation ${formatMetric(row.overallMeanActivation)} · peak ${formatMetric(row.overallPeakActivation)}</li>`).join('')}</ol>` : '<p>No validated position activation vectors were captured.</p>'}
            <p><strong>Biomechanical hypotheses for clinical review:</strong> compare the movements and locations that reproduce symptoms, their pain and perceived-weakness scores, and the generic-model muscles active in those postures. High activation is not proof of injury; compensation, referred pain, non-muscle tissues, and pain inhibition remain possible.</p>
            <h3>Boundaries</h3>
            <p>${painful.length} painful movement(s) recorded. Model demand was deliberately unavailable for ${unavailable} test(s) where resistance, support, assistance, safety, or visual mirroring would make the current calculation misleading.</p>
            <ul>${report.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
        byId('diagnosis-report-time').textContent = new Date(report.generatedAt).toLocaleString();
        byId('diagnosis-report').classList.remove('hidden');
        byId('diagnosis-copy-json').disabled = false;
        byId('diagnosis-download-json').disabled = false;
        byId('capacity-copy-json').disabled = false;
        byId('capacity-download-json').disabled = false;
    }

    function renderMovementReport(report) {
        const host = byId('diagnosis-report-content');
        const positions = report.capacityScreen.positions;
        const recorded = positions.filter((position) => position.observation.result !== 'not_tested');
        const modeled = recorded.filter((position) => position.modelEstimate.available);
        const painPositions = recorded.filter((position) => position.observation.result === 'pain_limited' || (position.observation.painScore ?? 0) > 0);
        const weaknessPositions = recorded.filter((position) => position.observation.result === 'unable' || (position.observation.perceivedWeaknessScore ?? 0) > 0);
        const analysis = report.capacityScreen.numericMuscleAnalysis;
        const patterns = report.capacityScreen.movementPatternSummary;
        const discriminationCompleted = report.capacityScreen.advancedResponses.filter((item) => ['able', 'unable'].includes(item.result)).length;
        const compatible = report.capacityScreen.rankedCompatiblePatterns.filter((item) => item.compatible);
        const discriminationDisplay = compatible.length ? compatible : report.capacityScreen.rankedCompatiblePatterns.slice(0, 5);
        const intake = report.intake ?? {};
        const intakeLabel = (value) => escapeHtml(String(value ?? '—').replaceAll('_', ' '));
        const resultLabel = (result) => ({
            able: 'Reached and held',
            unable: 'Unable / marked weakness',
            pain_limited: 'Stopped because of pain',
            uncertain: 'Uncertain / stopped',
            not_tested: 'Not tested'
        }[result] ?? result);
        const ranking = (rows, meanField, deltaField) => rows?.length
            ? `<ol>${rows.slice(0, 10).map((row) => `<li><strong>${escapeHtml(row.name)}</strong> · mean activation ${formatMetric(row[meanField])}${Number.isFinite(row[deltaField]) ? ` · contrast ${row[deltaField] >= 0 ? '+' : ''}${formatMetric(row[deltaField])}` : ''}</li>`).join('')}</ol>`
            : '<p>Insufficient contrasting observations for a numeric ranking.</p>';
        host.innerHTML = `
            <div class="diagnosis-report-summary">
                <div><span>Positions recorded</span><strong>${recorded.length}/25</strong></div>
                <div><span>Pain-associated</span><strong>${painPositions.length}</strong></div>
                <div><span>Weakness-associated</span><strong>${weaknessPositions.length}</strong></div>
                <div><span>Model vectors</span><strong>${modeled.length}/25</strong></div>
            </div>
            <p><strong>Biomechanical assessment report—not a diagnosis.</strong> This report combines recorded observations with generic MoBL-ARMS activation estimates for the exact postures. It supports hypothesis generation for qualified clinical review; it does not determine which tissue is painful or injured.</p>
            <h3>Patient and pain context</h3>
            <div class="diagnosis-report-table-wrap"><table><tbody>
                <tr><th>Name</th><td>${escapeHtml(intake.name || '—')}</td><th>Age</th><td>${Number.isFinite(intake.ageYears) ? intake.ageYears : '—'}</td></tr>
                <tr><th>Gender</th><td>${intakeLabel(intake.gender)}</td><th>Assessed arm</th><td>${intakeLabel(intake.assessedArm)}</td></tr>
                <tr><th>Height / weight</th><td>${Number.isFinite(intake.heightCm) ? `${intake.heightCm} cm` : '—'} / ${Number.isFinite(intake.weightKg) ? `${intake.weightKg} kg` : '—'}</td><th>City</th><td>${escapeHtml(intake.city || '—')}</td></tr>
                <tr><th>Email</th><td colspan="3">${escapeHtml(intake.email || '—')}</td></tr>
                <tr><th>Pain duration</th><td>${intakeLabel(intake.painDuration)}</td><th>Onset</th><td>${intakeLabel(intake.painOnset)}</td></tr>
                <tr><th>Pain now / worst</th><td>${Number.isFinite(intake.painNow) ? `${intake.painNow}/10` : '—'} / ${Number.isFinite(intake.painWorst) ? `${intake.painWorst}/10` : '—'}</td><th>Main location</th><td>${intakeLabel(intake.primaryPainLocation)}</td></tr>
                <tr><th>Other features</th><td colspan="3">${[
                    intake.painAtRest ? 'Pain at rest' : '', intake.nightPain ? 'Sleep disturbance' : '', intake.radiatingPain ? 'Radiating pain' : '', intake.clickingInstability ? 'Clicking/catching/instability' : ''
                ].filter(Boolean).map(escapeHtml).join(' · ') || 'None selected'}</td></tr>
                ${intake.onsetDetails ? `<tr><th>Onset details</th><td colspan="3">${escapeHtml(intake.onsetDetails)}</td></tr>` : ''}
                ${intake.aggravatingRelieving ? `<tr><th>Worse / better</th><td colspan="3">${escapeHtml(intake.aggravatingRelieving)}</td></tr>` : ''}
                ${intake.relevantHistory ? `<tr><th>Relevant history</th><td colspan="3">${escapeHtml(intake.relevantHistory)}</td></tr>` : ''}
            </tbody></table></div>
            <h3>Safety</h3>
            ${report.redFlags.length
                ? `<ul>${report.redFlags.map((flag) => `<li>${escapeHtml(flag.label)}</li>`).join('')}</ul>`
                : `<p>${report.safetyReviewed ? 'Safety screen reviewed; no warning item was selected.' : 'Safety screen not reviewed.'}</p>`}
            <h3>Position results and model estimates</h3>
            ${recorded.length ? `<div class="diagnosis-report-table-wrap"><table>
                <thead><tr><th>Position and description</th><th>Result</th><th>Pain</th><th>Weakness</th><th>Location</th><th>Numeric model reference</th></tr></thead>
                <tbody>${recorded.map((position) => `<tr>
                    <td><strong>${position.sequence}. ${escapeHtml(position.name)}</strong><br><small>${escapeHtml(position.instruction)}</small></td>
                    <td>${escapeHtml(resultLabel(position.observation.result))}</td>
                    <td>${Number.isFinite(position.observation.painScore) ? `${position.observation.painScore}/10` : '—'}</td>
                    <td>${Number.isFinite(position.observation.perceivedWeaknessScore) ? `${position.observation.perceivedWeaknessScore}/10` : '—'}</td>
                    <td>${escapeHtml(position.observation.painLocation || '—')}${position.observation.notes ? `<br><small>${escapeHtml(position.observation.notes)}</small>` : ''}</td>
                    <td>${position.modelEstimate.available
                        ? `<strong>Activation:</strong> ${position.modelEstimate.topActivation.map((muscle) => `${escapeHtml(muscle.name)} ${formatMetric(muscle.activation)}`).join(' · ')}<br><small><strong>Active actuator estimate:</strong> ${position.modelEstimate.topActiveActuatorForceN.map((muscle) => `${escapeHtml(muscle.name)} ${formatMetric(muscle.activeActuatorForceN, 1)} N`).join(' · ')}</small>`
                        : escapeHtml(position.modelEstimate.reason)}</td>
                </tr>`).join('')}</tbody>
            </table></div>` : '<p>No movement positions have been recorded.</p>'}
            <h3>Pain-associated generic-model activation</h3>
            <p>Ranked by mean activation in positions associated with reported pain. The contrast compares those positions with recorded painless positions where available.</p>
            ${ranking(analysis.painRanking, 'painAssociatedMeanActivation', 'painAssociationDelta')}
            <h3>Weakness-associated generic-model activation</h3>
            <p>Ranked by mean activation in positions associated with perceived weakness. The contrast compares those positions with reached/held, zero-weakness positions where available.</p>
            ${ranking(analysis.weaknessRanking, 'weaknessAssociatedMeanActivation', 'weaknessAssociationDelta')}
            <h3>Movement-family summary</h3>
            ${Object.keys(patterns.families).length ? `<div class="diagnosis-report-table-wrap"><table><thead><tr><th>Movement family</th><th>Recorded</th><th>Pain-associated</th><th>Weakness-associated</th><th>Mean pain</th><th>Mean weakness</th></tr></thead><tbody>${Object.entries(patterns.families).map(([name, item]) => `<tr><td>${escapeHtml(name)}</td><td>${item.recorded}</td><td>${item.painAssociated}</td><td>${item.weaknessAssociated}</td><td>${Number.isFinite(item.meanPainScore) ? `${formatMetric(item.meanPainScore, 1)}/10` : '—'}</td><td>${Number.isFinite(item.meanWeaknessScore) ? `${formatMetric(item.meanWeaknessScore, 1)}/10` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p>No movement-family observations recorded.</p>'}
            <p><strong>Pain locations:</strong> ${patterns.painLocations.length ? patterns.painLocations.map((item) => `${escapeHtml(item.location)} (${item.count})`).join(' · ') : 'None recorded'}.</p>
            <h3>Overall modeled muscle demand</h3>
            ${analysis.overallRanking.length ? `<ol>${analysis.overallRanking.map((row) => `<li><strong>${escapeHtml(row.name)}</strong> · mean activation ${formatMetric(row.overallMeanActivation)} · peak ${formatMetric(row.overallPeakActivation)} · mean active actuator estimate ${formatMetric(row.overallMeanActiveActuatorForceN, 1)} N</li>`).join('')}</ol>` : '<p>No modeled positions recorded.</p>'}
            <h3>Discrimination-position comparison</h3>
            <p>${discriminationCompleted}/7 discrimination positions contribute an able/unable observation. Pain-limited and uncertain positions are excluded from this binary comparison.</p>
            ${discriminationCompleted ? `<ol>${discriminationDisplay.map((item) => `<li><strong>${escapeHtml(item.name)}</strong> · ${item.contradictions} contradiction(s) across ${item.compared} comparable observation(s)</li>`).join('')}</ol>` : '<p>No experimental capacity-loss signature comparison is available.</p>'}
            <h3>Hypotheses and limits for clinical review</h3>
            <ul>
                <li>Review muscles with high activation in symptom-associated positions only as biomechanical demand hypotheses—not as identified pain generators.</li>
                <li>Give greater weight to a positive pain/weakness contrast than to high activation that is also present in symptom-free positions.</li>
                <li>Consider compensation, pain inhibition, referred pain, tendons, joints, nerves, and other non-muscle tissues.</li>
                <li>The complete 50-muscle vectors, forces, coordinates, observations, provenance, and limitations are retained in the downloadable JSON.</li>
            </ul>
            <p><strong>Required boundary:</strong> this generic, gravity-only, no-external-load model is not clinically validated and cannot diagnose or treat a patient.</p>`;
        byId('diagnosis-report-title').textContent = '25-position biomechanical assessment';
        byId('diagnosis-report-time').textContent = new Date(report.generatedAt).toLocaleString();
        byId('diagnosis-report').classList.remove('hidden');
        byId('diagnosis-copy-json').disabled = false;
        byId('diagnosis-download-json').disabled = false;
        byId('capacity-copy-json').disabled = false;
        byId('capacity-download-json').disabled = false;
    }

    function generateReport(view = 'all') {
        stopCurrentRun();
        state.report = buildReport();
        if (view === 'movement') renderMovementReport(state.report);
        else renderReport(state.report);
    }

    async function copyJson(buttonId = 'diagnosis-copy-json') {
        if (!state.report) return;
        const text = JSON.stringify(state.report, null, 2);
        await navigator.clipboard.writeText(text);
        const button = byId(buttonId);
        button.textContent = 'Copied';
        const original = buttonId === 'capacity-copy-json' ? 'Copy full JSON' : 'Copy JSON';
        window.setTimeout(() => { button.textContent = original; }, 1400);
    }

    function downloadJson() {
        if (!state.report) return;
        const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `mobl-arms-biomechanical-assessment-${new Date().toISOString().replaceAll(':', '-')}.json`;
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
    byId('capacity-next').addEventListener('click', () => {
        if (state.activeCapacityIndex < ALL_CAPACITY_POSITIONS.length - 1) {
            state.activeCapacityIndex += 1;
            renderCapacityList();
            renderCapacityPosition();
            persistDraft();
        } else {
            showReportScreen();
        }
    });
    byId('diagnosis-run-model').addEventListener('click', runModel);
    byId('diagnosis-generate-report').addEventListener('click', () => generateReport('all'));
    byId('diagnosis-copy-json').addEventListener('click', () => copyJson().catch(() => {}));
    byId('diagnosis-download-json').addEventListener('click', downloadJson);
    byId('capacity-copy-json').addEventListener('click', () => copyJson('capacity-copy-json').catch(() => {}));
    byId('capacity-download-json').addEventListener('click', downloadJson);
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
