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

const ASSESSMENT_REGION_DEFINITIONS = Object.freeze([
    {
        key: 'arm',
        titleKey: 'explorer.regions.choices.arm',
        title: 'Arm',
        protocolKeys: ['left-upper-limb', 'right-upper-limb']
    },
    {
        key: 'hand',
        titleKey: 'explorer.regions.choices.hand',
        title: 'Hand',
        protocolKeys: ['right-hand'],
        availabilityKey: 'assessment.protocol.hand-right-only'
    },
    {
        key: 'leg',
        titleKey: 'explorer.regions.choices.leg',
        title: 'Leg',
        protocolKeys: ['left-lower-limb', 'right-lower-limb']
    },
    {
        key: 'foot-ankle',
        titleKey: 'explorer.regions.choices.foot-ankle',
        title: 'Foot and ankle',
        protocolKeys: ['left-foot-ankle', 'right-foot-ankle']
    },
    {
        key: 'trunk',
        titleKey: 'explorer.regions.trunk.name',
        title: 'Back and trunk',
        protocolKeys: ['trunk']
    },
    {
        key: 'head-neck',
        titleKey: 'explorer.regions.head-neck.name',
        title: 'Head and neck',
        protocolKeys: ['head-neck']
    }
]);

const assignedProtocolKeys = new Set();
export const ASSESSMENT_REGIONS = deepFreeze(ASSESSMENT_REGION_DEFINITIONS.map((definition) => {
    const protocols = definition.protocolKeys.map((key) => {
        const protocol = BY_KEY.get(key);
        if (!protocol) throw new Error(`Assessment region ${definition.key} refers to unknown protocol ${key}.`);
        if (assignedProtocolKeys.has(key)) throw new Error(`Assessment protocol ${key} belongs to more than one body region.`);
        assignedProtocolKeys.add(key);
        return protocol;
    });
    const sides = protocols.map((protocol) => protocol.side);
    if (new Set(sides).size !== sides.length) {
        throw new Error(`Assessment region ${definition.key} has more than one protocol for the same side.`);
    }
    return {
        ...definition,
        protocols,
        sideOptions: sides,
        requiresSideSelection: protocols.length > 1,
        fixedSide: protocols.length === 1 ? protocols[0].side : null
    };
}));

if (assignedProtocolKeys.size !== ASSESSMENT_PROTOCOLS.length) {
    const unassigned = ASSESSMENT_PROTOCOLS
        .map((entry) => entry.key)
        .filter((key) => !assignedProtocolKeys.has(key));
    throw new Error(`Assessment protocols are missing body-region assignments: ${unassigned.join(', ')}`);
}

const REGION_BY_KEY = new Map(ASSESSMENT_REGIONS.map((region) => [region.key, region]));
const REGION_BY_PROTOCOL_KEY = new Map(ASSESSMENT_REGIONS.flatMap((region) => (
    region.protocols.map((protocol) => [protocol.key, region])
)));
const BY_IDENTITY = new Map(ASSESSMENT_PROTOCOLS.map((entry) => {
    const report = entry.reportProtocol;
    return [`${report.id}\u0000${report.version}\u0000${normalizeDigest(report.digest)}`, entry];
}));

/** Return the canonical entry for a stable registry key, or null. */
export function assessmentProtocolByKey(key) {
    return BY_KEY.get(String(key ?? '')) ?? null;
}

/** Return the canonical body-region selection group, or null. */
export function assessmentRegionByKey(key) {
    return REGION_BY_KEY.get(String(key ?? '')) ?? null;
}

/** Return the body-region selection group containing a protocol, or null. */
export function assessmentRegionForProtocol(protocolOrKey) {
    const key = typeof protocolOrKey === 'object' ? protocolOrKey?.key : protocolOrKey;
    return REGION_BY_PROTOCOL_KEY.get(String(key ?? '')) ?? null;
}

/** Return the native protocol for a region and side, or null if unsupported. */
export function assessmentProtocolForRegionSide(regionKey, side = null) {
    const region = assessmentRegionByKey(regionKey);
    if (!region) return null;
    if (!region.requiresSideSelection && (side === null || side === undefined || side === '')) {
        return region.protocols[0] ?? null;
    }
    return region.protocols.find((protocol) => protocol.side === side) ?? null;
}

/** Return the canonical entry for a persisted report identity, or null. */
export function assessmentProtocolByIdentity({ id, version, digest } = {}) {
    if (!id || !version || !digest) return null;
    return BY_IDENTITY.get(`${id}\u0000${version}\u0000${normalizeDigest(digest)}`) ?? null;
}

export default ASSESSMENT_PROTOCOLS;
