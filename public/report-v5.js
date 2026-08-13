const REPORT_SCHEMA = 'waajacu-medical-biomechanical-assessment';
export const REPORT_SCHEMA_VERSION = 5;

const CONTROL_FLOOR = 0.01;
const MODEL_ONLY_PREFIX = 'D';
const SHOULDER_MUSCLES = new Set([
    'DELT1', 'DELT2', 'DELT3', 'SUPSP', 'INFSP', 'SUBSC', 'TMIN', 'TMAJ',
    'PECM1', 'PECM2', 'PECM3', 'LAT1', 'LAT2', 'LAT3', 'CORB', 'BIClong',
    'BICshort', 'TRIlong'
]);

const MATCHED_COMPARISON_DEFINITIONS = Object.freeze([
    { id: 'plane_30_forward_vs_diagonal', name: 'Forward vs diagonal elevation at 30 degrees', trialIds: ['M4', 'M7'], controlledVariables: ['shoulder elevation 30 degrees', 'elbow flexion 90 degrees', 'gravity-only reference'], changedVariable: 'elevation_plane' },
    { id: 'plane_30_diagonal_vs_lateral', name: 'Diagonal vs lateral elevation at 30 degrees', trialIds: ['M7', 'M10'], controlledVariables: ['shoulder elevation 30 degrees', 'elbow flexion 90 degrees', 'gravity-only reference'], changedVariable: 'elevation_plane' },
    { id: 'plane_45_forward_vs_diagonal', name: 'Forward vs diagonal elevation at 45 degrees', trialIds: ['M5', 'M8'], controlledVariables: ['shoulder elevation 45 degrees', 'elbow flexion 90 degrees', 'gravity-only reference'], changedVariable: 'elevation_plane' },
    { id: 'plane_45_diagonal_vs_lateral', name: 'Diagonal vs lateral elevation at 45 degrees', trialIds: ['M8', 'M11'], controlledVariables: ['shoulder elevation 45 degrees', 'elbow flexion 90 degrees', 'gravity-only reference'], changedVariable: 'elevation_plane' },
    { id: 'plane_60_forward_vs_diagonal', name: 'Forward vs diagonal elevation at 60 degrees', trialIds: ['M6', 'M9'], controlledVariables: ['shoulder elevation 60 degrees', 'elbow flexion 90 degrees', 'gravity-only reference'], changedVariable: 'elevation_plane' },
    { id: 'plane_60_diagonal_vs_lateral', name: 'Diagonal vs lateral elevation at 60 degrees', trialIds: ['M9', 'M12'], controlledVariables: ['shoulder elevation 60 degrees', 'elbow flexion 90 degrees', 'gravity-only reference'], changedVariable: 'elevation_plane' },
    { id: 'forward_elevation_30_vs_45', name: 'Forward elevation 30 vs 45 degrees', trialIds: ['M4', 'M5'], controlledVariables: ['forward plane', 'elbow flexion 90 degrees', 'gravity-only reference'], changedVariable: 'shoulder_elevation' },
    { id: 'forward_elevation_45_vs_60', name: 'Forward elevation 45 vs 60 degrees', trialIds: ['M5', 'M6'], controlledVariables: ['forward plane', 'elbow flexion 90 degrees', 'gravity-only reference'], changedVariable: 'shoulder_elevation' },
    { id: 'diagonal_elevation_30_vs_45', name: 'Diagonal elevation 30 vs 45 degrees', trialIds: ['M7', 'M8'], controlledVariables: ['diagonal plane', 'elbow flexion 90 degrees', 'gravity-only reference'], changedVariable: 'shoulder_elevation' },
    { id: 'diagonal_elevation_45_vs_60', name: 'Diagonal elevation 45 vs 60 degrees', trialIds: ['M8', 'M9'], controlledVariables: ['diagonal plane', 'elbow flexion 90 degrees', 'gravity-only reference'], changedVariable: 'shoulder_elevation' },
    { id: 'lateral_elevation_30_vs_45', name: 'Lateral elevation 30 vs 45 degrees', trialIds: ['M10', 'M11'], controlledVariables: ['lateral plane', 'elbow flexion 90 degrees', 'gravity-only reference'], changedVariable: 'shoulder_elevation' },
    { id: 'lateral_elevation_45_vs_60', name: 'Lateral elevation 45 vs 60 degrees', trialIds: ['M11', 'M12'], controlledVariables: ['lateral plane', 'elbow flexion 90 degrees', 'gravity-only reference'], changedVariable: 'shoulder_elevation' },
    { id: 'internal_vs_external_rotation_20', name: 'Internal vs external rotation at 20 degrees', trialIds: ['M13', 'M15'], controlledVariables: ['shoulder elevation 15 degrees', 'elbow flexion 90 degrees', 'gravity-only reference'], changedVariable: 'shoulder_rotation_direction' },
    { id: 'internal_vs_external_rotation_40', name: 'Internal vs external rotation at 40 degrees', trialIds: ['M14', 'M16'], controlledVariables: ['shoulder elevation 15 degrees', 'elbow flexion 90 degrees', 'gravity-only reference'], changedVariable: 'shoulder_rotation_direction' },
    { id: 'forearm_supination_vs_pronation', name: 'Forearm supination vs pronation at 45 degrees', trialIds: ['M17', 'M18'], controlledVariables: ['shoulder neutral', 'elbow flexion 90 degrees', 'gravity-only reference'], changedVariable: 'forearm_rotation_direction' }
]);

function finiteOrNull(value) {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function mean(values) {
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function publicIntake(intake = {}) {
    return {
        ageYears: finiteOrNull(intake.ageYears),
        gender: intake.gender || null,
        heightCm: finiteOrNull(intake.heightCm),
        weightKg: finiteOrNull(intake.weightKg),
        dominantSide: intake.dominantSide || null,
        assessedSide: intake.assessedArm || intake.assessedSide || null,
        symptomDuration: intake.painDuration || intake.symptomDuration || null,
        symptomOnset: intake.painOnset || intake.symptomOnset || null,
        painNow: finiteOrNull(intake.painNow),
        painWorst: finiteOrNull(intake.painWorst),
        primaryPainLocation: intake.primaryPainLocation || null,
        restPain: typeof intake.painAtRest === 'boolean' ? intake.painAtRest : null,
        nightPain: typeof intake.nightPain === 'boolean' ? intake.nightPain : null,
        radiatingPain: typeof intake.radiatingPain === 'boolean' ? intake.radiatingPain : null,
        clickingOrInstability: typeof intake.clickingInstability === 'boolean' ? intake.clickingInstability : null,
        identifiersExcluded: ['name', 'email', 'city'],
        freeTextExcluded: ['onsetDetails', 'aggravatingOrRelievingFactors', 'relevantHistory']
    };
}

function mapLegacyCompletion(raw) {
    if (['not_recorded', 'full', 'partial', 'unable', 'stopped', 'skipped'].includes(raw?.completion)) return raw.completion;
    if (!raw?.answered && (!raw?.result || raw.result === 'not_tested')) return 'not_recorded';
    return ({
        able: 'full',
        pain_limited: 'stopped',
        unable: 'unable',
        uncertain: 'stopped',
        not_tested: 'skipped'
    })[raw?.result] ?? 'not_recorded';
}

function symptomState(value, score, legacyPositive) {
    if (value === 'yes') return 'positive';
    if (value === 'no') return 'recorded_zero';
    if (value === 'not_recorded') return 'not_recorded';
    if (legacyPositive) return 'positive';
    // A numeric value from a legacy report is evidence only when it is positive.
    // A legacy zero is not accepted as an explicit negative answer.
    return Number.isFinite(score) && score > 0 ? 'positive' : 'not_recorded';
}

function normalizeObservation(raw = {}, executionMode = 'person_attempted', migratedFromVersion = null) {
    if (executionMode === 'model_only') {
        return {
            attempted: false,
            answered: false,
            completion: 'not_recorded',
            limitingFactors: [],
            pain: { state: 'not_recorded', score: null, locations: [], quality: [], familiar: 'not_recorded', onsetAngleDegrees: null, phase: null },
            weakness: { state: 'not_recorded', score: null },
            compensation: { state: 'not_recorded', details: [] },
            stiffness: { state: 'not_recorded' },
            repeatable: 'not_recorded',
            notes: null,
            excludedReason: 'Model-only research posture; no person observation is represented.'
        };
    }

    const completion = mapLegacyCompletion(raw);
    const painScore = finiteOrNull(raw.painScore ?? raw.peakScore);
    const weaknessScore = finiteOrNull(raw.weaknessScore ?? raw.perceivedWeaknessScore);
    const legacyPainPositive = raw.result === 'pain_limited';
    // Legacy "unable" did not distinguish pain, weakness, stiffness, fear, or
    // another limitation, so it cannot be migrated as a weakness observation.
    const legacyWeaknessPositive = false;
    const painState = symptomState(raw.pain, painScore, legacyPainPositive);
    const weaknessState = symptomState(raw.weakness, weaknessScore, legacyWeaknessPositive);
    const stiffnessState = raw.stiffness === 'yes' ? 'positive'
        : raw.stiffness === 'no' ? 'recorded_zero' : 'not_recorded';
    const compensationState = raw.compensation === 'yes' ? 'positive'
        : raw.compensation === 'no' ? 'recorded_zero'
            : raw.compensation === 'uncertain' ? 'uncertain' : 'not_recorded';
    const limitingFactors = [];
    if (painState === 'positive') limitingFactors.push('pain');
    if (weaknessState === 'positive') limitingFactors.push('weakness');
    if (raw.stiffness === 'yes') limitingFactors.push('stiffness');
    if (Array.isArray(raw.limitingFactors)) {
        for (const factor of raw.limitingFactors) if (factor && !limitingFactors.includes(factor)) limitingFactors.push(factor);
    }
    if (raw.limitingFactor && !limitingFactors.includes(raw.limitingFactor)) limitingFactors.push(raw.limitingFactor);
    const painLocations = Array.isArray(raw.painLocations)
        ? raw.painLocations.filter(Boolean)
        : [raw.painLocation ?? raw.location].filter(Boolean);
    const compensationDetails = Array.isArray(raw.compensationDetail)
        ? raw.compensationDetail.filter(Boolean)
        : [raw.compensationDetail].filter(Boolean);
    const attempted = !['not_recorded', 'skipped'].includes(completion);
    const positiveDetailsComplete = (painState !== 'positive' || (Number.isFinite(painScore) && painScore > 0 && painLocations.length > 0))
        && (weaknessState !== 'positive' || (Number.isFinite(weaknessScore) && weaknessScore > 0))
        && (compensationState !== 'positive' || compensationDetails.length > 0);
    const incompleteMovementExplained = !['partial', 'unable', 'stopped'].includes(completion) || limitingFactors.length > 0;
    const answered = completion === 'skipped' || (attempted
        && painState !== 'not_recorded'
        && weaknessState !== 'not_recorded'
        && stiffnessState !== 'not_recorded'
        && compensationState !== 'not_recorded'
        && positiveDetailsComplete
        && incompleteMovementExplained);

    return {
        attempted,
        answered,
        completion,
        limitingFactors,
        pain: {
            state: painState,
            score: painState === 'recorded_zero' ? 0 : painScore,
            locations: painLocations,
            quality: Array.isArray(raw.painQuality) ? raw.painQuality.filter(Boolean) : [],
            familiar: raw.painFamiliar ?? raw.familiar ?? 'not_recorded',
            onsetAngleDegrees: finiteOrNull(raw.painOnsetAngleDegrees ?? raw.onsetAngle),
            phase: raw.painPhase || null
        },
        weakness: { state: weaknessState, score: weaknessState === 'recorded_zero' ? 0 : weaknessScore },
        compensation: {
            state: compensationState,
            details: compensationDetails
        },
        stiffness: { state: stiffnessState },
        achievedPose: raw.achievedPose ?? null,
        repeatable: raw.repeatable ?? 'not_recorded',
        notes: raw.notes || null,
        provenance: migratedFromVersion ? { migratedFromReportVersion: migratedFromVersion, conservativeUnknownPreservation: true } : undefined
    };
}

function normalizeMuscles(modelEstimate = {}) {
    return (modelEstimate.muscles ?? []).map((muscle) => {
        const control = finiteOrNull(muscle.predictedModelControl ?? muscle.activation);
        const activeForce = finiteOrNull(muscle.predictedGenericActiveForceN ?? muscle.activeActuatorForceN);
        return {
            name: muscle.name,
            predictedModelControl: control,
            predictedModelControlAboveFloor: Number.isFinite(control) ? Math.max(0, control - CONTROL_FLOOR) : null,
            predictedGenericActiveForceN: activeForce
        };
    }).filter((muscle) => muscle.name && Number.isFinite(muscle.predictedModelControl));
}

function compactModelReference(modelEstimate, targetPose, model = {}) {
    if (!modelEstimate?.available) {
        return {
            available: false,
            referenceOnly: true,
            subjectSpecificEstimate: false,
            notComputableReason: modelEstimate?.reason || 'Validated static reference not available.'
        };
    }
    const muscles = normalizeMuscles(modelEstimate);
    const shoulder = muscles.filter((muscle) => SHOULDER_MUSCLES.has(muscle.name));
    const relevant = shoulder.sort((a, b) => b.predictedModelControl - a.predictedModelControl).slice(0, 8);
    const outlier = [...muscles].filter((muscle) => !SHOULDER_MUSCLES.has(muscle.name)).sort((a, b) => b.predictedModelControl - a.predictedModelControl)[0];
    return {
        available: muscles.length > 0,
        source: modelEstimate.source || 'trial-specific-static-reference',
        sourceSampleId: modelEstimate.sourceSampleId || null,
        referenceOnly: true,
        subjectSpecificEstimate: false,
        targetPoseUsed: targetPose,
        achievedPoseUsed: null,
        externalLoadsUsed: [],
        analysisType: 'static_optimization',
        solverConfigurationId: model.solverConfigurationId ?? null,
        modelVersion: model.id ?? null,
        topRelevantPredictedControls: relevant,
        unexpectedOutlier: outlier ?? null,
        quality: {
            converged: true,
            maximumReserveTorqueNm: finiteOrNull(modelEstimate.maximumReserveTorqueNm),
            reservePercentageOfRequiredMoment: null,
            poseConstraintError: null,
            actualVsTargetPoseError: null,
            warnings: ['Packaged generic reference posture; not a simulation of the observed person.']
        }
    };
}

function technicalModelRecord(trialId, modelEstimate, targetPose, model = {}) {
    const muscles = normalizeMuscles(modelEstimate);
    return {
        trialId,
        available: Boolean(modelEstimate?.available && muscles.length),
        provenance: {
            source: modelEstimate?.source || null,
            sourceSampleId: modelEstimate?.sourceSampleId || null,
            referenceOnly: true,
            subjectScaled: false,
            targetPoseUsed: targetPose,
            achievedPoseUsed: null,
            externalLoadsUsed: [],
            analysisType: 'static_optimization',
            solverConfigurationId: model.solverConfigurationId ?? null,
            modelVersion: model.id ?? null,
            modelSource: model.source ?? null,
            appCommit: model.appCommit ?? null
        },
        solver: {
            converged: Boolean(modelEstimate?.available),
            durationMs: finiteOrNull(modelEstimate?.solverDurationMs),
            maximumReserveTorqueNm: finiteOrNull(modelEstimate?.maximumReserveTorqueNm),
            reservePercentageOfRequiredMoment: null,
            objectiveValue: null,
            poseConstraintError: null,
            actualVsTargetPoseError: null
        },
        controlFloor: CONTROL_FLOOR,
        forceDefinition: 'Generic-model active actuator force only; passive fiber force and external loads are excluded.',
        muscles
    };
}

function canonicalTrial(record, model, migratedFromVersion = null) {
    const modelOnly = record.executionMode === 'model_only' || String(record.id).startsWith(MODEL_ONLY_PREFIX);
    const executionMode = modelOnly ? 'model_only' : (record.executionMode || 'person_attempted');
    const raw = record.rawObservation ?? record.response ?? record.observation ?? {};
    const targetPose = { ...record.coordinatesDegrees ?? record.targetPose ?? record.coordinates ?? {} };
    const observation = normalizeObservation(raw, executionMode, migratedFromVersion);
    return {
        id: record.id,
        sequence: modelOnly ? null : finiteOrNull(record.sequence),
        protocolSection: modelOnly ? 'research_model_discrimination' : 'human_matched_postures',
        executionMode,
        includeInHumanProtocol: !modelOnly,
        includeInSymptomAssociation: !modelOnly,
        name: record.name,
        instruction: modelOnly ? 'Computational research posture. Do not present as a person attempt.' : record.instruction,
        targetPose: { coordinatesDegrees: targetPose, source: 'protocol_definition' },
        achievedPose: observation.achievedPose
            ? { coordinatesDegrees: observation.achievedPose, source: 'manual_entry' }
            : { coordinatesDegrees: null, source: 'not_measured' },
        observation,
        load: {
            type: 'gravity_only',
            externalForceN: 0,
            applicationPoint: null,
            supportForceN: null,
            measured: false
        },
        protocol: {
            speed: 'not_recorded',
            holdDurationSeconds: null,
            repetitionNumber: null,
            restIntervalSeconds: null
        },
        modelReference: compactModelReference(record.modelEstimate, targetPose, model)
    };
}

function observationWarnings(trial) {
    if (!trial.includeInHumanProtocol) return [];
    const warnings = [];
    const observation = trial.observation;
    if (observation.pain.state === 'recorded_zero' && Number.isFinite(observation.pain.score) && observation.pain.score !== 0) {
        warnings.push({ code: 'pain_state_score_conflict', trialId: trial.id, message: 'Pain was marked no but the score is greater than zero.' });
    }
    if (observation.pain.state === 'not_recorded' && Number.isFinite(observation.pain.score)) {
        warnings.push({ code: 'pain_unanswered_with_score', trialId: trial.id, message: 'A pain score exists without an explicit yes/no pain answer.' });
    }
    if (observation.weakness.state === 'recorded_zero' && Number.isFinite(observation.weakness.score) && observation.weakness.score !== 0) {
        warnings.push({ code: 'weakness_state_score_conflict', trialId: trial.id, message: 'Weakness was marked no but the score is greater than zero.' });
    }
    if (observation.weakness.state === 'not_recorded' && Number.isFinite(observation.weakness.score)) {
        warnings.push({ code: 'weakness_unanswered_with_score', trialId: trial.id, message: 'A weakness score exists without an explicit yes/no weakness answer.' });
    }
    if (observation.completion === 'skipped' && (observation.pain.state !== 'not_recorded' || observation.weakness.state !== 'not_recorded')) {
        warnings.push({ code: 'skipped_trial_has_symptoms', trialId: trial.id, message: 'A skipped trial also contains symptom answers.' });
    }
    return warnings;
}

function dataQuality(trials, migratedFromVersion = null) {
    const human = trials.filter((trial) => trial.includeInHumanProtocol);
    const attempted = human.filter((trial) => trial.observation.attempted);
    const missingRequiredFields = [];
    for (const trial of human) {
        if (trial.observation.completion === 'not_recorded') {
            missingRequiredFields.push(`${trial.id}.completion`);
            continue;
        }
        if (!trial.observation.attempted) continue;
        if (trial.observation.pain.state === 'not_recorded') missingRequiredFields.push(`${trial.id}.pain`);
        if (trial.observation.pain.state === 'positive' && !(Number.isFinite(trial.observation.pain.score) && trial.observation.pain.score > 0)) missingRequiredFields.push(`${trial.id}.pain.score`);
        if (trial.observation.pain.state === 'positive' && !trial.observation.pain.locations.length) missingRequiredFields.push(`${trial.id}.pain.location`);
        if (trial.observation.weakness.state === 'not_recorded') missingRequiredFields.push(`${trial.id}.weakness`);
        if (trial.observation.weakness.state === 'positive' && !(Number.isFinite(trial.observation.weakness.score) && trial.observation.weakness.score > 0)) missingRequiredFields.push(`${trial.id}.weakness.score`);
        if (trial.observation.stiffness.state === 'not_recorded') missingRequiredFields.push(`${trial.id}.stiffness`);
        if (trial.observation.compensation.state === 'not_recorded') missingRequiredFields.push(`${trial.id}.compensation`);
        if (trial.observation.compensation.state === 'positive' && !trial.observation.compensation.details.length) missingRequiredFields.push(`${trial.id}.compensation.detail`);
        if (['partial', 'unable', 'stopped'].includes(trial.observation.completion) && !trial.observation.limitingFactors.length) {
            missingRequiredFields.push(`${trial.id}.limitingFactor`);
        }
    }
    const warnings = human.flatMap(observationWarnings);
    if (migratedFromVersion) warnings.push({ code: 'legacy_report_migrated', message: `Version ${migratedFromVersion} data was migrated conservatively; absent symptom answers remain not recorded.` });
    const conflict = warnings.some((warning) => warning.code !== 'legacy_report_migrated');
    const interpretabilityStatus = conflict ? 'conflicting'
        : attempted.length === 0 || missingRequiredFields.length > 0 ? 'insufficient_data'
            : 'interpretable';
    return {
        interpretabilityStatus,
        requiredTrialCount: human.length,
        recordedTrialCount: human.filter((trial) => trial.observation.completion !== 'not_recorded').length,
        attemptedTrialCount: attempted.length,
        completedTrialCount: attempted.filter((trial) => ['full', 'partial'].includes(trial.observation.completion)).length,
        skippedTrialCount: human.filter((trial) => trial.observation.completion === 'skipped').length,
        painAnsweredCount: attempted.filter((trial) => trial.observation.pain.state !== 'not_recorded').length,
        weaknessAnsweredCount: attempted.filter((trial) => trial.observation.weakness.state !== 'not_recorded').length,
        stiffnessAnsweredCount: attempted.filter((trial) => trial.observation.stiffness.state !== 'not_recorded').length,
        compensationAnsweredCount: attempted.filter((trial) => trial.observation.compensation.state !== 'not_recorded').length,
        missingRequiredFields,
        warnings
    };
}

function muscleMapByTrial(technicalTrials) {
    return new Map(technicalTrials.map((trial) => [trial.trialId, new Map((trial.muscles ?? []).map((muscle) => [muscle.name, muscle]))]));
}

function demandRanking(trials, technicalTrials) {
    const maps = muscleMapByTrial(technicalTrials);
    const available = trials.filter((trial) => maps.get(trial.id)?.size);
    const names = [...new Set(available.flatMap((trial) => [...maps.get(trial.id).keys()]))];
    return names.map((name) => {
        const values = available.map((trial) => maps.get(trial.id).get(name)).filter(Boolean);
        return {
            name,
            modeledTrialCount: values.length,
            meanPredictedModelControl: mean(values.map((value) => value.predictedModelControl)),
            peakPredictedModelControl: Math.max(...values.map((value) => value.predictedModelControl)),
            meanPredictedGenericActiveForceN: mean(values.map((value) => value.predictedGenericActiveForceN).filter(Number.isFinite))
        };
    }).sort((left, right) => right.meanPredictedModelControl - left.meanPredictedModelControl).slice(0, 10);
}

function symptomRanking(kind, trials, technicalTrials) {
    const maps = muscleMapByTrial(technicalTrials);
    const eligible = trials.filter((trial) => trial.includeInSymptomAssociation && trial.observation.attempted && maps.get(trial.id)?.size);
    const positive = eligible.filter((trial) => trial.observation.answered && trial.observation[kind].state === 'positive');
    const explicitZero = eligible.filter((trial) => trial.observation.answered && trial.observation[kind].state === 'recorded_zero');
    if (!positive.length || !explicitZero.length) {
        const missing = eligible.filter((trial) => !trial.observation.answered || trial.observation[kind].state === 'not_recorded').map((trial) => trial.id);
        const reason = !positive.length && !explicitZero.length
            ? `No explicit positive or zero ${kind} observations were recorded.`
            : !positive.length ? `No positive ${kind} observation was recorded.`
                : `No explicit zero-${kind} comparison observation was recorded.`;
        return { computable: false, notComputableReason: reason, positiveTrialIds: positive.map((trial) => trial.id), explicitZeroTrialIds: explicitZero.map((trial) => trial.id), missingTrialIds: missing, ranking: [] };
    }
    const names = [...maps.get(positive[0].id).keys()];
    const ranking = names.map((name) => {
        const positiveValues = positive.map((trial) => maps.get(trial.id).get(name)?.predictedModelControl).filter(Number.isFinite);
        const zeroValues = explicitZero.map((trial) => maps.get(trial.id).get(name)?.predictedModelControl).filter(Number.isFinite);
        const positiveMean = mean(positiveValues);
        const zeroMean = mean(zeroValues);
        return {
            name,
            positiveMeanPredictedModelControl: positiveMean,
            explicitZeroMeanPredictedModelControl: zeroMean,
            associationContrast: Number.isFinite(positiveMean) && Number.isFinite(zeroMean) ? positiveMean - zeroMean : null,
            supportingTrialIds: positive.map((trial) => trial.id),
            comparisonTrialIds: explicitZero.map((trial) => trial.id)
        };
    }).filter((row) => Number.isFinite(row.associationContrast)).sort((left, right) => right.associationContrast - left.associationContrast).slice(0, 10);
    return { computable: true, notComputableReason: null, positiveTrialIds: positive.map((trial) => trial.id), explicitZeroTrialIds: explicitZero.map((trial) => trial.id), missingTrialIds: [], ranking };
}

function numericSymptomValue(symptom) {
    if (symptom.state === 'recorded_zero') return 0;
    if (symptom.state === 'positive' && Number.isFinite(symptom.score)) return symptom.score;
    return null;
}

function matchedComparisons(trials, technicalTrials) {
    const trialMap = new Map(trials.map((trial) => [trial.id, trial]));
    const modelMaps = muscleMapByTrial(technicalTrials);
    return MATCHED_COMPARISON_DEFINITIONS.map((definition) => {
        const [left, right] = definition.trialIds.map((id) => trialMap.get(id));
        if (!left || !right) return null;
        const leftPain = numericSymptomValue(left.observation.pain);
        const rightPain = numericSymptomValue(right.observation.pain);
        const leftWeakness = numericSymptomValue(left.observation.weakness);
        const rightWeakness = numericSymptomValue(right.observation.weakness);
        const leftMuscles = modelMaps.get(left.id);
        const rightMuscles = modelMaps.get(right.id);
        const modelDelta = [];
        if (leftMuscles && rightMuscles) {
            for (const name of SHOULDER_MUSCLES) {
                const first = leftMuscles.get(name);
                const second = rightMuscles.get(name);
                if (!first || !second) continue;
                modelDelta.push({
                    name,
                    predictedModelControlDelta: second.predictedModelControl - first.predictedModelControl,
                    predictedGenericActiveForceNDelta: Number.isFinite(first.predictedGenericActiveForceN) && Number.isFinite(second.predictedGenericActiveForceN)
                        ? second.predictedGenericActiveForceN - first.predictedGenericActiveForceN : null
                });
            }
        }
        const observationsComplete = left.observation.answered && right.observation.answered;
        const numericSymptomDeltaComplete = Number.isFinite(leftPain) && Number.isFinite(rightPain)
            && Number.isFinite(leftWeakness) && Number.isFinite(rightWeakness);
        return {
            ...definition,
            direction: `${definition.trialIds[1]} minus ${definition.trialIds[0]}`,
            observationsComplete,
            observationDelta: {
                painScore: Number.isFinite(leftPain) && Number.isFinite(rightPain) ? rightPain - leftPain : null,
                weaknessScore: Number.isFinite(leftWeakness) && Number.isFinite(rightWeakness) ? rightWeakness - leftWeakness : null,
                completion: { from: left.observation.completion, to: right.observation.completion },
                stiffness: { from: left.observation.stiffness.state, to: right.observation.stiffness.state },
                compensation: { from: left.observation.compensation.state, to: right.observation.compensation.state },
                notComputableReason: !observationsComplete
                    ? 'Both trials require explicit completion, pain, weakness, stiffness, and compensation observations.'
                    : !numericSymptomDeltaComplete
                        ? 'Pain and weakness score deltas require explicit numeric scores (zero is accepted only after an explicit no answer).'
                        : null
            },
            modelDelta
        };
    }).filter(Boolean);
}

function hypothesisEvidence(associations) {
    const evidence = [];
    for (const [kind, result] of Object.entries(associations)) {
        if (!result.computable) {
            evidence.push({
                hypothesis: `${kind}_linked_model_demand`,
                supportingEvidence: [],
                contradictingEvidence: [],
                unknownBecause: [result.notComputableReason],
                confidence: 'not_computable'
            });
            continue;
        }
        for (const row of result.ranking.slice(0, 5)) {
            evidence.push({
                hypothesis: `${row.name} generic-model demand is associated with recorded ${kind} in this protocol`,
                supportingEvidence: row.supportingTrialIds.map((trialId) => ({ trialId, evidence: `Explicit positive ${kind} observation` })),
                contradictingEvidence: row.comparisonTrialIds.map((trialId) => ({ trialId, evidence: `Explicit zero-${kind} comparison observation` })),
                unknownBecause: ['Association does not identify a painful or impaired tissue.', 'Reference values are generic and not subject-specific.'],
                confidence: 'descriptive_only'
            });
        }
    }
    return evidence;
}

function reportSummary(quality, trials, associations) {
    if (quality.interpretabilityStatus === 'insufficient_data') {
        return {
            status: 'insufficient_data',
            statement: `${quality.recordedTrialCount} reference posture result(s) were recorded, but required symptom or movement-quality observations are missing. No symptom-linked muscle comparison can be calculated.`,
            painAssociatedTrialIds: [],
            weaknessAssociatedTrialIds: []
        };
    }
    if (quality.interpretabilityStatus === 'conflicting') {
        return {
            status: 'conflicting',
            statement: 'Some recorded fields conflict. Resolve the listed data-quality warnings before interpreting symptom-linked comparisons.',
            painAssociatedTrialIds: associations.pain.positiveTrialIds,
            weaknessAssociatedTrialIds: associations.weakness.positiveTrialIds
        };
    }
    return {
        status: 'interpretable',
        statement: 'Required observations are explicit. Any muscle results below describe associations with generic-model posture demand, not a tissue diagnosis.',
        painAssociatedTrialIds: associations.pain.positiveTrialIds,
        weaknessAssociatedTrialIds: associations.weakness.positiveTrialIds
    };
}

export function createAssessmentId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `assessment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildReportV5({
    assessmentId = createAssessmentId(), generatedAt = new Date().toISOString(), testedSide = 'right',
    safetyReviewed = false, redFlags = [], intake = {}, positionRecords = [], model = {},
    capacityLossCompatibility = [], migratedFromVersion = null, syntheticData = false,
    legacySymptomAssessment = null
}) {
    const trials = positionRecords.map((record) => canonicalTrial(record, model, migratedFromVersion));
    const technicalTrials = positionRecords.map((record) => technicalModelRecord(record.id, record.modelEstimate, record.coordinatesDegrees ?? record.coordinates ?? {}, model));
    const quality = dataQuality(trials, migratedFromVersion);
    let associations = {
        pain: symptomRanking('pain', trials, technicalTrials),
        weakness: symptomRanking('weakness', trials, technicalTrials)
    };
    if (quality.interpretabilityStatus !== 'interpretable') {
        associations = Object.fromEntries(Object.entries(associations).map(([kind, result]) => [kind, {
            ...result,
            computable: false,
            notComputableReason: `Report data quality is ${quality.interpretabilityStatus}; complete or resolve all required observations before calculating ${kind}-linked comparisons.`,
            ranking: []
        }]));
    }
    const comparisons = matchedComparisons(trials, technicalTrials);
    const humanTrials = trials.filter((trial) => trial.includeInHumanProtocol);
    const researchTrials = trials.filter((trial) => trial.executionMode === 'model_only');
    const mainReport = {
        schema: REPORT_SCHEMA,
        schemaVersion: REPORT_SCHEMA_VERSION,
        generatedAt,
        assessment: {
            assessmentId,
            syntheticData: Boolean(syntheticData),
            reportVersion: REPORT_SCHEMA_VERSION,
            protocolVersion: 'matched-posture-protocol-v1',
            appCommit: model.appCommit ?? null,
            testedSide,
            modelSide: testedSide === 'left' ? 'right_model_visually_mirrored' : 'right',
            modelScaledToSubject: false
        },
        framing: 'Biomechanical hypothesis generator; not a medical diagnosis or treatment recommendation.',
        dataQuality: quality,
        summary: reportSummary(quality, trials, associations),
        safety: { reviewed: Boolean(safetyReviewed), positiveFlags: redFlags },
        intake: publicIntake(intake),
        trials: humanTrials,
        matchedComparisons: comparisons,
        analyses: {
            symptomAssociations: associations,
            protocolDemandRanking: demandRanking(humanTrials, technicalTrials)
        },
        hypothesisEvidence: hypothesisEvidence(associations),
        modelCoverage: {
            modelId: model.id ?? null,
            modelName: model.name ?? null,
            modelSource: model.source ?? null,
            subjectScaled: false,
            missingIndependentActuators: ['trapezius', 'serratus_anterior'],
            jointReactionAvailable: false,
            contralateralModelAvailable: false,
            mirroredSideIsVisualOnly: testedSide === 'left'
        },
        limitations: [
            'No single shoulder movement or model ratio identifies the painful tissue.',
            'Predicted controls and active forces are generic posture references, not measurements from the observed person.',
            'Actual achieved posture, movement speed, support, assistance, and resistance were not measured.',
            'Static optimization uses an assumed recruitment objective and does not reproduce dynamic neuromuscular control.',
            'Trapezius and serratus anterior are not represented as independent actuators; scapular compensation is outside model coverage.',
            'Left-side display is a visual mirror of a right-side model and does not estimate biological side asymmetry.'
        ],
        rawTechnicalAnnex: {
            available: true,
            separateExportRequired: true,
            filenameSuggestion: `${assessmentId}-technical-annex.json`,
            containsPotentialLegacyFreeTextIdentifiers: Boolean(legacySymptomAssessment)
        }
    };
    const technicalAnnex = {
        schema: `${REPORT_SCHEMA}-technical-annex`,
        schemaVersion: REPORT_SCHEMA_VERSION,
        generatedAt,
        assessmentId,
        deidentified: !legacySymptomAssessment,
        privacyNotice: legacySymptomAssessment
            ? 'Contains preserved legacy observation fields, including possible free text. Review before sharing.'
            : 'No direct patient identifiers or intake free text are included.',
        model,
        trialModels: technicalTrials,
        legacySymptomAssessment,
        researchCapacityScreen: {
            status: 'research_only_unvalidated',
            modelOnlyTrialIds: researchTrials.map((trial) => trial.id),
            modelOnlyTrials: researchTrials,
            capacityLossCompatibility,
            researchDiscriminationDemandRanking: demandRanking(researchTrials, technicalTrials),
            includeInHumanProtocol: false,
            includeInSymptomAssociation: false,
            limitations: [
                'Observed able/unable is not equivalent to modeled complete muscle-capacity loss.',
                'The model-only positions do not identify pain, injury, or diagnosis.',
                'No independent one-error-correcting panel exists under the tested gravity-only protocol.'
            ]
        }
    };
    return { report: mainReport, technicalAnnex };
}

function legacyPositionRecords(report) {
    const positions = report?.capacityScreen?.positions ?? [];
    return positions.map((position) => ({
        id: position.id,
        sequence: position.sequence,
        name: position.name,
        instruction: position.instruction,
        executionMode: String(position.id).startsWith(MODEL_ONLY_PREFIX) ? 'model_only' : 'person_attempted',
        coordinatesDegrees: position.coordinatesDegrees ?? position.coordinates ?? {},
        rawObservation: position.observation ?? {},
        modelEstimate: position.modelEstimate ?? { available: false, reason: 'Legacy report did not contain a model estimate.' }
    }));
}

function preservedLegacyAssessment(report) {
    if (!Array.isArray(report?.tests) || !report.tests.length) return null;
    // Keep the discontinued assessment stream read-only in the private annex
    // instead of silently discarding it. Legacy free text cannot be guaranteed
    // deidentified, so the annex is explicitly marked for review before sharing.
    return {
        sourceSchemaVersion: Number(report.schemaVersion) || null,
        sourceCollection: 'tests',
        readOnly: true,
        interpretationExcluded: true,
        mayContainFreeTextIdentifiers: true,
        tests: structuredClone(report.tests)
    };
}

export function migrateReportToV5(report, technicalAnnex = null) {
    if (report?.schemaVersion === REPORT_SCHEMA_VERSION && Array.isArray(report.trials)) {
        return { report, technicalAnnex };
    }
    if (!report || Number(report.schemaVersion) !== 4) return { report, technicalAnnex };
    const generatedAt = report.generatedAt ?? new Date().toISOString();
    const assessmentId = report.assessment?.assessmentId || `legacy-${String(generatedAt).replace(/[^0-9A-Za-z]/g, '').slice(0, 24)}`;
    return buildReportV5({
        assessmentId,
        generatedAt,
        testedSide: report.testedSide ?? report.intake?.assessedArm ?? 'right',
        safetyReviewed: report.safetyReviewed,
        redFlags: report.redFlags ?? [],
        intake: report.intake ?? {},
        positionRecords: legacyPositionRecords(report),
        model: report.model ?? {},
        capacityLossCompatibility: report.capacityScreen?.rankedCompatiblePatterns ?? [],
        migratedFromVersion: 4,
        syntheticData: report.syntheticData === true,
        legacySymptomAssessment: preservedLegacyAssessment(report)
    });
}

export function mainReportExport(report) {
    return report;
}

export function fullReportExport(report, technicalAnnex) {
    return { report, technicalAnnex: technicalAnnex ?? null };
}
