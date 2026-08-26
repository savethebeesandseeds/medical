/**
 * Canonical assessment-protocol registry.
 *
 * The established right-arm V2 protocol is imported without modification.
 * All other entries are generated deterministically from the checked-in
 * regional search evidence.
 */

import {
    MS_HUMAN_ASSESSMENT_PROTOCOL,
    MS_HUMAN_ASSESSMENT_REPORT_PROTOCOL,
    MS_HUMAN_AUTHORED_COORDINATES
} from './ms-human-assessment-protocol.js';
import { GENERATED_REGIONAL_ASSESSMENT_PROTOCOLS } from './generated-regional-assessment-protocols.js';

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function normalizeDigest(value) {
    return String(value ?? '').replace(/^sha256:/i, '').toLowerCase();
}

const RIGHT_ARM_LIMITATIONS = Object.freeze([
    'Right-arm static postures only. The rest of the body is prescribed and acts as external support.',
    'No held object, contact force, measured support, speed, acceleration, fatigue, or person-specific co-contraction is modeled.',
    'Generic static-model estimates only—not patient measurements, proof of muscle isolation, pain or injury evidence, safety clearance, diagnosis, treatment guidance, or clinical validation.'
]);

const RIGHT_ARM_ENTRY = deepFreeze({
    key: 'right-upper-limb',
    regionId: 'right-upper-limb',
    profileId: 'primary',
    side: 'right',
    sideOptions: ['right'],
    titleKey: 'assessment.protocol.right-upper-limb.title',
    shortTitleKey: 'assessment.protocol.right-upper-limb.short-title',
    descriptionKey: 'assessment.protocol.right-upper-limb.description',
    title: 'Right upper limb',
    shortTitle: 'Right arm',
    description: 'Right shoulder, elbow, forearm, and wrist observation',
    positionI18nPrefix: 'assessment.protocol.right-upper-limb.position',
    angleLabels: Object.fromEntries(Object.entries(MS_HUMAN_AUTHORED_COORDINATES)
        .map(([key, range]) => [key, range.label])),
    responseProfile: 'movement-observation-v1',
    intakeLocationOptions: [
        'Front of shoulder',
        'Top of shoulder',
        'Back of shoulder',
        'Upper arm',
        'Elbow',
        'Forearm',
        'Wrist or hand',
        'Diffuse or uncertain'
    ],
    movementDifferenceOptions: [
        'No difference observed',
        'Pain',
        'Perceived weakness',
        'Stiffness',
        'Compensation',
        'Unable to complete',
        'Stopped for safety',
        'Not attempted'
    ],
    model: {
        ...MS_HUMAN_ASSESSMENT_PROTOCOL.model,
        profileId: 'primary',
        regionId: 'right-upper-limb',
        sideMode: 'native',
        unloadedOpenChain: 'Right arm only; the rest of the body is prescribed and acts as external support.',
        dynamicMotion: false,
        externalLoads: false,
        patientSpecific: false
    },
    limitations: RIGHT_ARM_LIMITATIONS,
    evidence: {
        sourceFile: 'tools/ms-human-assessment-protocol-solver-evidence.json',
        selectedCount: MS_HUMAN_ASSESSMENT_PROTOCOL.positions.length,
        responseDiversityStatus: 'activation-diverse'
    },
    positions: MS_HUMAN_ASSESSMENT_PROTOCOL.positions,
    reportProtocol: MS_HUMAN_ASSESSMENT_REPORT_PROTOCOL,
    protocol: MS_HUMAN_ASSESSMENT_PROTOCOL
});

export const DEFAULT_ASSESSMENT_PROTOCOL_KEY = RIGHT_ARM_ENTRY.key;

export const ASSESSMENT_PROTOCOLS = Object.freeze([
    RIGHT_ARM_ENTRY,
    ...GENERATED_REGIONAL_ASSESSMENT_PROTOCOLS
]);

const BY_KEY = new Map(ASSESSMENT_PROTOCOLS.map((entry) => [entry.key, entry]));
const BY_IDENTITY = new Map(ASSESSMENT_PROTOCOLS.map((entry) => {
    const report = entry.reportProtocol;
    return [`${report.id}\u0000${report.version}\u0000${normalizeDigest(report.digest)}`, entry];
}));

/** Return the canonical entry for a stable registry key, or null. */
export function assessmentProtocolByKey(key) {
    return BY_KEY.get(String(key ?? '')) ?? null;
}

/** Return the canonical entry for a persisted report identity, or null. */
export function assessmentProtocolByIdentity({ id, version, digest } = {}) {
    if (!id || !version || !digest) return null;
    return BY_IDENTITY.get(`${id}\u0000${version}\u0000${normalizeDigest(digest)}`) ?? null;
}

export default ASSESSMENT_PROTOCOLS;
