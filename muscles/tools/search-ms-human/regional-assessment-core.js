import { HALTON_BASES } from './regional-assessment-config.js';

const COORDINATE_DIGITS = 1;
const OUTPUT_DIGITS = 8;

export function round(value, digits = OUTPUT_DIGITS) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function halton(index, base) {
    let fraction = 1;
    let value = 0;
    let remaining = index;
    while (remaining > 0) {
        fraction /= base;
        value += fraction * (remaining % base);
        remaining = Math.floor(remaining / base);
    }
    return value;
}

export function quantile(values, probability) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const position = (sorted.length - 1) * probability;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function rmsDistance(left, right) {
    if (!left.length || left.length !== right.length) throw new Error('Cannot compare mismatched feature vectors.');
    return Math.sqrt(left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0) / left.length);
}

function coordinateBounds(coordinate) {
    return {
        minimum: Number(coordinate.minimumDegrees ?? coordinate.minimum),
        maximum: Number(coordinate.maximumDegrees ?? coordinate.maximum),
        origin: Number(coordinate.defaultDegrees ?? coordinate.default)
    };
}

function valueAt(coordinate, fraction, unit) {
    const { minimum, maximum, origin } = coordinateBounds(coordinate);
    const low = origin + (minimum - origin) * fraction;
    const high = origin + (maximum - origin) * fraction;
    return round(low + unit * (high - low), COORDINATE_DIGITS);
}

function signature(values, coordinates) {
    return coordinates.map((item) => Number(values[item.name]).toFixed(COORDINATE_DIGITS)).join('|');
}

function maximumTravelFraction(values, coordinates) {
    return Math.max(0, ...coordinates.map((coordinate) => {
        const { minimum, maximum, origin } = coordinateBounds(coordinate);
        const value = Number(values[coordinate.name] ?? origin);
        const available = value < origin ? origin - minimum : maximum - origin;
        return available > 0 ? Math.abs(value - origin) / available : 0;
    }));
}

function tierForTravelFraction(travelFraction, config) {
    return config.tiers.find((tier) => travelFraction <= tier.travelFraction + 1e-9)?.id || 'outside-envelope';
}

export function buildCandidates(region, config, count = config.candidateCount) {
    const coordinates = region.coordinates;
    if (coordinates.length > HALTON_BASES.length) throw new Error(`Only ${HALTON_BASES.length} deterministic dimensions are configured.`);
    const candidates = [];
    const seen = new Set();
    const add = (tier, travelFraction, values, source = 'generated') => {
        const normalized = Object.fromEntries(coordinates.map((item) => [item.name, round(Number(values[item.name] ?? coordinateBounds(item).origin), COORDINATE_DIGITS)]));
        const key = signature(normalized, coordinates);
        if (seen.has(key) || candidates.length >= count) return false;
        seen.add(key);
        const actualTravelFraction = maximumTravelFraction(normalized, coordinates);
        candidates.push({
            id: `MSH-${config.key.toUpperCase()}-${String(candidates.length).padStart(4, '0')}`,
            ordinal: candidates.length,
            tier: tier || tierForTravelFraction(actualTravelFraction, config),
            travelFraction: round(travelFraction ?? actualTravelFraction),
            actualTravelFraction: round(actualTravelFraction),
            source,
            coordinates: normalized
        });
        return true;
    };

    add('neutral-reference', 0, Object.fromEntries(coordinates.map((item) => [item.name, coordinateBounds(item).origin])), 'authored-default');
    for (const preset of region.presets || []) add(null, null, preset.coordinates || {}, `preset:${preset.id || preset.name || candidates.length}`);
    for (const coordinate of coordinates) {
        const bounds = coordinateBounds(coordinate);
        for (const direction of [-1, 1]) {
            const values = Object.fromEntries(coordinates.map((item) => [item.name, coordinateBounds(item).origin]));
            values[coordinate.name] = direction < 0 ? bounds.minimum : bounds.maximum;
            add(null, null, values, `axis:${coordinate.name}:${direction < 0 ? 'minimum' : 'maximum'}`);
        }
    }

    const remaining = Math.max(0, count - candidates.length);
    const allocations = config.tiers.map((tier, index) => index === config.tiers.length - 1
        ? remaining - config.tiers.slice(0, index).reduce((sum, prior) => sum + Math.floor(remaining * prior.allocationWeight), 0)
        : Math.floor(remaining * tier.allocationWeight));
    let sequenceIndex = 1;
    for (let tierIndex = 0; tierIndex < config.tiers.length; tierIndex += 1) {
        const tier = config.tiers[tierIndex];
        let added = 0;
        while (added < allocations[tierIndex] && candidates.length < count) {
            const values = Object.fromEntries(coordinates.map((coordinate, dimension) => [
                coordinate.name,
                valueAt(coordinate, tier.travelFraction, halton(sequenceIndex, HALTON_BASES[dimension]))
            ]));
            sequenceIndex += 1;
            if (add(tier.id, tier.travelFraction, values)) added += 1;
        }
    }
    if (candidates.length !== count) throw new Error(`Candidate builder produced ${candidates.length}/${count} unique poses.`);
    return candidates;
}

function normalizePose(record, coordinates) {
    return coordinates.map((coordinate) => {
        const { minimum, maximum } = coordinateBounds(coordinate);
        return (record.coordinates[coordinate.name] - minimum) / Math.max(1e-9, maximum - minimum);
    });
}

function familyKey(muscle) {
    const group = String(muscle.group || 'ungrouped').trim();
    const stem = String(muscle.actuatorId || muscle.id || muscle.name)
        .replace(/_[rl]$/i, '').replace(/[_-]?[0-9]+(?:_[0-9]+)?$/g, '').replace(/[0-9]+$/g, '').toLowerCase();
    return `${group}:${stem || 'unknown'}`;
}

export function featuresForAtlas(usable, region, config) {
    const muscleCount = region.muscles.length;
    const scales = Array.from({ length: muscleCount }, (_, index) => Math.max(config.activationScaleFloor, quantile(usable.map((record) => record.vectors.activation[index]), 0.95)));
    const majorIndices = region.coordinates.map((coordinate, index) => config.majorCoordinatePatterns.some((pattern) => pattern.test(coordinate.name)) ? index : -1).filter((index) => index >= 0);
    const featured = usable.map((record) => {
        const fullPose = normalizePose(record, region.coordinates);
        return {
            record,
            activationPattern: record.vectors.activation.map((value, index) => Math.min(config.activationScaleCap, value / scales[index])),
            fullPose,
            majorPose: majorIndices.map((index) => fullPose[index])
        };
    });
    return { scales, majorIndices, featured };
}

function jacobiEigenvalues(matrix) {
    const a = matrix.map((row) => [...row]);
    const n = a.length;
    for (let sweep = 0; sweep < 80 * Math.max(1, n); sweep += 1) {
        let p = 0; let q = 0; let largest = 0;
        for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) {
            if (Math.abs(a[i][j]) > largest) { largest = Math.abs(a[i][j]); p = i; q = j; }
        }
        if (largest < 1e-12) break;
        const theta = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
        const c = Math.cos(theta); const s = Math.sin(theta);
        for (let k = 0; k < n; k += 1) if (k !== p && k !== q) {
            const apk = a[p][k]; const aqk = a[q][k];
            a[p][k] = a[k][p] = c * apk - s * aqk;
            a[q][k] = a[k][q] = s * apk + c * aqk;
        }
        const app = a[p][p]; const aqq = a[q][q]; const apq = a[p][q];
        a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
        a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
        a[p][q] = a[q][p] = 0;
    }
    return a.map((row, index) => Math.max(0, row[index])).sort((x, y) => y - x);
}

export function matrixEvidence(vectors, robustRatio = 0.10) {
    if (vectors.length < 2) return { effectiveRank: 0, robustRank: 0, singularValues: [] };
    const mean = Array.from({ length: vectors[0].length }, (_, j) => vectors.reduce((sum, row) => sum + row[j], 0) / vectors.length);
    const centered = vectors.map((row) => row.map((value, j) => value - mean[j]));
    const gram = centered.map((left) => centered.map((right) => left.reduce((sum, value, j) => sum + value * right[j], 0)));
    const singular = jacobiEigenvalues(gram).map(Math.sqrt).filter((value) => value > 1e-10);
    const squares = singular.map((value) => value * value);
    const effectiveRank = squares.length ? (squares.reduce((a, b) => a + b, 0) ** 2) / squares.reduce((sum, value) => sum + value * value, 0) : 0;
    const robustRank = singular.length ? singular.filter((value) => value / singular[0] >= robustRatio).length : 0;
    return { effectiveRank: round(effectiveRank), robustRank, singularValues: singular.map((value) => round(value)) };
}

function nearest(candidate, selected) {
    const min = (key) => Math.min(...selected.map((item) => rmsDistance(candidate[key], item[key])));
    return { activationPattern: min('activationPattern'), rawActivation: Math.min(...selected.map((item) => rmsDistance(candidate.record.vectors.activation, item.record.vectors.activation))), fullPose: min('fullPose'), majorPose: min('majorPose') };
}

function score(distances, weights) {
    return weights.activationPattern * distances.activationPattern + weights.fullPose * distances.fullPose + weights.majorPose * distances.majorPose;
}

function tierAllocation(total, tiers) {
    const raw = tiers.map((tier, index) => ({ index, value: total * tier.allocationWeight }));
    const counts = raw.map((item) => Math.floor(item.value));
    let remaining = total - counts.reduce((sum, value) => sum + value, 0);
    const priority = [...raw].sort((left, right) => {
        const fractionalDifference = (right.value - Math.floor(right.value)) - (left.value - Math.floor(left.value));
        return Math.abs(fractionalDifference) > 1e-12 ? fractionalDifference : left.index - right.index;
    });
    for (let index = 0; index < remaining; index += 1) counts[priority[index].index] += 1;
    return Object.fromEntries(tiers.map((tier, index) => [tier.id, counts[index]]));
}

export function selectPanel(usable, region, config) {
    const eligible = usable.filter((record) => {
        const max = Math.max(...record.vectors.activation);
        const rms = Math.sqrt(record.vectors.activation.reduce((sum, value) => sum + value * value, 0) / region.muscles.length);
        return max <= config.filters.maximumActivation && rms <= config.filters.maximumActivationRms && record.quality.capacityLimited !== true;
    });
    if (eligible.length < config.minimumPanelCount) throw new Error(`Only ${eligible.length} candidates passed selection gates; ${config.minimumPanelCount} are required.`);
    const { scales, majorIndices, featured } = featuresForAtlas(eligible, region, config);
    const neutral = featured.find((item) => item.record.source === 'authored-default') || featured[0];
    const tierIds = new Set(config.tiers.map((tier) => tier.id));
    const panelCandidates = featured.filter((item) => tierIds.has(item.record.tier));
    const tierAvailability = Object.fromEntries(config.tiers.map((tier) => [tier.id, panelCandidates.filter((item) => item.record.tier === tier.id).length]));
    const minimumTierTargets = tierAllocation(config.minimumPanelCount - 1, config.tiers);
    for (const tier of config.tiers) {
        if (tierAvailability[tier.id] < minimumTierTargets[tier.id]) {
            throw new Error(`Only ${tierAvailability[tier.id]} ${tier.id} candidates passed selection gates; ${minimumTierTargets[tier.id]} are required for the balanced panel.`);
        }
    }
    const selected = [neutral];
    const selectedIds = new Set([neutral.record.id]);
    const trace = [{ id: neutral.record.id, selectionOrder: 1, source: 'authored-default', score: null, rank: matrixEvidence([neutral.record.vectors.activation], config.robustSingularRatio) }];
    const selectedByTier = Object.fromEntries(config.tiers.map((tier) => [tier.id, 0]));
    let stale = 0;
    while (selected.length < config.maximumPanelCount) {
        const nextTierTargets = tierAllocation(selected.length, config.tiers);
        const requiredTiers = new Set(config.tiers.filter((tier) => selectedByTier[tier.id] < nextTierTargets[tier.id]).map((tier) => tier.id));
        let best = null;
        for (const candidate of panelCandidates) {
            if (selectedIds.has(candidate.record.id)) continue;
            if (!requiredTiers.has(candidate.record.tier)) continue;
            const distances = nearest(candidate, selected);
            if (distances.rawActivation < config.filters.minimumRawActivationRms || distances.fullPose < config.minimumPairDistance.fullPose || distances.majorPose < config.minimumPairDistance.majorPose) continue;
            const candidateScore = score(distances, config.weights);
            if (!best || candidateScore > best.score + 1e-12 || (Math.abs(candidateScore - best.score) <= 1e-12 && candidate.record.id < best.candidate.record.id)) best = { candidate, distances, score: candidateScore };
        }
        if (!best) break;
        const before = matrixEvidence(selected.map((item) => item.record.vectors.activation), config.robustSingularRatio);
        const after = matrixEvidence([...selected, best.candidate].map((item) => item.record.vectors.activation), config.robustSingularRatio);
        const gain = before.effectiveRank > 0 ? (after.effectiveRank - before.effectiveRank) / before.effectiveRank : 1;
        stale = selected.length >= config.minimumPanelCount && gain < config.stoppingEffectiveRankGainFraction && after.robustRank <= before.robustRank ? stale + 1 : 0;
        if (selected.length >= config.minimumPanelCount && stale >= config.stoppingPatience) break;
        selected.push(best.candidate); selectedIds.add(best.candidate.record.id); selectedByTier[best.candidate.record.tier] += 1;
        trace.push({ id: best.candidate.record.id, selectionOrder: selected.length, tier: best.candidate.record.tier, tierTarget: nextTierTargets[best.candidate.record.tier], score: round(best.score), nearestDistances: Object.fromEntries(Object.entries(best.distances).map(([key, value]) => [key, round(value)])), effectiveRankGainFraction: round(gain), rank: after });
    }
    if (selected.length < config.minimumPanelCount) throw new Error(`Selector stopped at ${selected.length}; ${config.minimumPanelCount} are required.`);

    const activationVectors = selected.map((item) => item.record.vectors.activation);
    const muscleRanges = region.muscles.map((muscle, index) => {
        const values = activationVectors.map((row) => row[index]);
        return { index, actuatorId: muscle.actuatorId, name: muscle.name, group: muscle.group, family: familyKey(muscle), minimumActivation: round(Math.min(...values)), maximumActivation: round(Math.max(...values)), range: round(Math.max(...values) - Math.min(...values)) };
    });
    const familyCoverage = Object.values(muscleRanges.reduce((groups, muscle) => {
        const entry = groups[muscle.family] ||= { family: muscle.family, sampledMuscleCount: 0, responsiveInSampledPosesCount: 0, maximumRange: 0 };
        entry.sampledMuscleCount += 1; entry.maximumRange = Math.max(entry.maximumRange, muscle.range); if (muscle.range >= config.minimumResponseRange) entry.responsiveInSampledPosesCount += 1;
        return groups;
    }, {})).sort((a, b) => a.family.localeCompare(b.family));
    const pairStats = (key) => {
        const distances = [];
        for (let i = 0; i < selected.length; i += 1) for (let j = i + 1; j < selected.length; j += 1) distances.push(rmsDistance(selected[i][key], selected[j][key]));
        return { pairCount: distances.length, minimum: round(Math.min(...distances)), median: round(quantile(distances, .5)), maximum: round(Math.max(...distances)) };
    };
    return {
        objective: { algorithm: 'deterministic-tier-balanced-region-weighted-maximin-with-empirical-rank-stop-v2', weights: config.weights, tierAllocationWeights: Object.fromEntries(config.tiers.map((tier) => [tier.id, tier.allocationWeight])), tierAvailability, selectedByTier, filters: config.filters, minimumPairDistance: config.minimumPairDistance, stoppingRule: { minimumPanelCount: config.minimumPanelCount, maximumPanelCount: config.maximumPanelCount, patience: config.stoppingPatience, effectiveRankGainFraction: config.stoppingEffectiveRankGainFraction, robustSingularRatio: config.robustSingularRatio } },
        activationScaleByMuscle: scales.map((value, index) => ({ index, actuatorId: region.muscles[index].actuatorId, percentile95Activation: round(value) })),
        selectedPositions: selected.map((item, index) => ({ selectionOrder: index + 1, id: item.record.id, tier: item.record.tier, source: item.record.source, coordinates: item.record.coordinates, maximumActivation: round(Math.max(...item.record.vectors.activation)), activationRms: round(Math.sqrt(item.record.vectors.activation.reduce((sum, value) => sum + value * value, 0) / region.muscles.length)), selection: trace[index] })),
        panelDiversity: { activationPattern: pairStats('activationPattern'), fullPose: pairStats('fullPose'), majorPose: pairStats('majorPose') },
        rankEvidence: matrixEvidence(activationVectors, config.robustSingularRatio),
        responseDiversity: { responseRangeThreshold: config.minimumResponseRange, responsiveInSampledPosesCount: muscleRanges.filter((item) => item.range >= config.minimumResponseRange).length, sampledMuscleCount: muscleRanges.length, muscleRanges, familyCoverage },
        majorCoordinateIndices: majorIndices
    };
}

export function validateRegion(metadata, config) {
    const source = metadata.regions?.find((item) => item.id === config.regionId);
    if (!source) throw new Error(`Worker profile ${config.profileId} does not expose ${config.regionId}.`);
    const coordinates = source.coordinates.map((coordinate) => ({ ...coordinate, minimumDegrees: Number(coordinate.minimumDegrees ?? coordinate.minimum), maximumDegrees: Number(coordinate.maximumDegrees ?? coordinate.maximum), defaultDegrees: Number(coordinate.defaultDegrees ?? coordinate.default) }));
    if (!coordinates.length || !source.muscles?.length) throw new Error(`${config.regionId} has no searchable coordinates or muscles.`);
    for (const coordinate of coordinates) if (![coordinate.minimumDegrees, coordinate.maximumDegrees, coordinate.defaultDegrees].every(Number.isFinite) || coordinate.maximumDegrees <= coordinate.minimumDegrees) throw new Error(`Invalid coordinate bounds for ${coordinate.name}.`);
    return { ...source, coordinates };
}

export function validateState(state, region, regionId) {
    return state?.regionId === regionId && state?.staticHolding?.quality?.usable === true && Array.isArray(state.muscles) && state.muscles.length === region.muscles.length && state.muscles.every((muscle, index) => muscle.actuatorId === region.muscles[index].actuatorId && Number.isFinite(muscle.activation) && Number.isFinite(muscle.activeActuatorForceN));
}
