import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';

// The application is served as browser-native ES modules and intentionally has
// no package.json. A temporary .mjs mirror lets standalone Node execute the same
// source without changing the project's module type.
const reportModuleUrl = new URL('../public/report-v5.js', import.meta.url);
const reportModuleSource = await readFile(reportModuleUrl, 'utf8');
const moduleMirrorUrl = new URL(`.report-v5-under-test-${Date.now()}.mjs`, import.meta.url);
const diagnosisModuleUrl = new URL('../public/diagnosis.js', import.meta.url);
const diagnosisModuleSource = await readFile(diagnosisModuleUrl, 'utf8');
const diagnosisMirrorUrl = new URL(`.diagnosis-under-test-${Date.now()}.mjs`, import.meta.url);
const protocolModuleUrl = new URL('../public/ms-human-assessment-protocol.js', import.meta.url);
const protocolModuleSource = await readFile(protocolModuleUrl, 'utf8');
const protocolMirrorUrl = new URL(`.assessment-protocol-under-test-${Date.now()}.mjs`, import.meta.url);
let reportModule;
let diagnosisModule;
try {
    await writeFile(moduleMirrorUrl, reportModuleSource, 'utf8');
    await writeFile(protocolMirrorUrl, protocolModuleSource, 'utf8');
    await writeFile(
        diagnosisMirrorUrl,
        diagnosisModuleSource
            .replace("'./report-v5.js'", JSON.stringify(moduleMirrorUrl.href))
            .replace("'./ms-human-assessment-protocol.js'", JSON.stringify(protocolMirrorUrl.href)),
        'utf8'
    );
    reportModule = await import(moduleMirrorUrl.href);
    diagnosisModule = await import(diagnosisMirrorUrl.href);
} finally {
    await unlink(moduleMirrorUrl).catch(() => {});
    await unlink(diagnosisMirrorUrl).catch(() => {});
    await unlink(protocolMirrorUrl).catch(() => {});
}

const {
    REPORT_SCHEMA_VERSION,
    buildReportV5,
    migrateReportToV5,
    mainReportExport,
    fullReportExport
} = reportModule;

const { completeStaticState, reportModelMetadata } = diagnosisModule;

const SCAPULAR_STABILIZERS = Object.freeze([
    'cleid_mast', 'cleid_occ', 'trap_cl', 'trap_acr_scap', 'trap_acr_T1',
    'trap_acr_T2', 'trap_acr_T3', 'trap_inf_T4', 'trap_inf_T5', 'trap_inf_T6',
    'trap_inf_T7', 'trap_inf_T8', 'trap_inf_T9', 'trap_inf_T10', 'trap_inf_T11',
    'trap_inf_T12', 'levator_scap', 'SerrAnt1_1_R', 'SerrAnt2_1_R',
    'SerrAnt2_2_R', 'SerrAnt3_1_R', 'SerrAnt4_1_R', 'SerrAnt5_1_R',
    'SerrAnt6_1_R', 'SerrAnt7_1_R', 'SerrAnt8_1_R', 'SerrAnt9_1_R'
]);

const MODEL = Object.freeze({
    id: 'ms-human-700-primary-right-arm',
    modelDigest: 'test-model-digest',
    name: 'MS-Human-700',
    variant: 'primary / right-arm static posture prototype',
    appCommit: 'test-commit',
    solverConfigurationId: 'test-solver-config',
    controlFloor: 0,
    functionalMuscleCount: 4,
    muscles: ['DELT1_r', 'SUPSP_r', 'ECRB_r', 'trap_cl'],
    actuatorIds: [114, 117, 151, 161],
    scapularStabilizers: ['trap_cl'],
    source: { modelLicense: 'Apache-2.0', sourceTreeSha256: 'test-source-tree-sha' }
});

const ASSESSMENT_PROTOCOL = Object.freeze({
    id: 'ms-human-static-upper-limb-assessment-test',
    version: '2.0.0-test',
    digest: `sha256:${'a'.repeat(64)}`,
    name: 'MS-Human static upper-limb test protocol',
    trialIds: ['M4', 'M5', 'M6'],
    matchedComparisons: [{
        id: 'forward_elevation_30_vs_45',
        name: 'Forward elevation 30 vs 45 degrees',
        trialIds: ['M4', 'M5'],
        controlledVariables: ['forward plane', 'elbow flexion 90 degrees', 'gravity-only reference'],
        changedVariable: 'shoulder_elevation'
    }]
});

function modelEstimate(control = 0.2, force = 20) {
    return {
        available: true,
        source: 'test-reference',
        sourceSampleId: 'fixture',
        solverDurationMs: 12,
        maximumReserveTorqueNm: 0.001,
        muscles: [
            { name: 'DELT1_r', activation: control, activeActuatorForceN: force },
            { name: 'SUPSP_r', activation: control / 2, activeActuatorForceN: force / 2 },
            { name: 'ECRB_r', activation: 0.03, activeActuatorForceN: 3 },
            { name: 'trap_cl', activation: control / 4, activeActuatorForceN: force / 4 }
        ]
    };
}

function record(id, rawObservation, options = {}) {
    return {
        id,
        sequence: options.sequence ?? Number(id.slice(1)),
        name: options.name ?? `Posture ${id}`,
        instruction: 'Test posture',
        executionMode: options.executionMode,
        coordinatesDegrees: options.coordinatesDegrees ?? { shoulder_elv_r: 30 },
        rawObservation,
        modelEstimate: options.modelEstimate ?? modelEstimate(options.control ?? 0.2)
    };
}

function explicitObservation({
    result = 'able', pain = 'no', painScore = 0, painLocation = pain === 'yes' ? 'lateral_upper_arm' : '',
    weakness = 'no', weaknessScore = 0, stiffness = 'no', compensation = 'no',
    compensationDetail = compensation === 'yes' ? 'shoulder_hike' : '',
    limitingFactor = ['partial', 'unable', 'stopped'].includes(result) ? 'other' : ''
} = {}) {
    return { answered: true, result, pain, painScore, painLocation, weakness, weaknessScore, stiffness, compensation, compensationDetail, limitingFactor };
}

function build(positionRecords, extra = {}) {
    return buildReportV5({
        assessmentId: extra.assessmentId ?? 'assessment-test',
        generatedAt: '2026-08-12T20:00:00.000Z',
        testedSide: extra.testedSide ?? 'right',
        safetyReviewed: true,
        intake: extra.intake ?? {},
        positionRecords,
        model: MODEL,
        assessmentProtocol: ASSESSMENT_PROTOCOL,
        syntheticData: true,
        ...extra
    });
}

function comparison(report, id) {
    const value = report.matchedComparisons.find((item) => item.id === id);
    assert.ok(value, `Expected matched comparison ${id}`);
    return value;
}

const tests = [];
function test(name, callback) {
    tests.push({ name, callback });
}

test('null symptom values remain unknown and never become explicit zero controls', () => {
    const unknown = { answered: true, result: 'able', painScore: null, weaknessScore: null, compensation: 'no' };
    const positive = explicitObservation({ pain: 'yes', painScore: 5 });
    const { report } = build([
        record('M4', unknown, { control: 0.1 }),
        record('M5', positive, { control: 0.4 })
    ]);

    const m4 = report.trials.find((trial) => trial.id === 'M4');
    assert.equal(m4.observation.pain.state, 'not_recorded');
    assert.equal(m4.observation.weakness.state, 'not_recorded');
    assert.equal(report.analyses.symptomAssociations, undefined);
    assert.equal(report.hypothesisEvidence, undefined);
    assert.equal(report.analyses.genericProtocolDemand.symptomLinked, false);
    assert.match(report.analyses.genericProtocolDemand.statement, /without using pain, weakness, or other participant observations/i);
});

test('string muscle metadata preserves all explicit scapular stabilizers in reports', () => {
    const muscles = ['DELT1_r', ...SCAPULAR_STABILIZERS];
    const metadata = reportModelMetadata({
        id: 'ms-human-700-right-arm',
        name: 'MS-Human-700',
        muscles,
        scapularStabilizers: [...SCAPULAR_STABILIZERS, 'trap_cl', 'not-in-functional-inventory']
    });
    assert.deepEqual(metadata.scapularStabilizers, SCAPULAR_STABILIZERS);
    const { report } = build([], { model: metadata });
    assert.equal(report.modelCoverage.scapularStabilizersIncluded.length, 27);
    assert.deepEqual(report.modelCoverage.scapularStabilizersIncluded, SCAPULAR_STABILIZERS);
});

test('diagnosis accepts only exact current complete static vectors', () => {
    const model = {
        id: 'ms-human-700-right-arm',
        modelDigest: 'digest-current',
        solverConfigurationId: 'solver-current',
        functionalMuscleCount: 3,
        muscles: ['DELT1_r', 'SUPSP_r', 'trap_cl'],
        actuatorIds: [114, 117, 161]
    };
    const state = {
        mode: 'static',
        modelDigest: 'digest-current',
        solverConfigId: 'solver-current',
        staticHolding: { solver: { converged: true }, quality: { usable: true } },
        muscles: [
            { name: 'DELT1_r', actuatorId: 114, activation: 0.2, activeActuatorForceN: 20 },
            { name: 'SUPSP_r', actuatorId: 117, activation: 0.1, activeActuatorForceN: 10 },
            { name: 'trap_cl', actuatorId: 161, activation: 0.05, activeActuatorForceN: 5 }
        ]
    };
    assert.equal(completeStaticState(state, model), true);
    assert.equal(completeStaticState({ ...state, modelDigest: 'stale-digest' }, model), false);
    assert.equal(completeStaticState({ ...state, solverConfigId: 'stale-solver' }, model), false);
    assert.equal(completeStaticState({ ...state, muscles: state.muscles.slice(0, 2) }, model), false);
    assert.equal(completeStaticState({
        ...state,
        muscles: state.muscles.map((muscle, index) => index === 2 ? { ...muscle, actuatorId: 117 } : muscle)
    }, model), false);
    assert.equal(completeStaticState({
        ...state,
        muscles: state.muscles.map((muscle, index) => index === 1 ? { ...muscle, activeActuatorForceN: Number.NaN } : muscle)
    }, model), false);
    assert.equal(completeStaticState({
        ...state,
        muscles: state.muscles.map((muscle, index) => index === 1 ? { ...muscle, activation: Number.NaN } : muscle)
    }, model), false);
});

test('explicit no answers serialize as explicit numeric zero', () => {
    const { report } = build([record('M4', explicitObservation())]);
    const observation = report.trials[0].observation;
    assert.equal(observation.pain.state, 'recorded_zero');
    assert.equal(observation.pain.score, 0);
    assert.equal(observation.weakness.state, 'recorded_zero');
    assert.equal(observation.weakness.score, 0);
});

test('skipped postures remain descriptive while generic protocol demand stays symptom-independent', () => {
    const { report } = build([
        record('M4', { answered: true, result: 'not_tested' }, { control: 0.99 }),
        record('M5', explicitObservation({ pain: 'yes', painScore: 4 }), { control: 0.3 }),
        record('M6', explicitObservation(), { control: 0.1 })
    ]);

    const skipped = report.trials.find((trial) => trial.id === 'M4');
    assert.equal(skipped.observation.completion, 'skipped');
    assert.equal(skipped.observation.attempted, false);
    assert.equal(report.dataQuality.requiredTrialCount, 3);
    assert.equal(report.dataQuality.skippedTrialCount, 1);
    assert.equal(report.dataQuality.stiffnessAnsweredCount, 2);
    assert.equal(report.analyses.symptomAssociations, undefined);
    const humanDemandNames = report.analyses.genericProtocolDemand.ranking.map((item) => item.name);
    assert.ok(humanDemandNames.length > 0);
});

test('missing required observations produce an explicit insufficient-data result', () => {
    const { report } = build([
        record('M4', { answered: true, result: 'able', painScore: null, weaknessScore: null, compensation: 'no' })
    ]);

    assert.equal(report.dataQuality.recordStatus, 'incomplete_record');
    assert.equal(report.dataQuality.interpretabilityStatus, undefined);
    assert.equal(report.summary.status, 'incomplete_record');
    assert.match(report.summary.statement, /record is incomplete/i);
    assert.ok(report.dataQuality.missingRequiredFields.includes('M4.pain'));
    assert.ok(report.dataQuality.missingRequiredFields.includes('M4.weakness'));
    assert.ok(report.dataQuality.missingRequiredFields.includes('M4.stiffness'));
    assert.equal(report.hypothesisEvidence, undefined);
});

test('the privacy-reduced main export excludes direct identifiers, free text, and exact demographics', () => {
    const identifying = {
        name: 'PRIVATE-NAME-SENTINEL',
        email: 'private-email-sentinel@example.invalid',
        city: 'PRIVATE-CITY-SENTINEL',
        onsetDetails: 'PRIVATE-FREE-TEXT-SENTINEL',
        ageYears: 47,
        heightCm: 183,
        weightKg: 91,
        assessedArm: 'right'
    };
    const noteSentinel = 'PRIVATE-OBSERVATION-NOTE-SENTINEL';
    const observation = { ...explicitObservation(), notes: noteSentinel };
    const result = build([record('M4', observation)], { intake: identifying });
    const main = mainReportExport(result.report);
    const full = fullReportExport(result.report, result.technicalAnnex);
    const serializedMain = JSON.stringify(main);
    const serializedAnnex = JSON.stringify(full.technicalAnnex);

    assert.equal(main.intake.name, undefined);
    assert.equal(main.intake.email, undefined);
    assert.equal(main.intake.city, undefined);
    assert.equal(main.intake.ageYears, undefined);
    assert.equal(main.intake.heightCm, undefined);
    assert.equal(main.intake.weightKg, undefined);
    assert.equal(main.intake.ageBandYears, '40-49');
    assert.equal(main.intake.heightBandCm, '180-189');
    assert.equal(main.intake.weightBandKg, '90-99');
    assert.deepEqual(main.intake.identifiersExcluded, ['name', 'email', 'city']);
    for (const sentinel of [identifying.name, identifying.email, identifying.city, identifying.onsetDetails, noteSentinel]) {
        assert.equal(serializedMain.includes(sentinel), false);
    }
    assert.equal(main.exportPrivacy.status, 'privacy_reduced_not_anonymous');
    assert.equal(main.trials[0].observation.notes, undefined);
    assert.equal(full.report.intake.ageYears, 47);
    assert.equal(full.report.intake.heightCm, 183);
    assert.equal(full.report.intake.weightKg, 91);
    assert.equal(full.report.trials[0].observation.notes, noteSentinel);
    assert.equal(full.exportPrivacy.status, 'full_local_assessment_export');
    assert.equal(full.technicalAnnex.privacyStatus, 'technical_model_data_only');
    assert.equal(full.technicalAnnex.directIdentifiersIncluded, false);
    for (const sentinel of [identifying.name, identifying.email, identifying.city, identifying.onsetDetails]) {
        assert.equal(serializedAnnex.includes(sentinel), false);
    }
});

test('current reports and every export remove legacy symptom-to-muscle inferences', () => {
    const stored = build([
        record('M4', explicitObservation(), { control: 0.1 }),
        record('M5', explicitObservation({ pain: 'yes', painScore: 4, weakness: 'yes', weaknessScore: 2 }), { control: 0.4 })
    ]);
    const sentinel = 'FORBIDDEN-SYMPTOM-MUSCLE-INFERENCE-SENTINEL';
    stored.report.analyses.symptomAssociations = {
        pain: { computable: true, ranking: [{ name: sentinel, associationContrast: 0.3 }] },
        weakness: { computable: true, ranking: [{ name: sentinel, associationContrast: 0.2 }] }
    };
    stored.report.hypothesisEvidence = [{ hypothesis: sentinel, confidence: 'descriptive_only' }];
    stored.report.matchedComparisons[0].modelDelta = [{ name: sentinel, predictedModelControlDelta: 0.3 }];
    stored.report.dataQuality.interpretabilityStatus = 'interpretable';
    delete stored.report.dataQuality.recordStatus;
    stored.report.summary.status = 'interpretable';

    const migrated = migrateReportToV5(stored.report, stored.technicalAnnex, { assessmentProtocol: ASSESSMENT_PROTOCOL });
    assert.equal(migrated.report.trials.length, 2, 'Scientific-boundary cleanup must preserve current-protocol observations');
    assert.equal(migrated.report.dataQuality.recordStatus, 'complete_record');
    assert.equal(migrated.report.dataQuality.interpretabilityStatus, undefined);
    assert.equal(migrated.report.analyses.symptomAssociations, undefined);
    assert.equal(migrated.report.hypothesisEvidence, undefined);
    assert.equal(migrated.report.matchedComparisons[0].modelDelta, undefined);

    const mainJson = JSON.stringify(mainReportExport(stored.report));
    const fullJson = JSON.stringify(fullReportExport(stored.report, stored.technicalAnnex));
    for (const serialized of [mainJson, fullJson]) {
        assert.equal(serialized.includes(sentinel), false);
        assert.equal(serialized.includes('"symptomAssociations"'), false);
        assert.equal(serialized.includes('"hypothesisEvidence"'), false);
        assert.equal(serialized.includes('"modelDelta"'), false);
    }
});

test('protocol identity is explicit and missing identity disables protocol interpretation', () => {
    const identified = build([record('M4', explicitObservation()), record('M5', explicitObservation())]);
    assert.equal(identified.report.assessment.assessmentProtocolId, ASSESSMENT_PROTOCOL.id);
    assert.equal(identified.report.assessment.protocolVersion, ASSESSMENT_PROTOCOL.version);
    assert.equal(identified.report.assessment.assessmentProtocolDigest, ASSESSMENT_PROTOCOL.digest);
    assert.equal(identified.report.assessment.protocolIdentityVerified, true);
    assert.equal(identified.technicalAnnex.assessmentProtocol.digest, ASSESSMENT_PROTOCOL.digest);
    assert.equal(identified.report.matchedComparisons.length, 1);

    const unidentified = buildReportV5({
        assessmentId: 'unidentified-protocol',
        positionRecords: [record('M4', explicitObservation()), record('M5', explicitObservation())],
        model: MODEL,
        syntheticData: true
    });
    assert.equal(unidentified.report.assessment.protocolIdentityVerified, false);
    assert.equal(unidentified.report.dataQuality.recordStatus, 'incomplete_record');
    assert.deepEqual(unidentified.report.matchedComparisons, []);
    assert.deepEqual(unidentified.report.analyses.genericProtocolDemand.ranking, []);
    assert.ok(unidentified.report.dataQuality.warnings.some((warning) => warning.code === 'assessment_protocol_identity_unverified'));
});

test('a stored report from another protocol is archived, never remapped to replacement trial IDs', () => {
    const stored = structuredClone(build([
        record('M4', explicitObservation({ pain: 'yes', painScore: 3 })),
        record('M5', explicitObservation())
    ]));
    const previousProtocol = {
        id: 'previous-static-panel',
        version: '1.0.0',
        digest: `sha256:${'b'.repeat(64)}`,
        identityVerified: true
    };
    stored.report.assessment.assessmentProtocol = previousProtocol;
    stored.report.assessment.assessmentProtocolId = previousProtocol.id;
    stored.report.assessment.protocolVersion = previousProtocol.version;
    stored.report.assessment.assessmentProtocolDigest = previousProtocol.digest;
    stored.report.assessment.protocolIdentityVerified = true;
    stored.technicalAnnex.assessmentProtocol = previousProtocol;
    const original = JSON.stringify(stored);

    const migrated = migrateReportToV5(stored.report, stored.technicalAnnex, { assessmentProtocol: ASSESSMENT_PROTOCOL });
    assert.deepEqual(migrated.report.trials, []);
    assert.deepEqual(migrated.report.matchedComparisons, []);
    assert.equal(migrated.report.analyses.symptomAssociations, undefined);
    assert.equal(migrated.report.hypothesisEvidence, undefined);
    assert.equal(migrated.report.assessment.migrationRequired, true);
    assert.ok(migrated.report.dataQuality.warnings.some((warning) => (
        warning.code === 'assessment_protocol_migration_required'
        && warning.reason === 'stored_assessment_protocol_does_not_match_current_protocol'
    )));
    assert.equal(
        migrated.technicalAnnex.legacySymptomAssessment.migrationReason,
        'stored_assessment_protocol_does_not_match_current_protocol'
    );
    assert.equal(migrated.technicalAnnex.legacySymptomAssessment.sourceAssessmentProtocol.id, previousProtocol.id);
    assert.equal(migrated.technicalAnnex.legacySymptomAssessment.expectedAssessmentProtocol.id, ASSESSMENT_PROTOCOL.id);
    assert.deepEqual(
        migrated.technicalAnnex.legacySymptomAssessment.archivedProtocolObservations.map((entry) => entry.sourceTrialId),
        ['M4', 'M5']
    );
    const repeated = migrateReportToV5(migrated.report, migrated.technicalAnnex, { assessmentProtocol: ASSESSMENT_PROTOCOL });
    assert.equal(repeated.report, migrated.report, 'An already archived report must not be migrated repeatedly');
    assert.equal(repeated.technicalAnnex, migrated.technicalAnnex);
    assert.equal(JSON.stringify(stored), original, 'Protocol migration must not mutate the stored report');
});

test('version-4 migration retains human observations and strips all prior model evidence', () => {
    const legacy = {
        schema: 'legacy-biomechanical-observation-report',
        schemaVersion: 4,
        generatedAt: '2026-08-11T12:34:56.000Z',
        testedSide: 'left',
        safetyReviewed: true,
        redFlags: [],
        intake: {
            name: 'Legacy Person',
            email: 'legacy@example.invalid',
            city: 'Legacy City',
            ageYears: 55,
            assessedArm: 'left'
        },
        model: {
            id: 'PREVIOUS-MODEL-SENTINEL',
            name: 'Previous model sentinel',
            source: { modelSha256: 'PREVIOUS-SOURCE-SENTINEL' }
        },
        capacityScreen: {
            positions: [
                {
                    id: 'M4', sequence: 4, name: 'Forward 30', instruction: 'Legacy posture',
                    coordinatesDegrees: { shoulder_elv_r: 30 },
                    observation: { answered: true, result: 'able', painScore: 0, perceivedWeaknessScore: 0 },
                    modelEstimate: { ...modelEstimate(0.2), sentinel: 'PREVIOUS-VECTOR-SENTINEL' }
                },
                {
                    id: 'D1', sequence: 19, name: 'Research posture', instruction: 'Legacy extreme posture',
                    coordinatesDegrees: { shoulder_elv_r: 125 },
                    observation: { answered: true, result: 'able', painScore: 0, perceivedWeaknessScore: 0 },
                    modelEstimate: { ...modelEstimate(0.9), sentinel: 'PREVIOUS-RESEARCH-SENTINEL' }
                }
            ],
            rankedCompatiblePatterns: [{ name: 'PREVIOUS-RANKING-SENTINEL', compatible: true }]
        },
        tests: [{
            id: 91,
            name: 'Legacy stream sentinel',
            observation: { status: 'completed', notes: 'legacy observation text' },
            run: { activations: [0.1, 0.2], sentinel: 'PREVIOUS-RUN-SENTINEL' }
        }]
    };
    const originalJson = JSON.stringify(legacy);
    const { report, technicalAnnex } = migrateReportToV5(legacy);

    assert.equal(report.schemaVersion, REPORT_SCHEMA_VERSION);
    assert.match(report.assessment.assessmentId, /^legacy-/);
    assert.equal(report.assessment.testedSide, 'left');
    assert.deepEqual(report.trials, [], 'Legacy postures must not be mapped onto the current protocol trial list');
    assert.equal(report.dataQuality.recordStatus, 'incomplete_record');
    assert.ok(report.dataQuality.warnings.some((warning) => warning.code === 'legacy_report_migrated'));
    assert.ok(report.dataQuality.warnings.some((warning) => warning.code === 'assessment_protocol_identity_unverified'));
    assert.equal(technicalAnnex.legacySymptomAssessment.tests[0].name, 'Legacy stream sentinel');
    assert.equal(technicalAnnex.legacySymptomAssessment.tests[0].run, undefined);
    assert.deepEqual(
        technicalAnnex.legacySymptomAssessment.archivedProtocolObservations.map((entry) => entry.sourceTrialId),
        ['M4', 'D1']
    );
    assert.equal(technicalAnnex.legacySymptomAssessment.protocolDefinitionRemoved, true);
    assert.equal(technicalAnnex.legacySymptomAssessment.interpretationExcluded, true);
    assert.equal(technicalAnnex.privacyStatus, 'review_required_possible_legacy_free_text');
    assert.equal(technicalAnnex.directIdentifiersIncluded, false);
    assert.equal(JSON.stringify(report).includes('legacy@example.invalid'), false);
    const migratedJson = JSON.stringify({ report, technicalAnnex });
    for (const sentinel of [
        'PREVIOUS-MODEL-SENTINEL', 'PREVIOUS-SOURCE-SENTINEL', 'PREVIOUS-VECTOR-SENTINEL',
        'PREVIOUS-RESEARCH-SENTINEL', 'PREVIOUS-RANKING-SENTINEL', 'PREVIOUS-RUN-SENTINEL'
    ]) assert.equal(migratedJson.includes(sentinel), false);
    assert.equal(technicalAnnex.trialModels.every((trial) => trial.available === false && trial.muscles.length === 0), true);
    assert.equal(report.modelCoverage.modelId, 'legacy-model-evidence-removed');
    assert.equal(report.modelCoverage.legacyModelRecord, true);
    assert.match(report.modelCoverage.legacyNotice, /earlier model results are not included/i);
    assert.equal(JSON.stringify(legacy), originalJson, 'Migration must not mutate a stored version-4 report');

    const priorV5 = structuredClone(build([record('M4', explicitObservation())]));
    priorV5.report.assessment.legacyModelRecord = true;
    priorV5.report.modelCoverage.modelId = 'PREVIOUS-V5-MODEL-SENTINEL';
    priorV5.report.analyses.genericProtocolDemand.ranking = [{ name: 'PREVIOUS-V5-RANKING-SENTINEL', meanPredictedModelControl: 0.7 }];
    priorV5.report.trials[0].modelReference = { available: true, muscles: [{ name: 'PREVIOUS-V5-VECTOR-SENTINEL', control: 0.7 }] };
    priorV5.technicalAnnex.model = { id: 'PREVIOUS-V5-ANNEX-MODEL-SENTINEL' };
    priorV5.technicalAnnex.legacySymptomAssessment = {
        sourceSchemaVersion: 4,
        responses: { 1: { status: 'completed', notes: 'human note' } },
        runs: { 1: { sentinel: 'PREVIOUS-V5-RUN-SENTINEL', activations: [0.7] } }
    };
    const sanitizedV5 = migrateReportToV5(priorV5.report, priorV5.technicalAnnex);
    const sanitizedV5Json = JSON.stringify(sanitizedV5);
    for (const sentinel of [
        'PREVIOUS-V5-MODEL-SENTINEL', 'PREVIOUS-V5-RANKING-SENTINEL',
        'PREVIOUS-V5-VECTOR-SENTINEL', 'PREVIOUS-V5-ANNEX-MODEL-SENTINEL',
        'PREVIOUS-V5-RUN-SENTINEL'
    ]) assert.equal(sanitizedV5Json.includes(sentinel), false);
    assert.deepEqual(sanitizedV5.report.trials, []);
    const archivedM4 = sanitizedV5.technicalAnnex.legacySymptomAssessment.archivedProtocolObservations
        .find((entry) => entry.sourceTrialId === 'M4');
    assert.equal(archivedM4.observation.pain, 'no');
    assert.equal(archivedM4.observation.painScore, 0);
    assert.equal(sanitizedV5.technicalAnnex.legacySymptomAssessment.responses['1'].notes, 'human note');
    assert.equal(sanitizedV5.technicalAnnex.legacySymptomAssessment.runs, undefined);
});

test('positive details and incomplete-movement reasons are required by the schema', () => {
    const malformed = {
        completion: 'partial', pain: 'yes', painScore: null, painLocation: '',
        weakness: 'no', stiffness: 'no', compensation: 'yes', compensationDetail: ''
    };
    const unexplained = {
        completion: 'partial', pain: 'no', painScore: 0, weakness: 'no', weaknessScore: 0,
        stiffness: 'no', compensation: 'no'
    };
    const { report } = build([record('M4', malformed), record('M5', unexplained)]);
    assert.equal(report.trials[0].observation.answered, false);
    assert.equal(report.dataQuality.recordStatus, 'incomplete_record');
    assert.ok(report.dataQuality.missingRequiredFields.includes('M4.pain.score'));
    assert.ok(report.dataQuality.missingRequiredFields.includes('M4.pain.location'));
    assert.ok(report.dataQuality.missingRequiredFields.includes('M4.compensation.detail'));
    assert.ok(report.dataQuality.missingRequiredFields.includes('M5.limitingFactor'));
});

test('matched comparisons explain incomplete observations and compute only explicit deltas', () => {
    const { report } = build([
        record('M4', { answered: true, result: 'able', pain: 'no', painScore: 0, weakness: 'no', weaknessScore: 0, stiffness: 'no', compensation: 'no' }, { control: 0.1 }),
        record('M5', { answered: true, result: 'able', pain: 'yes', painScore: 4, weaknessScore: null, stiffness: 'no', compensation: 'no' }, { control: 0.3 })
    ]);
    const incomplete = comparison(report, 'forward_elevation_30_vs_45');
    assert.equal(incomplete.observationsComplete, false);
    assert.equal(incomplete.observationDelta.painScore, 4);
    assert.equal(incomplete.observationDelta.weaknessScore, null);
    assert.match(incomplete.observationDelta.notComputableReason, /Both trials require explicit completion, pain, weakness, stiffness, and compensation/);
    assert.equal(incomplete.modelDelta, undefined);

    const complete = build([
        record('M4', explicitObservation(), { control: 0.1 }),
        record('M5', explicitObservation({ pain: 'yes', painScore: 4, weakness: 'yes', weaknessScore: 2 }), { control: 0.3 })
    ]).report;
    const computable = comparison(complete, 'forward_elevation_30_vs_45');
    assert.equal(computable.observationsComplete, true);
    assert.equal(computable.observationDelta.notComputableReason, null);
    assert.equal(computable.observationDelta.painScore, 4);
    assert.equal(computable.observationDelta.weaknessScore, 2);
    assert.equal(computable.modelDelta, undefined);
});

let passed = 0;
for (const { name, callback } of tests) {
    try {
        await callback();
        passed += 1;
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}`);
        throw error;
    }
}

console.log(`Diagnosis report verification passed: ${passed}/${tests.length} tests.`);
