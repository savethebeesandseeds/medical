/**
 * MS-Human-native moderate right-arm assessment panel.
 *
 * This panel is generated from the seven authored MS-Human coordinate ranges.
 * It is intentionally a compact paired-contrast design rather than a copied
 * angle grid: every comparison changes exactly one model coordinate while the
 * other six remain fixed. Solver feasibility is mechanical quality assurance;
 * it is not clinical validation or evidence that a posture is safe for a
 * particular person.
 */

export const MS_HUMAN_ASSESSMENT_PROTOCOL_SCHEMA_VERSION = 1;

const roundToControlStep = (value) => Number(value.toFixed(1));

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

function towardBound(coordinateName, bound, fraction) {
    const coordinate = MS_HUMAN_AUTHORED_COORDINATES[coordinateName];
    const limit = bound === 'minimum' ? coordinate.minimum : coordinate.maximum;
    return roundToControlStep(coordinate.default + (limit - coordinate.default) * fraction);
}

function neutralPose() {
    return Object.fromEntries(MS_HUMAN_ASSESSMENT_COORDINATE_KEYS.map((name) => [name, 0]));
}

function pose(values = {}) {
    return Object.freeze({ ...neutralPose(), ...values });
}

function position(id, name, instruction, coordinates, designRole) {
    return Object.freeze({ id, name, instruction, coordinates, designRole });
}

// Fractions are measured from each coordinate's authored default toward the
// named authored bound. No selected value is more than 74% of that travel.
export const MS_HUMAN_ASSESSMENT_DESIGN = Object.freeze({
    plane: Object.freeze({
        heldElevation: Object.freeze(['shoulder_elv_r', 'maximum', 0.24]),
        heldElbow: Object.freeze(['elbow_flexion_r', 'maximum', 0.44]),
        first: Object.freeze(['elv_angle_r', 'maximum', 0.08]),
        second: Object.freeze(['elv_angle_r', 'maximum', 0.62])
    }),
    elevation: Object.freeze({
        heldPlane: Object.freeze(['elv_angle_r', 'maximum', 0.28]),
        heldElbow: Object.freeze(['elbow_flexion_r', 'maximum', 0.44]),
        first: Object.freeze(['shoulder_elv_r', 'maximum', 0.14]),
        second: Object.freeze(['shoulder_elv_r', 'maximum', 0.38])
    }),
    shoulderRotation: Object.freeze({
        heldPlane: Object.freeze(['elv_angle_r', 'maximum', 0.28]),
        heldElevation: Object.freeze(['shoulder_elv_r', 'maximum', 0.20]),
        heldElbow: Object.freeze(['elbow_flexion_r', 'maximum', 0.60]),
        first: Object.freeze(['shoulder_rot_r', 'minimum', 0.42]),
        second: Object.freeze(['shoulder_rot_r', 'maximum', 0.28])
    }),
    elbow: Object.freeze({
        heldPlane: Object.freeze(['elv_angle_r', 'maximum', 0.28]),
        heldElevation: Object.freeze(['shoulder_elv_r', 'maximum', 0.14]),
        first: Object.freeze(['elbow_flexion_r', 'maximum', 0.28]),
        second: Object.freeze(['elbow_flexion_r', 'maximum', 0.74])
    }),
    forearm: Object.freeze({
        heldPlane: Object.freeze(['elv_angle_r', 'maximum', 0.20]),
        heldElevation: Object.freeze(['shoulder_elv_r', 'maximum', 0.12]),
        heldElbow: Object.freeze(['elbow_flexion_r', 'maximum', 0.62]),
        first: Object.freeze(['pro_sup_r', 'minimum', 0.42]),
        second: Object.freeze(['pro_sup_r', 'maximum', 0.42])
    }),
    wristFlexion: Object.freeze({
        heldPlane: Object.freeze(['elv_angle_r', 'maximum', 0.20]),
        heldElevation: Object.freeze(['shoulder_elv_r', 'maximum', 0.08]),
        heldElbow: Object.freeze(['elbow_flexion_r', 'maximum', 0.55]),
        first: Object.freeze(['flexion_r', 'minimum', 0.50]),
        second: Object.freeze(['flexion_r', 'maximum', 0.50])
    }),
    wristDeviation: Object.freeze({
        heldPlane: Object.freeze(['elv_angle_r', 'maximum', 0.20]),
        heldElevation: Object.freeze(['shoulder_elv_r', 'maximum', 0.08]),
        heldElbow: Object.freeze(['elbow_flexion_r', 'maximum', 0.55]),
        first: Object.freeze(['deviation_r', 'minimum', 0.50]),
        second: Object.freeze(['deviation_r', 'maximum', 0.50])
    })
});

const value = (specification) => towardBound(...specification);
const planeBase = {
    shoulder_elv_r: value(MS_HUMAN_ASSESSMENT_DESIGN.plane.heldElevation),
    elbow_flexion_r: value(MS_HUMAN_ASSESSMENT_DESIGN.plane.heldElbow)
};
const elevationBase = {
    elv_angle_r: value(MS_HUMAN_ASSESSMENT_DESIGN.elevation.heldPlane),
    elbow_flexion_r: value(MS_HUMAN_ASSESSMENT_DESIGN.elevation.heldElbow)
};
const shoulderRotationBase = {
    elv_angle_r: value(MS_HUMAN_ASSESSMENT_DESIGN.shoulderRotation.heldPlane),
    shoulder_elv_r: value(MS_HUMAN_ASSESSMENT_DESIGN.shoulderRotation.heldElevation),
    elbow_flexion_r: value(MS_HUMAN_ASSESSMENT_DESIGN.shoulderRotation.heldElbow)
};
const elbowBase = {
    elv_angle_r: value(MS_HUMAN_ASSESSMENT_DESIGN.elbow.heldPlane),
    shoulder_elv_r: value(MS_HUMAN_ASSESSMENT_DESIGN.elbow.heldElevation)
};
const forearmBase = {
    elv_angle_r: value(MS_HUMAN_ASSESSMENT_DESIGN.forearm.heldPlane),
    shoulder_elv_r: value(MS_HUMAN_ASSESSMENT_DESIGN.forearm.heldElevation),
    elbow_flexion_r: value(MS_HUMAN_ASSESSMENT_DESIGN.forearm.heldElbow)
};
const wristBase = {
    elv_angle_r: value(MS_HUMAN_ASSESSMENT_DESIGN.wristFlexion.heldPlane),
    shoulder_elv_r: value(MS_HUMAN_ASSESSMENT_DESIGN.wristFlexion.heldElevation),
    elbow_flexion_r: value(MS_HUMAN_ASSESSMENT_DESIGN.wristFlexion.heldElbow)
};

export const MS_HUMAN_ASSESSMENT_POSITIONS = Object.freeze([
    position('MSH-A01', 'Natural arm reference', 'Let the arm rest comfortably at the side. No hold is required if this is uncomfortable.', pose(), 'reference'),
    position('MSH-A02', 'Low side-diagonal reach', 'Lift the partly bent arm a short distance, only slightly forward of the side.', pose({ ...planeBase, elv_angle_r: value(MS_HUMAN_ASSESSMENT_DESIGN.plane.first) }), 'plane contrast A'),
    position('MSH-A03', 'Low forward-diagonal reach', 'Keep the same height and elbow bend, but place the arm in the more forward direction shown.', pose({ ...planeBase, elv_angle_r: value(MS_HUMAN_ASSESSMENT_DESIGN.plane.second) }), 'plane contrast B'),
    position('MSH-A04', 'Shallow diagonal reach', 'Raise the partly bent arm diagonally to the low position shown.', pose({ ...elevationBase, shoulder_elv_r: value(MS_HUMAN_ASSESSMENT_DESIGN.elevation.first) }), 'elevation contrast A'),
    position('MSH-A05', 'Mid diagonal reach', 'Use the same plane and elbow bend, raising only to the moderate position shown.', pose({ ...elevationBase, shoulder_elv_r: value(MS_HUMAN_ASSESSMENT_DESIGN.elevation.second) }), 'elevation contrast B'),
    position('MSH-A06', 'Gentle outward shoulder turn', 'With the elbow bent, turn the upper arm outward only to the displayed position.', pose({ ...shoulderRotationBase, shoulder_rot_r: value(MS_HUMAN_ASSESSMENT_DESIGN.shoulderRotation.first) }), 'shoulder-rotation contrast A'),
    position('MSH-A07', 'Gentle inward shoulder turn', 'Keep the same arm position and turn the upper arm inward only to the displayed position.', pose({ ...shoulderRotationBase, shoulder_rot_r: value(MS_HUMAN_ASSESSMENT_DESIGN.shoulderRotation.second) }), 'shoulder-rotation contrast B'),
    position('MSH-A08', 'Longer-arm diagonal hold', 'Hold the arm low and diagonal with the elbow only partly bent.', pose({ ...elbowBase, elbow_flexion_r: value(MS_HUMAN_ASSESSMENT_DESIGN.elbow.first) }), 'elbow contrast A'),
    position('MSH-A09', 'Compact-arm diagonal hold', 'Keep the upper arm in place and bring the hand closer by bending the elbow.', pose({ ...elbowBase, elbow_flexion_r: value(MS_HUMAN_ASSESSMENT_DESIGN.elbow.second) }), 'elbow contrast B'),
    position('MSH-A10', 'Palm-up carry', 'Keep the elbow bent and turn the palm upward only to the displayed moderate angle.', pose({ ...forearmBase, pro_sup_r: value(MS_HUMAN_ASSESSMENT_DESIGN.forearm.first) }), 'forearm-rotation contrast A'),
    position('MSH-A11', 'Palm-down carry', 'Keep the same upper-arm and elbow position and turn the palm downward.', pose({ ...forearmBase, pro_sup_r: value(MS_HUMAN_ASSESSMENT_DESIGN.forearm.second) }), 'forearm-rotation contrast B'),
    position('MSH-A12', 'Wrist gently extended', 'With the elbow comfortably bent, angle the hand backward only to the displayed position.', pose({ ...wristBase, flexion_r: value(MS_HUMAN_ASSESSMENT_DESIGN.wristFlexion.first) }), 'wrist-flexion contrast A'),
    position('MSH-A13', 'Wrist gently flexed', 'Keep the forearm still and angle the hand forward only to the displayed position.', pose({ ...wristBase, flexion_r: value(MS_HUMAN_ASSESSMENT_DESIGN.wristFlexion.second) }), 'wrist-flexion contrast B'),
    position('MSH-A14', 'Small wrist deviation A', 'Keep the forearm still and angle the hand slightly in the first displayed side direction.', pose({ ...wristBase, deviation_r: value(MS_HUMAN_ASSESSMENT_DESIGN.wristDeviation.first) }), 'wrist-deviation contrast A'),
    position('MSH-A15', 'Small wrist deviation B', 'Keep the forearm still and angle the hand slightly in the opposite displayed side direction.', pose({ ...wristBase, deviation_r: value(MS_HUMAN_ASSESSMENT_DESIGN.wristDeviation.second) }), 'wrist-deviation contrast B')
]);

function comparison(id, name, firstPositionId, secondPositionId, changedCoordinate, purpose) {
    const first = MS_HUMAN_ASSESSMENT_POSITIONS.find((item) => item.id === firstPositionId);
    const heldCoordinates = Object.fromEntries(MS_HUMAN_ASSESSMENT_COORDINATE_KEYS
        .filter((key) => key !== changedCoordinate)
        .map((key) => [key, first.coordinates[key]]));
    return Object.freeze({ id, name, firstPositionId, secondPositionId, changedCoordinate, heldCoordinates, purpose });
}

export const MS_HUMAN_ASSESSMENT_COMPARISONS = Object.freeze([
    comparison('MSH-C01', 'Elevation-plane contrast', 'MSH-A02', 'MSH-A03', 'elv_angle_r', 'Compare the same arm height and elbow bend in two authored elevation planes.'),
    comparison('MSH-C02', 'Elevation contrast', 'MSH-A04', 'MSH-A05', 'shoulder_elv_r', 'Compare lower and moderate elevation with plane and elbow bend held fixed.'),
    comparison('MSH-C03', 'Shoulder-rotation contrast', 'MSH-A06', 'MSH-A07', 'shoulder_rot_r', 'Compare outward and inward shoulder rotation in one modest raised-arm setup.'),
    comparison('MSH-C04', 'Elbow-flexion contrast', 'MSH-A08', 'MSH-A09', 'elbow_flexion_r', 'Compare two elbow bends while the upper arm remains in the same pose.'),
    comparison('MSH-C05', 'Forearm-rotation contrast', 'MSH-A10', 'MSH-A11', 'pro_sup_r', 'Compare palm-up and palm-down forearm rotation with the rest of the arm fixed.'),
    comparison('MSH-C06', 'Wrist-flexion contrast', 'MSH-A12', 'MSH-A13', 'flexion_r', 'Compare modest wrist extension and flexion with the proximal posture fixed.'),
    comparison('MSH-C07', 'Wrist-deviation contrast', 'MSH-A14', 'MSH-A15', 'deviation_r', 'Compare the two modeled wrist-deviation directions with the proximal posture fixed.')
]);

export const MS_HUMAN_ASSESSMENT_PROTOCOL_CONTENT = Object.freeze({
    schemaVersion: MS_HUMAN_ASSESSMENT_PROTOCOL_SCHEMA_VERSION,
    id: 'MSH700-RIGHT-ARM-PAIRED-CONTRAST-V1',
    version: '1.0.0',
    model: Object.freeze({
        modelId: 'MS_HUMAN_700_RIGHT_ARM_STATIC_V1',
        modelDigest: '38815fed122d1beb61155f0afd85e72a52093111fcae183bbb273f2483291971',
        runtimeModelSha256: '13d2b0bed35db2b07f3b8076931abef4ec4e149ca8d89f326bde22b84f821ad3',
        coordinateMetadataSha256: '4278ffe5171328047dd240711386ac2ea84ba7bcc54e1740df359f263956414e'
    }),
    derivation: Object.freeze({
        algorithm: 'authored-range-normalized-paired-contrast-v1',
        coordinateSource: 'The seven ranges and defaults in the pinned MS-Human right-arm metadata asset.',
        roundingDegrees: 0.1,
        maximumAuthoredTravelFraction: 0.74,
        design: 'Neutral reference plus seven matched pairs. Each pair changes exactly one independent MS-Human coordinate and holds the other six fixed.',
        selection: 'Values are fixed fractions of authored travel from the model default; no value was copied from a previous assessment grid.',
        solverScreen: 'Every pose must pass the unchanged browser static solver finite-value, path, equilibrium, reserve, and capacity gates. Failed candidates are replaced, never admitted by weakening a gate.',
        interpretation: 'Solver feasibility is mechanical quality assurance for this generic model, not clinical validation, personal safety clearance, diagnostic evidence, or an instruction to move through pain.'
    }),
    coordinateRanges: MS_HUMAN_AUTHORED_COORDINATES,
    designFractions: MS_HUMAN_ASSESSMENT_DESIGN,
    positions: MS_HUMAN_ASSESSMENT_POSITIONS,
    comparisons: MS_HUMAN_ASSESSMENT_COMPARISONS
});

// SHA-256 of canonical JSON for MS_HUMAN_ASSESSMENT_PROTOCOL_CONTENT. The
// repository validator recomputes it so any posture or wording change requires
// an intentional protocol version/digest update.
export const MS_HUMAN_ASSESSMENT_PROTOCOL_DIGEST = 'dd1775262214462c39440f6b461c2562fa8d7addd58ab4ceb6b56643e63b18b1';

export const MS_HUMAN_ASSESSMENT_PROTOCOL = Object.freeze({
    ...MS_HUMAN_ASSESSMENT_PROTOCOL_CONTENT,
    contentDigestSha256: MS_HUMAN_ASSESSMENT_PROTOCOL_DIGEST
});

// Shape consumed by report-v5. The digest prefix is part of that report API's
// verified protocol-identity contract.
export const MS_HUMAN_ASSESSMENT_REPORT_PROTOCOL = Object.freeze({
    id: MS_HUMAN_ASSESSMENT_PROTOCOL.id,
    version: MS_HUMAN_ASSESSMENT_PROTOCOL.version,
    digest: `sha256:${MS_HUMAN_ASSESSMENT_PROTOCOL_DIGEST}`,
    name: 'MS-Human authored-range paired-contrast right-arm panel',
    trialIds: Object.freeze(MS_HUMAN_ASSESSMENT_POSITIONS.map((item) => item.id)),
    matchedComparisons: Object.freeze(MS_HUMAN_ASSESSMENT_COMPARISONS.map((item) => Object.freeze({
        id: item.id,
        name: item.name,
        trialIds: Object.freeze([item.firstPositionId, item.secondPositionId]),
        controlledVariables: Object.freeze(Object.entries(item.heldCoordinates)
            .map(([coordinate, degrees]) => `${coordinate} ${degrees.toFixed(1)} degrees`)),
        changedVariable: item.changedCoordinate
    })))
});

export default MS_HUMAN_ASSESSMENT_PROTOCOL;
