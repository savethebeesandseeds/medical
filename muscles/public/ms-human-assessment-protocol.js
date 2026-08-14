/**
 * MS-Human right-arm activation-diverse observation panel, version 2.
 *
 * The 20 independent postures below were selected from a deterministic
 * 384-candidate, seven-coordinate atlas evaluated with the pinned browser
 * solver. Selection jointly rewards posture and 88-actuator activation
 * diversity while rejecting failed, reserve-dependent, saturated, and
 * high-demand candidates. This is experimental test design for a generic
 * model. It is not clinical validation, a diagnosis, or proof that any
 * posture isolates one anatomical muscle in a person.
 */

export const MS_HUMAN_ASSESSMENT_PROTOCOL_SCHEMA_VERSION = 2;

export const MS_HUMAN_AUTHORED_COORDINATES = Object.freeze({
    elv_angle_r: Object.freeze({ label: 'Shoulder elevation plane', minimum: -91.6732, maximum: 126.0507, default: 0 }),
    shoulder_elv_r: Object.freeze({ label: 'Shoulder elevation', minimum: 0, maximum: 177.6169, default: 0 }),
    shoulder_rot_r: Object.freeze({ label: 'Shoulder rotation', minimum: -45.8366, maximum: 91.6732, default: 0 }),
    elbow_flexion_r: Object.freeze({ label: 'Elbow flexion', minimum: 0, maximum: 126.0507, default: 0 }),
    pro_sup_r: Object.freeze({ label: 'Forearm rotation', minimum: -85.9437, maximum: 85.9437, default: 0 }),
    deviation_r: Object.freeze({ label: 'Wrist deviation', minimum: -9.7403, maximum: 24.6372, default: 0 }),
    flexion_r: Object.freeze({ label: 'Wrist flexion', minimum: -34.3775, maximum: 34.3775, default: 0 })
});

export const MS_HUMAN_ASSESSMENT_COORDINATE_KEYS = Object.freeze(Object.keys(MS_HUMAN_AUTHORED_COORDINATES));

function pose(values = {}) {
    return Object.freeze(Object.fromEntries(MS_HUMAN_ASSESSMENT_COORDINATE_KEYS
        .map((name) => [name, Number(values[name] ?? MS_HUMAN_AUTHORED_COORDINATES[name].default)])));
}

function position(id, name, instruction, coordinates, designRole, sourceCandidateId) {
    return Object.freeze({ id, name, instruction, coordinates: pose(coordinates), designRole, sourceCandidateId });
}

const followDisplay = (description) => `Follow the displayed ${description}. Move only within a comfortable range; stop or skip if symptoms increase.`;
const optionalDisplay = (description) => `Optional higher-demand posture: follow the displayed ${description} only within a comfortable range, or skip it.`;
const supplementalDisplay = (description) => `Optional supplemental posture: follow the displayed ${description} only within a comfortable range, or skip it.`;

// Ordered from reference and lower-demand postures toward broader optional
// postures. The source candidate identifiers tie every row to the full atlas
// and its recorded 88-actuator vector.
export const MS_HUMAN_ASSESSMENT_POSITIONS = Object.freeze([
    position('MSH-V2-01', 'Natural arm reference', 'Let the arm rest comfortably at the side. No hold is required if this is uncomfortable.', {}, 'reference', 'MSH-EXP-0000'),
    position('MSH-V2-02', 'Low diagonal reach', followDisplay('low diagonal arm posture'), {
        elv_angle_r: 33.2, shoulder_elv_r: 9.9, shoulder_rot_r: -5.1, elbow_flexion_r: 31.8,
        pro_sup_r: 30.2, deviation_r: -4.2, flexion_r: -4.8
    }, 'core', 'MSH-EXP-0261'),
    position('MSH-V2-03', 'Low turned reach', followDisplay('low turned-arm posture'), {
        elv_angle_r: -23.4, shoulder_elv_r: 16.9, shoulder_rot_r: 51.0, elbow_flexion_r: 55.3,
        pro_sup_r: -29.8, deviation_r: -1.2, flexion_r: 17.0
    }, 'core', 'MSH-EXP-0354'),
    position('MSH-V2-04', 'Low open-arm reach', followDisplay('low open-arm posture'), {
        elv_angle_r: 63.7, shoulder_elv_r: 19.9, shoulder_rot_r: 25.9, elbow_flexion_r: 18.5,
        pro_sup_r: 17.8, deviation_r: -3.9, flexion_r: 11.9
    }, 'core', 'MSH-EXP-0183'),
    position('MSH-V2-05', 'Low across-body bend', followDisplay('low across-body posture with the elbow bent'), {
        elv_angle_r: -19.7, shoulder_elv_r: 8.3, shoulder_rot_r: -7.5, elbow_flexion_r: 70.2,
        pro_sup_r: 45.9, deviation_r: 8.0, flexion_r: -25.2
    }, 'core', 'MSH-EXP-0306'),
    position('MSH-V2-06', 'Straight-arm diagonal reach', followDisplay('diagonal posture with the elbow nearly straight'), {
        elv_angle_r: -9.3, shoulder_elv_r: 44.9, shoulder_rot_r: 38.0, elbow_flexion_r: 2.1,
        pro_sup_r: -47.3, deviation_r: 12.5, flexion_r: -16.3
    }, 'core', 'MSH-EXP-0154'),
    position('MSH-V2-07', 'Mid bent-arm reach', followDisplay('mid-height bent-arm posture'), {
        elv_angle_r: 59.6, shoulder_elv_r: 34.8, shoulder_rot_r: 58.4, elbow_flexion_r: 53.0,
        pro_sup_r: 49.1, deviation_r: -5.2, flexion_r: 22.8
    }, 'core', 'MSH-EXP-0339'),
    position('MSH-V2-08', 'Mid long-arm reach', followDisplay('mid-height longer-arm posture'), {
        elv_angle_r: 82.6, shoulder_elv_r: 58.6, shoulder_rot_r: 26.5, elbow_flexion_r: 28.0,
        pro_sup_r: -5.6, deviation_r: -6.3, flexion_r: 4.0
    }, 'core', 'MSH-EXP-0247'),
    position('MSH-V2-09', 'Cross-body reach', followDisplay('cross-body longer-arm posture'), {
        elv_angle_r: -63.7, shoulder_elv_r: 46.1, shoulder_rot_r: 10.4, elbow_flexion_r: 28.6,
        pro_sup_r: -52.9, deviation_r: -5.1, flexion_r: 11.0
    }, 'core', 'MSH-EXP-0352'),
    position('MSH-V2-10', 'Straight-arm forward reach', followDisplay('straight-arm forward posture'), {
        elv_angle_r: 79.8, shoulder_elv_r: 54.3, shoulder_rot_r: 42.1, elbow_flexion_r: 0.0,
        pro_sup_r: -30.8, deviation_r: 2.6, flexion_r: -15.9
    }, 'core', 'MSH-EXP-0343'),
    position('MSH-V2-11', 'Compact rotated reach', followDisplay('compact posture with the forearm turned'), {
        elv_angle_r: 67.2, shoulder_elv_r: 21.8, shoulder_rot_r: 38.8, elbow_flexion_r: 83.8,
        pro_sup_r: -63.3, deviation_r: 16.4, flexion_r: -6.8
    }, 'core', 'MSH-EXP-0363'),
    position('MSH-V2-12', 'Forward bent-arm reach', followDisplay('forward bent-arm posture'), {
        elv_angle_r: 83.5, shoulder_elv_r: 45.6, shoulder_rot_r: 3.0, elbow_flexion_r: 73.7,
        pro_sup_r: 19.6, deviation_r: 15.4, flexion_r: 25.0
    }, 'core', 'MSH-EXP-0271'),
    position('MSH-V2-13', 'High across-body reach', optionalDisplay('higher across-body posture'), {
        elv_angle_r: -59.9, shoulder_elv_r: 76.4, shoulder_rot_r: 49.4, elbow_flexion_r: 43.5,
        pro_sup_r: 22.8, deviation_r: 4.1, flexion_r: 19.4
    }, 'optional-advanced', 'MSH-EXP-0304'),
    position('MSH-V2-14', 'High bent-arm reach', optionalDisplay('higher bent-arm posture'), {
        elv_angle_r: 8.0, shoulder_elv_r: 79.7, shoulder_rot_r: -4.3, elbow_flexion_r: 90.9,
        pro_sup_r: -59.2, deviation_r: -5.8, flexion_r: 19.2
    }, 'optional-advanced', 'MSH-EXP-0286'),
    position('MSH-V2-15', 'Overhead diagonal reach', optionalDisplay('overhead diagonal posture'), {
        elv_angle_r: 58.4, shoulder_elv_r: 104.0, shoulder_rot_r: -32.8, elbow_flexion_r: 35.6,
        pro_sup_r: -60.3, deviation_r: -2.1, flexion_r: -13.6
    }, 'optional-advanced', 'MSH-EXP-0275'),
    position('MSH-V2-16', 'Low compact bent-arm reach', supplementalDisplay('low compact posture with the elbow bent'), {
        elv_angle_r: 37.1, shoulder_elv_r: 22.5, shoulder_rot_r: 14.4, elbow_flexion_r: 71.0,
        pro_sup_r: 12.8, deviation_r: -0.4, flexion_r: 19.3
    }, 'optional-supplemental', 'MSH-EXP-0237'),
    position('MSH-V2-17', 'Low across-body straight reach', supplementalDisplay('low across-body posture with the elbow nearly straight'), {
        elv_angle_r: -42.8, shoulder_elv_r: 23.7, shoulder_rot_r: 31.6, elbow_flexion_r: 5.1,
        pro_sup_r: -19.3, deviation_r: 14.2, flexion_r: 16.5
    }, 'optional-supplemental', 'MSH-EXP-0168'),
    position('MSH-V2-18', 'High compact open reach', optionalDisplay('higher compact open-arm posture'), {
        elv_angle_r: 30.7, shoulder_elv_r: 81.3, shoulder_rot_r: 37.2, elbow_flexion_r: 72.1,
        pro_sup_r: 0.7, deviation_r: -3.6, flexion_r: -4.3
    }, 'optional-advanced', 'MSH-EXP-0313'),
    position('MSH-V2-19', 'High bent-arm side reach', optionalDisplay('higher side posture with the elbow bent'), {
        elv_angle_r: 84.8, shoulder_elv_r: 93.2, shoulder_rot_r: -23.0, elbow_flexion_r: 91.1,
        pro_sup_r: 2.8, deviation_r: 14.2, flexion_r: 10.8
    }, 'optional-advanced', 'MSH-EXP-0335'),
    position('MSH-V2-20', 'Overhead bent-arm turned reach', optionalDisplay('overhead bent-arm posture with the forearm turned'), {
        elv_angle_r: 39.5, shoulder_elv_r: 122.4, shoulder_rot_r: 1.4, elbow_flexion_r: 79.7,
        pro_sup_r: -53.9, deviation_r: -1.3, flexion_r: -21.9
    }, 'optional-advanced', 'MSH-EXP-0341')
]);

// V2 intentionally uses independent globally selected postures. It does not
// present arbitrary angle pairs as controlled clinical comparisons.
export const MS_HUMAN_ASSESSMENT_COMPARISONS = Object.freeze([]);

export const MS_HUMAN_ASSESSMENT_PROTOCOL_CONTENT = Object.freeze({
    schemaVersion: MS_HUMAN_ASSESSMENT_PROTOCOL_SCHEMA_VERSION,
    id: 'MSH700-RIGHT-ARM-GLOBAL-ACTIVATION-V2',
    version: '2.1.0',
    model: Object.freeze({
        modelId: 'MS_HUMAN_700_RIGHT_ARM_STATIC_V1',
        modelDigest: '38815fed122d1beb61155f0afd85e72a52093111fcae183bbb273f2483291971',
        runtimeModelSha256: '13d2b0bed35db2b07f3b8076931abef4ec4e149ca8d89f326bde22b84f821ad3',
        coordinateMetadataSha256: '4278ffe5171328047dd240711386ac2ea84ba7bcc54e1740df359f263956414e'
    }),
    derivation: Object.freeze({
        algorithm: 'deterministic-halton-atlas-constrained-weighted-maximin-v2',
        candidateCount: 384,
        usableCandidateCount: 327,
        coordinateSource: 'The seven ranges and defaults in the pinned MS-Human right-arm metadata asset.',
        roundingDegrees: 0.1,
        maximumAuthoredTravelFraction: 0.74,
        design: 'One neutral reference and 19 independent postures selected for normalized joint-space and 88-actuator activation-pattern diversity. The final five are supplemental and may be skipped.',
        selection: 'Candidates with solver failure, reserve dependence, activation at or above 0.995, maximum activation above 0.85, or activation RMS above 0.15 were excluded. Five supplemental postures were then admitted by deterministic constrained weighted-maximin marginal gain; selection stopped at 20 because a 21st posture added less than one percent effective-rank improvement and no robust-rank improvement.',
        solverScreen: 'Every admitted posture passed the unchanged browser static solver finite-value, path, equilibrium, reserve, and capacity gates. Failed candidates were rejected, never admitted by weakening a gate.',
        interpretation: 'This is generic-model experimental test design, not clinical validation, personal safety clearance, proof of muscle isolation, diagnostic evidence, or an instruction to move through pain.'
    }),
    coordinateRanges: MS_HUMAN_AUTHORED_COORDINATES,
    positions: MS_HUMAN_ASSESSMENT_POSITIONS,
    comparisons: MS_HUMAN_ASSESSMENT_COMPARISONS
});

// Updated by the repository validator whenever the canonical protocol content
// changes. A placeholder is intentionally invalid until evidence generation.
export const MS_HUMAN_ASSESSMENT_PROTOCOL_DIGEST = '6dbdc21fc004d90cb0df687c1265d3398f8a39623e366c5bc53844c3768107b9';

export const MS_HUMAN_ASSESSMENT_PROTOCOL = Object.freeze({
    ...MS_HUMAN_ASSESSMENT_PROTOCOL_CONTENT,
    contentDigestSha256: MS_HUMAN_ASSESSMENT_PROTOCOL_DIGEST
});

export const MS_HUMAN_ASSESSMENT_REPORT_PROTOCOL = Object.freeze({
    id: MS_HUMAN_ASSESSMENT_PROTOCOL.id,
    version: MS_HUMAN_ASSESSMENT_PROTOCOL.version,
    digest: `sha256:${MS_HUMAN_ASSESSMENT_PROTOCOL_DIGEST}`,
    name: 'MS-Human activation-diverse right-arm observation panel',
    trialIds: Object.freeze(MS_HUMAN_ASSESSMENT_POSITIONS.map((item) => item.id)),
    matchedComparisons: MS_HUMAN_ASSESSMENT_COMPARISONS
});

export default MS_HUMAN_ASSESSMENT_PROTOCOL;
