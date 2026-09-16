import { MsHumanEngine } from '../../public/ms-human-engine.js';
import { DEFAULT_REGIONAL_ASSESSMENT_REGION, REGIONAL_ASSESSMENT_CONFIGS, regionalAssessmentConfig, workerUrlForProfile } from './regional-assessment-config.js';
import { buildCandidates, quantile, round, selectPanel, validateRegion, validateState } from './regional-assessment-core.js';

const byId = (id) => document.getElementById(id);
const regionInput = byId('assessment-search-region');
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

function readModelIdentity(metadata) {
    const identity = metadata.identity ?? {};
    const model = metadata.model ?? {};
    const result = {
        modelId: identity.modelId ?? model.id ?? metadata.modelId ?? null,
        modelDigest: identity.modelDigest ?? identity.sourceTreeSha256 ?? model.digest ?? metadata.modelDigest ?? null,
        runtimeModelSha256: identity.runtimeModelSha256 ?? model.runtimeModelSha256 ?? null,
        sourceCommit: identity.sourceCommit ?? model.sourceCommit ?? null,
        runtimeVersion: identity.runtimeVersion ?? metadata.runtimeVersion ?? null
    };
    if (!result.modelId || !result.modelDigest || !result.runtimeModelSha256) throw new Error('Engine metadata lacks a complete pinned model identity.');
    return result;
}

function extractUsable(candidate, state, durationMs) {
    const quality = state.staticHolding.quality;
    return {
        ...candidate,
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

function failedRecord(candidate, state, error, durationMs, expectedCount) {
    return {
        id: candidate.id, ordinal: candidate.ordinal, tier: candidate.tier, source: candidate.source,
        coordinates: candidate.coordinates,
        status: state?.staticHolding?.quality?.status || error?.code || error?.name || 'invalid-result',
        reason: state?.staticHolding?.quality?.reason || error?.message || `Result did not contain ${expectedCount} finite activation and active-force values.`,
        observedRoundTripMs: round(durationMs, 4)
    };
}

function histogram(records, key) {
    return records.reduce((result, item) => { const value = item[key] || 'unknown'; result[value] = (result[value] || 0) + 1; return result; }, {});
}

function setProgress(done, total, usable, failures, message = '') {
    progressBar.max = total;
    progressBar.value = done;
    progressText.textContent = message || `Evaluated ${done}/${total} · usable ${usable} · rejected/error ${failures}`;
}

function setRunning(value) {
    running = value;
    regionInput.disabled = value;
    countInput.disabled = value;
    runButton.disabled = value;
    stopButton.disabled = !value;
    copyButton.disabled = value || !resultElement.value;
    downloadButton.disabled = value || !resultElement.value;
}

function syncCount() {
    const config = regionalAssessmentConfig(regionInput.value);
    countInput.value = String(config.candidateCount);
    summaryElement.textContent = `${config.regionId}: ${config.boundary}\nConfigured deterministic atlas: ${config.candidateCount} candidates.`;
}

async function yieldToPage() { await new Promise((resolve) => requestAnimationFrame(resolve)); }

function displaySummary(result) {
    const selection = result.selection;
    summaryElement.textContent = [
        `${result.model.regionId} · ${result.model.profileId}`,
        `Evaluated ${result.run.evaluatedCandidateCount}; usable ${result.run.usableCandidateCount}; rejected/error ${result.run.failedCandidateCount}`,
        `Selected ${selection.selectedPositions.length} activation-diverse positions by empirical rank stopping.`,
        `Activation rank: effective ${selection.rankEvidence.effectiveRank}; robust ${selection.rankEvidence.robustRank}.`,
        `Actuator paths responsive in sampled poses: ${selection.responseDiversity.responsiveInSampledPosesCount}/${selection.responseDiversity.sampledMuscleCount} changed by at least ${selection.responseDiversity.responseRangeThreshold}.`,
        `Minimum pair distances: activation ${selection.panelDiversity.activationPattern.minimum}; full pose ${selection.panelDiversity.fullPose.minimum}; major pose ${selection.panelDiversity.majorPose.minimum}.`,
        result.interpretationBoundary,
        result.model.unloadedOpenChain
    ].join('\n');
}

export async function runSearch() {
    if (running) return null;
    const config = regionalAssessmentConfig(regionInput.value);
    const candidateCount = Number(countInput.value);
    if (!Number.isInteger(candidateCount) || candidateCount < 64 || candidateCount > 4096) throw new Error('Candidate count must be an integer from 64 to 4096.');
    stopRequested = false;
    resultElement.value = '';
    window.__assessmentSearchResult = null;
    window.__assessmentSearchError = null;
    setRunning(true);
    setProgress(0, candidateCount, 0, 0, `Initializing ${config.profileId} model profile…`);
    engine = new MsHumanEngine({ workerName: `ms-human-${config.key}-assessment-search`, workerUrl: workerUrlForProfile(config.profileId) });
    try {
        const metadata = await engine.initialize();
        const region = validateRegion(metadata, config);
        const candidates = buildCandidates(region, config, candidateCount);
        const usable = [];
        const failures = [];
        const durations = [];
        for (let index = 0; index < candidates.length; index += 1) {
            if (stopRequested) throw new Error(`Search stopped after ${index} exact static solves; partial output was not retained.`);
            const candidate = candidates[index];
            const started = performance.now();
            let state = null; let error = null;
            try { state = await engine.staticHold(candidate.coordinates, undefined, config.regionId); }
            catch (caught) { error = caught; }
            const duration = performance.now() - started;
            durations.push(duration);
            if (!error && validateState(state, region, config.regionId)) usable.push(extractUsable(candidate, state, duration));
            else failures.push(failedRecord(candidate, state, error, duration, region.muscles.length));
            setProgress(index + 1, candidates.length, usable.length, failures.length);
            if ((index + 1) % 4 === 0) await yieldToPage();
        }
        const selection = selectPanel(usable, region, config);
        const result = {
            schemaVersion: 2,
            classification: 'experimental-generic-model-regional-search-not-diagnostic',
            interpretationBoundary: 'Generic static model design evidence only—not a patient measurement, proof of muscle isolation, pain or injury evidence, safety clearance, diagnosis, treatment recommendation, or clinical validation.',
            model: {
                ...readModelIdentity(metadata), profileId: config.profileId, regionId: config.regionId,
                regionDigest: region.digest, solverConfigId: region.solverConfig.id, solverConfigDigest: region.solverConfig.digest,
                unloadedOpenChain: config.boundary, dynamicMotion: false, externalLoads: false, patientSpecific: false
            },
            search: {
                algorithm: `${region.coordinates.length}-dimensional-Halton-plus-authored-presets-and-axis-boundaries-v2`,
                deterministic: true, candidateCount, coordinateRoundingDegrees: 0.1,
                coordinateOrder: region.coordinates.map((coordinate) => coordinate.name),
                authoredRangesDegrees: Object.fromEntries(region.coordinates.map((coordinate) => [coordinate.name, { minimumDegrees: coordinate.minimumDegrees, maximumDegrees: coordinate.maximumDegrees, defaultDegrees: coordinate.defaultDegrees }])),
                tiers: config.tiers, samplingSources: histogram(candidates, 'source')
            },
            muscles: region.muscles.map((muscle, index) => ({ index, id: muscle.id, actuatorId: muscle.actuatorId, name: muscle.name, group: muscle.group })),
            run: {
                status: 'complete', evaluatedCandidateCount: candidates.length, usableCandidateCount: usable.length, failedCandidateCount: failures.length,
                usableFraction: round(usable.length / candidates.length), failureStatusHistogram: histogram(failures, 'status'),
                observedRoundTripMs: { median: round(quantile(durations, .5), 4), percentile95: round(quantile(durations, .95), 4), total: round(durations.reduce((sum, value) => sum + value, 0), 4) }
            },
            selection, usableCandidates: usable, failedCandidates: failures
        };
        resultElement.value = JSON.stringify(result);
        window.__assessmentSearchResult = result;
        displaySummary(result);
        setProgress(candidateCount, candidateCount, usable.length, failures.length, `Complete · ${selection.selectedPositions.length} positions selected`);
        window.dispatchEvent(new CustomEvent('assessment-search-complete', { detail: result }));
        return result;
    } catch (error) {
        window.__assessmentSearchError = String(error?.stack || error);
        summaryElement.textContent = `Search did not produce an evidence artifact.\n${error.message}`;
        progressText.textContent = error.message;
        console.error(error);
        throw error;
    } finally {
        if (engine) await engine.dispose();
        engine = null;
        setRunning(false);
    }
}

for (const config of Object.values(REGIONAL_ASSESSMENT_CONFIGS)) {
    const option = document.createElement('option');
    option.value = config.regionId;
    option.textContent = `${config.regionId} (${config.profileId})`;
    regionInput.append(option);
}
regionInput.addEventListener('change', syncCount);
runButton.addEventListener('click', () => runSearch().catch(() => {}));
stopButton.addEventListener('click', () => { stopRequested = true; stopButton.disabled = true; });
copyButton.addEventListener('click', async () => navigator.clipboard.writeText(resultElement.value));
downloadButton.addEventListener('click', () => {
    const blob = new Blob([resultElement.value], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ms-human-${regionInput.value}-assessment-atlas-${countInput.value}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
});
window.addEventListener('beforeunload', () => { stopRequested = true; engine?.dispose(); });

const parameters = new URLSearchParams(location.search);
const requestedRegion = parameters.get('region') || DEFAULT_REGIONAL_ASSESSMENT_REGION;
regionInput.value = REGIONAL_ASSESSMENT_CONFIGS[requestedRegion] ? requestedRegion : DEFAULT_REGIONAL_ASSESSMENT_REGION;
syncCount();
if (parameters.has('count')) countInput.value = parameters.get('count');
window.__assessmentSearchReady = true;
if (parameters.get('autorun') === '1') runSearch().catch(() => {});
