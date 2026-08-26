import { createHash } from 'node:crypto';

export function stableStringify(value) {
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    if (value && typeof value === 'object') {
        return '{' + Object.keys(value).sort().map((key) => (
            JSON.stringify(key) + ':' + stableStringify(value[key])
        )).join(',') + '}';
    }
    return JSON.stringify(value);
}

export function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

function stableCandidate(candidate) {
    return {
        id: candidate.id,
        ordinal: candidate.ordinal,
        tier: candidate.tier,
        actualTravelFraction: candidate.actualTravelFraction,
        source: candidate.source,
        coordinates: candidate.coordinates,
        vectors: candidate.vectors,
        quality: {
            status: candidate.quality.status,
            maximumResidualNm: candidate.quality.maximumResidualNm,
            maximumReserveNm: candidate.quality.maximumReserveNm,
            capacityLimited: candidate.quality.capacityLimited
        }
    };
}

/**
 * Scientific/mechanical atlas content used for semantic provenance.
 *
 * Runtime and solver timings are deliberately absent: identical poses,
 * vectors, quality gates, model assets, and search design must retain the same
 * identity even when a clean rerun takes a different amount of wall time.
 */
export function stableMechanicalEvidence(evidence) {
    return {
        schemaVersion: evidence.schemaVersion,
        classification: evidence.classification,
        interpretationBoundary: evidence.interpretationBoundary,
        model: evidence.model,
        search: evidence.search,
        muscles: evidence.muscles,
        usableCandidates: evidence.usableCandidates.map(stableCandidate)
    };
}

export function mechanicalEvidenceDigest(evidence) {
    return sha256(stableStringify(stableMechanicalEvidence(evidence)));
}

export function regionalModelIdentity(sourceModel) {
    const modelId = sourceModel.profileId === 'right-hand' || sourceModel.regionId === 'right-hand'
        ? 'MS_HUMAN_700_RIGHT_HAND_STATIC_V1'
        : 'MS_HUMAN_700_PRIMARY_REGIONS_V1';
    const identityContent = {
        modelId,
        runtimeModelSha256: sourceModel.runtimeModelSha256,
        sourceCommit: sourceModel.sourceCommit,
        runtimeVersion: sourceModel.runtimeVersion
    };
    return {
        ...sourceModel,
        sourceModelId: sourceModel.modelId,
        sourceModelDigest: sourceModel.modelDigest,
        modelId,
        modelDigest: sha256(stableStringify(identityContent))
    };
}
