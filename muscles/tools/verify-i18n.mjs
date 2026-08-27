import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const publicRoot = new URL('../public/', import.meta.url);
const catalogUrl = new URL('locales/en.json', publicRoot);
const translatedCatalogDefinitions = [
    { file: 'es.json', locale: 'es' },
    { file: 'de.json', locale: 'de' },
    { file: 'el.json', locale: 'el' },
    { file: 'cs.json', locale: 'cs' },
    { file: 'zh-Hans.json', locale: 'zh-Hans' }
];
const htmlUrl = new URL('index.html', publicRoot);
const appUrl = new URL('app-ms-human.js', publicRoot);
const diagnosisUrl = new URL('diagnosis.js', publicRoot);
const protocolUrl = new URL('ms-human-assessment-protocol.js', publicRoot);
const protocolRegistryUrl = new URL('assessment-protocol-registry.js', publicRoot);
const workerUrl = new URL('ms-human-worker.js', publicRoot);
const reportUrl = new URL('report-v5.js', publicRoot);
const i18nUrl = new URL('i18n.js', publicRoot);
const localizedPageBuilderUrl = new URL('build-localized-pages.mjs', import.meta.url);
const manifestUrls = [
    new URL('models/ms_human_700/body-regions.json', publicRoot),
    new URL('models/ms_human_700/hand-region.json', publicRoot)
];

const [
    catalogSource, html, appSource, diagnosisSource, protocolSource,
    workerSource, reportSource, ...manifestSources
] = await Promise.all([
    readFile(catalogUrl, 'utf8'),
    readFile(htmlUrl, 'utf8'),
    readFile(appUrl, 'utf8'),
    readFile(diagnosisUrl, 'utf8'),
    readFile(protocolUrl, 'utf8'),
    readFile(workerUrl, 'utf8'),
    readFile(reportUrl, 'utf8'),
    ...manifestUrls.map((url) => readFile(url, 'utf8'))
]);

const catalog = JSON.parse(catalogSource);
const { ASSESSMENT_REGIONS, ASSESSMENT_PROTOCOLS } = await import(`${protocolRegistryUrl.href}?verify-i18n=${Date.now()}`);
const translatedCatalogs = await Promise.all(translatedCatalogDefinitions.map(async ({ file, locale }) => ({
    file,
    locale,
    catalog: JSON.parse(await readFile(new URL(`locales/${file}`, publicRoot), 'utf8'))
})));
const manifests = manifestSources.map((source) => JSON.parse(source));
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)*$/;
const placeholderPattern = /\{([a-z][a-zA-Z0-9]*)\}/g;
const allowedAttributes = new Set(['aria-label', 'title', 'placeholder', 'data-tooltip', 'data-label', 'content']);
const failures = [];

function check(condition, message) {
    if (!condition) failures.push(message);
}

function requireKeys(keys, family) {
    const missing = [...new Set(keys)].filter((key) => !Object.hasOwn(catalog.messages, key)).sort();
    if (missing.length) failures.push(`${family} is missing ${missing.length} key(s):\n  ${missing.join('\n  ')}`);
}

function kebab(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function escapeHtmlText(value) {
    return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeHtmlAttribute(value) {
    return escapeHtmlText(value).replaceAll('"', '&quot;');
}

function collectLiteralCalls(source, functionName) {
    const keys = [];
    const pattern = new RegExp(`\\b${functionName}\\(\\s*['\"]([^'\"]+)['\"]`, 'g');
    for (const match of source.matchAll(pattern)) keys.push(match[1]);
    return keys;
}

function placeholders(value) {
    return [...String(value).matchAll(placeholderPattern)].map((match) => match[1]).sort();
}

const expectedExplorerRegionChoiceOrder = [
    'arm',
    'hand',
    'leg',
    'foot-ankle',
    'trunk',
    'head-neck'
];
const regionChoiceBody = appSource.match(/const REGION_CHOICES = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] ?? '';
const explorerRegionChoiceOrder = [...regionChoiceBody.matchAll(/Object\.freeze\(\{\s*id:\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
const explorerRegionIds = [...regionChoiceBody.matchAll(/(?:right|left|regionId):\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
const explorerRegionChoiceLabelKeys = [...regionChoiceBody.matchAll(/labelKey:\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
const readyManifestRegionIds = manifests
    .flatMap((manifest) => manifest.regions ?? [])
    .filter((region) => !region.status || ['ready', 'data-ready'].includes(region.status))
    .map((region) => region.id);
check(
    JSON.stringify(explorerRegionChoiceOrder) === JSON.stringify(expectedExplorerRegionChoiceOrder),
    `Explorer region choice order changed: ${explorerRegionChoiceOrder.join(', ')}`
);
check(
    explorerRegionChoiceOrder.length === new Set(explorerRegionChoiceOrder).size,
    'Explorer region choices contain a duplicate logical ID.'
);
check(
    explorerRegionIds.length === new Set(explorerRegionIds).size,
    'Explorer region choices contain a duplicate model region ID.'
);
for (const regionId of readyManifestRegionIds) {
    check(explorerRegionIds.includes(regionId), `Ready manifest region is missing from the Explorer selector: ${regionId}`);
}
for (const regionId of explorerRegionIds) {
    check(readyManifestRegionIds.includes(regionId), `Explorer selector references a region that is not ready: ${regionId}`);
}
requireKeys(explorerRegionChoiceLabelKeys, 'Explorer logical region choices');

function validateCatalogShape(candidate, label, expectedLocale) {
    check(candidate && typeof candidate === 'object' && !Array.isArray(candidate), `${label} must contain an object.`);
    check(candidate?.schemaVersion === 1, `${label} schemaVersion must be 1.`);
    check(candidate?.locale === expectedLocale, `${label} locale must be "${expectedLocale}".`);
    check(['ltr', 'rtl'].includes(candidate?.dir), `${label} dir must be "ltr" or "rtl".`);
    check(candidate?.messages && typeof candidate.messages === 'object' && !Array.isArray(candidate.messages), `${label} messages must be an object.`);
    for (const [key, value] of Object.entries(candidate?.messages ?? {})) {
        check(keyPattern.test(key), `Invalid catalog key in ${label}: ${key}`);
        check(typeof value === 'string' && Boolean(value.trim()), `Catalog value must be a nonblank string in ${label}: ${key}`);
        if (typeof value !== 'string') continue;
        const stripped = value.replace(placeholderPattern, '');
        check(!/[{}]/.test(stripped), `Malformed or unsupported placeholder syntax in ${label} ${key}: ${value}`);
        const valuePlaceholders = placeholders(value);
        check(valuePlaceholders.length === new Set(valuePlaceholders).size, `Duplicate placeholder in ${label} ${key}: ${value}`);
    }
}

validateCatalogShape(catalog, 'en.json', 'en');

const regionNeutralAssessmentMessages = {
    'assessment.dialogs.reassess.message': 'First, confirm the safety check. The saved participant profile—age, gender, height, weight, and selected body region or side—will then appear prefilled in Assessment context. Pain history and movement responses start blank.',
    'assessment.intake.features.radiating-pain': 'Spreads beyond the tested area',
    'assessment.intake.fields.arm.label': 'Body area being assessed *',
    'assessment.intake.fields.relevant-history.placeholder': 'Previous injury, surgery, diagnosis, or treatment in the tested area',
    'assessment.safety.flags.circulation': 'Major sudden swelling, complete loss of sensation, or an unusually cold or discoloured tested area',
    'assessment.safety.flags.infection': 'A hot, red, swollen tested area with fever or feeling systemically unwell',
    'assessment.safety.flags.neurological': 'Persistent numbness, pins and needles, or new marked weakness in or beyond the tested area',
    'assessment.safety.flags.trauma': 'Recent fall or trauma with substantial pain, weakness, or inability to move the tested area',
    'assessment.safety.title': 'Movement safety check',
    'assessment.workspace.title': 'Regional movement observation',
    'nav.tabs.assessment.description': 'Guided regional observation'
};
for (const [key, expected] of Object.entries(regionNeutralAssessmentMessages)) {
    check(catalog.messages?.[key] === expected, `Region-neutral assessment wording changed for ${key}.`);
}
check(
    !/right upper-limb workflow/i.test(catalog.messages?.['model-info.limitations.assessment-copy'] ?? ''),
    'Model disclosure must not describe Assessment as a right-upper-limb-only workflow.'
);

for (const [key, value] of Object.entries(catalog.messages ?? {})) {
    check(keyPattern.test(key), `Invalid catalog key: ${key}`);
    check(typeof value === 'string' && Boolean(value.trim()), `Catalog value must be a nonblank string: ${key}`);
    if (typeof value !== 'string') continue;
}

const englishKeys = Object.keys(catalog.messages ?? {}).sort();
for (const { file, locale: expectedLocale, catalog: translated } of translatedCatalogs) {
    validateCatalogShape(translated, file, expectedLocale);
    const translatedKeys = Object.keys(translated.messages ?? {}).sort();
    check(JSON.stringify(translatedKeys) === JSON.stringify(englishKeys), `${file} must have exact key parity with en.json.`);
    for (const key of englishKeys) {
        if (!Object.hasOwn(translated.messages ?? {}, key)) continue;
        check(
            JSON.stringify(placeholders(translated.messages[key])) === JSON.stringify(placeholders(catalog.messages[key])),
            `${file} placeholder mismatch for ${key}.`
        );
    }
}
const translatedCatalogByLocale = new Map(translatedCatalogs.map(({ locale, catalog: translated }) => [locale, translated]));
check(translatedCatalogByLocale.get('el')?.messages?.['common.sides.right'] === 'Δεξιά',
    'Greek anatomical right-side label must be "Δεξιά".');
check(translatedCatalogByLocale.get('cs')?.messages?.['common.sides.right'] === 'Vpravo',
    'Czech anatomical right-side label must be "Vpravo".');

const htmlReferences = [];
for (const match of html.matchAll(/\bdata-i18n="([^"]+)"/g)) htmlReferences.push(match[1]);
for (const match of html.matchAll(/\bdata-i18n-attrs="([^"]+)"/g)) {
    for (const rawBinding of match[1].split(';')) {
        const separator = rawBinding.indexOf(':');
        check(separator > 0, `Invalid data-i18n-attrs binding: ${rawBinding}`);
        if (separator <= 0) continue;
        const attribute = rawBinding.slice(0, separator).trim();
        const key = rawBinding.slice(separator + 1).trim();
        check(allowedAttributes.has(attribute), `Unsupported translated attribute: ${attribute}`);
        check(keyPattern.test(key), `Invalid data-i18n-attrs key: ${key}`);
        htmlReferences.push(key);
    }
}
requireKeys(htmlReferences, 'Static HTML references');
requireKeys([
    ...collectLiteralCalls(appSource, 't'),
    ...collectLiteralCalls(diagnosisSource, 't')
], 'Literal app/diagnosis t() calls');
requireKeys([
    ...collectLiteralCalls(appSource, 'plural'),
    ...collectLiteralCalls(diagnosisSource, 'plural')
].map((key) => `${key}.other`), 'Literal app/diagnosis plural() calls');

// Catalog-backed elements may contain their exact English catalog value as a
// source-visible fallback for no-JavaScript discovery. Any non-empty fallback
// must match the catalog so static and runtime copy cannot drift apart. The
// expression is deliberately scoped to elements carrying data-i18n; it does
// not scan canonical model/legal identifiers elsewhere in the document.
const catalogElementPattern = /<(?!area\b|base\b|br\b|col\b|embed\b|hr\b|img\b|input\b|link\b|meta\b|param\b|source\b|track\b|wbr\b)([A-Za-z][\w:-]*)\b(?=[^>]*\bdata-i18n=)[^>]*\bdata-i18n="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/gi;
let catalogElementCount = 0;
for (const match of html.matchAll(catalogElementPattern)) {
    catalogElementCount += 1;
    const fallback = match[3].trim();
    check(fallback === '' || fallback === catalog.messages[match[2]],
        `Catalog-backed HTML fallback must be empty or match English catalog: ${match[2]}`);
}
check(catalogElementCount === [...html.matchAll(/\bdata-i18n="/g)].length,
    'Every data-i18n reference must be on a paired, non-void HTML element.');

const regionKeys = [];
const coordinateKeys = [];
const presetKeys = [];
const muscleGroupKeys = ['explorer.muscles.groups.other', 'explorer.muscles.groups.regional-muscles'];
const manifestMuscleNames = new Set();
for (const manifest of manifests) {
    check(Array.isArray(manifest.regions), 'Each region manifest must contain a regions array.');
    for (const region of manifest.regions ?? []) {
        regionKeys.push(`explorer.regions.${region.id}.name`, `explorer.regions.${region.id}.support`);
        for (const coordinate of region.coordinates ?? []) coordinateKeys.push(`explorer.coordinates.${coordinate.name}`);
        for (const group of region.presetGroups ?? []) {
            presetKeys.push(`explorer.presets.groups.${group.id}`);
            for (const preset of group.presets ?? []) {
                presetKeys.push(
                    `explorer.presets.items.${region.id}.${preset.id}.label`,
                    `explorer.presets.items.${region.id}.${preset.id}.description`
                );
            }
        }
        for (const muscle of region.candidateMuscles ?? region.muscles ?? []) {
            if (muscle.group) muscleGroupKeys.push(`explorer.muscles.groups.${kebab(muscle.group)}`);
            if (muscle.name) manifestMuscleNames.add(muscle.name);
        }
    }
}
for (const aliases of [
    manifests[0]?.compatibility?.rightUpperLimb?.canonicalCoordinateAliases,
    manifests[1]?.compatibility?.rightUpperLimb?.canonicalCoordinateAliases
]) {
    for (const alias of Object.keys(aliases ?? {})) coordinateKeys.push(`explorer.coordinates.${alias}`);
}
requireKeys(regionKeys, 'Region messages');
requireKeys(coordinateKeys, 'Coordinate messages');
requireKeys(presetKeys, 'Preset messages');
requireKeys(muscleGroupKeys, 'Muscle-group messages');
requireKeys([
    'explorer.coordinate-groups.wrist', 'explorer.coordinate-groups.thumb',
    'explorer.coordinate-groups.index-finger', 'explorer.coordinate-groups.middle-finger',
    'explorer.coordinate-groups.ring-finger', 'explorer.coordinate-groups.little-finger'
], 'Hand coordinate-group messages');

const protocolKeys = [];
const positionIds = [];
const comparisonIds = [];
for (const match of protocolSource.matchAll(/\bposition\(\s*'([^']+)'/g)) {
    positionIds.push(match[1]);
    protocolKeys.push(`assessment.positions.${match[1]}.name`, `assessment.positions.${match[1]}.instruction`);
}
for (const match of protocolSource.matchAll(/\bcomparison\(\s*'([^']+)'/g)) {
    comparisonIds.push(match[1]);
    protocolKeys.push(`assessment.comparisons.${match[1]}.name`);
}
check(positionIds.length > 0, 'No protocol positions were discovered.');
// Independent global panels intentionally have no arbitrary matched pairs.
// Archived protocols may still declare comparisons, so validate them when
// present without requiring every protocol design to manufacture one.
requireKeys(protocolKeys, 'Protocol messages');
const regionalProtocolKeys = ASSESSMENT_PROTOCOLS.flatMap((entry) => [
    entry.titleKey,
    entry.shortTitleKey,
    entry.descriptionKey
]);
requireKeys([
    ...regionalProtocolKeys,
    ...ASSESSMENT_REGIONS.map((region) => region.titleKey),
    ...ASSESSMENT_REGIONS.map((region) => region.availabilityKey).filter(Boolean),
    'assessment.protocol.tier.neutral-reference',
    'assessment.protocol.tier.accessible',
    'assessment.protocol.tier.moderate',
    'assessment.protocol.tier.broad'
], 'Regional protocol messages');

const qualityFunction = workerSource.match(/function staticQualityStatus\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
const qualityStatuses = [...qualityFunction.matchAll(/return\s*\[\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
check(qualityStatuses.length > 0, 'No static quality statuses were discovered.');
requireKeys([...qualityStatuses.map((status) => `explorer.quality.${status}`), 'explorer.quality.unknown'], 'Static-quality messages');

const displayRuleBody = appSource.match(/const MUSCLE_DISPLAY_RULES = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] ?? '';
const displayRuleKeys = [...displayRuleBody.matchAll(/,\s*'([^']+)'\s*\]/g)].map((match) => `explorer.muscles.names.${match[1]}`);
check(displayRuleKeys.length > 0, 'No muscle display rules were discovered.');
requireKeys(displayRuleKeys, 'Muscle-name messages');
check(manifestMuscleNames.size > 0, 'No manifest muscle identifiers were discovered.');

const reportStatusSuffixes = [...new Set([...reportSource.matchAll(/recordStatus\s*===\s*'([^']+)'|status:\s*'((?:incomplete|complete|conflicting)_record)'/g)]
    .map((match) => match[1] ?? match[2]).filter(Boolean).map((value) => value.replaceAll('_', '-')))];
const warningCodes = [...new Set([...reportSource.matchAll(/code:\s*'([^']+)'/g)].map((match) => match[1]))];
const reportValueSuffixes = [
    'positive', 'recorded-zero', 'not-recorded', 'full', 'partial', 'unable', 'stopped', 'skipped',
    'uncertain', 'pain', 'weakness', 'stiffness', 'instability', 'fear', 'coordination', 'other', 'unknown'
];
const reportLimitationSuffixes = [
    'no-single-test-diagnosis', 'generic-not-personal', 'achieved-pose-not-measured',
    'static-recruitment', 'no-measured-load', 'scapular-included', 'scapular-absent',
    'mirrored-visual-only', 'protocol-unverified', 'legacy-record'
];
const observationColumns = ['posture', 'completion', 'pain', 'weakness', 'stiffness', 'compensation', 'notes', 'model-reference'];
const comparisonColumns = ['comparison', 'trials', 'changed-variable', 'pain-delta', 'weakness-delta', 'status'];
requireKeys([
    ...reportStatusSuffixes.flatMap((suffix) => [`assessment.report.status.${suffix}`, `assessment.report.summary.${suffix}`]),
    'assessment.report.status.unavailable', 'assessment.report.summary.unavailable',
    ...warningCodes.map((code) => `assessment.report.quality.warnings.${code.replaceAll('_', '-')}`),
    'assessment.report.quality.warnings.unknown',
    ...reportValueSuffixes.map((suffix) => `assessment.report.values.${suffix}`),
    ...reportLimitationSuffixes.map((suffix) => `assessment.report.limitations.items.${suffix}`),
    ...observationColumns.map((suffix) => `assessment.report.observations.columns.${suffix}`),
    ...comparisonColumns.map((suffix) => `assessment.report.comparisons.columns.${suffix}`)
], 'Dynamic report messages');

// Exercise the exact browser localization module. These assertions guard
// against unsafe/partial interpolation, missing arguments, silent extra
// arguments, invalid catalogs, and plural fallback behavior.
const i18n = await import(`${i18nUrl.href}?verify-i18n=${Date.now()}`);
const localizedPageBuilder = await import(`${localizedPageBuilderUrl.href}?verify-i18n=${Date.now()}`);
i18n.installCatalogForTest(catalog);
const translatedMeta = new Map();
const testDocument = {
    documentElement: { lang: '', dir: '' },
    title: '',
    querySelectorAll(selector) {
        if (selector === '[data-i18n]') return [];
        if (selector === '[data-i18n-attrs]') {
            return [{
                dataset: { i18nAttrs: 'content:meta.description' },
                setAttribute(name, value) { translatedMeta.set(name, value); }
            }];
        }
        return [];
    }
};
const previousDocument = globalThis.document;
globalThis.document = testDocument;
try {
    i18n.applyDocumentTranslations(testDocument);
} finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
}
assert.equal(translatedMeta.get('content'), catalog.messages['meta.description']);
assert.equal(testDocument.title, catalog.messages['meta.title']);
assert.equal(i18n.t('assessment.position.progress', { current: '<1>', total: '&15' }), 'Position <1> of &15');
assert.equal(i18n.t('assessment.report.summary.incomplete-record', { recorded: 2, required: 15 }).includes('2'), true);
assert.throws(() => i18n.t('assessment.position.progress', { current: 1 }), /Missing localization parameter/);
assert.throws(() => i18n.t('meta.title', { unexpected: 'value' }), /Unexpected localization parameter/);
assert.throws(() => i18n.t('verify.missing-key'), /Missing localization message/);
assert.equal(i18n.plural('common.age-years', 1), '1 year');
assert.equal(i18n.plural('common.age-years', 2), '2 years');
assert.throws(() => i18n.installCatalogForTest({ ...catalog, messages: { ...catalog.messages, 'bad key': 'value' } }), /invalid message key/i);
assert.throws(() => i18n.installCatalogForTest({ ...catalog, messages: { ...catalog.messages, 'verify.blank': ' ' } }), /is empty/i);
assert.equal(i18n.resolveLanguage({ pathname: '/medical/es/tools/muscles/', search: '' }).locale, 'es');
assert.equal(i18n.resolveLanguage({ pathname: '/medical/el/tools/muscles/', search: '' }).locale, 'el');
assert.equal(i18n.resolveLanguage({ pathname: '/medical/cs/tools/muscles/', search: '' }).locale, 'cs');
assert.equal(i18n.resolveLanguage({ pathname: '/zh/tools/muscles/', search: '' }).locale, 'zh-Hans');
assert.equal(i18n.resolveLanguage({ pathname: '/ZH/tools/muscles/', search: '' }).locale, 'zh-Hans');
assert.equal(i18n.routeLanguage('/medical/de/tools/muscles/'), 'de');
assert.equal(i18n.routeLanguage('/'), null);
assert.equal(i18n.resolveLanguage({ pathname: '/', search: '?lang=de' }).locale, 'de');
assert.equal(i18n.resolveLanguage({ pathname: '/', search: '?lang=unknown' }).locale, 'en');
assert.equal(
    i18n.languageUrl('de', { href: 'https://medical.waajacu.com/en/tools/muscles/?view=assessment#report' }),
    'https://medical.waajacu.com/de/tools/muscles/?view=assessment#report'
);
assert.equal(
    i18n.languageUrl('es', { href: 'http://localhost:8080/?view=assessment#report' }),
    'http://localhost:8080/?view=assessment&lang=es#report'
);
assert.throws(() => i18n.languageUrl('fr', { href: 'https://medical.waajacu.com/en/tools/muscles/' }), /Unsupported language route/);
for (const { catalog: translated } of translatedCatalogs) {
    i18n.installCatalogForTest(translated);
    assert.equal(i18n.locale(), translated.locale);
    assert.equal(typeof i18n.t('meta.title'), 'string');
    assert.ok(i18n.t('assessment.position.progress', { current: 1, total: 15 }).includes('1'));
    assert.ok(i18n.plural('common.age-years', 2).includes('2'));
}
i18n.installCatalogForTest(catalog);

const renderedEnglish = localizedPageBuilder.renderLocalizedHtml(html, catalog);
check(renderedEnglish.includes('<html class="i18n-loading" lang="en" dir="ltr">'), 'English build must materialize html language metadata.');
check(renderedEnglish.includes(`<title>${escapeHtmlText(catalog.messages['meta.title'])}</title>`), 'English build must materialize the document title.');
check(renderedEnglish.includes(`content="${escapeHtmlAttribute(catalog.messages['meta.description'])}" data-i18n-attrs="content:meta.description"`), 'English build must materialize the meta description.');
check(renderedEnglish.includes(`property="og:title" content="${escapeHtmlAttribute(catalog.messages['meta.title'])}"`), 'English build must materialize the Open Graph title.');
check(renderedEnglish.includes(`property="og:description" content="${escapeHtmlAttribute(catalog.messages['meta.description'])}"`), 'English build must materialize the Open Graph description.');
check(renderedEnglish.includes('<link rel="canonical" href="https://medical.waajacu.com/en/tools/muscles/">'), 'English build must materialize its canonical URL.');
check(renderedEnglish.includes('<meta property="og:url" content="https://medical.waajacu.com/en/tools/muscles/">'), 'English build must materialize its Open Graph URL.');
check(renderedEnglish.includes(`data-i18n="brand.eyebrow">${catalog.messages['brand.eyebrow']}</p>`), 'English build must materialize catalog-backed text.');
check(renderedEnglish.includes(`aria-label="${catalog.messages['language.selector.aria-label']}"`), 'English build must materialize translated attributes.');
for (const { catalog: translated } of translatedCatalogs) {
    const rendered = localizedPageBuilder.renderLocalizedHtml(html, translated);
    const route = translated.locale === 'zh-Hans' ? 'zh' : translated.locale;
    const canonicalUrl = `https://medical.waajacu.com/${route}/tools/muscles/`;
    check(rendered.includes(`lang="${translated.locale}"`), `${translated.locale} build must materialize html language metadata.`);
    check(rendered.includes(`<title>${escapeHtmlText(translated.messages['meta.title'])}</title>`), `${translated.locale} build must materialize the document title.`);
    check(rendered.includes(`content="${escapeHtmlAttribute(translated.messages['meta.description'])}" data-i18n-attrs="content:meta.description"`), `${translated.locale} build must materialize the meta description.`);
    check(rendered.includes(`property="og:title" content="${escapeHtmlAttribute(translated.messages['meta.title'])}"`), `${translated.locale} build must materialize the Open Graph title.`);
    check(rendered.includes(`property="og:description" content="${escapeHtmlAttribute(translated.messages['meta.description'])}"`), `${translated.locale} build must materialize the Open Graph description.`);
    check(rendered.includes(`<link rel="canonical" href="${canonicalUrl}">`), `${translated.locale} build must materialize its canonical URL.`);
    check(rendered.includes(`<meta property="og:url" content="${canonicalUrl}">`), `${translated.locale} build must materialize its Open Graph URL.`);
    check(rendered.includes(`data-i18n="brand.eyebrow">${translated.messages['brand.eyebrow']}</p>`), `${translated.locale} build must materialize catalog-backed text.`);
}

if (failures.length) {
    throw new Error(`Localization verification failed:\n- ${failures.join('\n- ')}`);
}

console.log(`Verified ${translatedCatalogs.length + 1} localization catalogs: ${Object.keys(catalog.messages).length} messages each, ${htmlReferences.length} HTML references, ${regionKeys.length + coordinateKeys.length + presetKeys.length} manifest-derived references, ${protocolKeys.length} protocol references.`);
