import {
    REPORT_SCHEMA_VERSION,
    buildReportV5,
    createAssessmentId,
    fullReportExport,
    mainReportExport,
    migrateReportToV5
} from './report-v5.js';
import {
    MS_HUMAN_ASSESSMENT_POSITIONS,
    MS_HUMAN_ASSESSMENT_REPORT_PROTOCOL
} from './ms-human-assessment-protocol.js';
import { formatDate, formatNumber, plural, t } from './i18n.js';

const DIAGNOSIS_DRAFT_KEY = 'waajacu-medical.diagnosis-draft.v1';
const DIAGNOSIS_REPORTS_KEY = 'waajacu-medical.patient-reports.v1';
const MAX_SAVED_REPORTS = 100;

const POSE_KEYS = [
    'elv_angle_r',
    'shoulder_elv_r',
    'shoulder_rot_r',
    'elbow_flexion_r',
    'pro_sup_r',
    'deviation_r',
    'flexion_r'
];

const ASSESSMENT_POSITIONS = MS_HUMAN_ASSESSMENT_POSITIONS;

function emptyPositionResponse() {
    return {
        answered: false,
        completion: 'not_recorded',
        pain: 'not_recorded',
        weakness: 'not_recorded',
        stiffness: 'not_recorded',
        compensation: 'not_recorded',
        painScore: '',
        weaknessScore: '',
        painLocation: '',
        limitingFactor: '',
        compensationDetail: '',
        notes: '',
        result: 'not_tested'
    };
}

const CAPACITY_ANGLE_LABELS = Object.freeze({
    elv_angle_r: 'assessment.angles.plane',
    shoulder_elv_r: 'assessment.angles.shoulder',
    shoulder_rot_r: 'assessment.angles.rotation',
    elbow_flexion_r: 'assessment.angles.elbow',
    pro_sup_r: 'assessment.angles.forearm',
    deviation_r: 'assessment.angles.wrist-deviation',
    flexion_r: 'assessment.angles.wrist-flexion'
});

const RED_FLAGS = Object.freeze([
    { id: 'cardiopulmonary', urgency: 'emergency' },
    { id: 'deformity', urgency: 'emergency' },
    { id: 'circulation', urgency: 'emergency' },
    { id: 'trauma', urgency: 'urgent' },
    { id: 'neurological', urgency: 'urgent' },
    { id: 'infection', urgency: 'urgent' },
    { id: 'restPain', urgency: 'review' },
    { id: 'systemicHistory', urgency: 'review' }
]);

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function finiteOrNull(value) {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function modelMuscleNames(model = {}) {
    if (!Array.isArray(model.muscles)) return [];
    return [...new Set(model.muscles.map((muscle) => (
        typeof muscle === 'string' ? muscle : muscle?.name
    )).filter(Boolean))];
}

function selectedMuscle(controller) {
    return typeof controller.getSelectedMuscle === 'function'
        ? controller.getSelectedMuscle()
        : null;
}

function activeForceValue(muscle = {}) {
    return finiteOrNull(muscle.activeActuatorForceN ?? muscle.activeForceN);
}

function modelActuatorIds(model = {}) {
    if (Array.isArray(model.actuatorIds)) return [...model.actuatorIds];
    if (!Array.isArray(model.muscles)) return [];
    return model.muscles
        .filter((muscle) => muscle && typeof muscle === 'object')
        .map((muscle) => muscle.actuatorId)
        .filter((actuatorId) => actuatorId !== undefined && actuatorId !== null);
}

export function reportModelMetadata(model = {}) {
    const descriptors = Array.isArray(model.muscles)
        ? model.muscles.filter((muscle) => muscle && typeof muscle === 'object')
        : [];
    const muscles = modelMuscleNames(model);
    const muscleInventory = new Set(muscles);
    const explicitScapularStabilizers = Array.isArray(model.scapularStabilizers)
        ? model.scapularStabilizers.map((muscle) => (
            typeof muscle === 'string' ? muscle : muscle?.name
        )).filter(Boolean)
        : [];
    const inferredScapularStabilizers = descriptors
        .filter((muscle) => muscle.group === 'Shoulder stabilizer')
        .map((muscle) => muscle.name)
        .filter(Boolean);
    const scapularStabilizers = [...new Set([
        ...explicitScapularStabilizers,
        ...inferredScapularStabilizers
    ])].filter((name) => muscleInventory.has(name));
    return {
        id: model.id ?? model.model?.id ?? model.model?.name ?? null,
        modelDigest: model.modelDigest ?? model.identity?.modelDigest ?? null,
        name: model.name ?? model.model?.name ?? null,
        variant: model.variant ?? model.scope ?? model.model?.variant ?? null,
        scope: model.scope ?? model.model?.variant ?? 'generic right-arm static posture',
        runtime: model.runtime ?? model.model?.runtime
            ?? (model.source?.mujocoVersion ? `MuJoCo ${model.source.mujocoVersion}` : null),
        source: model.source ?? null,
        modelLicense: model.modelLicense ?? model.source?.modelLicense ?? null,
        solverConfigurationId: model.solverConfigurationId ?? model.staticHold?.configurationId ?? null,
        regionId: model.regionId ?? model.region?.id ?? null,
        regionDigest: model.regionDigest ?? model.region?.digest ?? null,
        analysisType: model.analysisType ?? 'bounded_static_equilibrium',
        controlFloor: 0,
        functionalMuscleCount: model.functionalMuscleCount ?? model.model?.functionalMuscles ?? muscles.length,
        muscles,
        actuatorIds: modelActuatorIds(model),
        scapularStabilizers,
        coverage: model.coverage ?? null,
        staticHold: model.staticHold ?? null,
        appCommit: model.appCommit ?? null
    };
}

function formatMetric(value, digits = 3) {
    return Number.isFinite(value)
        ? formatNumber(Number(value), { minimumFractionDigits: digits, maximumFractionDigits: digits })
        : t('common.status.unavailable');
}

export function completeStaticState(state, model = {}) {
    if (state?.mode !== 'static' || state.staticHolding?.solver?.converged !== true ||
            state.staticHolding?.quality?.usable !== true || !Array.isArray(state.muscles)) return false;
    const expectedModelDigest = model.modelDigest ?? model.identity?.modelDigest;
    const expectedSolverConfigId = model.solverConfigurationId
        ?? model.staticHold?.id
        ?? model.staticHold?.configurationId;
    if (!expectedModelDigest || state.modelDigest !== expectedModelDigest ||
            !expectedSolverConfigId || state.solverConfigId !== expectedSolverConfigId) return false;
    const expectedRegionId = model.regionId ?? model.region?.id;
    const expectedRegionDigest = model.regionDigest ?? model.region?.digest;
    if (expectedRegionId && state.regionId !== expectedRegionId) return false;
    if (expectedRegionDigest && state.regionDigest !== expectedRegionDigest) return false;

    const expectedNames = modelMuscleNames(model);
    const expectedActuatorIds = modelActuatorIds(model);
    const expectedCount = Number(model.functionalMuscleCount ?? model.model?.functionalMuscles ?? expectedNames.length);
    if (!Number.isInteger(expectedCount) || expectedCount <= 0 ||
            expectedNames.length !== expectedCount || expectedActuatorIds.length !== expectedCount ||
            new Set(expectedActuatorIds).size !== expectedCount || state.muscles.length !== expectedCount) return false;

    const expectedNameSet = new Set(expectedNames);
    const expectedActuatorIdSet = new Set(expectedActuatorIds);
    const returnedNames = new Set();
    const returnedActuatorIds = new Set();
    for (const muscle of state.muscles) {
        const activeForce = muscle.activeActuatorForceN ?? muscle.activeForceN;
        if (!expectedNameSet.has(muscle.name) || returnedNames.has(muscle.name) ||
                !expectedActuatorIdSet.has(muscle.actuatorId) || returnedActuatorIds.has(muscle.actuatorId) ||
                !Number.isFinite(muscle.activation) || !Number.isFinite(activeForce)) return false;
        returnedNames.add(muscle.name);
        returnedActuatorIds.add(muscle.actuatorId);
    }
    return returnedNames.size === expectedCount && returnedActuatorIds.size === expectedCount;
}

export function createDiagnosisWorkflow(controller) {
    const byId = (id) => document.getElementById(id);
    const state = {
        schemaVersion: REPORT_SCHEMA_VERSION,
        assessmentId: createAssessmentId(),
        activeCapacityIndex: 0,
        capacityResponses: Object.fromEntries(ASSESSMENT_POSITIONS.map((position) => [position.id, emptyPositionResponse()])),
        capacityModelStates: {},
        testedSide: 'right',
        redFlags: Object.fromEntries(RED_FLAGS.map((flag) => [flag.id, null])),
        safetyReviewed: false,
        intakeCompleted: false,
        intake: {},
        ready: false,
        report: null,
        reportAnnex: null,
        reportStored: false,
        storageMode: 'device',
        sessionReports: [],
        deviceStorageError: false,
        legacySymptomAssessment: null,
        protocolMigrationNotice: null,
        previewGeneration: 0,
        capacityPreviewPromise: null,
        assessmentOpen: false,
        phase: 'privacy',
        draftUpdatedAt: null,
        viewingSavedReport: false,
        dialogAction: null,
        dialogReturnFocus: null
    };

    function recordCode(assessmentId = state.assessmentId) {
        const source = String(assessmentId ?? '');
        let hash = 0x811c9dc5;
        for (let index = 0; index < source.length; index += 1) {
            hash ^= source.charCodeAt(index);
            hash = Math.imul(hash, 0x01000193);
        }
        return (hash & 0xffff).toString(16).toUpperCase().padStart(4, '0');
    }

    function localizedDate(value, options = { dateStyle: 'medium', timeStyle: 'short' }) {
        const date = value instanceof Date ? value : new Date(value);
        return Number.isNaN(date.getTime()) ? t('common.status.date-unavailable') : formatDate(date, options);
    }

    function readStoredJson(key, fallback) {
        if (state.storageMode !== 'device') return fallback;
        try {
            const value = JSON.parse(window.localStorage.getItem(key) ?? 'null');
            return value ?? fallback;
        } catch {
            return fallback;
        }
    }

    function savedReports() {
        const storedDeviceReports = state.storageMode === 'device'
            ? readStoredJson(DIAGNOSIS_REPORTS_KEY, [])
            : [];
        const deviceReports = Array.isArray(storedDeviceReports) ? storedDeviceReports : [];
        const reports = state.storageMode === 'session'
            ? state.sessionReports
            : state.storageMode === 'device'
                ? [...deviceReports, ...state.sessionReports.filter((sessionEntry) => !deviceReports.some((deviceEntry) => deviceEntry?.id === sessionEntry?.id))]
                : [];
        if (!Array.isArray(reports)) return [];
        return reports.map((entry) => {
            const patient = entry?.patient ?? entry?.report?.intake ?? {};
            const migrated = migrateReportToV5(entry?.report, entry?.technicalAnnex ?? null, {
                assessmentProtocol: MS_HUMAN_ASSESSMENT_REPORT_PROTOCOL
            });
            return { ...entry, patient, report: migrated.report, technicalAnnex: migrated.technicalAnnex };
        }).filter((entry) => entry?.report?.generatedAt && entry.patient);
    }

    function restoreDraft() {
        const draft = readStoredJson(DIAGNOSIS_DRAFT_KEY, null);
        if (!draft || ![4, state.schemaVersion].includes(Number(draft.schemaVersion))) return false;
        const emptyResponses = Object.fromEntries(ASSESSMENT_POSITIONS.map((position) => [position.id, emptyPositionResponse()]));
        const protocolMatches = draft.assessmentProtocolId === MS_HUMAN_ASSESSMENT_REPORT_PROTOCOL.id
            && draft.assessmentProtocolVersion === MS_HUMAN_ASSESSMENT_REPORT_PROTOCOL.version
            && draft.assessmentProtocolDigest === MS_HUMAN_ASSESSMENT_REPORT_PROTOCOL.digest;
        const storedProtocolObservations = !protocolMatches && draft.capacityResponses
            ? {
                sourceSchemaVersion: Number(draft.schemaVersion),
                sourceCollection: 'draft.capacityResponses',
                sourceAssessmentProtocol: {
                    id: draft.assessmentProtocolId ?? null,
                    version: draft.assessmentProtocolVersion ?? null,
                    digest: draft.assessmentProtocolDigest ?? null
                },
                readOnly: true,
                interpretationExcluded: true,
                protocolDefinitionRemoved: true,
                modelEvidenceRemoved: true,
                mayContainFreeTextIdentifiers: true,
                archivedProtocolObservations: structuredClone(draft.capacityResponses)
            }
            : null;
        const migrateLegacyResponse = (response = {}) => {
            if (Number(draft.schemaVersion) !== 4) return response;
            const completion = ({ able: 'full', pain_limited: 'stopped', unable: 'unable', uncertain: 'stopped', not_tested: response.answered ? 'skipped' : 'not_recorded' })[response.result] ?? 'not_recorded';
            return {
                completion,
                pain: response.result === 'pain_limited' || Number(response.painScore) > 0 ? 'yes' : 'not_recorded',
                weakness: response.weakness === 'yes' || Number(response.weaknessScore) > 0 ? 'yes' : 'not_recorded',
                stiffness: 'not_recorded',
                compensation: 'not_recorded',
                painScore: response.painScore ?? '',
                weaknessScore: response.weaknessScore ?? '',
                painLocation: response.painLocation ?? '',
                limitingFactor: '',
                compensationDetail: '',
                notes: response.notes ?? '',
                answered: completion === 'skipped',
                migratedFromDraftVersion: 4
            };
        };
        state.activeCapacityIndex = protocolMatches
            ? Math.max(0, Math.min(ASSESSMENT_POSITIONS.length - 1, Number(draft.activeCapacityIndex) || 0))
            : 0;
        state.capacityResponses = Object.fromEntries(ASSESSMENT_POSITIONS.map((position) => [
            position.id,
            { ...emptyResponses[position.id], ...(protocolMatches ? migrateLegacyResponse(draft.capacityResponses?.[position.id] ?? {}) : {}) }
        ]));
        for (const response of Object.values(state.capacityResponses)) {
            response.answered = capacityResponseComplete(response);
            response.result = derivePositionResult(response);
        }
        const firstUnansweredIndex = ASSESSMENT_POSITIONS.findIndex((position) => !state.capacityResponses[position.id].answered);
        if (firstUnansweredIndex !== -1) state.activeCapacityIndex = Math.min(state.activeCapacityIndex, firstUnansweredIndex);
        state.testedSide = draft.testedSide === 'left' ? 'left' : 'right';
        state.redFlags = Object.fromEntries(RED_FLAGS.map((flag) => [
            flag.id,
            protocolMatches && typeof draft.redFlags?.[flag.id] === 'boolean' ? draft.redFlags[flag.id] : null
        ]));
        state.safetyReviewed = protocolMatches && Boolean(draft.safetyReviewed);
        state.intakeCompleted = protocolMatches && Boolean(draft.intakeCompleted);
        state.intake = draft.intake && typeof draft.intake === 'object' ? { ...draft.intake } : {};
        state.legacySymptomAssessment = storedProtocolObservations ?? (Number(draft.schemaVersion) === 4 && draft.responses
            ? {
                sourceSchemaVersion: 4,
                sourceCollection: 'draft.responses',
                readOnly: true,
                interpretationExcluded: true,
                modelEvidenceRemoved: true,
                mayContainFreeTextIdentifiers: true,
                responses: structuredClone(draft.responses ?? {})
            }
            : (draft.legacySymptomAssessment ?? null));
        state.protocolMigrationNotice = Boolean(storedProtocolObservations || draft.protocolMigrationNotice);
        state.assessmentId = protocolMatches ? (draft.assessmentId || createAssessmentId()) : createAssessmentId();
        state.assessmentOpen = protocolMatches && Boolean(draft.assessmentOpen);
        const restoredPhase = ['privacy', 'safety', 'intake', 'assessment', 'report'].includes(draft.phase) ? draft.phase : 'privacy';
        state.phase = protocolMatches ? restoredPhase : 'safety';
        state.draftUpdatedAt = draft.updatedAt ?? null;
        return true;
    }

    function persistDraft() {
        const hasData = Object.values(state.redFlags).some((value) => typeof value === 'boolean')
            || Object.values(state.intake).some((value) => value !== '' && value !== null && value !== false)
            || Object.values(state.capacityResponses).some((response) => response.answered || response.notes);
        if (state.storageMode !== 'device') {
            state.draftUpdatedAt = state.storageMode === 'session' && hasData && !(state.phase === 'report' && state.reportStored)
                ? new Date().toISOString()
                : null;
            updateSavedRecordsUi();
            return true;
        }
        if (state.phase === 'report' && !state.viewingSavedReport && state.reportStored) {
            try {
                window.localStorage.removeItem(DIAGNOSIS_DRAFT_KEY);
                state.deviceStorageError = false;
            } catch { state.deviceStorageError = true; }
            state.draftUpdatedAt = null;
            updateSavedRecordsUi();
            return !state.deviceStorageError;
        }
        if (!hasData) {
            try {
                window.localStorage.removeItem(DIAGNOSIS_DRAFT_KEY);
                state.deviceStorageError = false;
            } catch { state.deviceStorageError = true; }
            state.draftUpdatedAt = null;
            updateSavedRecordsUi();
            return !state.deviceStorageError;
        }
        const draft = {
            schemaVersion: state.schemaVersion,
            assessmentProtocolId: MS_HUMAN_ASSESSMENT_REPORT_PROTOCOL.id,
            assessmentProtocolVersion: MS_HUMAN_ASSESSMENT_REPORT_PROTOCOL.version,
            assessmentProtocolDigest: MS_HUMAN_ASSESSMENT_REPORT_PROTOCOL.digest,
            assessmentId: state.assessmentId,
            updatedAt: new Date().toISOString(),
            phase: state.phase,
            activeCapacityIndex: state.activeCapacityIndex,
            capacityResponses: state.capacityResponses,
            testedSide: state.testedSide,
            redFlags: state.redFlags,
            safetyReviewed: state.safetyReviewed,
            intakeCompleted: state.intakeCompleted,
            intake: state.intake,
            legacySymptomAssessment: state.legacySymptomAssessment,
            protocolMigrationNotice: state.protocolMigrationNotice,
            assessmentOpen: state.assessmentOpen
        };
        try {
            window.localStorage.setItem(DIAGNOSIS_DRAFT_KEY, JSON.stringify(draft));
            state.draftUpdatedAt = draft.updatedAt;
            state.deviceStorageError = false;
        } catch {
            state.deviceStorageError = true;
        }
        updateSavedRecordsUi();
        return !state.deviceStorageError;
    }

    function clearDraft() {
        if (state.storageMode === 'device') {
            try {
                window.localStorage.removeItem(DIAGNOSIS_DRAFT_KEY);
                state.deviceStorageError = false;
            } catch { state.deviceStorageError = true; }
        }
        state.draftUpdatedAt = null;
        updateSavedRecordsUi();
    }

    function fillIntakeForm(intake = {}) {
        const form = byId('diagnosis-intake-form');
        for (const element of form.elements) {
            if (!element.name || !(element.name in intake)) continue;
            if (element.type === 'checkbox') element.checked = Boolean(intake[element.name]);
            else element.value = intake[element.name] ?? '';
        }
    }

    function reportPatientKey(intake = {}) {
        const recordLabel = String(intake.name ?? '').trim().toLowerCase();
        return recordLabel ? `label:${recordLabel}` : null;
    }

    function archiveReport(report) {
        if (!report?.generatedAt || !state.storageMode) return false;
        const patient = { ...state.intake };
        const assessmentId = report.assessment?.assessmentId || report.generatedAt;
        const entry = { id: assessmentId, patientKey: reportPatientKey(patient) ?? `assessment:${assessmentId}`, patient, report, technicalAnnex: state.reportAnnex };
        const reports = savedReports().filter((item) => (item.report?.assessment?.assessmentId || item.id) !== assessmentId);
        reports.unshift(entry);
        if (reports.length > MAX_SAVED_REPORTS) return false;
        if (state.storageMode === 'session') {
            state.sessionReports = reports;
            updateSavedRecordsUi();
            return true;
        }
        try {
            window.localStorage.setItem(DIAGNOSIS_REPORTS_KEY, JSON.stringify(reports));
            state.deviceStorageError = false;
        } catch {
            state.deviceStorageError = true;
            return false;
        }
        updateSavedRecordsUi();
        return true;
    }

    function closeAppDialog() {
        const returnFocus = state.dialogReturnFocus;
        state.dialogAction = null;
        state.dialogReturnFocus = null;
        byId('app-dialog').classList.add('hidden');
        byId('app-dialog').querySelector('.app-dialog-card').classList.remove('danger');
        for (const element of document.querySelectorAll('main > :not(#app-dialog)')) element.inert = false;
        if (returnFocus?.isConnected) returnFocus.focus();
    }

    function showAppDialog({ title, message, confirmLabel = null, danger = false, onConfirm }) {
        state.dialogReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        state.dialogAction = onConfirm;
        byId('app-dialog-title').textContent = title;
        byId('app-dialog-message').textContent = message;
        byId('app-dialog-confirm').textContent = confirmLabel ?? t('common.actions.confirm');
        byId('app-dialog').querySelector('.app-dialog-card').classList.toggle('danger', danger);
        for (const element of document.querySelectorAll('main > :not(#app-dialog)')) element.inert = true;
        byId('app-dialog').classList.remove('hidden');
        byId('app-dialog-cancel').focus();
    }

    function beginAssessmentWithPatientDetails(entry) {
        const prior = entry.patient ?? entry.report.intake ?? {};
        const demographics = ['name', 'ageYears', 'gender', 'heightCm', 'weightKg', 'assessedArm'];
        cancelPreview();
        state.assessmentId = createAssessmentId();
        state.activeCapacityIndex = 0;
        state.capacityResponses = Object.fromEntries(ASSESSMENT_POSITIONS.map((position) => [position.id, emptyPositionResponse()]));
        state.capacityModelStates = {};
        state.redFlags = Object.fromEntries(RED_FLAGS.map((flag) => [flag.id, null]));
        state.safetyReviewed = false;
        state.intake = {};
        for (const field of demographics) state.intake[field] = prior[field] ?? '';
        state.testedSide = state.intake.assessedArm === 'left' ? 'left' : 'right';
        state.intakeCompleted = false;
        state.report = null;
        state.reportAnnex = null;
        state.reportStored = false;
        state.legacySymptomAssessment = null;
        state.protocolMigrationNotice = null;
        state.viewingSavedReport = false;
        byId('diagnosis-intake-form').reset();
        fillIntakeForm(state.intake);
        clearDraft();
        setSide(state.testedSide);
        renderCapacityList();
        showSafetyLanding();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function importPatientDetails(entry) {
        const prior = entry.patient ?? entry.report.intake ?? {};
        const participant = prior.name || t('assessment.participant.this-participant');
        showAppDialog({
            title: t('assessment.dialogs.reassess.title', { participant }),
            message: t('assessment.dialogs.reassess.message'),
            confirmLabel: t('assessment.dialogs.reassess.confirm'),
            danger: false,
            onConfirm: () => beginAssessmentWithPatientDetails(entry)
        });
    }

    function removeSavedReport(entry) {
        const remaining = savedReports().filter((item) => item.id !== entry.id);
        state.sessionReports = state.sessionReports.filter((item) => item.id !== entry.id);
        if (state.storageMode === 'device') {
            try {
                window.localStorage.setItem(DIAGNOSIS_REPORTS_KEY, JSON.stringify(remaining));
                state.deviceStorageError = false;
            } catch { state.deviceStorageError = true; }
        } else if (state.storageMode === 'session') {
            state.sessionReports = remaining;
        }
        updateSavedRecordsUi();
    }

    function updateSavedRecordsUi() {
        const reports = savedReports();
        const answered = ASSESSMENT_POSITIONS.filter((position) => state.capacityResponses[position.id]?.answered).length;
        const patient = state.intake?.name ? t('assessment.storage.participant-prefix', { participant: state.intake.name }) : '';
        const draftState = byId('diagnosis-draft-state');
        const privacy = byId('diagnosis-records-privacy');
        const activeStorageNotice = byId('diagnosis-active-storage-notice');
        const hasOngoingAssessment = !state.viewingSavedReport
            && (state.assessmentOpen || state.phase === 'safety' || state.phase === 'intake');
        const hasStoredAssessmentData = reports.length > 0 || Boolean(state.draftUpdatedAt);
        const newAssessmentButton = byId('diagnosis-new-assessment');
        const clearDataButton = byId('diagnosis-delete-all-data');
        newAssessmentButton.disabled = !state.storageMode;
        newAssessmentButton.classList.toggle('hidden', !hasOngoingAssessment);
        clearDataButton.classList.toggle('hidden', !hasStoredAssessmentData);
        if (!state.storageMode) {
            draftState.textContent = t('assessment.storage.choose');
            privacy.textContent = t('assessment.storage.none-loaded');
        } else if (state.storageMode === 'session') {
            draftState.textContent = state.protocolMigrationNotice ? t('assessment.storage.protocol-migration') : (state.draftUpdatedAt
                ? t('assessment.storage.session-progress', { patient, answered, total: ASSESSMENT_POSITIONS.length })
                : t('assessment.storage.session-empty'));
            privacy.textContent = t('assessment.storage.session-privacy');
            if (activeStorageNotice) activeStorageNotice.textContent = t('assessment.storage.session-notice');
        } else {
            draftState.textContent = state.protocolMigrationNotice ? t('assessment.storage.protocol-migration') : (state.draftUpdatedAt
                ? t('assessment.storage.device-progress', { patient, answered, total: ASSESSMENT_POSITIONS.length })
                : t('assessment.storage.device-empty'));
            privacy.textContent = state.deviceStorageError
                ? t('assessment.storage.save-failed')
                : t('assessment.storage.device-privacy');
            if (activeStorageNotice) activeStorageNotice.textContent = t('assessment.storage.device-notice');
        }
        draftState.textContent = t('assessment.storage.record-state', { recordCode: recordCode(), state: draftState.textContent });

        const host = byId('diagnosis-saved-report-list');
        host.replaceChildren();
        if (!reports.length) {
            const empty = document.createElement('p');
            empty.className = 'saved-report-empty';
            empty.textContent = !state.storageMode
                ? t('assessment.records.empty-unloaded')
                : state.storageMode === 'session'
                    ? t('assessment.records.empty-session')
                    : t('assessment.records.empty-device');
            host.append(empty);
            return;
        }
        const table = document.createElement('table');
        table.className = 'saved-report-table';
        table.innerHTML = `<thead><tr><th>${escapeHtml(t('assessment.records.columns.record'))}</th><th>${escapeHtml(t('assessment.records.columns.participant'))}</th><th>${escapeHtml(t('assessment.records.columns.assessment'))}</th><th>${escapeHtml(t('assessment.records.columns.actions'))}</th></tr></thead>`;
        const body = document.createElement('tbody');
        for (const entry of reports) {
            const row = document.createElement('tr');
            const reportCode = recordCode(entry.report.assessment?.assessmentId || entry.id);
            const generatedDate = new Date(entry.report.generatedAt);
            const validDate = !Number.isNaN(generatedDate.getTime());
            const quality = entry.report.dataQuality ?? {};
            const legacy = entry.report.assessment?.legacyModelRecord === true;
            const statusCode = legacy ? 'archived'
                : quality.recordStatus === 'complete_record' ? 'complete'
                    : quality.recordStatus === 'conflicting_record' ? 'review-needed' : 'incomplete';
            const statusText = t(`assessment.records.status.${statusCode}`);

            const recordCell = document.createElement('td');
            recordCell.className = 'saved-report-record-cell';
            recordCell.dataset.label = t('assessment.records.columns.record');
            const recordDetails = document.createElement('div');
            recordDetails.className = 'saved-report-record';
            const code = document.createElement('strong');
            code.className = 'saved-report-code';
            code.textContent = reportCode;
            const date = document.createElement('time');
            if (validDate) date.dateTime = generatedDate.toISOString();
            date.textContent = localizedDate(generatedDate);
            const status = document.createElement('span');
            status.className = `saved-report-status ${statusCode}`;
            status.textContent = statusText;
            recordDetails.append(code, date, status);
            recordCell.append(recordDetails);
            row.append(recordCell);

            const patientCell = document.createElement('td');
            patientCell.className = 'saved-report-patient-cell';
            patientCell.dataset.label = t('assessment.records.columns.participant');
            const patientDetails = document.createElement('div');
            patientDetails.className = 'saved-report-patient';
            const patientName = document.createElement('strong');
            patientName.textContent = entry.patient?.name || t('assessment.participant.no-label');
            patientDetails.append(patientName);
            const patientMeta = document.createElement('span');
            patientMeta.textContent = [
                Number.isFinite(entry.patient?.ageYears) ? plural('common.age-years', entry.patient.ageYears) : null,
                entry.patient?.gender ? intakeOptionLabel('gender', entry.patient.gender) : null
            ].filter(Boolean).join(t('common.separator.middle-dot')) || t('assessment.participant.profile-not-recorded');
            patientDetails.append(patientMeta);
            const measures = [
                Number.isFinite(entry.patient?.heightCm) ? `${formatNumber(entry.patient.heightCm)} cm` : null,
                Number.isFinite(entry.patient?.weightKg) ? `${formatNumber(entry.patient.weightKg)} kg` : null
            ].filter(Boolean).join(t('common.separator.middle-dot'));
            if (measures) {
                const measureMeta = document.createElement('span');
                measureMeta.textContent = measures;
                patientDetails.append(measureMeta);
            }
            if (legacy) {
                const legacyLabel = document.createElement('span');
                legacyLabel.textContent = t('assessment.records.archived-description');
                patientDetails.append(legacyLabel);
            }
            patientCell.append(patientDetails);
            row.append(patientCell);

            const assessmentCell = document.createElement('td');
            assessmentCell.className = 'saved-report-assessment-cell';
            assessmentCell.dataset.label = t('assessment.records.columns.assessment');
            const assessmentDetails = document.createElement('div');
            assessmentDetails.className = 'saved-report-assessment';
            const arm = entry.patient?.assessedArm || entry.report.assessment?.testedSide;
            const armValue = document.createElement('strong');
            armValue.textContent = arm ? t('assessment.records.arm', { side: sideLabel(arm) }) : t('assessment.records.arm-not-recorded');
            const progress = document.createElement('span');
            const recorded = Number.isFinite(quality.recordedTrialCount) ? quality.recordedTrialCount : null;
            const required = Number.isFinite(quality.requiredTrialCount) ? quality.requiredTrialCount : null;
            progress.textContent = recorded !== null && required !== null
                ? t('assessment.records.position-progress', { recorded, required })
                : t('assessment.records.position-count-unavailable');
            assessmentDetails.append(armValue, progress);
            assessmentCell.append(assessmentDetails);
            row.append(assessmentCell);

            const actions = document.createElement('td');
            actions.className = 'saved-report-actions-cell';
            actions.dataset.label = t('assessment.records.columns.actions');
            const actionButtons = document.createElement('div');
            actionButtons.className = 'saved-report-actions';
            const use = document.createElement('button');
            use.type = 'button';
            use.className = 'saved-report-action reuse';
            use.textContent = t('assessment.records.actions.assess-again');
            use.setAttribute('aria-label', t('assessment.records.actions.assess-again-label', { recordCode: reportCode }));
            use.addEventListener('click', () => importPatientDetails(entry));
            const view = document.createElement('button');
            view.type = 'button';
            view.className = 'saved-report-action open';
            view.textContent = t('assessment.records.actions.open-report');
            view.setAttribute('aria-label', t('assessment.records.actions.open-report-label', { recordCode: reportCode }));
            view.addEventListener('click', () => showSavedReport(entry));
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'saved-report-action delete';
            remove.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg>';
            remove.setAttribute('aria-label', t('assessment.records.actions.delete-report-label', { recordCode: reportCode }));
            remove.title = t('assessment.records.actions.delete-report');
            remove.addEventListener('click', () => {
                showAppDialog({
                    title: t('assessment.dialogs.delete-report.title'),
                    message: t(entry.patient?.name ? 'assessment.dialogs.delete-report.message-named' : 'assessment.dialogs.delete-report.message', {
                        ...(entry.patient?.name ? { participant: entry.patient.name } : {}),
                        date: localizedDate(entry.report.generatedAt),
                        location: t(state.storageMode === 'session' ? 'assessment.storage.location-tab' : 'assessment.storage.location-browser')
                    }),
                    confirmLabel: t('assessment.records.actions.delete-report'),
                    danger: true,
                    onConfirm: () => removeSavedReport(entry)
                });
            });
            actionButtons.append(view, use, remove);
            actions.append(actionButtons);
            row.append(actions);
            body.append(row);
        }
        table.append(body);
        host.append(table);
    }

    function showSavedReport(entry) {
        cancelPreview();
        state.viewingSavedReport = true;
        state.reportStored = true;
        state.report = entry.report;
        state.reportAnnex = entry.technicalAnnex ?? null;
        byId('diagnosis-safety-landing').classList.add('hidden');
        byId('diagnosis-intake').classList.add('hidden');
        byId('diagnosis-assessment').classList.add('hidden');
        byId('diagnosis-report-screen').classList.remove('hidden');
        byId('diagnosis-privacy-overview').classList.add('hidden');
        byId('diagnosis-start').classList.add('hidden');
        byId('diagnosis-report-back').textContent = t('common.actions.back');
        renderMovementReport(state.report);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function showPrivacyLanding() {
        cancelPreview();
        state.assessmentOpen = false;
        state.phase = 'privacy';
        state.viewingSavedReport = false;
        byId('diagnosis-privacy-overview').classList.remove('hidden');
        byId('diagnosis-start').classList.remove('hidden');
        byId('diagnosis-safety-landing').classList.add('hidden');
        byId('diagnosis-intake').classList.add('hidden');
        byId('diagnosis-assessment').classList.add('hidden');
        byId('diagnosis-report-screen').classList.add('hidden');
        window.requestAnimationFrame(controller.resizeViewer);
    }

    function showSafetyLanding() {
        cancelPreview();
        state.assessmentOpen = false;
        state.phase = 'safety';
        state.viewingSavedReport = false;
        byId('diagnosis-privacy-overview').classList.add('hidden');
        byId('diagnosis-start').classList.add('hidden');
        byId('diagnosis-safety-landing').classList.remove('hidden');
        byId('diagnosis-intake').classList.add('hidden');
        byId('diagnosis-assessment').classList.add('hidden');
        byId('diagnosis-report-screen').classList.add('hidden');
        renderSafetyForm();
        updateWarning();
        persistDraft();
        window.requestAnimationFrame(controller.resizeViewer);
    }

    function readIntake() {
        const form = byId('diagnosis-intake-form');
        const data = new FormData(form);
        state.intake = {
            name: String(data.get('name') ?? '').trim(),
            ageYears: finiteOrNull(data.get('ageYears')),
            gender: String(data.get('gender') ?? ''),
            heightCm: finiteOrNull(data.get('heightCm')),
            weightKg: finiteOrNull(data.get('weightKg')),
            assessedArm: String(data.get('assessedArm') ?? ''),
            painDuration: String(data.get('painDuration') ?? ''),
            painOnset: String(data.get('painOnset') ?? ''),
            painNow: finiteOrNull(data.get('painNow')),
            painWorst: finiteOrNull(data.get('painWorst')),
            primaryPainLocation: String(data.get('primaryPainLocation') ?? ''),
            painAtRest: data.has('painAtRest'),
            nightPain: data.has('nightPain'),
            radiatingPain: data.has('radiatingPain'),
            clickingInstability: data.has('clickingInstability'),
            onsetDetails: String(data.get('onsetDetails') ?? '').trim(),
            aggravatingRelieving: String(data.get('aggravatingRelieving') ?? '').trim(),
            relevantHistory: String(data.get('relevantHistory') ?? '').trim(),
            privacyAccepted: data.has('privacyAccepted')
        };
        state.report = null;
    }

    function showIntake() {
        if (!state.safetyReviewed || selectedRedFlags().length) {
            showSafetyLanding();
            return;
        }
        cancelPreview();
        state.assessmentOpen = false;
        state.phase = 'intake';
        state.viewingSavedReport = false;
        byId('diagnosis-privacy-overview').classList.add('hidden');
        byId('diagnosis-start').classList.add('hidden');
        byId('diagnosis-safety-landing').classList.add('hidden');
        byId('diagnosis-intake').classList.remove('hidden');
        byId('diagnosis-assessment').classList.add('hidden');
        byId('diagnosis-report-screen').classList.add('hidden');
        fillIntakeForm(state.intake);
        byId('diagnosis-intake-state').textContent = state.intakeCompleted
            ? t(state.storageMode === 'device' ? 'assessment.intake.state.saved-device' : 'assessment.intake.state.kept-tab')
            : t('assessment.intake.state.complete-details');
        persistDraft();
        window.requestAnimationFrame(controller.resizeViewer);
    }

    function intakeOptionLabel(fieldName, value) {
        if (!value) return t('common.punctuation.em-dash');
        const option = byId('diagnosis-intake-form').querySelector(`[name="${fieldName}"] option[value="${CSS.escape(String(value))}"]`);
        return option?.textContent?.trim() || t('assessment.intake.options.unknown', { value: String(value) });
    }

    function sideLabel(side) {
        return ['left', 'right'].includes(side) ? t(`common.sides.${side}`) : t('common.status.not-recorded');
    }

    function renderAssessmentPatientHeader() {
        const intake = state.intake ?? {};
        const age = Number.isFinite(intake.ageYears) ? plural('common.age-years', intake.ageYears) : t('common.punctuation.em-dash');
        const size = [
            Number.isFinite(intake.heightCm) ? `${formatNumber(intake.heightCm)} cm` : '',
            Number.isFinite(intake.weightKg) ? `${formatNumber(intake.weightKg)} kg` : ''
        ].filter(Boolean).join(t('common.separator.slash')) || t('common.punctuation.em-dash');
        const painNow = Number.isFinite(intake.painNow) ? formatNumber(intake.painNow) : t('common.punctuation.em-dash');
        const painWorst = Number.isFinite(intake.painWorst) ? formatNumber(intake.painWorst) : t('common.punctuation.em-dash');
        byId('diagnosis-patient-name').textContent = intake.name || t('assessment.participant.no-label');
        byId('diagnosis-current-record-code').textContent = recordCode();
        byId('diagnosis-patient-age').textContent = age;
        byId('diagnosis-patient-gender').textContent = intakeOptionLabel('gender', intake.gender);
        byId('diagnosis-patient-arm').textContent = intakeOptionLabel('assessedArm', intake.assessedArm);
        byId('diagnosis-patient-size').textContent = size;
        byId('diagnosis-patient-pain').textContent = t('assessment.participant.pain-values', { current: painNow, worst: painWorst });
        byId('diagnosis-patient-duration').textContent = intakeOptionLabel('painDuration', intake.painDuration);
        byId('diagnosis-patient-location').textContent = intakeOptionLabel('primaryPainLocation', intake.primaryPainLocation);
    }

    function showAssessment() {
        if (!state.safetyReviewed || selectedRedFlags().length) {
            showSafetyLanding();
            return;
        }
        if (!state.intakeCompleted) {
            showIntake();
            return;
        }
        state.assessmentOpen = true;
        state.phase = 'assessment';
        state.viewingSavedReport = false;
        byId('diagnosis-privacy-overview').classList.add('hidden');
        byId('diagnosis-safety-landing').classList.add('hidden');
        byId('diagnosis-intake').classList.add('hidden');
        byId('diagnosis-assessment').classList.remove('hidden');
        byId('diagnosis-report-screen').classList.add('hidden');
        renderAssessmentPatientHeader();
        renderCapacityList();
        renderCapacityPosition();
        persistDraft();
        window.requestAnimationFrame(controller.resizeViewer);
    }

    async function showReportScreen() {
        const previewGeneration = state.previewGeneration;
        await state.capacityPreviewPromise;
        if (previewGeneration !== state.previewGeneration || !['assessment', 'report'].includes(state.phase)) return;
        state.assessmentOpen = false;
        state.phase = 'report';
        state.viewingSavedReport = false;
        state.report = buildReport();
        byId('diagnosis-privacy-overview').classList.add('hidden');
        byId('diagnosis-safety-landing').classList.add('hidden');
        byId('diagnosis-intake').classList.add('hidden');
        byId('diagnosis-assessment').classList.add('hidden');
        byId('diagnosis-report-screen').classList.remove('hidden');
        byId('diagnosis-report-back').textContent = t('assessment.report.back');
        renderMovementReport(state.report);
        state.reportStored = archiveReport(state.report);
        if (state.reportStored) {
            clearDraft();
        } else {
            persistDraft();
            showAppDialog({
                title: t('assessment.dialogs.report-storage.title'),
                message: t('assessment.dialogs.report-storage.message'),
                confirmLabel: t('assessment.dialogs.report-storage.confirm'),
                danger: false,
                onConfirm: () => {}
            });
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
        window.requestAnimationFrame(controller.resizeViewer);
    }

    function resetAssessmentData() {
        cancelPreview();
        state.assessmentId = createAssessmentId();
        state.activeCapacityIndex = 0;
        state.capacityResponses = Object.fromEntries(ASSESSMENT_POSITIONS.map((position) => [position.id, emptyPositionResponse()]));
        state.capacityModelStates = {};
        state.testedSide = 'right';
        state.redFlags = Object.fromEntries(RED_FLAGS.map((flag) => [flag.id, null]));
        state.safetyReviewed = false;
        state.intakeCompleted = false;
        state.intake = {};
        state.report = null;
        state.reportAnnex = null;
        state.reportStored = false;
        state.legacySymptomAssessment = null;
        state.protocolMigrationNotice = null;
        byId('diagnosis-intake-form').reset();
        clearDraft();
        setSide('right');
        renderCapacityList();
        showPrivacyLanding();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function deleteAllLocalAssessmentData() {
        try {
            window.localStorage.removeItem(DIAGNOSIS_DRAFT_KEY);
            window.localStorage.removeItem(DIAGNOSIS_REPORTS_KEY);
        } catch { /* storage unavailable */ }
        state.sessionReports = [];
        resetAssessmentData();
        updateSavedRecordsUi();
    }

    function requestDeleteAllLocalAssessmentData() {
        showAppDialog({
            title: t('assessment.dialogs.delete-all.title'),
            message: t('assessment.dialogs.delete-all.message'),
            confirmLabel: t('assessment.dialogs.delete-all.confirm'),
            danger: true,
            onConfirm: deleteAllLocalAssessmentData
        });
    }

    function restartAssessment() {
        const hasAssessmentData = state.intakeCompleted
            || Object.values(state.redFlags).some((value) => typeof value === 'boolean')
            || Object.values(state.intake).some((value) => value !== '' && value !== null && value !== false)
            || Object.values(state.capacityResponses).some((response) => response.answered || response.notes);
        if (!hasAssessmentData) {
            resetAssessmentData();
            return;
        }
        showAppDialog({
            title: t('assessment.dialogs.restart.title'),
            message: t('assessment.dialogs.restart.message'),
            confirmLabel: t('assessment.dialogs.restart.confirm'),
            danger: true,
            onConfirm: resetAssessmentData
        });
    }

    function renderCapacityList() {
        const tableBody = byId('capacity-position-list');
        tableBody.replaceChildren();
        const firstUnansweredIndex = ASSESSMENT_POSITIONS.findIndex((position) => !state.capacityResponses[position.id]?.answered);
        const unlockedThrough = firstUnansweredIndex === -1 ? ASSESSMENT_POSITIONS.length - 1 : firstUnansweredIndex;
        const fieldOptions = {
            completion: [
                ['not_recorded', t('assessment.responses.completion.select')],
                ['full', t('assessment.responses.completion.full')],
                ['partial', t('assessment.responses.completion.partial')],
                ['unable', t('assessment.responses.completion.unable')],
                ['stopped', t('assessment.responses.completion.stopped')],
                ['skipped', t('assessment.responses.completion.skipped')]
            ],
            pain: [['not_recorded', t('common.options.select')], ['no', t('common.options.no')], ['yes', t('common.options.yes')]],
            weakness: [['not_recorded', t('common.options.select')], ['no', t('common.options.no')], ['yes', t('common.options.yes')]],
            stiffness: [['not_recorded', t('common.options.select')], ['no', t('common.options.no')], ['yes', t('common.options.yes')]],
            compensation: [['not_recorded', t('common.options.select')], ['no', t('common.options.no')], ['yes', t('common.options.yes')], ['uncertain', t('assessment.responses.value.unsure')]],
            limitingFactor: [
                ['', t('common.options.select')], ['pain', t('assessment.responses.limiting.pain')], ['weakness', t('assessment.responses.limiting.weakness')], ['stiffness', t('assessment.responses.limiting.stiffness')],
                ['instability', t('assessment.responses.limiting.instability')], ['fear', t('assessment.responses.limiting.fear')], ['coordination', t('assessment.responses.limiting.coordination')], ['other', t('assessment.responses.limiting.other')]
            ]
        };
        const fieldLabels = {
            completion: t('assessment.responses.fields.completion'),
            pain: t('assessment.responses.fields.pain'),
            weakness: t('assessment.responses.fields.weakness'),
            stiffness: t('assessment.responses.fields.stiffness'),
            compensation: t('assessment.responses.fields.compensation')
        };
        const optionLabel = (field, value) => fieldOptions[field].find(([option]) => option === value)?.[1] ?? t('common.punctuation.em-dash');
        const responseChoices = (field, response, position) => {
            const group = document.createElement('div');
            group.className = `capacity-choice-group ${field === 'completion' ? 'completion' : ''}`;
            group.setAttribute('role', 'group');
            const positionName = t(`assessment.positions.${position.id}.name`);
            group.setAttribute('aria-label', t('assessment.responses.aria.field-for-position', { field: fieldLabels[field], position: positionName }));
            for (const [value, label] of fieldOptions[field].filter(([optionValue]) => optionValue !== 'not_recorded')) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = `capacity-choice-button choice-${field} value-${value}`;
                button.classList.toggle('selected', response[field] === value);
                button.setAttribute('aria-pressed', response[field] === value ? 'true' : 'false');
                button.setAttribute('aria-label', t('assessment.responses.aria.choice-for-position', { choice: label, field: fieldLabels[field], position: positionName }));
                button.textContent = label;
                button.addEventListener('click', () => updateCapacityResponse(field, value));
                group.append(button);
            }
            return group;
        };
        const addDetailSelect = (host, { label, field, value, options, required = false }) => {
            const wrapper = document.createElement('label');
            wrapper.className = 'capacity-detail-field';
            const caption = document.createElement('span');
            caption.textContent = required ? t('assessment.responses.required-label', { label }) : label;
            const select = document.createElement('select');
            select.setAttribute('aria-label', label);
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = t('common.options.select');
            select.append(placeholder);
            for (const [optionValue, optionLabelText] of options) {
                const option = document.createElement('option');
                option.value = optionValue;
                option.textContent = optionLabelText;
                option.selected = String(value ?? '') === String(optionValue);
                select.append(option);
            }
            select.addEventListener('change', () => updateCapacityResponse(field, select.value));
            wrapper.append(caption, select);
            host.append(wrapper);
        };
        ASSESSMENT_POSITIONS.forEach((position, index) => {
            const response = { ...emptyPositionResponse(), ...state.capacityResponses[position.id] };
            state.capacityResponses[position.id] = response;
            const active = index === state.activeCapacityIndex;
            const locked = index > unlockedThrough;
            const row = document.createElement('tr');
            row.classList.toggle('active', active);
            row.classList.toggle('locked', locked);
            const positionCell = document.createElement('th');
            positionCell.scope = 'row';
            const positionButton = document.createElement('button');
            positionButton.type = 'button';
            positionButton.className = 'capacity-position-open';
            positionButton.disabled = locked;
            positionButton.setAttribute('aria-current', active ? 'step' : 'false');
            const positionName = t(`assessment.positions.${position.id}.name`);
            if (locked) positionButton.setAttribute('aria-label', t('assessment.responses.aria.locked-position', { position: positionName }));
            const progressLabel = response.answered
                ? t(response.completion === 'skipped' ? 'assessment.responses.row-status.skipped' : 'assessment.responses.row-status.recorded')
                : t(locked ? 'assessment.responses.row-status.locked' : 'assessment.responses.row-status.next');
            positionButton.innerHTML = `<span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(positionName)}</strong><em>${progressLabel}</em>`;
            positionButton.addEventListener('click', () => {
                state.activeCapacityIndex = index;
                renderCapacityList();
                renderCapacityPosition();
                persistDraft();
            });
            positionCell.append(positionButton);
            row.append(positionCell);
            ['completion', 'pain', 'weakness', 'stiffness', 'compensation'].forEach((field) => {
                const cell = document.createElement('td');
                cell.dataset.label = fieldLabels[field];
                if (active) {
                    cell.append(responseChoices(field, response, position));
                } else if (response[field] && response[field] !== 'not_recorded') {
                    const value = document.createElement('span');
                    value.className = 'capacity-record-value';
                    value.textContent = `X ${optionLabel(field, response[field])}`;
                    value.setAttribute('aria-label', t('assessment.responses.aria.field-value', { field: fieldLabels[field], value: optionLabel(field, response[field]) }));
                    cell.append(value);
                }
                row.append(cell);
            });
            const commentsCell = document.createElement('td');
            commentsCell.dataset.label = t('assessment.responses.fields.notes');
            if (active) {
                const notes = document.createElement('textarea');
                notes.className = 'capacity-record-comments';
                notes.maxLength = 500;
                notes.rows = 2;
                notes.placeholder = t('assessment.responses.notes-optional');
                notes.setAttribute('aria-label', t('assessment.responses.aria.comments-for-position', { position: positionName }));
                notes.value = response.notes;
                notes.addEventListener('input', (event) => {
                    response.notes = event.target.value.trim();
                    state.report = null;
                    persistDraft();
                });
                commentsCell.append(notes);
            } else if (response.notes) {
                const note = document.createElement('span');
                note.className = 'capacity-record-comment-text';
                note.textContent = response.notes;
                commentsCell.append(note);
            }
            row.append(commentsCell);
            tableBody.append(row);

            const showDetails = active && response.completion !== 'skipped'
                && (['partial', 'unable', 'stopped'].includes(response.completion)
                    || response.pain === 'yes' || response.weakness === 'yes' || response.compensation === 'yes');
            if (showDetails) {
                const detailRow = document.createElement('tr');
                detailRow.className = 'capacity-detail-row';
                const detailCell = document.createElement('td');
                detailCell.colSpan = 7;
                const details = document.createElement('div');
                details.className = 'capacity-detail-fields';
                if (['partial', 'unable', 'stopped'].includes(response.completion)) {
                    addDetailSelect(details, {
                        label: t('assessment.responses.fields.limiting-factor'),
                        field: 'limitingFactor',
                        value: response.limitingFactor,
                        options: fieldOptions.limitingFactor.slice(1),
                        required: true
                    });
                }
                if (response.pain === 'yes') {
                    addDetailSelect(details, {
                        label: t('assessment.responses.fields.pain-score'),
                        field: 'painScore',
                        value: response.painScore,
                        options: Array.from({ length: 10 }, (_, value) => [String(value + 1), String(value + 1)]),
                        required: true
                    });
                    addDetailSelect(details, {
                        label: t('assessment.responses.fields.pain-location'),
                        field: 'painLocation',
                        value: response.painLocation,
                        options: [
                            ['front_shoulder', t('assessment.responses.pain-location.front-shoulder')],
                            ['top_shoulder', t('assessment.responses.pain-location.top-shoulder')],
                            ['back_shoulder', t('assessment.responses.pain-location.back-shoulder')],
                            ['lateral_upper_arm', t('assessment.responses.pain-location.lateral-upper-arm')],
                            ['neck_arm', t('assessment.responses.pain-location.neck-arm')],
                            ['other', t('assessment.responses.pain-location.other')]
                        ],
                        required: true
                    });
                }
                if (response.weakness === 'yes') {
                    addDetailSelect(details, {
                        label: t('assessment.responses.fields.weakness-score'),
                        field: 'weaknessScore',
                        value: response.weaknessScore,
                        options: Array.from({ length: 10 }, (_, value) => [String(value + 1), String(value + 1)]),
                        required: true
                    });
                }
                if (response.compensation === 'yes') {
                    addDetailSelect(details, {
                        label: t('assessment.responses.fields.movement-difference'),
                        field: 'compensationDetail',
                        value: response.compensationDetail,
                        options: [
                            ['shoulder_hike', t('assessment.responses.movement-difference.shoulder-hike')],
                            ['trunk_lean', t('assessment.responses.movement-difference.trunk-lean')],
                            ['scapular_difference', t('assessment.responses.movement-difference.scapular-difference')],
                            ['other', t('assessment.responses.movement-difference.other')]
                        ],
                        required: true
                    });
                }
                const help = document.createElement('span');
                help.className = 'capacity-detail-help';
                help.textContent = t('assessment.responses.details-required');
                details.append(help);
                detailCell.append(details);
                detailRow.append(detailCell);
                tableBody.append(detailRow);
            }
        });
        const answeredCount = ASSESSMENT_POSITIONS.filter((position) => state.capacityResponses[position.id]?.answered).length;
        const reportRow = document.createElement('tr');
        reportRow.className = 'capacity-report-list-item';
        const reportCell = document.createElement('td');
        reportCell.colSpan = 7;
        const reportButton = document.createElement('button');
            reportButton.type = 'button';
            reportButton.className = 'capacity-report-list-button';
            reportButton.disabled = answeredCount !== ASSESSMENT_POSITIONS.length;
            reportButton.innerHTML = `<span class="diagnosis-test-number" aria-hidden="true">✓</span><span class="diagnosis-test-copy"><strong>${escapeHtml(t('assessment.responses.review-results'))}</strong><span>${escapeHtml(t('assessment.responses.positions-complete', { answered: answeredCount, total: ASSESSMENT_POSITIONS.length }))}</span></span>`;
        reportButton.addEventListener('click', showReportScreen);
        reportCell.append(reportButton);
        reportRow.append(reportCell);
        tableBody.append(reportRow);
    }

    async function previewCapacityPose() {
        if (!state.ready || state.phase !== 'assessment') return;
        const position = ASSESSMENT_POSITIONS[state.activeCapacityIndex];
        if (!position) return;
        const preview = ++state.previewGeneration;
        const loading = byId('capacity-view-loading');
        loading.querySelector('strong').textContent = t('assessment.responses.loading-posture');
        loading.classList.remove('hidden');
        controller.neutralizeActivation();
        try {
            const geometry = await controller.pose(position.coordinates, selectedMuscle(controller));
            if (preview !== state.previewGeneration || state.phase !== 'assessment') return;
            geometry.mode = 'pose';
            for (const muscle of geometry.muscles ?? []) delete muscle.activation;
            controller.applyState(geometry);
            if (typeof controller.frameDiagnosisPose === 'function') controller.frameDiagnosisPose();
            else controller.resetView();
            loading.querySelector('strong').textContent = t('assessment.responses.calculating-activation');

            const result = await controller.staticHold(position.coordinates, selectedMuscle(controller));
            if (preview !== state.previewGeneration || state.phase !== 'assessment') return;
            state.capacityModelStates[position.id] = result;
            controller.applyState(result);
        } catch {
            if (preview !== state.previewGeneration || state.phase !== 'assessment') return;
            controller.neutralizeActivation();
        } finally {
            if (preview === state.previewGeneration) loading.classList.add('hidden');
        }
    }

    function renderCapacityPosition() {
        const positions = ASSESSMENT_POSITIONS;
        state.activeCapacityIndex = Math.max(0, Math.min(positions.length - 1, state.activeCapacityIndex));
        const position = positions[state.activeCapacityIndex];
        const response = state.capacityResponses[position.id];
        byId('capacity-position-id').textContent = t('assessment.position.progress', { current: state.activeCapacityIndex + 1, total: positions.length });
        byId('capacity-position-title').textContent = t(`assessment.positions.${position.id}.name`);
        byId('capacity-position-instruction').textContent = t(`assessment.positions.${position.id}.instruction`);
        byId('capacity-angle-grid').innerHTML = POSE_KEYS.map((key) => `<div><dt>${escapeHtml(t(CAPACITY_ANGLE_LABELS[key]))}</dt><dd>${Number(position.coordinates[key]).toFixed(1)}°</dd></div>`).join('');
        byId('capacity-save-state').textContent = capacityResponseStatus(response);
        byId('capacity-previous').disabled = state.activeCapacityIndex === 0;
        state.capacityPreviewPromise = previewCapacityPose();
    }

    function capacityResponseComplete(response) {
        if (response.completion === 'skipped') return true;
        if (!['full', 'partial', 'unable', 'stopped'].includes(response.completion)) return false;
        if (!['no', 'yes'].includes(response.pain) || !['no', 'yes'].includes(response.weakness) || !['no', 'yes'].includes(response.stiffness)) return false;
        if (!['no', 'yes', 'uncertain'].includes(response.compensation)) return false;
        if (['partial', 'unable', 'stopped'].includes(response.completion) && !response.limitingFactor) return false;
        if (response.pain === 'yes' && (!response.painScore || !response.painLocation)) return false;
        if (response.weakness === 'yes' && !response.weaknessScore) return false;
        return response.compensation !== 'yes' || Boolean(response.compensationDetail);
    }

    function derivePositionResult(response) {
        if (response.completion === 'skipped') return 'not_tested';
        if (response.completion === 'unable') return 'unable';
        if (response.pain === 'yes') return 'pain_limited';
        if (response.completion === 'stopped' || response.completion === 'partial' || response.weakness === 'yes' || response.stiffness === 'yes' || response.compensation === 'uncertain') return 'uncertain';
        return response.completion === 'full' ? 'able' : 'not_tested';
    }

    function capacityResponseStatus(response) {
        if (response.completion === 'skipped') return t('assessment.responses.status.position-skipped');
        if (response.answered) return t('assessment.responses.status.observations-saved');
        if (response.pain === 'yes' && (!response.painScore || !response.painLocation)) return t('assessment.responses.status.need-pain-details');
        if (response.weakness === 'yes' && !response.weaknessScore) return t('assessment.responses.status.need-weakness');
        if (response.compensation === 'yes' && !response.compensationDetail) return t('assessment.responses.status.need-movement-difference');
        if (['partial', 'unable', 'stopped'].includes(response.completion) && !response.limitingFactor) return t('assessment.responses.status.need-limiting-factor');
        return t('assessment.responses.status.need-required-observations');
    }

    function scheduleCapacityAdvance(position, wasAnswered) {
        const response = state.capacityResponses[position.id];
        if (!response?.answered || wasAnswered) return;
        byId('capacity-save-state').textContent = t(response.completion === 'skipped'
            ? 'assessment.responses.status.skipped-opening-next'
            : 'assessment.responses.status.saved-opening-next');
        const completedIndex = state.activeCapacityIndex;
        window.setTimeout(() => {
            if (state.activeCapacityIndex !== completedIndex || !state.capacityResponses[position.id]?.answered) return;
            if (state.activeCapacityIndex < ASSESSMENT_POSITIONS.length - 1) {
                state.activeCapacityIndex += 1;
                renderCapacityList();
                renderCapacityPosition();
                persistDraft();
            } else {
                showReportScreen();
            }
        }, 220);
    }

    function applyQuickCapacityResponse(mode) {
        const position = ASSESSMENT_POSITIONS[state.activeCapacityIndex];
        if (!position) return;
        const previous = { ...emptyPositionResponse(), ...state.capacityResponses[position.id] };
        const skipped = mode === 'skip';
        const response = {
            ...previous,
            completion: skipped ? 'skipped' : 'full',
            pain: skipped ? 'not_recorded' : 'no',
            weakness: skipped ? 'not_recorded' : 'no',
            stiffness: skipped ? 'not_recorded' : 'no',
            compensation: skipped ? 'not_recorded' : 'no',
            painScore: '',
            painLocation: '',
            weaknessScore: '',
            limitingFactor: '',
            compensationDetail: ''
        };
        response.answered = capacityResponseComplete(response);
        response.result = derivePositionResult(response);
        state.capacityResponses[position.id] = response;
        state.report = null;
        renderCapacityList();
        byId('capacity-save-state').textContent = capacityResponseStatus(response);
        persistDraft();
        scheduleCapacityAdvance(position, previous.answered);
    }

    function updateCapacityResponse(field, value) {
        const position = ASSESSMENT_POSITIONS[state.activeCapacityIndex];
        if (!position) return;
        const previous = { ...emptyPositionResponse(), ...state.capacityResponses[position.id] };
        const wasAnswered = previous.answered;
        const response = { ...previous, [field]: value };
        if (field === 'completion' && value === 'skipped') {
            response.pain = 'not_recorded';
            response.weakness = 'not_recorded';
            response.stiffness = 'not_recorded';
            response.compensation = 'not_recorded';
            response.painScore = '';
            response.painLocation = '';
            response.weaknessScore = '';
            response.limitingFactor = '';
            response.compensationDetail = '';
        }
        if (field === 'completion' && !['partial', 'unable', 'stopped'].includes(value)) response.limitingFactor = '';
        if (field === 'pain' && value !== 'yes') {
            response.painScore = '';
            response.painLocation = '';
        }
        if (field === 'weakness' && value !== 'yes') response.weaknessScore = '';
        if (field === 'compensation' && value !== 'yes') response.compensationDetail = '';
        response.answered = capacityResponseComplete(response);
        response.result = derivePositionResult(response);
        state.capacityResponses[position.id] = response;
        state.report = null;
        renderCapacityList();
        byId('capacity-save-state').textContent = capacityResponseStatus(response);
        persistDraft();
        scheduleCapacityAdvance(position, wasAnswered);
    }

    function selectedRedFlags() {
        return RED_FLAGS.filter((flag) => state.redFlags[flag.id]);
    }

    function safetyAnswersComplete() {
        return RED_FLAGS.every((flag) => typeof state.redFlags[flag.id] === 'boolean');
    }

    function updateSafetyGate() {
        const answered = RED_FLAGS.filter((flag) => typeof state.redFlags[flag.id] === 'boolean').length;
        const flags = selectedRedFlags();
        const complete = safetyAnswersComplete();
        const button = byId('diagnosis-continue');
        button.disabled = !complete;
        button.textContent = t(flags.length ? 'assessment.safety.record-warnings-stop' : 'common.actions.continue');
        if (!complete) {
            byId('diagnosis-safety-state').textContent = t('assessment.safety.progress', { answered, total: RED_FLAGS.length });
        } else if (state.safetyReviewed) {
            byId('diagnosis-safety-state').textContent = t(flags.length ? 'assessment.safety.warnings-recorded' : 'assessment.safety.reviewed');
        } else {
            byId('diagnosis-safety-state').textContent = flags.length
                ? plural('assessment.safety.warning-selected', flags.length)
                : t('assessment.safety.all-clear');
        }
    }

    function cancelPreview() {
        state.previewGeneration += 1;
        state.capacityPreviewPromise = null;
        byId('capacity-view-loading')?.classList.add('hidden');
    }

    function updateWarning() {
        const safetyWarning = byId('diagnosis-safety-warning');
        const flags = selectedRedFlags();
        if (!flags.length) {
            safetyWarning.classList.add('hidden');
            safetyWarning.textContent = '';
            return;
        }
        const emergency = flags.some((flag) => flag.urgency === 'emergency');
        safetyWarning.textContent = emergency
            ? t('assessment.safety.warning-emergency')
            : t('assessment.safety.warning-urgent');
        safetyWarning.classList.remove('hidden');
    }

    function renderSafetyForm() {
        const host = byId('diagnosis-safety-form');
        host.innerHTML = `<table class="diagnosis-safety-table">
            <thead><tr><th scope="col">${escapeHtml(t('assessment.safety.columns.warning'))}</th><th scope="col">${escapeHtml(t('common.options.no'))}</th><th scope="col">${escapeHtml(t('common.options.yes'))}</th></tr></thead>
            <tbody>${RED_FLAGS.map((flag) => {
                const heading = t(`assessment.safety.urgency.${flag.urgency}`);
                return `<tr>
                    <th scope="row"><strong>${escapeHtml(heading)}</strong><span>${escapeHtml(t(`assessment.safety.flags.${flag.id}`))}</span></th>
                    <td><label><input type="radio" name="safety-${flag.id}" value="no" data-red-flag="${flag.id}" ${state.redFlags[flag.id] === false ? 'checked' : ''}><span>${escapeHtml(t('common.options.no'))}</span></label></td>
                    <td><label class="warning-answer"><input type="radio" name="safety-${flag.id}" value="yes" data-red-flag="${flag.id}" ${state.redFlags[flag.id] === true ? 'checked' : ''}><span>${escapeHtml(t('common.options.yes'))}</span></label></td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
        for (const input of host.querySelectorAll('[data-red-flag]')) {
            input.addEventListener('change', () => {
                state.redFlags[input.dataset.redFlag] = input.value === 'yes';
                state.safetyReviewed = false;
                state.report = null;
                updateSafetyGate();
                updateWarning();
                persistDraft();
            });
        }
        updateSafetyGate();
    }

    function summarizeCapacityModel(position) {
        const modelState = state.capacityModelStates[position.id];
        const model = controller.getModel() ?? {};
        const expectedNames = modelMuscleNames(model);
        if (!completeStaticState(modelState, model)) {
            return { available: false, reason: modelState?.staticHolding?.quality?.reason ?? 'Model reference unavailable for this posture' };
        }
        const returned = new Map((modelState.muscles ?? []).map((muscle) => [muscle.name, muscle]));
        const muscles = expectedNames.map((name) => {
            const muscle = returned.get(name) ?? {};
            return {
                name,
                activation: finiteOrNull(muscle.activation),
                activeActuatorForceN: activeForceValue(muscle)
            };
        });
        return {
            available: true,
            source: 'on-demand-ms-human-static-hold',
            solverDurationMs: finiteOrNull(modelState.staticHolding?.solver?.durationMs),
            maximumReserveTorqueNm: finiteOrNull(modelState.staticHolding?.quality?.maxReserveTorqueNm),
            muscles,
            topActivation: [...muscles].sort((a, b) => b.activation - a.activation).slice(0, 5),
            topActiveActuatorForceN: [...muscles].filter((muscle) => Number.isFinite(muscle.activeActuatorForceN)).sort((a, b) => b.activeActuatorForceN - a.activeActuatorForceN).slice(0, 5)
        };
    }

    function movementPositionRecords() {
        return ASSESSMENT_POSITIONS.map((position, index) => ({
            sequence: index + 1,
            id: position.id,
            executionMode: 'person_attempted',
            name: position.name,
            instruction: position.instruction,
            coordinatesDegrees: position.coordinates,
            rawObservation: { ...state.capacityResponses[position.id] },
            modelEstimate: summarizeCapacityModel(position)
        }));
    }

    function buildReport() {
        const model = controller.getModel() ?? {};
        const result = buildReportV5({
            assessmentId: state.assessmentId,
            testedSide: state.testedSide,
            safetyReviewed: state.safetyReviewed,
            redFlags: selectedRedFlags(),
            intake: state.intake,
            positionRecords: movementPositionRecords(),
            assessmentProtocol: MS_HUMAN_ASSESSMENT_REPORT_PROTOCOL,
            model: reportModelMetadata(model),
            syntheticData: false,
            legacySymptomAssessment: state.legacySymptomAssessment
        });
        state.reportAnnex = result.technicalAnnex;
        return result.report;
    }

    function renderMovementReport(report) {
        const host = byId('diagnosis-report-content');
        const trials = (report.trials ?? []).filter((trial) => trial.includeInHumanProtocol);
        const attempted = trials.filter((trial) => trial.observation?.attempted);
        const quality = report.dataQuality ?? {};
        const hasMatchedComparisonProtocol = (MS_HUMAN_ASSESSMENT_REPORT_PROTOCOL.matchedComparisons ?? []).length > 0;
        const comparisonRows = (report.matchedComparisons ?? []).filter((comparison) => comparison.observationsComplete);
        const protocolDemand = report.analyses?.genericProtocolDemand ?? {};
        const e = escapeHtml;
        const dash = e(t('common.punctuation.em-dash'));
        const positionIds = new Set(ASSESSMENT_POSITIONS.map((position) => position.id));
        const comparisonIds = new Set((MS_HUMAN_ASSESSMENT_REPORT_PROTOCOL.matchedComparisons ?? []).map((comparison) => comparison.id));
        const positionName = (id) => positionIds.has(id)
            ? t(`assessment.positions.${id}.name`)
            : t('assessment.report.observations.unknown-position', { id: String(id ?? '') });
        const comparisonName = (id) => comparisonIds.has(id)
            ? t(`assessment.comparisons.${id}.name`)
            : t('assessment.report.comparisons.unknown', { id: String(id ?? '') });
        const trialNames = new Map(trials.map((trial) => [trial.id, positionName(trial.id)]));
        const displayMuscle = (name) => controller.displayMuscle?.(name) ?? String(name ?? '');
        const valueKey = (value) => String(value ?? '').replaceAll('_', '-');
        const valueLabel = (value) => {
            const supported = new Set(['positive', 'recorded-zero', 'not-recorded', 'full', 'partial', 'unable', 'stopped', 'skipped', 'uncertain', 'pain', 'weakness', 'stiffness', 'instability', 'fear', 'coordination', 'other']);
            const normalized = valueKey(value);
            return supported.has(normalized)
                ? t(`assessment.report.values.${normalized}`)
                : t('assessment.report.values.unknown', { value: String(value ?? '') });
        };
        const stateLabel = (symptom) => e(valueLabel(symptom?.state));
        const scoreLabel = (symptom) => symptom?.state === 'recorded_zero'
            ? e(t('assessment.report.score', { score: 0 }))
            : Number.isFinite(symptom?.score)
                ? e(t('assessment.report.score', { score: formatNumber(symptom.score) }))
                : dash;
        const reportStatusKey = ({
            incomplete_record: 'incomplete-record', complete_record: 'complete-record', conflicting_record: 'conflicting-record'
        })[quality.recordStatus] ?? 'unavailable';
        const summaryStatusKey = ({
            incomplete_record: 'incomplete-record', complete_record: 'complete-record', conflicting_record: 'conflicting-record'
        })[report.summary?.status] ?? 'unavailable';
        const warningCodes = new Set([
            'pain_state_score_conflict', 'pain_unanswered_with_score', 'weakness_state_score_conflict',
            'weakness_unanswered_with_score', 'skipped_trial_has_symptoms', 'legacy_report_migrated',
            'assessment_protocol_identity_unverified', 'assessment_protocol_migration_required'
        ]);
        const warningMessage = (warning) => warningCodes.has(warning.code)
            ? t(`assessment.report.quality.warnings.${warning.code.replaceAll('_', '-')}`)
            : t('assessment.report.quality.warnings.unknown', { code: String(warning.code ?? '') });
        const safetyLabel = report.safety?.positiveFlags?.length
            ? plural('assessment.report.safety.warning-selected', report.safety.positiveFlags.length)
            : t(report.safety?.reviewed ? 'assessment.report.safety.reviewed-clear' : 'assessment.report.safety.not-reviewed');
        const limitationKeys = [
            'no-single-test-diagnosis', 'generic-not-personal', 'achieved-pose-not-measured',
            'static-recruitment', 'no-measured-load',
            report.modelCoverage?.scapularStabilizersIncluded?.length ? 'scapular-included' : 'scapular-absent',
            'mirrored-visual-only'
        ];
        if (report.assessment?.protocolIdentityVerified === false) limitationKeys.push('protocol-unverified');
        if (report.assessment?.legacyModelRecord) limitationKeys.push('legacy-record');
        host.innerHTML = `
            <div class="diagnosis-report-summary">
                <div><span>${e(t('assessment.report.metrics.data-status'))}</span><strong>${e(t(`assessment.report.status.${reportStatusKey}`))}</strong></div>
                <div><span>${e(t('assessment.report.metrics.postures-attempted'))}</span><strong>${attempted.length}/${quality.requiredTrialCount ?? trials.length}</strong></div>
                <div><span>${e(t('assessment.report.metrics.pain-answered'))}</span><strong>${quality.painAnsweredCount ?? 0}/${quality.attemptedTrialCount ?? 0}</strong></div>
                <div><span>${e(t('assessment.report.metrics.weakness-answered'))}</span><strong>${quality.weaknessAnsweredCount ?? 0}/${quality.attemptedTrialCount ?? 0}</strong></div>
                <div><span>${e(t('assessment.report.metrics.stiffness-answered'))}</span><strong>${quality.stiffnessAnsweredCount ?? 0}/${quality.attemptedTrialCount ?? 0}</strong></div>
            </div>
            <p><strong>${e(t(`assessment.report.summary.${summaryStatusKey}`, { recorded: quality.recordedTrialCount ?? 0, required: quality.requiredTrialCount ?? trials.length }))}</strong></p>
            <p>${e(t(state.storageMode === 'device' ? 'assessment.report.onscreen-privacy.device' : 'assessment.report.onscreen-privacy.session'))}</p>
            ${quality.warnings?.length ? `<h3>${e(t('assessment.report.quality.title'))}</h3><ul>${quality.warnings.map((warning) => `<li>${e(warning.trialId
                ? t('assessment.report.quality.warning-position', { position: trialNames.get(warning.trialId) ?? positionName(warning.trialId), message: warningMessage(warning) })
                : warningMessage(warning))}</li>`).join('')}</ul>` : ''}
            ${quality.missingRequiredFields?.length ? `<details><summary>${e(plural('assessment.report.quality.missing', quality.missingRequiredFields.length))}</summary><p>${e(t('assessment.report.quality.missing-help'))}</p></details>` : ''}
            <h3>${e(t('assessment.report.context.title'))}</h3>
            <div class="diagnosis-report-table-wrap"><table><tbody>
                <tr><th>${e(t('assessment.report.context.age'))}</th><td>${Number.isFinite(report.intake?.ageYears) ? e(formatNumber(report.intake.ageYears)) : dash}</td><th>${e(t('assessment.report.context.gender'))}</th><td>${e(intakeOptionLabel('gender', report.intake?.gender))}</td></tr>
                <tr><th>${e(t('assessment.report.context.assessed-side'))}</th><td>${report.intake?.assessedSide ? e(sideLabel(report.intake.assessedSide)) : dash}</td><th>${e(t('assessment.report.context.height-weight'))}</th><td>${Number.isFinite(report.intake?.heightCm) ? `${e(formatNumber(report.intake.heightCm))} cm` : dash} / ${Number.isFinite(report.intake?.weightKg) ? `${e(formatNumber(report.intake.weightKg))} kg` : dash}</td></tr>
                <tr><th>${e(t('assessment.report.context.symptom-duration'))}</th><td>${e(intakeOptionLabel('painDuration', report.intake?.symptomDuration))}</td><th>${e(t('assessment.report.context.onset'))}</th><td>${e(intakeOptionLabel('painOnset', report.intake?.symptomOnset))}</td></tr>
                <tr><th>${e(t('assessment.report.context.safety-screen'))}</th><td colspan="3">${e(safetyLabel)}</td></tr>
            </tbody></table></div>
            <h3>${e(t('assessment.report.observations.title'))}</h3>
            <div class="diagnosis-report-table-wrap"><table>
                <thead><tr>${['posture', 'completion', 'pain', 'weakness', 'stiffness', 'compensation', 'notes', 'model-reference'].map((key) => `<th>${e(t(`assessment.report.observations.columns.${key}`))}</th>`).join('')}</tr></thead>
                <tbody>${trials.map((trial) => `<tr>
                    <td><strong>${e(positionName(trial.id))}</strong></td>
                    <td>${e(valueLabel(trial.observation.completion))}${trial.observation.limitingFactors?.length ? ` · ${trial.observation.limitingFactors.map((value) => e(valueLabel(value))).join(', ')}` : ''}</td>
                    <td>${stateLabel(trial.observation.pain)}${trial.observation.pain.state !== 'not_recorded' ? ` · ${scoreLabel(trial.observation.pain)}` : ''}</td>
                    <td>${stateLabel(trial.observation.weakness)}${trial.observation.weakness.state !== 'not_recorded' ? ` · ${scoreLabel(trial.observation.weakness)}` : ''}</td>
                    <td>${stateLabel(trial.observation.stiffness)}</td>
                    <td>${stateLabel(trial.observation.compensation)}</td>
                    <td>${e(trial.observation.notes || dash)}</td>
                    <td>${trial.modelReference?.available
                        ? trial.modelReference.topRelevantPredictedControls.slice(0, 3).map((muscle) => `${e(displayMuscle(muscle.name))} ${formatMetric(muscle.predictedModelControl)}`).join(' · ')
                        : e(t('assessment.report.model-reference.unavailable'))}</td>
                </tr>`).join('')}</tbody>
            </table></div>
            ${hasMatchedComparisonProtocol ? `<h3>${e(t('assessment.report.comparisons.title'))}</h3>
            <p>${e(t('assessment.report.comparisons.intro'))}</p>
            ${comparisonRows.length ? `<div class="diagnosis-report-table-wrap"><table><thead><tr>${['comparison', 'trials', 'changed-variable', 'pain-delta', 'weakness-delta', 'status'].map((key) => `<th>${e(t(`assessment.report.comparisons.columns.${key}`))}</th>`).join('')}</tr></thead><tbody>${comparisonRows.map((comparison) => `<tr>
                <td>${e(comparisonName(comparison.id))}</td><td>${comparison.trialIds.map((trialId) => e(trialNames.get(trialId) ?? positionName(trialId))).join(' → ')}</td><td>${e(CAPACITY_ANGLE_LABELS[comparison.changedVariable] ? t(CAPACITY_ANGLE_LABELS[comparison.changedVariable]) : t('assessment.report.values.unknown', { value: String(comparison.changedVariable ?? '') }))}</td>
                <td>${Number.isFinite(comparison.observationDelta.painScore) ? `${comparison.observationDelta.painScore >= 0 ? '+' : ''}${formatMetric(comparison.observationDelta.painScore, 1)}` : '—'}</td>
                <td>${Number.isFinite(comparison.observationDelta.weaknessScore) ? `${comparison.observationDelta.weaknessScore >= 0 ? '+' : ''}${formatMetric(comparison.observationDelta.weaknessScore, 1)}` : '—'}</td>
                <td>${e(t(comparison.observationDelta.notComputableReason ? 'assessment.report.comparisons.status-scores-required' : 'assessment.report.comparisons.status-complete'))}</td>
            </tr>`).join('')}</tbody></table></div>` : `<p>${e(t('assessment.report.comparisons.none'))}</p>`}` : ''}
            <h3>${e(t('assessment.report.model-reference.title'))}</h3>
            <p>${e(t('assessment.report.model-reference.statement'))}</p>
            ${protocolDemand.ranking?.length ? `<ol>${protocolDemand.ranking.slice(0, 8).map((row) => `<li>${e(t('assessment.report.model-reference.ranking-item', { name: displayMuscle(row.name), mean: formatMetric(row.meanPredictedModelControl), peak: formatMetric(row.peakPredictedModelControl) }))}</li>`).join('')}</ol>` : `<p>${e(t('assessment.report.model-reference.none'))}</p>`}
            <h3>${e(t('assessment.report.limitations.title'))}</h3>
            ${report.assessment?.legacyModelRecord ? `<p><strong>${e(t('assessment.report.limitations.archived-heading'))}</strong> ${e(t('assessment.report.limitations.archived-notice'))}</p>` : ''}
            <p><strong>${e(t('assessment.report.limitations.scapular-heading'))}</strong> ${e(t(report.modelCoverage?.scapularStabilizersIncluded?.length ? 'assessment.report.limitations.scapular-included' : 'assessment.report.limitations.scapular-absent', report.modelCoverage?.scapularStabilizersIncluded?.length ? { count: report.modelCoverage.scapularStabilizersIncluded.length } : {}))}</p>
            <ul>${limitationKeys.map((key) => `<li>${e(t(`assessment.report.limitations.items.${key}`))}</li>`).join('')}</ul>`;
        byId('diagnosis-report-title').textContent = t('assessment.report.title');
        byId('diagnosis-report-time').textContent = localizedDate(report.generatedAt);
        byId('diagnosis-report').classList.remove('hidden');
        byId('diagnosis-copy-json').disabled = false;
        byId('diagnosis-download-json').disabled = false;
        byId('capacity-copy-json').disabled = false;
        byId('capacity-download-json').disabled = false;
        byId('diagnosis-copy-json').textContent = t('assessment.report.copy-reduced');
        byId('diagnosis-download-json').textContent = t('assessment.report.download-reduced');
        byId('capacity-copy-json').textContent = t('assessment.report.copy-full');
        byId('capacity-download-json').textContent = t('assessment.report.download-full');
    }

    async function copyJson(buttonId = 'diagnosis-copy-json') {
        if (!state.report) return;
        const full = buttonId === 'capacity-copy-json';
        const payload = full ? fullReportExport(state.report, state.reportAnnex) : mainReportExport(state.report);
        const text = JSON.stringify(payload, null, 2);
        await navigator.clipboard.writeText(text);
        const button = byId(buttonId);
        button.textContent = t('assessment.report.copied');
        const original = t(full ? 'assessment.report.copy-full' : 'assessment.report.copy-reduced');
        window.setTimeout(() => { button.textContent = original; }, 1400);
    }

    function downloadJson(full = false) {
        if (!state.report) return;
        const payload = full ? fullReportExport(state.report, state.reportAnnex) : mainReportExport(state.report);
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const code = recordCode(state.report.assessment?.assessmentId);
        link.download = full ? `waajacu-record-${code}-full.json` : `waajacu-record-${code}-reduced.json`;
        link.click();
        URL.revokeObjectURL(url);
    }

    function setSide(side) {
        state.testedSide = side === 'left' ? 'left' : 'right';
        controller.setMirroredView(state.testedSide === 'left');
        state.report = null;
    }

    function enter() {
        controller.enterDiagnosis();
        byId('tab-explorer').classList.remove('active');
        byId('tab-explorer').setAttribute('aria-selected', 'false');
        byId('tab-explorer').tabIndex = -1;
        byId('tab-diagnosis').classList.add('active');
        byId('tab-diagnosis').setAttribute('aria-selected', 'true');
        byId('tab-diagnosis').tabIndex = 0;
        byId('explorer-workspace').classList.add('hidden');
        byId('diagnosis-workspace').classList.remove('hidden');
        document.body.classList.add('diagnosis-active');
        byId('mirror-view').hidden = true;
        controller.setMirroredView(state.testedSide === 'left');
        window.requestAnimationFrame(controller.resizeViewer);
        if (state.phase === 'report' && state.intakeCompleted) showReportScreen();
        else if (state.phase === 'assessment' && state.intakeCompleted) showAssessment();
        else if (state.phase === 'intake' && state.safetyReviewed) showIntake();
        else if (state.phase === 'safety') showSafetyLanding();
        else showPrivacyLanding();
    }

    function leave() {
        cancelPreview();
        persistDraft();
        controller.leaveDiagnosis();
        byId('tab-diagnosis').classList.remove('active');
        byId('tab-diagnosis').setAttribute('aria-selected', 'false');
        byId('tab-diagnosis').tabIndex = -1;
        byId('tab-explorer').classList.add('active');
        byId('tab-explorer').setAttribute('aria-selected', 'true');
        byId('tab-explorer').tabIndex = 0;
        byId('diagnosis-workspace').classList.add('hidden');
        byId('explorer-workspace').classList.remove('hidden');
        document.body.classList.remove('diagnosis-active');
        byId('mirror-view').hidden = false;
        window.requestAnimationFrame(controller.resizeViewer);
    }

    function returnFromReport() {
        if (!state.viewingSavedReport) {
            showAssessment();
            return;
        }
        state.viewingSavedReport = false;
        state.report = null;
        if (state.phase === 'assessment' && state.intakeCompleted) showAssessment();
        else if (state.phase === 'intake' && state.safetyReviewed) showIntake();
        else showSafetyLanding();
    }

    byId('tab-diagnosis').addEventListener('click', enter);
    byId('tab-explorer').addEventListener('click', leave);
    document.querySelector('.app-tabs').addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const tabs = [byId('tab-explorer'), byId('tab-diagnosis')];
        const current = Math.max(0, tabs.indexOf(document.activeElement));
        const next = event.key === 'Home' ? 0
            : event.key === 'End' ? tabs.length - 1
                : event.key === 'ArrowLeft' ? (current - 1 + tabs.length) % tabs.length
                    : (current + 1) % tabs.length;
        event.preventDefault();
        tabs[next].click();
        tabs[next].focus();
    });
    byId('diagnosis-delete-all-data').addEventListener('click', requestDeleteAllLocalAssessmentData);
    byId('diagnosis-start').addEventListener('click', showSafetyLanding);
    byId('diagnosis-continue').addEventListener('click', () => {
        if (!safetyAnswersComplete()) return;
        state.safetyReviewed = true;
        state.report = null;
        updateWarning();
        if (selectedRedFlags().length) {
            byId('diagnosis-safety-state').textContent = t('assessment.safety.warnings-recorded');
            return;
        }
        showIntake();
    });
    byId('diagnosis-restart').addEventListener('click', restartAssessment);
    byId('diagnosis-report-restart').addEventListener('click', restartAssessment);
    byId('diagnosis-report-back').addEventListener('click', returnFromReport);
    byId('diagnosis-intake-back').addEventListener('click', showSafetyLanding);
    byId('diagnosis-intake-form').addEventListener('input', () => {
        readIntake();
        const stored = persistDraft();
        byId('diagnosis-intake-state').textContent = state.storageMode === 'device'
            ? t(stored ? 'assessment.intake.state.saved-device' : 'assessment.intake.state.save-failed-session')
            : t('assessment.intake.state.kept-session');
    });
    byId('diagnosis-intake-form').addEventListener('change', () => {
        readIntake();
        persistDraft();
    });
    byId('diagnosis-intake-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const form = byId('diagnosis-intake-form');
        if (!form.reportValidity()) {
            byId('diagnosis-intake-state').textContent = t('assessment.intake.state.complete-highlighted');
            return;
        }
        readIntake();
        state.intakeCompleted = true;
        setSide(state.intake.assessedArm);
        persistDraft();
        showAssessment();
    });
    byId('capacity-previous').addEventListener('click', () => {
        if (state.activeCapacityIndex > 0) {
            state.activeCapacityIndex -= 1;
            renderCapacityList();
            renderCapacityPosition();
            persistDraft();
        }
    });
    byId('capacity-no-symptoms').addEventListener('click', () => applyQuickCapacityResponse('full-no-symptoms'));
    byId('capacity-skip-position').addEventListener('click', () => applyQuickCapacityResponse('skip'));
    byId('diagnosis-copy-json').addEventListener('click', () => copyJson().catch(() => {}));
    byId('diagnosis-download-json').addEventListener('click', () => downloadJson(false));
    byId('capacity-copy-json').addEventListener('click', () => copyJson('capacity-copy-json').catch(() => {}));
    byId('capacity-download-json').addEventListener('click', () => downloadJson(true));
    byId('diagnosis-new-assessment').addEventListener('click', restartAssessment);
    byId('app-dialog-cancel').addEventListener('click', closeAppDialog);
    byId('app-dialog-backdrop').addEventListener('click', closeAppDialog);
    byId('app-dialog-confirm').addEventListener('click', () => {
        const action = state.dialogAction;
        closeAppDialog();
        action?.();
    });
    document.addEventListener('keydown', (event) => {
        const dialog = byId('app-dialog');
        if (dialog.classList.contains('hidden')) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeAppDialog();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = [...dialog.querySelectorAll('.app-dialog-card button:not(:disabled)')];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
    window.addEventListener('waajacu:language-change-request', (event) => {
        const hasSessionOnlyData = state.storageMode === 'session'
            && (Boolean(state.draftUpdatedAt) || state.sessionReports.length > 0);
        if (!hasSessionOnlyData || !event.detail?.targetUrl) return;
        event.preventDefault();
        showAppDialog({
            title: t('language.change-session.title'),
            message: t('language.change-session.message'),
            confirmLabel: t('language.change-session.confirm'),
            danger: true,
            onConfirm: () => window.location.assign(event.detail.targetUrl)
        });
    });
    restoreDraft();
    fillIntakeForm(state.intake);
    updateSavedRecordsUi();
    renderSafetyForm();
    renderCapacityList();

    return {
        setReady(ready) {
            state.ready = Boolean(ready);
        },
        getState: () => state
    };
}
