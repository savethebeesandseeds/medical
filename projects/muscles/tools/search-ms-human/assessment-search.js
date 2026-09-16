import { MsHumanEngine } from '../../public/ms-human-engine.js';

const REGION_ID = 'right-upper-limb';
const EXPECTED_COORDINATE_COUNT = 7;
const EXPECTED_MUSCLE_COUNT = 88;
const PANEL_TARGET_COUNT = 20;
const BASE_PANEL_SOURCE_IDS = Object.freeze([
    'MSH-EXP-0000', 'MSH-EXP-0261', 'MSH-EXP-0354', 'MSH-EXP-0183', 'MSH-EXP-0306',
    'MSH-EXP-0154', 'MSH-EXP-0339', 'MSH-EXP-0247', 'MSH-EXP-0352', 'MSH-EXP-0343',
    'MSH-EXP-0363', 'MSH-EXP-0271', 'MSH-EXP-0304', 'MSH-EXP-0286', 'MSH-EXP-0275'
]);
const HALTON_BASES = Object.freeze([2, 3, 5, 7, 11, 13, 17]);
const TIER_DEFINITIONS = Object.freeze([
    Object.freeze({ id: 'accessible-moderate', travelFraction: 0.42, allocationWeight: 0.30 }),
    Object.freeze({ id: 'middle-moderate', travelFraction: 0.58, allocationWeight: 0.34 }),
    Object.freeze({ id: 'broad-moderate', travelFraction: 0.74, allocationWeight: 0.36 })
]);
const PROXIMAL_COORDINATES = new Set([
    'elv_angle',
    'elv_angle_r',
    'shoulder_elv',
    'shoulder_elv_r',
    'shoulder_rot',
    'shoulder_rot_r',
    'elbow_flexion',
    'elbow_flexion_r'
]);
const OBJECTIVE_WEIGHTS = Object.freeze({ activationPattern: 0.55, fullPose: 0.20, proximalPose: 0.25 });
const SELECTION_FILTERS = Object.freeze({
    maximumActivation: 0.85,
    maximumActivationRms: 0.15,
    minimumRawActivationRms: 0.025,
    minimumFullPoseRms: 0.11,
    minimumProximalPoseRms: 0.10
});
const ROUND_COORDINATE_DIGITS = 1;
const ROUND_OUTPUT_DIGITS = 8;

const byId = (id) => document.getElementById(id);
const countInput = byId('assessment-search-count');
const runButton = byId('assessment-search-run');
const stopButton = byId('assessment-search-stop');
const copyButton = byId('assessment-search-copy');
const downloadButton = byId('assessment-search-download');
const progressBar = byId('assessment-search-progress-bar');
const progressText = byId('assessment-search-progress');
const summaryElement = byId('assessment-search-summary');
const resultElement = byId('assessment-search-result');

let engine = null;
let running = false;
let stopRequested = false;

function round(value, digits = ROUND_OUTPUT_DIGITS) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
}

function halton(index, base) {
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

function quantile(values, probability) {
    if (!values.length) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const position = (sorted.length - 1) * probability;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function rmsDistance(left, right) {
    if (left.length !== right.length || left.length === 0) throw new Error('Cannot compare mismatched feature vectors.');
    let sum = 0;
    for (let index = 0; index < left.length; index += 1) {
        const difference = left[index] - right[index];
        sum += difference * difference;
    }
    return Math.sqrt(sum / left.length);
}

function pairwiseStats(vectors) {
    const distances = [];
    for (let left = 0; left < vectors.length; left += 1) {
        for (let right = left + 1; right < vectors.length; right += 1) {
            distances.push(rmsDistance(vectors[left], vectors[right]));
        }
    }
    return {
        pairCount: distances.length,
        minimum: round(Math.min(...distances)),
        median: round(quantile(distances, 0.5)),
        mean: round(distances.reduce((sum, value) => sum + value, 0) / Math.max(1, distances.length)),
        maximum: round(Math.max(...distances))
    };
}

function tierCounts(candidateCount) {
    const nonNeutral = candidateCount - 1;
    const first = Math.floor(nonNeutral * TIER_DEFINITIONS[0].allocationWeight);
    const second = Math.floor(nonNeutral * TIER_DEFINITIONS[1].allocationWeight);
    return [first, second, nonNeutral - first - second];
}

function coordinateRange(coordinate, fraction) {
    const origin = coordinate.defaultDegrees ?? coordinate.default;
    const minimum = coordinate.minimumDegrees ?? coordinate.minimum;
    const maximum = coordinate.maximumDegrees ?? coordinate.maximum;
    return {
        minimumDegrees: round(origin + (minimum - origin) * fraction, ROUND_COORDINATE_DIGITS),
        maximumDegrees: round(origin + (maximum - origin) * fraction, ROUND_COORDINATE_DIGITS)
    };
}

function makeCoordinates(coordinates, fraction, sequenceIndex) {
    return Object.fromEntries(coordinates.map((coordinate, dimension) => {
        const range = coordinateRange(coordinate, fraction);
        const unit = halton(sequenceIndex, HALTON_BASES[dimension]);
        const value = range.minimumDegrees + unit * (range.maximumDegrees - range.minimumDegrees);
        return [coordinate.name, round(value, ROUND_COORDINATE_DIGITS)];
    }));
}

function coordinateSignature(coordinates, coordinateMetadata) {
    return coordinateMetadata.map((coordinate) => coordinates[coordinate.name].toFixed(ROUND_COORDINATE_DIGITS)).join('|');
}

function buildCandidates(coordinates, candidateCount) {
    const candidates = [{
        id: 'MSH-EXP-0000',
        ordinal: 0,
        tier: 'neutral-reference',
        travelFraction: 0,
        coordinates: Object.fromEntries(coordinates.map((coordinate) => [coordinate.name, coordinate.defaultDegrees ?? coordinate.default]))
    }];
    const seen = new Set([coordinateSignature(candidates[0].coordinates, coordinates)]);
    const allocations = tierCounts(candidateCount);
    let sequenceIndex = 1;

    for (let tierIndex = 0; tierIndex < TIER_DEFINITIONS.length; tierIndex += 1) {
        const tier = TIER_DEFINITIONS[tierIndex];
        let added = 0;
        while (added < allocations[tierIndex]) {
            const candidateCoordinates = makeCoordinates(coordinates, tier.travelFraction, sequenceIndex);
            sequenceIndex += 1;
            const signature = coordinateSignature(candidateCoordinates, coordinates);
            if (seen.has(signature)) continue;
            seen.add(signature);
            const ordinal = candidates.length;
            candidates.push({
                id: `MSH-EXP-${String(ordinal).padStart(4, '0')}`,
                ordinal,
                tier: tier.id,
                travelFraction: tier.travelFraction,
                coordinates: candidateCoordinates
            });
            added += 1;
        }
    }
    if (candidates.length !== candidateCount) throw new Error('Candidate allocation did not produce the requested deterministic count.');
    return candidates;
}

function firstFinite(...values) {
    for (const value of values) {
        if (value === null || value === undefined || value === '') continue;
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric;
    }
    return undefined;
}

function validateRegion(metadata) {
    const publicRegion = metadata.regions?.find((item) => item.id === REGION_ID);
    if (!publicRegion) throw new Error(`Current engine metadata does not expose ${REGION_ID}.`);
    if (publicRegion.coordinates?.length !== EXPECTED_COORDINATE_COUNT) {
        throw new Error(`Expected ${EXPECTED_COORDINATE_COUNT} coordinates; received ${publicRegion.coordinates?.length ?? 0}.`);
    }
    if (publicRegion.muscles?.length !== EXPECTED_MUSCLE_COUNT) {
        throw new Error(`Expected ${EXPECTED_MUSCLE_COUNT} muscles; received ${publicRegion.muscles?.length ?? 0}.`);
    }

    // Public metadata uses minimum/maximum/default. The older degree-suffixed
    // aliases remain accepted so this disposable harness can read either shape.
    const coordinates = publicRegion.coordinates.map((coordinate) => {
        const minimumDegrees = firstFinite(coordinate.minimum, coordinate.minimumDegrees, coordinate.min);
        const maximumDegrees = firstFinite(coordinate.maximum, coordinate.maximumDegrees, coordinate.max);
        const defaultDegrees = firstFinite(coordinate.default, coordinate.defaultDegrees, coordinate.defaultValue);
        if (minimumDegrees === undefined || maximumDegrees === undefined || defaultDegrees === undefined) {
            throw new Error(`Coordinate ${coordinate.name ?? 'unknown'} has incomplete public bounds.`);
        }
        if (maximumDegrees <= minimumDegrees) {
            throw new Error(`Coordinate ${coordinate.name ?? 'unknown'} has invalid public bounds.`);
        }
        return { ...coordinate, minimumDegrees, maximumDegrees, defaultDegrees };
    });
    return { ...publicRegion, coordinates };
}

function readModelIdentity(metadata) {
    const identity = metadata.identity ?? {};
    const publicModel = metadata.model ?? {};
    const result = {
        modelId: identity.modelId ?? publicModel.id ?? metadata.modelId ?? null,
        modelDigest: identity.modelDigest ?? identity.sourceTreeSha256 ?? publicModel.digest ?? metadata.modelDigest ?? null,
        runtimeModelSha256: identity.runtimeModelSha256 ?? publicModel.runtimeModelSha256 ?? null,
        sourceCommit: identity.sourceCommit ?? publicModel.sourceCommit ?? null,
        runtimeVersion: identity.runtimeVersion ?? metadata.runtimeVersion ?? null
    };
    if (!result.modelId || !result.modelDigest || !result.runtimeModelSha256) {
        throw new Error('Engine metadata does not expose a complete public model identity.');
    }
    return result;
}

function validateState(state, region) {
    if (state?.regionId !== REGION_ID || state?.staticHolding?.quality?.usable !== true) return false;
    if (!Array.isArray(state.muscles) || state.muscles.length !== region.muscles.length) return false;
    return state.muscles.every((muscle, index) =>
        muscle.actuatorId === region.muscles[index].actuatorId
        && Number.isFinite(muscle.activation)
        && Number.isFinite(muscle.activeActuatorForceN));
}

function extractUsable(candidate, state, durationMs) {
    const quality = state.staticHolding.quality;
    return {
        id: candidate.id,
        ordinal: candidate.ordinal,
        tier: candidate.tier,
        travelFraction: candidate.travelFraction,
        coordinates: candidate.coordinates,
        vectors: {
            activation: state.muscles.map((muscle) => round(muscle.activation)),
            activeForceN: state.muscles.map((muscle) => round(muscle.activeActuatorForceN))
        },
        quality: {
            status: quality.status,
            maximumResidualNm: round(quality.maxGeneralizedForceEquilibriumResidual, 12),
            maximumReserveNm: round(quality.maxReserveTorqueNm, 12),
            capacityLimited: quality.capacityLimited,
            solverDurationMs: round(state.staticHolding.solver.durationMs, 4),
            observedRoundTripMs: round(durationMs, 4)
        }
    };
}

function failedRecord(candidate, state, error, durationMs) {
    return {
        id: candidate.id,
        ordinal: candidate.ordinal,
        tier: candidate.tier,
        coordinates: candidate.coordinates,
        status: state?.staticHolding?.quality?.status || error?.code || error?.name || 'invalid-result',
        reason: state?.staticHolding?.quality?.reason || error?.message || 'The result did not contain 88 finite activation and force values.',
        observedRoundTripMs: round(durationMs, 4)
    };
}

function featuresForAtlas(usable, coordinateMetadata) {
    const activationScales = Array.from({ length: EXPECTED_MUSCLE_COUNT }, (_, muscleIndex) => {
        const values = usable.map((record) => record.vectors.activation[muscleIndex]);
        return Math.max(0.02, quantile(values, 0.95));
    });
    const proximalIndices = coordinateMetadata
        .map((coordinate, index) => PROXIMAL_COORDINATES.has(coordinate.name) ? index : -1)
        .filter((index) => index >= 0);

    const featured = usable.map((record) => {
        const fullPose = coordinateMetadata.map((coordinate) => {
            const minimum = coordinate.minimumDegrees ?? coordinate.minimum;
            const maximum = coordinate.maximumDegrees ?? coordinate.maximum;
            const span = Math.max(1e-9, maximum - minimum);
            return (record.coordinates[coordinate.name] - minimum) / span;
        });
        return {
            record,
            activationPattern: record.vectors.activation.map((value, index) => Math.min(1.5, value / activationScales[index])),
            fullPose,
            proximalPose: proximalIndices.map((index) => fullPose[index])
        };
    });
    return { activationScales, proximalIndices, featured };
}

function distancesToSelection(candidate, selected) {
    const activation = selected.map((item) => rmsDistance(candidate.activationPattern, item.activationPattern));
    const rawActivation = selected.map((item) => rmsDistance(candidate.record.vectors.activation, item.record.vectors.activation));
    const fullPose = selected.map((item) => rmsDistance(candidate.fullPose, item.fullPose));
    const proximal = selected.map((item) => rmsDistance(candidate.proximalPose, item.proximalPose));
    return {
        activationPattern: Math.min(...activation),
        rawActivation: Math.min(...rawActivation),
        fullPose: Math.min(...fullPose),
        proximalPose: Math.min(...proximal)
    };
}

function combinedScore(distances) {
    return OBJECTIVE_WEIGHTS.activationPattern * distances.activationPattern
        + OBJECTIVE_WEIGHTS.fullPose * distances.fullPose
        + OBJECTIVE_WEIGHTS.proximalPose * distances.proximalPose;
}

function selectPanel(usable, coordinateMetadata, muscleMetadata) {
    const eligible = usable.filter((record) => {
        const maximumActivation = Math.max(...record.vectors.activation);
        const activationRms = Math.sqrt(record.vectors.activation.reduce((sum, value) => sum + value * value, 0) / EXPECTED_MUSCLE_COUNT);
        return maximumActivation <= SELECTION_FILTERS.maximumActivation
            && activationRms <= SELECTION_FILTERS.maximumActivationRms
            && record.quality.capacityLimited !== true;
    });
    if (eligible.length < PANEL_TARGET_COUNT) {
        throw new Error(`Only ${eligible.length} candidates passed the selection gates; at least ${PANEL_TARGET_COUNT} are required.`);
    }
    const { activationScales, proximalIndices, featured } = featuresForAtlas(eligible, coordinateMetadata);
    const featureById = new Map(featured.map((item) => [item.record.id, item]));
    const selected = BASE_PANEL_SOURCE_IDS.map((id) => featureById.get(id));
    if (selected.some((item) => !item)) throw new Error('A reviewed V2 base-panel candidate did not pass the current selection gates.');
    const selectedIds = new Set(BASE_PANEL_SOURCE_IDS);
    const trace = selected.map((item, index) => ({
        id: item.record.id,
        selectionOrder: index + 1,
        score: null,
        nearestDistances: null,
        source: 'reviewed-v2-base-panel'
    }));

    while (selected.length < PANEL_TARGET_COUNT) {
        const pool = featured.filter((candidate) => {
            if (selectedIds.has(candidate.record.id)) return false;
            const distances = distancesToSelection(candidate, selected);
            return distances.rawActivation >= SELECTION_FILTERS.minimumRawActivationRms
                && distances.fullPose >= SELECTION_FILTERS.minimumFullPoseRms
                && distances.proximalPose >= SELECTION_FILTERS.minimumProximalPoseRms;
        });
        if (!pool.length) break;

        let best = null;
        for (const candidate of pool) {
            const nearestDistances = distancesToSelection(candidate, selected);
            const score = combinedScore(nearestDistances);
            if (!best || score > best.score + 1e-12
                || (Math.abs(score - best.score) <= 1e-12 && candidate.record.id < best.candidate.record.id)) {
                best = { candidate, nearestDistances, score };
            }
        }
        selected.push(best.candidate);
        selectedIds.add(best.candidate.record.id);
        trace.push({
            id: best.candidate.record.id,
            selectionOrder: selected.length,
            score: round(best.score),
            nearestDistances: Object.fromEntries(Object.entries(best.nearestDistances).map(([key, value]) => [key, round(value)]))
        });
    }
    if (selected.length !== PANEL_TARGET_COUNT) {
        throw new Error(`The selector produced ${selected.length} positions instead of ${PANEL_TARGET_COUNT}.`);
    }

    const selectedTierCounts = selected.reduce((counts, item) => {
        counts[item.record.tier] = (counts[item.record.tier] || 0) + 1;
        return counts;
    }, {});

    const dominantMuscles = (record) => record.vectors.activation
        .map((activation, index) => ({
            index,
            name: muscleMetadata[index].name,
            actuatorId: muscleMetadata[index].actuatorId,
            activation,
            activeForceN: record.vectors.activeForceN[index]
        }))
        .sort((left, right) => right.activation - left.activation || left.index - right.index)
        .slice(0, 8);

    return {
        objective: {
            algorithm: 'reviewed-base-plus-constrained-deterministic-weighted-maximin-v2.1',
            weights: OBJECTIVE_WEIGHTS,
            activationPattern: 'RMS distance after per-muscle 95th-percentile scaling (minimum scale 0.02; capped at 1.5).',
            fullPose: 'RMS distance across all seven coordinates normalized to authored ranges.',
            proximalPose: `RMS distance across ${proximalIndices.map((index) => coordinateMetadata[index].name).join(', ')}.`,
            hardSelectionFilters: SELECTION_FILTERS,
            basePanelSourceIds: BASE_PANEL_SOURCE_IDS,
            stoppingRule: 'Five supplemental positions are retained. A sixth adds less than one percent effective-rank improvement and no robust-rank improvement.'
        },
        activationScaleByMuscle: activationScales.map((value, index) => ({
            index,
            name: muscleMetadata[index].name,
            actuatorId: muscleMetadata[index].actuatorId,
            percentile95Activation: round(value)
        })),
        selectedTierCounts,
        selectedPositions: selected.map((item, index) => ({
            selectionOrder: index + 1,
            id: item.record.id,
            tier: item.record.tier,
            coordinates: item.record.coordinates,
            maximumActivation: round(Math.max(...item.record.vectors.activation)),
            activationRms: round(Math.sqrt(item.record.vectors.activation.reduce((sum, value) => sum + value * value, 0) / EXPECTED_MUSCLE_COUNT)),
            dominantMuscles: dominantMuscles(item.record),
            selection: trace[index]
        })),
        panelDiversity: {
            activationPattern: pairwiseStats(selected.map((item) => item.activationPattern)),
            fullPose: pairwiseStats(selected.map((item) => item.fullPose)),
            proximalPose: pairwiseStats(selected.map((item) => item.proximalPose))
        }
    };
}

function rangeEvidence(region, allocations) {
    return TIER_DEFINITIONS.map((tier, tierIndex) => ({
        id: tier.id,
        travelFractionFromAuthoredDefault: tier.travelFraction,
        candidateCount: allocations[tierIndex],
        rangesDegrees: Object.fromEntries(region.coordinates.map((coordinate) => [coordinate.name, coordinateRange(coordinate, tier.travelFraction)]))
    }));
}

function failureHistogram(failures) {
    const histogram = {};
    for (const failure of failures) histogram[failure.status] = (histogram[failure.status] || 0) + 1;
    return histogram;
}

function displaySummary(result) {
    const diversity = result.selection.panelDiversity;
    const tiers = Object.entries(result.selection.selectedTierCounts).map(([name, count]) => `${name}=${count}`).join(', ');
    summaryElement.textContent = [
        `Status: ${result.run.status}`,
        `Evaluated: ${result.run.evaluatedCandidateCount}/${result.search.candidateCount}`,
        `Usable: ${result.run.usableCandidateCount}; rejected/error: ${result.run.failedCandidateCount}`,
        `Selected: ${result.selection.selectedPositions.length} (${tiers})`,
        `Minimum pair distances — activation ${diversity.activationPattern.minimum}, full pose ${diversity.fullPose.minimum}, proximal ${diversity.proximalPose.minimum}`,
        `JSON: ${resultElement.value.length.toLocaleString()} characters`,
        'Experimental generic-model output only—not diagnostic evidence.'
    ].join('\n');
}

function setProgress(done, total, usable, failures, message = '') {
    progressBar.max = total;
    progressBar.value = done;
    progressText.textContent = message || `Evaluated ${done}/${total} · usable ${usable} · rejected/error ${failures}`;
}

function setRunning(value) {
    running = value;
    runButton.disabled = value;
    countInput.disabled = value;
    stopButton.disabled = !value;
    copyButton.disabled = value || !resultElement.value;
    downloadButton.disabled = value || !resultElement.value;
}

async function yieldToPage() {
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function runSearch() {
    if (running) return;
    const candidateCount = Number(countInput.value);
    if (![384, 512, 768].includes(candidateCount)) throw new Error('Unsupported candidate count.');
    stopRequested = false;
    resultElement.value = '';
    summaryElement.textContent = 'Initializing the pinned current-model worker…';
    setRunning(true);
    setProgress(0, candidateCount, 0, 0, 'Initializing the pinned current-model worker…');
    engine = new MsHumanEngine({ workerName: 'ms-human-experimental-assessment-search' });

    try {
        const metadata = await engine.initialize();
        const region = validateRegion(metadata);
        const modelIdentity = readModelIdentity(metadata);
        const candidates = buildCandidates(region.coordinates, candidateCount);
        const allocations = tierCounts(candidateCount);
        const usable = [];
        const failures = [];
        const roundTripDurations = [];

        for (let index = 0; index < candidates.length; index += 1) {
            if (stopRequested) break;
            const candidate = candidates[index];
            const started = performance.now();
            let state = null;
            let error = null;
            try {
                state = await engine.staticHold(candidate.coordinates, undefined, REGION_ID);
            } catch (caught) {
                error = caught;
            }
            const durationMs = performance.now() - started;
            roundTripDurations.push(durationMs);
            if (!error && validateState(state, region)) usable.push(extractUsable(candidate, state, durationMs));
            else failures.push(failedRecord(candidate, state, error, durationMs));
            setProgress(index + 1, candidateCount, usable.length, failures.length);
            if ((index + 1) % 3 === 0) await yieldToPage();
        }

        const status = stopRequested ? 'stopped-before-completion' : 'complete';
        if (stopRequested) throw new Error(`Search stopped after ${usable.length + failures.length} candidates; no partial panel was selected.`);
        const selection = selectPanel(usable, region.coordinates, region.muscles);
        const result = {
            schemaVersion: 1,
            classification: 'experimental-generic-model-search-not-diagnostic',
            interpretationBoundary: 'This atlas and selected panel are generic static model outputs. They are not patient measurements, evidence of pain or injury, a diagnosis, a movement prescription, or clinical validation.',
            model: {
                ...modelIdentity,
                regionId: REGION_ID,
                regionDigest: region.digest,
                solverConfigId: region.solverConfig.id,
                solverConfigDigest: region.solverConfig.digest
            },
            search: {
                algorithm: 'seven-dimensional-Halton-moderate-envelope-v1',
                deterministic: true,
                candidateCount,
                neutralIncluded: true,
                coordinateRoundingDegrees: 10 ** -ROUND_COORDINATE_DIGITS,
                haltonBases: HALTON_BASES,
                coordinateOrder: region.coordinates.map((coordinate) => coordinate.name),
                authoredRangesDegrees: Object.fromEntries(region.coordinates.map((coordinate) => [coordinate.name, {
                    minimumDegrees: coordinate.minimumDegrees ?? coordinate.minimum,
                    maximumDegrees: coordinate.maximumDegrees ?? coordinate.maximum,
                    defaultDegrees: coordinate.defaultDegrees ?? coordinate.default
                }])),
                tiers: rangeEvidence(region, allocations)
            },
            muscles: region.muscles.map((muscle, index) => ({
                index,
                id: muscle.id,
                actuatorId: muscle.actuatorId,
                name: muscle.name,
                group: muscle.group
            })),
            run: {
                status,
                evaluatedCandidateCount: usable.length + failures.length,
                usableCandidateCount: usable.length,
                failedCandidateCount: failures.length,
                usableFraction: round(usable.length / candidateCount),
                failureStatusHistogram: failureHistogram(failures),
                observedRoundTripMs: {
                    median: round(quantile(roundTripDurations, 0.5), 4),
                    percentile95: round(quantile(roundTripDurations, 0.95), 4),
                    total: round(roundTripDurations.reduce((sum, value) => sum + value, 0), 4)
                }
            },
            selection,
            usableCandidates: usable,
            failedCandidates: failures
        };
        resultElement.value = JSON.stringify(result);
        displaySummary(result);
        setProgress(candidateCount, candidateCount, usable.length, failures.length, `Complete · ${usable.length}/${candidateCount} usable · ${PANEL_TARGET_COUNT} positions selected`);
    } catch (error) {
        summaryElement.textContent = `Search did not produce a panel.\n${error.message}\n\nNo existing application file was changed.`;
        progressText.textContent = error.message;
        console.error(error);
    } finally {
        if (engine) await engine.dispose();
        engine = null;
        setRunning(false);
    }
}

runButton.addEventListener('click', () => runSearch());
stopButton.addEventListener('click', () => {
    stopRequested = true;
    stopButton.disabled = true;
    progressText.textContent = 'Stop requested; waiting for the current exact solve to finish…';
});
copyButton.addEventListener('click', async () => {
    await navigator.clipboard.writeText(resultElement.value);
    progressText.textContent = 'Result JSON copied.';
});
downloadButton.addEventListener('click', () => {
    const blob = new Blob([resultElement.value], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ms-human-experimental-assessment-search-${countInput.value}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
});
window.addEventListener('beforeunload', () => {
    stopRequested = true;
    engine?.dispose();
});

const parameters = new URLSearchParams(location.search);
if (['384', '512', '768'].includes(parameters.get('count'))) countInput.value = parameters.get('count');
if (parameters.get('autorun') === '1') runSearch();
