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
    elv_angle_r: 'Plane',
    shoulder_elv_r: 'Shoulder',
    shoulder_rot_r: 'Rotation',
    elbow_flexion_r: 'Elbow',
    pro_sup_r: 'Forearm',
    deviation_r: 'Wrist dev.',
    flexion_r: 'Wrist flex.'
});

const RED_FLAGS = Object.freeze([
    { id: 'cardiopulmonary', urgency: 'emergency', label: 'Chest pain, shortness of breath, faintness, or pain spreading toward the jaw' },
    { id: 'deformity', urgency: 'emergency', label: 'Visible deformity or apparent dislocation after an injury' },
    { id: 'circulation', urgency: 'emergency', label: 'Major sudden swelling, complete loss of sensation, or an unusually cold/discoloured arm' },
    { id: 'trauma', urgency: 'urgent', label: 'Recent fall or trauma with substantial pain, weakness, or inability to lift the arm' },
    { id: 'neurological', urgency: 'urgent', label: 'Persistent numbness, pins and needles, or new marked weakness down the arm' },
    { id: 'infection', urgency: 'urgent', label: 'Hot, red, swollen shoulder with fever or feeling systemically unwell' },
    { id: 'restPain', urgency: 'review', label: 'Intense or worsening pain at rest, especially with persistent loss of function' },
    { id: 'systemicHistory', urgency: 'review', label: 'Unexplained weight loss/night sweats or relevant cancer, TB, HIV, or inflammatory-disease history' }
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
    return Number.isFinite(value) ? Number(value).toFixed(digits) : 'Unavailable';
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
        storageMode: null,
        sessionReports: [],
        deviceStorageError: false,
        legacySymptomAssessment: null,
        protocolMigrationNotice: null,
        previewGeneration: 0,
        capacityPreviewPromise: null,
        assessmentOpen: false,
        phase: 'safety',
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
        state.redFlags = Object.fromEntries(RED_FLAGS.map((flag) => [flag.id, typeof draft.redFlags?.[flag.id] === 'boolean' ? draft.redFlags[flag.id] : null]));
        state.safetyReviewed = Boolean(draft.safetyReviewed);
        state.intakeCompleted = Boolean(draft.intakeCompleted);
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
        state.protocolMigrationNotice = storedProtocolObservations
            ? 'A draft from an earlier posture panel was preserved as read-only history. Its responses were not mapped onto this new MS-Human panel.'
            : (draft.protocolMigrationNotice ?? null);
        state.assessmentId = draft.assessmentId || createAssessmentId();
        state.assessmentOpen = Boolean(draft.assessmentOpen);
        const restoredPhase = ['safety', 'intake', 'assessment', 'report'].includes(draft.phase) ? draft.phase : 'safety';
        state.phase = !protocolMatches && restoredPhase === 'report'
            ? (state.intakeCompleted ? 'assessment' : state.safetyReviewed ? 'intake' : 'safety')
            : restoredPhase;
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

    function showAppDialog({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm }) {
        state.dialogReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        state.dialogAction = onConfirm;
        byId('app-dialog-title').textContent = title;
        byId('app-dialog-message').textContent = message;
        byId('app-dialog-confirm').textContent = confirmLabel;
        byId('app-dialog').querySelector('.app-dialog-card').classList.toggle('danger', danger);
        for (const element of document.querySelectorAll('main > :not(#app-dialog)')) element.inert = true;
        byId('app-dialog').classList.remove('hidden');
        byId('app-dialog-cancel').focus();
    }

    function importPatientDetails(entry) {
        const prior = entry.patient ?? entry.report.intake ?? {};
        const demographics = ['name', 'ageYears', 'gender', 'heightCm', 'weightKg', 'assessedArm'];
        for (const field of demographics) state.intake[field] = prior[field] ?? '';
        state.intakeCompleted = false;
        fillIntakeForm(state.intake);
        persistDraft();
        if (state.safetyReviewed && !selectedRedFlags().length) showIntake();
        else byId('diagnosis-draft-state').textContent = `${state.intake.name || 'Saved details'} selected · complete the safety check`;
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
        const patient = state.intake?.name ? `${state.intake.name} · ` : '';
        const draftState = byId('diagnosis-draft-state');
        const privacy = byId('diagnosis-records-privacy');
        const activeStorageNotice = byId('diagnosis-active-storage-notice');
        byId('diagnosis-new-assessment').disabled = !state.storageMode;
        if (!state.storageMode) {
            draftState.textContent = 'Choose how this tab should handle assessment data';
            privacy.textContent = 'No assessment data has been loaded or saved. Choose a storage option below to begin.';
        } else if (state.storageMode === 'session') {
            draftState.textContent = state.protocolMigrationNotice ?? (state.draftUpdatedAt
                ? `${patient}${answered} of ${ASSESSMENT_POSITIONS.length} positions kept in this tab`
                : 'Session only · no unfinished assessment');
            privacy.textContent = 'Session only: answers and reports stay in this tab and disappear when it closes or reloads. Existing device records remain untouched.';
            if (activeStorageNotice) activeStorageNotice.innerHTML = '<strong>Session only.</strong> Answers and reports stay in this tab and disappear when it closes or reloads. Existing device records are not loaded or changed.';
        } else {
            draftState.textContent = state.protocolMigrationNotice ?? (state.draftUpdatedAt
                ? `${patient}${answered} of ${ASSESSMENT_POSITIONS.length} positions saved on this device`
                : 'Device storage · no unfinished assessment');
            privacy.textContent = state.deviceStorageError
                ? 'Device storage is selected, but the latest save failed. Current answers remain available in this tab.'
                : 'Device storage is enabled. Drafts and reports remain in this browser profile until deleted.';
            if (activeStorageNotice) activeStorageNotice.innerHTML = '<strong>Device storage.</strong> Drafts and reports remain in this browser profile until deleted. Anyone using this profile may be able to view them.';
        }
        draftState.textContent = `Record ${recordCode()} · ${draftState.textContent}`;

        const host = byId('diagnosis-saved-report-list');
        host.replaceChildren();
        if (!reports.length) {
            const empty = document.createElement('p');
            empty.className = 'saved-report-empty';
            empty.textContent = !state.storageMode
                ? 'Records remain unloaded until you choose a storage option.'
                : state.storageMode === 'session'
                    ? 'No reports have been created in this tab.'
                    : 'No reports are saved in this browser profile.';
            host.append(empty);
            return;
        }
        const table = document.createElement('table');
        table.className = 'saved-report-table';
        table.innerHTML = '<thead><tr><th>Record</th><th>Optional label</th><th>Assessment date</th><th>Age</th><th>Arm</th><th>Actions</th></tr></thead>';
        const body = document.createElement('tbody');
        for (const entry of reports) {
            const row = document.createElement('tr');
            const codeCell = document.createElement('td');
            codeCell.className = 'saved-report-code';
            codeCell.textContent = recordCode(entry.report.assessment?.assessmentId || entry.id);
            row.append(codeCell);
            const patientCell = document.createElement('td');
            patientCell.className = 'saved-report-patient';
            const patientName = document.createElement('strong');
            patientName.textContent = entry.patient?.name || 'No label provided';
            patientCell.append(patientName);
            if (entry.report.assessment?.legacyModelRecord) {
                const legacyLabel = document.createElement('span');
                legacyLabel.textContent = 'Archived report from an earlier model or protocol';
                patientCell.append(legacyLabel);
            }
            row.append(patientCell);
            const values = [
                new Date(entry.report.generatedAt).toLocaleString(),
                Number.isFinite(entry.patient?.ageYears) ? String(entry.patient.ageYears) : '—',
                entry.patient?.assessedArm || entry.report.assessment?.testedSide || '—'
            ];
            for (const value of values) {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.append(cell);
            }
            const actions = document.createElement('td');
            actions.className = 'saved-report-actions';
            const use = document.createElement('button');
            use.type = 'button';
            use.className = 'quiet-button';
            use.textContent = 'Reuse details';
            use.addEventListener('click', () => importPatientDetails(entry));
            const view = document.createElement('button');
            view.type = 'button';
            view.className = 'quiet-button';
            view.textContent = 'View';
            view.addEventListener('click', () => showSavedReport(entry));
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'quiet-button';
            remove.textContent = 'Delete';
            remove.addEventListener('click', () => {
                showAppDialog({
                    title: 'Delete assessment report?',
                    message: `This will remove the report${entry.patient?.name ? ` for ${entry.patient.name}` : ''} dated ${new Date(entry.report.generatedAt).toLocaleString()} ${state.storageMode === 'session' ? 'from this tab' : 'from this browser profile'}.`,
                    confirmLabel: 'Delete report',
                    danger: true,
                    onConfirm: () => removeSavedReport(entry)
                });
            });
            actions.append(use, view, remove);
            row.append(actions);
            body.append(row);
        }
        table.append(body);
        host.append(table);
    }

    function showStorageChoice() {
        cancelPreview();
        byId('diagnosis-storage-choice').classList.remove('hidden');
        byId('diagnosis-safety-landing').classList.add('hidden');
        byId('diagnosis-intake').classList.add('hidden');
        byId('diagnosis-assessment').classList.add('hidden');
        byId('diagnosis-report-screen').classList.add('hidden');
        updateSavedRecordsUi();
        window.requestAnimationFrame(controller.resizeViewer);
    }

    function chooseStorageMode(mode) {
        if (state.storageMode) return;
        state.storageMode = mode === 'device' ? 'device' : 'session';
        if (state.storageMode === 'device') restoreDraft();
        fillIntakeForm(state.intake);
        updateSavedRecordsUi();
        if (state.phase === 'report' && state.intakeCompleted) showReportScreen();
        else if (state.phase === 'assessment' && state.intakeCompleted) showAssessment();
        else if (state.phase === 'intake' && state.safetyReviewed) showIntake();
        else showSafetyLanding();
    }

    function showSavedReport(entry) {
        cancelPreview();
        state.viewingSavedReport = true;
        state.reportStored = true;
        state.report = entry.report;
        state.reportAnnex = entry.technicalAnnex ?? null;
        byId('diagnosis-storage-choice').classList.add('hidden');
        byId('diagnosis-safety-landing').classList.add('hidden');
        byId('diagnosis-intake').classList.add('hidden');
        byId('diagnosis-assessment').classList.add('hidden');
        byId('diagnosis-report-screen').classList.remove('hidden');
        byId('diagnosis-report-back').textContent = 'Back';
        renderMovementReport(state.report);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function showSafetyLanding() {
        cancelPreview();
        state.assessmentOpen = false;
        state.phase = 'safety';
        state.viewingSavedReport = false;
        byId('diagnosis-storage-choice').classList.add('hidden');
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
            relevantHistory: String(data.get('relevantHistory') ?? '').trim()
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
        byId('diagnosis-storage-choice').classList.add('hidden');
        byId('diagnosis-safety-landing').classList.add('hidden');
        byId('diagnosis-intake').classList.remove('hidden');
        byId('diagnosis-assessment').classList.add('hidden');
        byId('diagnosis-report-screen').classList.add('hidden');
        fillIntakeForm(state.intake);
        byId('diagnosis-intake-state').textContent = state.intakeCompleted
            ? (state.storageMode === 'device' ? 'Details saved on this device. Review or continue.' : 'Details kept in this tab. Review or continue.')
            : 'Complete the required pain-history fields and assessed arm.';
        persistDraft();
        window.requestAnimationFrame(controller.resizeViewer);
    }

    function intakeOptionLabel(fieldName, value) {
        if (!value) return '—';
        const option = byId('diagnosis-intake-form').querySelector(`[name="${fieldName}"] option[value="${CSS.escape(String(value))}"]`);
        return option?.textContent?.trim() || String(value).replaceAll('_', ' ');
    }

    function renderAssessmentPatientHeader() {
        const intake = state.intake ?? {};
        const age = Number.isFinite(intake.ageYears) ? `${intake.ageYears} years` : '—';
        const size = [
            Number.isFinite(intake.heightCm) ? `${intake.heightCm} cm` : '',
            Number.isFinite(intake.weightKg) ? `${intake.weightKg} kg` : ''
        ].filter(Boolean).join(' / ') || '—';
        const painNow = Number.isFinite(intake.painNow) ? intake.painNow : '—';
        const painWorst = Number.isFinite(intake.painWorst) ? intake.painWorst : '—';
        byId('diagnosis-patient-name').textContent = intake.name || 'No label provided';
        byId('diagnosis-current-record-code').textContent = recordCode();
        byId('diagnosis-patient-age').textContent = age;
        byId('diagnosis-patient-gender').textContent = intakeOptionLabel('gender', intake.gender);
        byId('diagnosis-patient-arm').textContent = intakeOptionLabel('assessedArm', intake.assessedArm);
        byId('diagnosis-patient-size').textContent = size;
        byId('diagnosis-patient-pain').textContent = `${painNow} / ${painWorst}`;
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
        byId('diagnosis-storage-choice').classList.add('hidden');
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
        byId('diagnosis-storage-choice').classList.add('hidden');
        byId('diagnosis-safety-landing').classList.add('hidden');
        byId('diagnosis-intake').classList.add('hidden');
        byId('diagnosis-assessment').classList.add('hidden');
        byId('diagnosis-report-screen').classList.remove('hidden');
        byId('diagnosis-report-back').textContent = 'Back to assessment';
        renderMovementReport(state.report);
        state.reportStored = archiveReport(state.report);
        if (state.reportStored) {
            clearDraft();
        } else {
            persistDraft();
            showAppDialog({
                title: 'Report could not be stored',
                message: 'The resumable assessment has been kept. Download the report with direct identifiers excluded now, or return to the assessment and remove older saved reports before trying again.',
                confirmLabel: 'Keep resumable assessment',
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
        showSafetyLanding();
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
            title: 'Delete all local assessment data?',
            message: 'This permanently removes the saved draft and every saved assessment report for this application from this browser profile. It also clears the assessment and current-tab reports now open in this tab. Downloaded files are not affected.',
            confirmLabel: 'Delete all assessment data',
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
            title: 'Start a new assessment?',
            message: 'The unfinished personal details and position responses will be removed. Completed assessment reports will remain available.',
            confirmLabel: 'Start new assessment',
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
                ['not_recorded', 'Select'],
                ['full', 'Full'],
                ['partial', 'Partial'],
                ['unable', 'Unable'],
                ['stopped', 'Stopped'],
                ['skipped', 'Skipped']
            ],
            pain: [['not_recorded', 'Select'], ['no', 'No'], ['yes', 'Yes']],
            weakness: [['not_recorded', 'Select'], ['no', 'No'], ['yes', 'Yes']],
            stiffness: [['not_recorded', 'Select'], ['no', 'No'], ['yes', 'Yes']],
            compensation: [['not_recorded', 'Select'], ['no', 'No'], ['yes', 'Yes'], ['uncertain', 'Unsure']],
            limitingFactor: [
                ['', 'Select'], ['pain', 'Pain'], ['weakness', 'Weakness'], ['stiffness', 'Stiffness'],
                ['instability', 'Instability'], ['fear', 'Fear'], ['coordination', 'Coordination'], ['other', 'Other']
            ]
        };
        const fieldLabels = {
            completion: 'Completion',
            pain: 'Pain',
            weakness: 'Weakness',
            stiffness: 'Stiffness',
            compensation: 'Compensation'
        };
        const optionLabel = (field, value) => fieldOptions[field].find(([option]) => option === value)?.[1] ?? '—';
        const responseChoices = (field, response, position) => {
            const group = document.createElement('div');
            group.className = `capacity-choice-group ${field === 'completion' ? 'completion' : ''}`;
            group.setAttribute('role', 'group');
            group.setAttribute('aria-label', `${fieldLabels[field]} for ${position.name}`);
            for (const [value, label] of fieldOptions[field].filter(([optionValue]) => optionValue !== 'not_recorded')) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'capacity-choice-button';
                button.classList.toggle('selected', response[field] === value);
                button.setAttribute('aria-pressed', response[field] === value ? 'true' : 'false');
                button.setAttribute('aria-label', `${label} ${fieldLabels[field].toLowerCase()} for ${position.name}`);
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
            caption.textContent = `${label}${required ? ' *' : ''}`;
            const select = document.createElement('select');
            select.setAttribute('aria-label', label);
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Select';
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
            if (locked) positionButton.setAttribute('aria-label', `${position.name}, locked until the previous posture is completed`);
            const progressLabel = response.answered ? (response.completion === 'skipped' ? 'Skipped' : 'Recorded') : locked ? 'Locked' : 'Next';
            positionButton.innerHTML = `<span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(position.name)}</strong><em>${progressLabel}</em>`;
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
                    value.setAttribute('aria-label', `${fieldLabels[field]}: ${optionLabel(field, response[field])}`);
                    cell.append(value);
                }
                row.append(cell);
            });
            const commentsCell = document.createElement('td');
            commentsCell.dataset.label = 'Notes';
            if (active) {
                const notes = document.createElement('textarea');
                notes.className = 'capacity-record-comments';
                notes.maxLength = 500;
                notes.rows = 2;
                notes.placeholder = 'Optional';
                notes.setAttribute('aria-label', `Comments for ${position.name}`);
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
                        label: 'Limiting factor',
                        field: 'limitingFactor',
                        value: response.limitingFactor,
                        options: fieldOptions.limitingFactor.slice(1),
                        required: true
                    });
                }
                if (response.pain === 'yes') {
                    addDetailSelect(details, {
                        label: 'Pain 1–10',
                        field: 'painScore',
                        value: response.painScore,
                        options: Array.from({ length: 10 }, (_, value) => [String(value + 1), String(value + 1)]),
                        required: true
                    });
                    addDetailSelect(details, {
                        label: 'Pain location',
                        field: 'painLocation',
                        value: response.painLocation,
                        options: [
                            ['front_shoulder', 'Front shoulder'],
                            ['top_shoulder', 'Top / AC region'],
                            ['back_shoulder', 'Back shoulder'],
                            ['lateral_upper_arm', 'Lateral upper arm'],
                            ['neck_arm', 'Neck / radiating'],
                            ['other', 'Other']
                        ],
                        required: true
                    });
                }
                if (response.weakness === 'yes') {
                    addDetailSelect(details, {
                        label: 'Weakness 1–10',
                        field: 'weaknessScore',
                        value: response.weaknessScore,
                        options: Array.from({ length: 10 }, (_, value) => [String(value + 1), String(value + 1)]),
                        required: true
                    });
                }
                if (response.compensation === 'yes') {
                    addDetailSelect(details, {
                        label: 'Movement difference',
                        field: 'compensationDetail',
                        value: response.compensationDetail,
                        options: [
                            ['shoulder_hike', 'Shoulder hike'],
                            ['trunk_lean', 'Trunk lean'],
                            ['scapular_difference', 'Scapular difference'],
                            ['other', 'Other']
                        ],
                        required: true
                    });
                }
                const help = document.createElement('span');
                help.className = 'capacity-detail-help';
                help.textContent = 'Complete the marked detail fields to continue.';
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
            reportButton.innerHTML = `<span class="diagnosis-test-number" aria-hidden="true">✓</span><span class="diagnosis-test-copy"><strong>Review results</strong><span>${answeredCount} of ${ASSESSMENT_POSITIONS.length} positions complete</span></span>`;
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
        loading.querySelector('strong').textContent = 'Loading posture…';
        loading.classList.remove('hidden');
        controller.neutralizeActivation();
        try {
            const geometry = await controller.pose(position.coordinates, selectedMuscle(controller));
            if (preview !== state.previewGeneration || state.phase !== 'assessment') return;
            geometry.mode = 'pose';
            for (const muscle of geometry.muscles ?? []) delete muscle.activation;
            controller.applyState(geometry);
            controller.resetView();
            loading.querySelector('strong').textContent = 'Calculating activation…';

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
        byId('capacity-position-id').textContent = `Position ${state.activeCapacityIndex + 1} of ${positions.length}`;
        byId('capacity-position-title').textContent = position.name;
        byId('capacity-position-instruction').textContent = position.instruction ?? 'Do not attempt this posture if it is uncomfortable or unsuitable.';
        byId('capacity-angle-grid').innerHTML = POSE_KEYS.map((key) => `<div><dt>${escapeHtml(CAPACITY_ANGLE_LABELS[key])}</dt><dd>${Number(position.coordinates[key]).toFixed(1)}°</dd></div>`).join('');
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
        if (response.completion === 'skipped') return 'Position skipped';
        if (response.answered) return 'Observations saved';
        if (response.pain === 'yes' && (!response.painScore || !response.painLocation)) return 'Record pain score and location';
        if (response.weakness === 'yes' && !response.weaknessScore) return 'Record perceived weakness';
        if (response.compensation === 'yes' && !response.compensationDetail) return 'Record the movement difference';
        if (['partial', 'unable', 'stopped'].includes(response.completion) && !response.limitingFactor) return 'Record the limiting factor';
        return 'Record completion, pain, weakness, stiffness, and compensation';
    }

    function scheduleCapacityAdvance(position, wasAnswered) {
        const response = state.capacityResponses[position.id];
        if (!response?.answered || wasAnswered) return;
        byId('capacity-save-state').textContent = response.completion === 'skipped' ? 'Skipped · opening next position…' : 'Saved · opening next position…';
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
        button.textContent = flags.length ? 'Record warnings and stop' : 'Continue to assessment details';
        if (!complete) {
            byId('diagnosis-safety-state').textContent = `${answered} of ${RED_FLAGS.length} answered · complete every row`;
        } else if (state.safetyReviewed) {
            byId('diagnosis-safety-state').textContent = flags.length ? 'Warnings recorded · assessment paused' : 'Safety reviewed';
        } else {
            byId('diagnosis-safety-state').textContent = flags.length ? `${flags.length} warning${flags.length === 1 ? '' : 's'} selected` : 'All items answered · no warnings selected';
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
            ? 'Testing paused. A reported warning sign may require emergency assessment now. This tool cannot rule out a serious condition.'
            : 'Testing paused. A reported warning sign may require urgent medical assessment before more movement testing.';
        safetyWarning.classList.remove('hidden');
    }

    function renderSafetyForm() {
        const host = byId('diagnosis-safety-form');
        host.innerHTML = `<table class="diagnosis-safety-table">
            <thead><tr><th scope="col">Warning sign</th><th scope="col">No</th><th scope="col">Yes</th></tr></thead>
            <tbody>${RED_FLAGS.map((flag) => {
                const heading = flag.urgency === 'emergency' ? 'Emergency warning' : flag.urgency === 'urgent' ? 'Urgent warning' : 'Review before testing';
                return `<tr>
                    <th scope="row"><strong>${heading}</strong><span>${escapeHtml(flag.label)}</span></th>
                    <td><label><input type="radio" name="safety-${flag.id}" value="no" data-red-flag="${flag.id}" ${state.redFlags[flag.id] === false ? 'checked' : ''}><span>No</span></label></td>
                    <td><label class="warning-answer"><input type="radio" name="safety-${flag.id}" value="yes" data-red-flag="${flag.id}" ${state.redFlags[flag.id] === true ? 'checked' : ''}><span>Yes</span></label></td>
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
        const protocolDemand = report.analyses?.genericProtocolDemand ?? {};
        const label = (value) => escapeHtml(String(value ?? '—').replaceAll('_', ' '));
        const stateLabel = (symptom) => ({ positive: 'Yes', recorded_zero: 'No', not_recorded: 'Not recorded' }[symptom?.state] ?? label(symptom?.state));
        const scoreLabel = (symptom) => symptom?.state === 'recorded_zero'
            ? '0/10'
            : Number.isFinite(symptom?.score) ? `${symptom.score}/10` : '—';
        const comparisonRows = (report.matchedComparisons ?? []).filter((comparison) => comparison.observationsComplete);
        const trialNames = new Map(trials.map((trial) => [trial.id, trial.name]));
        const coordinateLabels = Object.fromEntries(Object.entries(CAPACITY_ANGLE_LABELS).map(([key, value]) => [key, value]));
        const reportStatus = ({
            incomplete_record: 'Incomplete record',
            complete_record: 'Complete record',
            conflicting_record: 'Record needs review'
        })[quality.recordStatus] || 'Record status unavailable';
        host.innerHTML = `
            <div class="diagnosis-report-summary">
                <div><span>Data status</span><strong>${escapeHtml(reportStatus)}</strong></div>
                <div><span>Postures attempted</span><strong>${attempted.length}/${quality.requiredTrialCount ?? trials.length}</strong></div>
                <div><span>Pain answered</span><strong>${quality.painAnsweredCount ?? 0}/${quality.attemptedTrialCount ?? 0}</strong></div>
                <div><span>Weakness answered</span><strong>${quality.weaknessAnsweredCount ?? 0}/${quality.attemptedTrialCount ?? 0}</strong></div>
                <div><span>Stiffness answered</span><strong>${quality.stiffnessAnsweredCount ?? 0}/${quality.attemptedTrialCount ?? 0}</strong></div>
            </div>
            <p><strong>${escapeHtml(report.summary?.statement || 'No summary is available.')}</strong></p>
            <p>This on-screen record includes exact optional demographics and observation notes. The reduced-detail export removes notes and direct identifiers and groups age, height, and weight into broad bands, but it is not guaranteed anonymous. Review every file before sharing. Direct identifiers remain only in the ${state.storageMode === 'device' ? 'browser-profile record' : 'current-tab record'} and the explicit full export.</p>
            ${quality.warnings?.length ? `<h3>Data-quality warnings</h3><ul>${quality.warnings.map((warning) => `<li>${escapeHtml(warning.trialId ? `${trialNames.get(warning.trialId) || 'Position'}: ${warning.message}` : warning.message)}</li>`).join('')}</ul>` : ''}
            ${quality.missingRequiredFields?.length ? `<details><summary>Missing required observations (${quality.missingRequiredFields.length})</summary><p>Complete the highlighted fields in the guided positions before treating this record as complete.</p></details>` : ''}
            <h3>Assessment context</h3>
            <div class="diagnosis-report-table-wrap"><table><tbody>
                <tr><th>Age</th><td>${Number.isFinite(report.intake?.ageYears) ? report.intake.ageYears : '—'}</td><th>Gender</th><td>${label(report.intake?.gender)}</td></tr>
                <tr><th>Assessed side</th><td>${label(report.intake?.assessedSide)}</td><th>Height / weight</th><td>${Number.isFinite(report.intake?.heightCm) ? `${report.intake.heightCm} cm` : '—'} / ${Number.isFinite(report.intake?.weightKg) ? `${report.intake.weightKg} kg` : '—'}</td></tr>
                <tr><th>Symptom duration</th><td>${label(report.intake?.symptomDuration)}</td><th>Onset</th><td>${label(report.intake?.symptomOnset)}</td></tr>
                <tr><th>Safety screen</th><td colspan="3">${report.safety?.positiveFlags?.length ? `${report.safety.positiveFlags.length} warning item(s) selected` : report.safety?.reviewed ? 'Reviewed; no warning item selected' : 'Not reviewed'}</td></tr>
            </tbody></table></div>
            <h3>Recorded posture observations</h3>
            <div class="diagnosis-report-table-wrap"><table>
                <thead><tr><th>Posture</th><th>Completion</th><th>Pain</th><th>Weakness</th><th>Stiffness</th><th>Compensation</th><th>Notes</th><th>Generic model reference</th></tr></thead>
                <tbody>${trials.map((trial) => `<tr>
                    <td><strong>${escapeHtml(trial.name)}</strong></td>
                    <td>${label(trial.observation.completion)}${trial.observation.limitingFactors?.length ? ` · ${trial.observation.limitingFactors.map(label).join(', ')}` : ''}</td>
                    <td>${stateLabel(trial.observation.pain)}${trial.observation.pain.state !== 'not_recorded' ? ` · ${scoreLabel(trial.observation.pain)}` : ''}</td>
                    <td>${stateLabel(trial.observation.weakness)}${trial.observation.weakness.state !== 'not_recorded' ? ` · ${scoreLabel(trial.observation.weakness)}` : ''}</td>
                    <td>${stateLabel(trial.observation.stiffness)}</td>
                    <td>${stateLabel(trial.observation.compensation)}</td>
                    <td>${escapeHtml(trial.observation.notes || '—')}</td>
                    <td>${trial.modelReference?.available
                        ? trial.modelReference.topRelevantPredictedControls.slice(0, 3).map((muscle) => `${escapeHtml(muscle.name)} ${formatMetric(muscle.predictedModelControl)}`).join(' · ')
                        : escapeHtml(trial.modelReference?.notComputableReason || 'Unavailable')}</td>
                </tr>`).join('')}</tbody>
            </table></div>
            <h3>Matched posture comparisons</h3>
            <p>Each comparison changes one principal posture variable while keeping the listed protocol variables fixed. Numeric symptom deltas appear only when explicit scores are present.</p>
            ${comparisonRows.length ? `<div class="diagnosis-report-table-wrap"><table><thead><tr><th>Comparison</th><th>Trials</th><th>Changed variable</th><th>Pain Δ</th><th>Weakness Δ</th><th>Status</th></tr></thead><tbody>${comparisonRows.map((comparison) => `<tr>
                <td>${escapeHtml(comparison.name)}</td><td>${comparison.trialIds.map((trialId) => escapeHtml(trialNames.get(trialId) || 'Position')).join(' → ')}</td><td>${escapeHtml(coordinateLabels[comparison.changedVariable] || String(comparison.changedVariable ?? '').replaceAll('_', ' '))}</td>
                <td>${Number.isFinite(comparison.observationDelta.painScore) ? `${comparison.observationDelta.painScore >= 0 ? '+' : ''}${formatMetric(comparison.observationDelta.painScore, 1)}` : '—'}</td>
                <td>${Number.isFinite(comparison.observationDelta.weaknessScore) ? `${comparison.observationDelta.weaknessScore >= 0 ? '+' : ''}${formatMetric(comparison.observationDelta.weaknessScore, 1)}` : '—'}</td>
                <td>${escapeHtml(comparison.observationDelta.notComputableReason || 'Complete')}</td>
            </tr>`).join('')}</tbody></table></div>` : '<p>No matched comparison has complete observations.</p>'}
            <h3>Generic model reference</h3>
            <p>${escapeHtml(protocolDemand.statement || 'This summary uses only the generic model across protocol postures. It does not use participant symptoms and cannot identify a painful or impaired muscle.')}</p>
            ${protocolDemand.ranking?.length ? `<ol>${protocolDemand.ranking.slice(0, 8).map((row) => `<li><strong>${escapeHtml(row.name)}</strong> · mean predicted model control ${formatMetric(row.meanPredictedModelControl)} · peak ${formatMetric(row.peakPredictedModelControl)}</li>`).join('')}</ol>` : '<p>No quality-gated generic model references are available.</p>'}
            <h3>Model coverage and limitations</h3>
            ${report.assessment?.legacyModelRecord ? `<p><strong>Archived historical record:</strong> ${escapeHtml(report.modelCoverage?.legacyNotice || 'This stored report predates the current model or protocol and remains read-only historical output.')}</p>` : ''}
            <p><strong>Scapular-control coverage:</strong> ${report.modelCoverage?.scapularStabilizersIncluded?.length
                ? `The static solve includes ${report.modelCoverage.scapularStabilizersIncluded.length} modeled trapezius, serratus-anterior, and related shoulder-girdle stabilizers. Their controls remain generic estimates and do not measure the observed person's scapular motion or compensation.`
                : 'Independent scapular-stabilizer coverage was not recorded for this model result; do not infer shoulder-hiking or scapular compensation from it.'}</p>
            <ul>${(report.limitations ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
        byId('diagnosis-report-title').textContent = 'Movement observation report';
        byId('diagnosis-report-time').textContent = new Date(report.generatedAt).toLocaleString();
        byId('diagnosis-report').classList.remove('hidden');
        byId('diagnosis-copy-json').disabled = false;
        byId('diagnosis-download-json').disabled = false;
        byId('capacity-copy-json').disabled = false;
        byId('capacity-download-json').disabled = false;
        byId('diagnosis-copy-json').textContent = 'Copy reduced-detail report';
        byId('diagnosis-download-json').textContent = 'Download reduced-detail report';
        byId('capacity-copy-json').textContent = 'Copy full report data';
        byId('capacity-download-json').textContent = 'Download full report data';
    }

    async function copyJson(buttonId = 'diagnosis-copy-json') {
        if (!state.report) return;
        const full = buttonId === 'capacity-copy-json';
        const payload = full ? fullReportExport(state.report, state.reportAnnex) : mainReportExport(state.report);
        const text = JSON.stringify(payload, null, 2);
        await navigator.clipboard.writeText(text);
        const button = byId(buttonId);
        button.textContent = 'Copied';
        const original = full ? 'Copy full report data' : 'Copy reduced-detail report';
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
        if (!state.storageMode) showStorageChoice();
        else if (state.phase === 'report' && state.intakeCompleted) showReportScreen();
        else if (state.phase === 'assessment' && state.intakeCompleted) showAssessment();
        else if (state.phase === 'intake' && state.safetyReviewed) showIntake();
        else showSafetyLanding();
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
    byId('diagnosis-use-session-storage').addEventListener('click', () => chooseStorageMode('session'));
    byId('diagnosis-use-device-storage').addEventListener('click', () => chooseStorageMode('device'));
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
    byId('diagnosis-continue').addEventListener('click', () => {
        if (!safetyAnswersComplete()) return;
        state.safetyReviewed = true;
        state.report = null;
        updateWarning();
        if (selectedRedFlags().length) {
            byId('diagnosis-safety-state').textContent = 'Warning recorded · assessment paused';
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
            ? (stored ? 'Saved on this device.' : 'Save failed; kept in this tab for now.')
            : 'Kept in this tab only.';
    });
    byId('diagnosis-intake-form').addEventListener('change', () => {
        readIntake();
        persistDraft();
    });
    byId('diagnosis-intake-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const form = byId('diagnosis-intake-form');
        if (!form.reportValidity()) {
            byId('diagnosis-intake-state').textContent = 'Complete the highlighted required fields.';
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
