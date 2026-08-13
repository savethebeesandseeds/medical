import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';

// The application is served as browser-native ES modules and intentionally has
// no package.json. A temporary .mjs mirror lets standalone Node execute the same
// source without changing the project's module type.
const reportModuleUrl = new URL('../public/report-v5.js', import.meta.url);
const reportModuleSource = await readFile(reportModuleUrl, 'utf8');
const moduleMirrorUrl = new URL(`.report-v5-under-test-${Date.now()}.mjs`, import.meta.url);
let reportModule;
try {
    await writeFile(moduleMirrorUrl, reportModuleSource, 'utf8');
    reportModule = await import(moduleMirrorUrl.href);
} finally {
    await unlink(moduleMirrorUrl).catch(() => {});
}

const {
    REPORT_SCHEMA_VERSION,
    buildReportV5,
    migrateReportToV5,
    mainReportExport,
    fullReportExport
} = reportModule;

const MODEL = Object.freeze({
    id: 'MOBL_ARMS_41',
    name: 'MoBL-ARMS',
    appCommit: 'test-commit',
    source: { modelSha256: 'test-model-sha' }
});

function modelEstimate(control = 0.2, force = 20) {
    return {
        available: true,
        source: 'test-reference',
        sourceSampleId: 'fixture',
        solverDurationMs: 12,
        maximumReserveTorqueNm: 0.001,
        muscles: [
            { name: 'DELT1', activation: control, activeActuatorForceN: force },
            { name: 'SUPSP', activation: control / 2, activeActuatorForceN: force / 2 },
            { name: 'ECRB', activation: 0.03, activeActuatorForceN: 3 }
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
        coordinatesDegrees: options.coordinatesDegrees ?? { shoulder_elv: 30 },
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
    assert.equal(report.analyses.symptomAssociations.pain.computable, false);
    assert.deepEqual(report.analyses.symptomAssociations.pain.explicitZeroTrialIds, []);
    assert.deepEqual(report.analyses.symptomAssociations.pain.positiveTrialIds, ['M5']);
    assert.deepEqual(report.analyses.symptomAssociations.pain.missingTrialIds, ['M4']);
    assert.match(report.analyses.symptomAssociations.pain.notComputableReason, /insufficient_data/);
});

test('explicit no answers serialize as explicit numeric zero', () => {
    const { report } = build([record('M4', explicitObservation())]);
    const observation = report.trials[0].observation;
    assert.equal(observation.pain.state, 'recorded_zero');
    assert.equal(observation.pain.score, 0);
    assert.equal(observation.weakness.state, 'recorded_zero');
    assert.equal(observation.weakness.score, 0);
});

test('model-only and skipped postures are excluded from human and symptom analyses', () => {
    const { report, technicalAnnex } = build([
        record('M4', { answered: true, result: 'not_tested' }, { control: 0.99 }),
        record('M5', explicitObservation({ pain: 'yes', painScore: 4 }), { control: 0.3 }),
        record('M6', explicitObservation(), { control: 0.1 }),
        record('D1', explicitObservation({ pain: 'yes', painScore: 10 }), { executionMode: 'model_only', control: 1 })
    ]);

    const skipped = report.trials.find((trial) => trial.id === 'M4');
    const modelOnly = technicalAnnex.researchCapacityScreen.modelOnlyTrials.find((trial) => trial.id === 'D1');
    assert.equal(skipped.observation.completion, 'skipped');
    assert.equal(skipped.observation.attempted, false);
    assert.equal(modelOnly.executionMode, 'model_only');
    assert.equal(modelOnly.includeInHumanProtocol, false);
    assert.equal(modelOnly.includeInSymptomAssociation, false);
    assert.equal(modelOnly.observation.attempted, false);
    assert.equal(report.trials.some((trial) => trial.id === 'D1'), false);
    assert.deepEqual(report.analyses.symptomAssociations.pain.positiveTrialIds, ['M5']);
    assert.deepEqual(report.analyses.symptomAssociations.pain.explicitZeroTrialIds, ['M6']);
    assert.equal(report.dataQuality.requiredTrialCount, 3);
    assert.equal(report.dataQuality.skippedTrialCount, 1);
    assert.equal(report.dataQuality.stiffnessAnsweredCount, 2);
    assert.deepEqual(technicalAnnex.researchCapacityScreen.modelOnlyTrialIds, ['D1']);
    assert.equal(technicalAnnex.researchCapacityScreen.includeInSymptomAssociation, false);

    const humanDemandNames = report.analyses.protocolDemandRanking.map((item) => item.name);
    assert.ok(humanDemandNames.length > 0);
    assert.ok(technicalAnnex.researchCapacityScreen.researchDiscriminationDemandRanking[0].meanPredictedModelControl > report.analyses.protocolDemandRanking[0].meanPredictedModelControl);
});

test('missing required observations produce an explicit insufficient-data result', () => {
    const { report } = build([
        record('M4', { answered: true, result: 'able', painScore: null, weaknessScore: null, compensation: 'no' })
    ]);

    assert.equal(report.dataQuality.interpretabilityStatus, 'insufficient_data');
    assert.equal(report.summary.status, 'insufficient_data');
    assert.match(report.summary.statement, /required symptom or movement-quality observations are missing/i);
    assert.ok(report.dataQuality.missingRequiredFields.includes('M4.pain'));
    assert.ok(report.dataQuality.missingRequiredFields.includes('M4.weakness'));
    assert.ok(report.dataQuality.missingRequiredFields.includes('M4.stiffness'));
    assert.equal(report.hypothesisEvidence.every((item) => item.confidence === 'not_computable'), true);
});

test('the main report and technical annex exclude direct patient identifiers', () => {
    const identifying = {
        name: 'PRIVATE-NAME-SENTINEL',
        email: 'private-email-sentinel@example.invalid',
        city: 'PRIVATE-CITY-SENTINEL',
        onsetDetails: 'PRIVATE-FREE-TEXT-SENTINEL',
        ageYears: 40,
        assessedArm: 'right'
    };
    const result = build([record('M4', explicitObservation())], { intake: identifying });
    const main = mainReportExport(result.report);
    const full = fullReportExport(result.report, result.technicalAnnex);
    const serializedMain = JSON.stringify(main);
    const serializedAnnex = JSON.stringify(full.technicalAnnex);

    assert.equal(main.intake.name, undefined);
    assert.equal(main.intake.email, undefined);
    assert.equal(main.intake.city, undefined);
    assert.equal(main.intake.ageYears, 40);
    assert.deepEqual(main.intake.identifiersExcluded, ['name', 'email', 'city']);
    for (const sentinel of [identifying.name, identifying.email, identifying.city, identifying.onsetDetails]) {
        assert.equal(serializedMain.includes(sentinel), false);
        assert.equal(serializedAnnex.includes(sentinel), false);
    }
    assert.equal(full.technicalAnnex.deidentified, true);
});

test('version-4 migration preserves uncertainty and converts D positions to model-only research', () => {
    const legacy = {
        schema: 'mobl-arms-biomechanical-observation-report',
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
        model: MODEL,
        capacityScreen: {
            positions: [
                {
                    id: 'M4', sequence: 4, name: 'Forward 30', instruction: 'Legacy posture',
                    coordinatesDegrees: { shoulder_elv: 30 },
                    observation: { answered: true, result: 'able', painScore: 0, perceivedWeaknessScore: 0 },
                    modelEstimate: modelEstimate(0.2)
                },
                {
                    id: 'D1', sequence: 19, name: 'Research posture', instruction: 'Legacy extreme posture',
                    coordinatesDegrees: { shoulder_elv: 125 },
                    observation: { answered: true, result: 'able', painScore: 0, perceivedWeaknessScore: 0 },
                    modelEstimate: modelEstimate(0.9)
                }
            ],
            rankedCompatiblePatterns: [{ name: 'Legacy pattern', compatible: true }]
        },
        tests: [{ id: 91, name: 'Legacy stream sentinel', observation: { status: 'completed', notes: 'legacy observation text' } }]
    };
    const originalJson = JSON.stringify(legacy);
    const { report, technicalAnnex } = migrateReportToV5(legacy);

    assert.equal(report.schemaVersion, REPORT_SCHEMA_VERSION);
    assert.match(report.assessment.assessmentId, /^legacy-/);
    assert.equal(report.assessment.testedSide, 'left');
    assert.equal(report.trials.find((trial) => trial.id === 'M4').observation.pain.state, 'not_recorded');
    assert.equal(report.trials.find((trial) => trial.id === 'M4').observation.weakness.state, 'not_recorded');
    assert.equal(report.trials.some((trial) => trial.id === 'D1'), false);
    assert.equal(technicalAnnex.researchCapacityScreen.modelOnlyTrials.find((trial) => trial.id === 'D1').executionMode, 'model_only');
    assert.equal(report.dataQuality.interpretabilityStatus, 'conflicting');
    assert.ok(report.dataQuality.warnings.some((warning) => warning.code === 'legacy_report_migrated'));
    assert.ok(report.dataQuality.warnings.some((warning) => warning.code === 'pain_unanswered_with_score'));
    assert.deepEqual(technicalAnnex.researchCapacityScreen.capacityLossCompatibility, [{ name: 'Legacy pattern', compatible: true }]);
    assert.equal(technicalAnnex.legacySymptomAssessment.tests[0].name, 'Legacy stream sentinel');
    assert.equal(technicalAnnex.deidentified, false);
    assert.equal(JSON.stringify(report).includes('legacy@example.invalid'), false);
    assert.equal(JSON.stringify(legacy), originalJson, 'Migration must not mutate a stored version-4 report');
});

test('legacy unable does not invent a weakness-positive observation', () => {
    const legacy = {
        schemaVersion: 4,
        generatedAt: '2026-08-11T12:00:00.000Z',
        capacityScreen: {
            positions: [{
                id: 'M4', name: 'Legacy unable', coordinatesDegrees: {},
                observation: { answered: true, result: 'unable', weaknessScore: null },
                modelEstimate: modelEstimate()
            }]
        }
    };
    const { report } = migrateReportToV5(legacy);
    assert.equal(report.trials[0].observation.weakness.state, 'not_recorded');
    assert.equal(report.dataQuality.interpretabilityStatus, 'insufficient_data');
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
    assert.equal(report.dataQuality.interpretabilityStatus, 'insufficient_data');
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
    assert.ok(incomplete.modelDelta.some((item) => item.name === 'DELT1' && Math.abs(item.predictedModelControlDelta - 0.2) < 1e-12));

    const complete = build([
        record('M4', explicitObservation(), { control: 0.1 }),
        record('M5', explicitObservation({ pain: 'yes', painScore: 4, weakness: 'yes', weaknessScore: 2 }), { control: 0.3 })
    ]).report;
    const computable = comparison(complete, 'forward_elevation_30_vs_45');
    assert.equal(computable.observationsComplete, true);
    assert.equal(computable.observationDelta.notComputableReason, null);
    assert.equal(computable.observationDelta.painScore, 4);
    assert.equal(computable.observationDelta.weaknessScore, 2);
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
