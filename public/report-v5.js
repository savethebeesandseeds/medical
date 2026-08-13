const REPORT_SCHEMA = 'waajacu-medical-biomechanical-assessment';
export const REPORT_SCHEMA_VERSION = 5;

const DEFAULT_MS_HUMAN_CONTROL_FLOOR = 0;
const MS_HUMAN_SHOULDER_MUSCLES = new Set([
    'DELT1_r', 'DELT2_r', 'DELT3_r', 'SUPSP_r', 'INFSP_r', 'SUBSC_r', 'TMIN_r',
    'TMAJ_r', 'PECM1_r', 'PECM2_r', 'PECM3_r', 'CORB_r', 'BIClong_r',
    'BICshort_r', 'TRIlong_r',
    'LD_L1_r', 'LD_L2_r', 'LD_L3_r', 'LD_L4_r', 'LD_L5_r', 'LD_T12_r',
    'LD_T11_r', 'LD_T10_r', 'LD_T9_r', 'LD_T8_r', 'LD_T7_r', 'LD_R12_r',
    'LD_R11_r', 'LD_IL_r',
    'cleid_mast', 'cleid_occ', 'trap_cl', 'trap_acr_scap', 'trap_acr_T1',
    'trap_acr_T2', 'trap_acr_T3', 'trap_inf_T4', 'trap_inf_T5', 'trap_inf_T6',
    'trap_inf_T7', 'trap_inf_T8', 'trap_inf_T9', 'trap_inf_T10', 'trap_inf_T11',
    'trap_inf_T12', 'levator_scap', 'SerrAnt1_1_R', 'SerrAnt2_1_R',
    'SerrAnt2_2_R', 'SerrAnt3_1_R', 'SerrAnt4_1_R', 'SerrAnt5_1_R',
    'SerrAnt6_1_R', 'SerrAnt7_1_R', 'SerrAnt8_1_R', 'SerrAnt9_1_R'
]);
const MS_HUMAN_SCAPULAR_STABILIZERS = new Set([
    'cleid_mast', 'cleid_occ', 'trap_cl', 'trap_acr_scap', 'trap_acr_T1',
    'trap_acr_T2', 'trap_acr_T3', 'trap_inf_T4', 'trap_inf_T5', 'trap_inf_T6',
    'trap_inf_T7', 'trap_inf_T8', 'trap_inf_T9', 'trap_inf_T10', 'trap_inf_T11',
    'trap_inf_T12', 'levator_scap', 'SerrAnt1_1_R', 'SerrAnt2_1_R',
    'SerrAnt2_2_R', 'SerrAnt3_1_R', 'SerrAnt4_1_R', 'SerrAnt5_1_R',
    'SerrAnt6_1_R', 'SerrAnt7_1_R', 'SerrAnt8_1_R', 'SerrAnt9_1_R'
]);

const PROTOCOL_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/i;

function normalizeAssessmentProtocol(protocol = {}) {
    const id = String(protocol.id ?? protocol.assessmentProtocolId ?? '').trim() || null;
    const version = String(protocol.version ?? protocol.protocolVersion ?? '').trim() || null;
    const digest = String(protocol.digest ?? protocol.assessmentProtocolDigest ?? '').trim().toLowerCase() || null;
    const identityVerified = Boolean(id && version && digest && PROTOCOL_DIGEST_PATTERN.test(digest));
    return {
        id,
        version,
        digest,
        name: String(protocol.name ?? '').trim() || null,
        identityVerified,
        trialCount: Array.isArray(protocol.trialIds) ? protocol.trialIds.length : null,
        matchedComparisonCount: Array.isArray(protocol.matchedComparisons) ? protocol.matchedComparisons.length : 0
    };
}

function protocolIdentityFromReport(report = {}) {
    const assessment = report.assessment ?? {};
    return normalizeAssessmentProtocol(assessment.assessmentProtocol ?? {
        assessmentProtocolId: assessment.assessmentProtocolId,
        protocolVersion: assessment.protocolVersion,
        assessmentProtocolDigest: assessment.assessmentProtocolDigest
    });
}

function protocolsMatch(left, right) {
    return left.identityVerified
        && right.identityVerified
        && left.id === right.id
        && left.version === right.version
        && left.digest === right.digest;
}

function finiteOrNull(value) {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function modelIdentityText(model = {}) {
    const source = model.source && typeof model.source === 'object'
        ? Object.values(model.source).join(' ')
        : model.source;
    return [model.id, model.name, model.variant, model.runtime, source]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

function isPreMsHumanModel(model = {}) {
    const identity = modelIdentityText(model);
    return Boolean(identity) && !identity.includes('ms-human');
}

function modelMuscleNames(model = {}) {
    if (!Array.isArray(model.muscles)) return [];
    return [...new Set(model.muscles.map((muscle) => (
        typeof muscle === 'string' ? muscle : muscle?.name
    )).filter(Boolean))];
}

function modelControlFloor(model = {}) {
    const configured = finiteOrNull(model.controlFloor ?? model.staticHold?.controlFloor);
    if (Number.isFinite(configured)) return Math.max(0, configured);
    return isPreMsHumanModel(model) ? 0.01 : DEFAULT_MS_HUMAN_CONTROL_FLOOR;
}

function shoulderMuscleNames(model = {}, availableNames = []) {
    const modelNames = new Set(modelMuscleNames(model));
    const available = new Set(availableNames.filter(Boolean));
    const explicit = [
        ...(Array.isArray(model.shoulderMuscles) ? model.shoulderMuscles : []),
        ...(Array.isArray(model.scapularStabilizers) ? model.scapularStabilizers : [])
    ].map((muscle) => typeof muscle === 'string' ? muscle : muscle?.name).filter(Boolean);
    const result = new Set(explicit);
    for (const name of MS_HUMAN_SHOULDER_MUSCLES) {
        if (modelNames.has(name) || available.has(name)) result.add(name);
    }
    return [...result].filter((name) => !available.size || available.has(name));
}

function scapularStabilizerNames(model = {}) {
    const modelNames = new Set(modelMuscleNames(model));
    const explicit = (Array.isArray(model.scapularStabilizers) ? model.scapularStabilizers : [])
        .map((muscle) => typeof muscle === 'string' ? muscle : muscle?.name)
        .filter(Boolean);
    if (explicit.length) return [...new Set(explicit)];
    return [...MS_HUMAN_SCAPULAR_STABILIZERS].filter((name) => modelNames.has(name));
}

function analysisType(model = {}) {
    return model.analysisType ?? model.staticHold?.method ?? 'bounded_static_equilibrium';
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

function normalizeMuscles(modelEstimate = {}, model = {}) {
    const controlFloor = modelControlFloor(model);
    return (modelEstimate.muscles ?? []).map((muscle) => {
        const control = finiteOrNull(muscle.predictedModelControl ?? muscle.activation);
        const activeForce = finiteOrNull(muscle.predictedGenericActiveForceN ?? muscle.activeActuatorForceN);
        return {
            name: muscle.name,
            predictedModelControl: control,
            predictedModelControlAboveFloor: Number.isFinite(control) ? Math.max(0, control - controlFloor) : null,
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
            notComputableReason: modelEstimate?.reason || 'Model reference unavailable for this posture.'
        };
    }
    const muscles = normalizeMuscles(modelEstimate, model);
    const shoulderNames = new Set(shoulderMuscleNames(model, muscles.map((muscle) => muscle.name)));
    const shoulder = muscles.filter((muscle) => shoulderNames.has(muscle.name));
    const relevant = shoulder.sort((a, b) => b.predictedModelControl - a.predictedModelControl).slice(0, 8);
    const outlier = [...muscles].filter((muscle) => !shoulderNames.has(muscle.name)).sort((a, b) => b.predictedModelControl - a.predictedModelControl)[0];
    return {
        available: muscles.length > 0,
        source: modelEstimate.source || 'trial-specific-static-reference',
        sourceSampleId: modelEstimate.sourceSampleId || null,
        referenceOnly: true,
        subjectSpecificEstimate: false,
        targetPoseUsed: targetPose,
        achievedPoseUsed: null,
        externalLoadsUsed: [],
        analysisType: analysisType(model),
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
            warnings: ['Generic model reference posture; not a simulation or measurement of the observed person.']
        }
    };
}

function technicalModelRecord(trialId, modelEstimate, targetPose, model = {}) {
    const muscles = normalizeMuscles(modelEstimate, model);
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
            analysisType: analysisType(model),
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
        controlFloor: modelControlFloor(model),
        forceDefinition: 'Generic-model active actuator force only; passive fiber force and external loads are excluded.',
        muscles
    };
}

function canonicalTrial(record, model, migratedFromVersion = null) {
    const executionMode = 'person_attempted';
    const raw = record.rawObservation ?? record.response ?? record.observation ?? {};
    const targetPose = { ...record.coordinatesDegrees ?? record.targetPose ?? record.coordinates ?? {} };
    const observation = normalizeObservation(raw, executionMode, migratedFromVersion);
    return {
        id: record.id,
        sequence: finiteOrNull(record.sequence),
        protocolSection: record.protocolSection || 'static_posture_observation',
        executionMode,
        includeInHumanProtocol: true,
        name: record.name,
        instruction: record.instruction,
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
    const recordStatus = conflict ? 'conflicting_record'
        : attempted.length === 0 || missingRequiredFields.length > 0 ? 'incomplete_record'
            : 'complete_record';
    return {
        recordStatus,
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

function numericSymptomValue(symptom) {
    if (symptom.state === 'recorded_zero') return 0;
    if (symptom.state === 'positive' && Number.isFinite(symptom.score)) return symptom.score;
    return null;
}

function matchedComparisons(trials, definitions = []) {
    const trialMap = new Map(trials.map((trial) => [trial.id, trial]));
    return definitions.filter((definition) => (
        definition?.id
        && Array.isArray(definition.trialIds)
        && definition.trialIds.length === 2
        && definition.trialIds[0] !== definition.trialIds[1]
    )).map((definition) => {
        const [left, right] = definition.trialIds.map((id) => trialMap.get(id));
        if (!left || !right) return null;
        const leftPain = numericSymptomValue(left.observation.pain);
        const rightPain = numericSymptomValue(right.observation.pain);
        const leftWeakness = numericSymptomValue(left.observation.weakness);
        const rightWeakness = numericSymptomValue(right.observation.weakness);
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
            }
        };
    }).filter(Boolean);
}

function observedTrialIds(trials, kind) {
    return trials.filter((trial) => trial.observation?.[kind]?.state === 'positive').map((trial) => trial.id);
}

function reportSummary(quality, trials) {
    if (quality.recordStatus === 'incomplete_record') {
        return {
            status: 'incomplete_record',
            statement: `${quality.recordedTrialCount} of ${quality.requiredTrialCount} positions were recorded. Required observations are missing, so this record is incomplete.`,
            painObservedTrialIds: observedTrialIds(trials, 'pain'),
            weaknessObservedTrialIds: observedTrialIds(trials, 'weakness')
        };
    }
    if (quality.recordStatus === 'conflicting_record') {
        return {
            status: 'conflicting_record',
            statement: 'Some recorded fields conflict. Review the listed warnings before treating this record as complete.',
            painObservedTrialIds: observedTrialIds(trials, 'pain'),
            weaknessObservedTrialIds: observedTrialIds(trials, 'weakness')
        };
    }
    return {
        status: 'complete_record',
        statement: 'All required observations were recorded. This report describes the responses only; it does not identify a muscle or tissue diagnosis.',
        painObservedTrialIds: observedTrialIds(trials, 'pain'),
        weaknessObservedTrialIds: observedTrialIds(trials, 'weakness')
    };
}

export function createAssessmentId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `assessment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildReportV5({
    assessmentId = createAssessmentId(), generatedAt = new Date().toISOString(), testedSide = 'right',
    safetyReviewed = false, redFlags = [], intake = {}, positionRecords = [], model = {},
    assessmentProtocol = {},
    migratedFromVersion = null, syntheticData = false,
    legacySymptomAssessment = null,
    migrationReason = null
}) {
    const protocolIdentity = normalizeAssessmentProtocol(assessmentProtocol);
    const protocolComparisons = protocolIdentity.identityVerified && Array.isArray(assessmentProtocol.matchedComparisons)
        ? assessmentProtocol.matchedComparisons
        : [];
    const humanRecords = positionRecords.filter((record) => record.executionMode !== 'model_only');
    const trials = humanRecords.map((record) => canonicalTrial(record, model, migratedFromVersion));
    const technicalTrials = humanRecords.map((record) => technicalModelRecord(record.id, record.modelEstimate, record.coordinatesDegrees ?? record.coordinates ?? {}, model));
    const quality = dataQuality(trials, migratedFromVersion);
    if (!protocolIdentity.identityVerified) {
        quality.recordStatus = 'incomplete_record';
        quality.warnings.push({
            code: 'assessment_protocol_identity_unverified',
            message: 'This report’s assessment version could not be verified. Comparisons and model-reference summaries are unavailable.'
        });
    }
    if (migrationReason) {
        quality.recordStatus = 'incomplete_record';
        quality.warnings.push({
            code: 'assessment_protocol_migration_required',
            message: 'This archived report is shown for reference only. Earlier model results are not included.',
            reason: migrationReason
        });
    }
    const comparisons = protocolIdentity.identityVerified
        ? matchedComparisons(trials, protocolComparisons)
        : [];
    const humanTrials = trials;
    const legacyModelRecord = isPreMsHumanModel(model) || Boolean(migratedFromVersion);
    const scapularStabilizers = scapularStabilizerNames(model);
    const modeledMuscles = modelMuscleNames(model);
    const missingIndependentActuators = Array.isArray(model.coverage?.missingIndependentActuators)
        ? [...model.coverage.missingIndependentActuators]
        : [];
    const legacyNotice = legacyModelRecord
        ? 'This archived report is shown for reference only. Earlier model results are not included.'
        : null;
    const limitations = [
        'No single shoulder movement, activation estimate, force estimate, or model ratio identifies the painful tissue.',
        'Predicted controls and active forces are generic posture references, not measurements from the observed person.',
        'Actual achieved posture, movement speed, support, assistance, and resistance were not measured.',
        'Static recruitment uses an assumed minimum-control objective and does not reproduce dynamic neuromuscular control.',
        'The static reference uses model self-weight with no measured contact or external hand load; supported, assisted, or resisted observations cannot be inferred from it.',
        scapularStabilizers.length
            ? 'Modeled trapezius, serratus-anterior, and related shoulder-girdle stabilizers participate in equilibrium, but their predicted controls do not measure observed scapular motion or compensation.'
            : 'Independent scapular-stabilizer coverage was not recorded for this model result; scapular compensation cannot be inferred.',
        'Left-side display is a visual mirror of a right-side model and does not estimate biological side asymmetry.'
    ];
    if (!protocolIdentity.identityVerified) {
        limitations.push('This report’s assessment version could not be verified, so comparisons and model-reference summaries are unavailable.');
    }
    if (legacyNotice) limitations.push(legacyNotice);
    const mainReport = {
        schema: REPORT_SCHEMA,
        schemaVersion: REPORT_SCHEMA_VERSION,
        generatedAt,
        assessment: {
            assessmentId,
            syntheticData: Boolean(syntheticData),
            reportVersion: REPORT_SCHEMA_VERSION,
            assessmentProtocol: protocolIdentity,
            assessmentProtocolId: protocolIdentity.id,
            protocolVersion: protocolIdentity.version,
            assessmentProtocolDigest: protocolIdentity.digest,
            protocolIdentityVerified: protocolIdentity.identityVerified,
            appCommit: model.appCommit ?? null,
            testedSide,
            modelSide: testedSide === 'left' ? 'right_model_visually_mirrored' : 'right',
            modelScaledToSubject: false,
            legacyModelRecord,
            migrationRequired: Boolean(migrationReason),
            migrationReason
        },
        framing: 'Posture observations with a separate generic-model reference. Not a diagnosis or treatment recommendation.',
        dataQuality: quality,
        summary: reportSummary(quality, trials),
        safety: { reviewed: Boolean(safetyReviewed), positiveFlags: redFlags },
        intake: publicIntake(intake),
        trials: humanTrials,
        matchedComparisons: comparisons,
        analyses: {
            genericProtocolDemand: {
                available: protocolIdentity.identityVerified && technicalTrials.some((trial) => trial.available),
                symptomLinked: false,
                subjectSpecific: false,
                scope: 'generic_model_demand_across_protocol_postures_only',
                statement: 'This summary ranks generic-model demand across the protocol postures without using pain, weakness, or other participant observations.',
                ranking: protocolIdentity.identityVerified ? demandRanking(humanTrials, technicalTrials) : []
            }
        },
        modelCoverage: {
            modelId: model.id ?? null,
            modelName: model.name ?? null,
            modelVariant: model.variant ?? null,
            modelSource: model.source ?? null,
            runtime: model.runtime ?? null,
            modelLicense: model.source?.modelLicense ?? model.modelLicense ?? null,
            sourceCommit: model.source?.commit ?? null,
            sourceTreeSha256: model.source?.sourceTreeSha256 ?? null,
            analysisType: analysisType(model),
            controlFloor: modelControlFloor(model),
            functionalMuscleCount: finiteOrNull(model.functionalMuscleCount) ?? modeledMuscles.length,
            shoulderMusclesIncluded: shoulderMuscleNames(model, modeledMuscles),
            scapularStabilizersIncluded: scapularStabilizers,
            staticHoldAssumptions: Array.isArray(model.staticHold?.assumptions) ? [...model.staticHold.assumptions] : [],
            subjectScaled: false,
            missingIndependentActuators,
            jointReactionAvailable: false,
            contralateralModelAvailable: false,
            mirroredSideIsVisualOnly: testedSide === 'left',
            legacyModelRecord,
            legacyNotice
        },
        limitations,
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
        assessmentProtocol: protocolIdentity,
        migrationRequired: Boolean(migrationReason),
        migrationReason,
        privacyStatus: legacySymptomAssessment
            ? 'review_required_possible_legacy_free_text'
            : 'technical_model_data_only',
        directIdentifiersIncluded: false,
        legacyModelRecord,
        legacyNotice,
        privacyNotice: legacySymptomAssessment
            ? 'Contains preserved legacy observation fields, including possible free text. Review before sharing.'
            : 'This annex contains technical model data only. When bundled with the full local report, the report can contain exact demographics and observation notes.',
        model,
        trialModels: technicalTrials,
        legacySymptomAssessment
    };
    return { report: mainReport, technicalAnnex };
}

function removedLegacyModelMetadata() {
    return {
        id: 'legacy-model-evidence-removed',
        name: 'Prior model evidence removed during migration',
        variant: 'human observations only',
        scope: 'stored human observations only',
        runtime: null,
        source: null,
        modelLicense: null,
        solverConfigurationId: null,
        analysisType: 'not_available_prior_model_evidence_removed',
        controlFloor: 0,
        functionalMuscleCount: 0,
        muscles: [],
        scapularStabilizers: [],
        coverage: { missingIndependentActuators: [] },
        staticHold: null,
        appCommit: null
    };
}

function sanitizedHumanFields(observation = {}) {
    const fields = [
        'status', 'reached', 'completion', 'answered', 'result', 'pain', 'painScore',
        'painLocation', 'painLocations', 'painQuality', 'painFamiliar', 'painOnsetAngleDegrees',
        'painPhase', 'weakness', 'weaknessScore', 'perceivedWeaknessScore', 'stiffness',
        'compensation', 'compensationDetail', 'limitingFactor', 'limitingFactors', 'achievedPose',
        'repeatable', 'notes', 'maxAngle', 'onsetAngle', 'location', 'locationOther', 'familiar',
        'severe', 'sharpOrUnfamiliar', 'neurological', 'escalating'
    ];
    return Object.fromEntries(fields.filter((field) => Object.hasOwn(observation, field)).map((field) => [
        field,
        structuredClone(observation[field])
    ]));
}

function archivedProtocolObservations(source = {}) {
    const canonical = Array.isArray(source.trials) ? source.trials.map((trial) => ({
        sourceTrialId: trial.id ?? null,
        sourceTrialName: trial.name ?? null,
        observation: sanitizedHumanFields(rawObservationFromCanonical(trial.observation ?? {}))
    })) : [];
    const positions = Array.isArray(source.capacityScreen?.positions)
        ? source.capacityScreen.positions.filter((position) => position.executionMode !== 'model_only').map((position) => ({
            sourceTrialId: position.id ?? null,
            sourceTrialName: position.name ?? null,
            observation: sanitizedHumanFields(position.observation ?? position.response ?? {})
        }))
        : [];
    const alreadyArchived = Array.isArray(source.archivedProtocolObservations)
        ? source.archivedProtocolObservations.map((entry) => ({
            sourceTrialId: entry.sourceTrialId ?? null,
            sourceTrialName: entry.sourceTrialName ?? null,
            observation: sanitizedHumanFields(entry.observation ?? {})
        }))
        : [];
    return [...canonical, ...positions, ...alreadyArchived];
}

function preservedLegacyAssessment(source, sourceSchemaVersion = null) {
    if (!source || typeof source !== 'object') return null;
    const tests = Array.isArray(source.tests) ? source.tests.map((test) => ({
        id: test.id ?? null,
        name: test.name ?? null,
        observation: sanitizedHumanFields(test.observation ?? test.response ?? {})
    })) : [];
    const responses = source.responses && typeof source.responses === 'object'
        ? Object.fromEntries(Object.entries(source.responses).map(([id, response]) => [id, sanitizedHumanFields(response)]))
        : {};
    const observations = archivedProtocolObservations(source);
    if (!tests.length && !Object.keys(responses).length && !observations.length) return null;
    return {
        sourceSchemaVersion: Number(sourceSchemaVersion ?? source.sourceSchemaVersion) || null,
        sourceCollection: tests.length ? 'tests' : 'responses',
        readOnly: true,
        interpretationExcluded: true,
        modelEvidenceRemoved: true,
        protocolDefinitionRemoved: true,
        mayContainFreeTextIdentifiers: true,
        ...(tests.length ? { tests } : {}),
        ...(Object.keys(responses).length ? { responses } : {}),
        ...(observations.length ? { archivedProtocolObservations: observations } : {})
    };
}

function mergePreservedAssessments(...collections) {
    const retained = collections.filter(Boolean);
    if (!retained.length) return null;
    const tests = retained.flatMap((collection) => collection.tests ?? []);
    const responses = Object.assign({}, ...retained.map((collection) => collection.responses ?? {}));
    const observations = retained.flatMap((collection) => collection.archivedProtocolObservations ?? []);
    return {
        sourceSchemaVersion: retained[0].sourceSchemaVersion ?? null,
        sourceCollection: 'archived_protocol_observations',
        readOnly: true,
        interpretationExcluded: true,
        modelEvidenceRemoved: true,
        protocolDefinitionRemoved: true,
        mayContainFreeTextIdentifiers: true,
        ...(tests.length ? { tests } : {}),
        ...(Object.keys(responses).length ? { responses } : {}),
        ...(observations.length ? { archivedProtocolObservations: observations } : {})
    };
}

function rawObservationFromCanonical(observation = {}) {
    const stateToAnswer = (state) => state === 'positive' ? 'yes' : state === 'recorded_zero' ? 'no' : 'not_recorded';
    return {
        completion: observation.completion ?? 'not_recorded',
        pain: stateToAnswer(observation.pain?.state),
        painScore: observation.pain?.score ?? null,
        painLocations: [...(observation.pain?.locations ?? [])],
        painQuality: [...(observation.pain?.quality ?? [])],
        painFamiliar: observation.pain?.familiar ?? 'not_recorded',
        painOnsetAngleDegrees: observation.pain?.onsetAngleDegrees ?? null,
        painPhase: observation.pain?.phase ?? null,
        weakness: stateToAnswer(observation.weakness?.state),
        weaknessScore: observation.weakness?.score ?? null,
        stiffness: stateToAnswer(observation.stiffness?.state),
        compensation: observation.compensation?.state === 'uncertain'
            ? 'uncertain'
            : stateToAnswer(observation.compensation?.state),
        compensationDetail: [...(observation.compensation?.details ?? [])],
        limitingFactors: [...(observation.limitingFactors ?? [])],
        achievedPose: observation.achievedPose ?? null,
        repeatable: observation.repeatable ?? 'not_recorded',
        notes: observation.notes ?? null
    };
}

function legacyRecordStatus(value) {
    return ({
        interpretable: 'complete_record',
        insufficient_data: 'incomplete_record',
        conflicting: 'conflicting_record'
    })[value] ?? (['complete_record', 'incomplete_record', 'conflicting_record'].includes(value)
        ? value
        : 'incomplete_record');
}

function needsScientificBoundarySanitizing(report = {}) {
    return Boolean(
        report.hypothesisEvidence
        || report.analyses?.symptomAssociations
        || report.analyses?.protocolDemandRanking
        || report.dataQuality?.interpretabilityStatus
        || ['interpretable', 'insufficient_data', 'conflicting'].includes(report.summary?.status)
        || (report.trials ?? []).some((trial) => Object.hasOwn(trial, 'includeInSymptomAssociation'))
        || (report.matchedComparisons ?? []).some((comparison) => Object.hasOwn(comparison, 'modelDelta'))
    );
}

function applyScientificBoundary(report) {
    if (!report || typeof report !== 'object' || !needsScientificBoundarySanitizing(report)) return report;
    const cleaned = structuredClone(report);
    const oldDemandRanking = cleaned.analyses?.protocolDemandRanking;
    delete cleaned.hypothesisEvidence;
    if (cleaned.analyses) {
        delete cleaned.analyses.symptomAssociations;
        delete cleaned.analyses.protocolDemandRanking;
        if (!cleaned.analyses.genericProtocolDemand && Array.isArray(oldDemandRanking)) {
            cleaned.analyses.genericProtocolDemand = {
                available: oldDemandRanking.length > 0,
                symptomLinked: false,
                subjectSpecific: false,
                scope: 'generic_model_demand_across_protocol_postures_only',
                statement: 'This summary ranks generic-model demand across the protocol postures without using pain, weakness, or other participant observations.',
                ranking: oldDemandRanking
            };
        }
    }
    for (const trial of cleaned.trials ?? []) delete trial.includeInSymptomAssociation;
    for (const comparison of cleaned.matchedComparisons ?? []) delete comparison.modelDelta;
    if (cleaned.dataQuality) {
        cleaned.dataQuality.recordStatus = legacyRecordStatus(
            cleaned.dataQuality.recordStatus ?? cleaned.dataQuality.interpretabilityStatus
        );
        delete cleaned.dataQuality.interpretabilityStatus;
        cleaned.summary = reportSummary(cleaned.dataQuality, cleaned.trials ?? []);
    }
    if (cleaned.framing?.includes('hypothesis generator')) {
        cleaned.framing = 'Posture observations with a separate generic-model reference. Not a diagnosis or treatment recommendation.';
    }
    return cleaned;
}

function storedV5NeedsSanitizing(report, technicalAnnex = null, expectedProtocol = null) {
    const coverage = report?.modelCoverage ?? {};
    const storedProtocol = protocolIdentityFromReport(report);
    const expected = normalizeAssessmentProtocol(expectedProtocol ?? {});
    const alreadyArchived = report?.assessment?.assessmentProtocolId === 'archived-human-observations-only'
        && Array.isArray(report?.trials)
        && report.trials.length === 0
        && technicalAnnex?.legacySymptomAssessment?.interpretationExcluded === true
        && technicalAnnex?.legacySymptomAssessment?.protocolDefinitionRemoved === true;
    if (alreadyArchived) return false;
    return !storedProtocol.identityVerified
        || (expected.identityVerified && !protocolsMatch(storedProtocol, expected))
        || report?.assessment?.legacyModelRecord === true
        || coverage.legacyModelRecord === true
        || isPreMsHumanModel({
            id: coverage.modelId,
            name: coverage.modelName,
            variant: coverage.modelVariant,
            runtime: coverage.runtime,
            source: coverage.modelSource
        })
        || isPreMsHumanModel(technicalAnnex?.model ?? {});
}

export function migrateReportToV5(report, technicalAnnex = null, options = {}) {
    const expectedProtocol = normalizeAssessmentProtocol(options.assessmentProtocol ?? {});
    const archivedProtocol = {
        id: 'archived-human-observations-only',
        version: '1',
        digest: null,
        name: 'Archived observations from an earlier assessment protocol',
        matchedComparisons: []
    };
    if (report?.schemaVersion === REPORT_SCHEMA_VERSION && Array.isArray(report.trials)) {
        if (!storedV5NeedsSanitizing(report, technicalAnnex, expectedProtocol)) {
            const boundedReport = applyScientificBoundary(report);
            return { report: boundedReport, technicalAnnex };
        }
        const storedProtocol = protocolIdentityFromReport(report);
        const legacySymptomAssessment = mergePreservedAssessments(
            preservedLegacyAssessment(report, REPORT_SCHEMA_VERSION),
            preservedLegacyAssessment(technicalAnnex?.legacySymptomAssessment, REPORT_SCHEMA_VERSION)
        );
        if (legacySymptomAssessment) {
            legacySymptomAssessment.sourceAssessmentProtocol = storedProtocol;
            legacySymptomAssessment.expectedAssessmentProtocol = expectedProtocol.identityVerified ? expectedProtocol : null;
            legacySymptomAssessment.migrationReason = !storedProtocol.identityVerified
                ? 'stored_assessment_protocol_identity_missing_or_invalid'
                : expectedProtocol.identityVerified && !protocolsMatch(storedProtocol, expectedProtocol)
                    ? 'stored_assessment_protocol_does_not_match_current_protocol'
                    : 'stored_model_evidence_requires_sanitizing';
        }
        const migrationReason = legacySymptomAssessment?.migrationReason ?? 'stored_model_evidence_requires_sanitizing';
        return buildReportV5({
            assessmentId: report.assessment?.assessmentId,
            generatedAt: report.generatedAt,
            testedSide: report.assessment?.testedSide ?? 'right',
            safetyReviewed: report.safety?.reviewed,
            redFlags: report.safety?.positiveFlags ?? [],
            intake: report.intake ?? {},
            positionRecords: [],
            model: removedLegacyModelMetadata(),
            assessmentProtocol: archivedProtocol,
            migratedFromVersion: REPORT_SCHEMA_VERSION,
            syntheticData: report.assessment?.syntheticData === true,
            legacySymptomAssessment,
            migrationReason
        });
    }
    if (!report || Number(report.schemaVersion) !== 4) return { report, technicalAnnex };
    const generatedAt = report.generatedAt ?? new Date().toISOString();
    const assessmentId = report.assessment?.assessmentId || `legacy-${String(generatedAt).replace(/[^0-9A-Za-z]/g, '').slice(0, 24)}`;
    const legacySymptomAssessment = preservedLegacyAssessment(report, 4);
    if (legacySymptomAssessment) {
        legacySymptomAssessment.sourceAssessmentProtocol = null;
        legacySymptomAssessment.expectedAssessmentProtocol = expectedProtocol.identityVerified ? expectedProtocol : null;
        legacySymptomAssessment.migrationReason = 'legacy_report_has_no_verifiable_assessment_protocol_identity';
    }
    const migrated = buildReportV5({
        assessmentId,
        generatedAt,
        testedSide: report.testedSide ?? report.intake?.assessedArm ?? 'right',
        safetyReviewed: report.safetyReviewed,
        redFlags: report.redFlags ?? [],
        intake: report.intake ?? {},
        positionRecords: [],
        model: removedLegacyModelMetadata(),
        assessmentProtocol: archivedProtocol,
        migratedFromVersion: 4,
        syntheticData: report.syntheticData === true,
        legacySymptomAssessment,
        migrationReason: 'legacy_report_has_no_verifiable_assessment_protocol_identity'
    });
    return migrated;
}

export function mainReportExport(report) {
    const bounded = applyScientificBoundary(report);
    if (!bounded || typeof bounded !== 'object') return bounded;
    const exported = structuredClone(bounded);
    const intake = exported.intake ?? {};
    const band = (value, width) => {
        if (!Number.isFinite(value)) return null;
        const lower = Math.floor(value / width) * width;
        return `${lower}-${lower + width - 1}`;
    };
    exported.intake = {
        ...intake,
        ageBandYears: band(intake.ageYears, 10),
        heightBandCm: band(intake.heightCm, 10),
        weightBandKg: band(intake.weightKg, 10)
    };
    delete exported.intake.ageYears;
    delete exported.intake.heightCm;
    delete exported.intake.weightKg;
    for (const trial of exported.trials ?? []) {
        if (trial.observation) delete trial.observation.notes;
    }
    exported.exportPrivacy = {
        status: 'privacy_reduced_not_anonymous',
        directIdentifiersExcluded: true,
        observationFreeTextExcluded: true,
        exactAgeHeightWeightCoarsened: true,
        notice: 'This export reduces identifying detail but is not guaranteed anonymous. Review it before sharing.'
    };
    return exported;
}

export function fullReportExport(report, technicalAnnex) {
    return {
        report: applyScientificBoundary(report),
        technicalAnnex: technicalAnnex ?? null,
        exportPrivacy: {
            status: 'full_local_assessment_export',
            notice: 'This explicit full export can contain exact demographics, observation notes, and preserved legacy free text. Review before sharing.'
        }
    };
}
