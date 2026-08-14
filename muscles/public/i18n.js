const CATALOG_SCHEMA_VERSION = 1;
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)*$/;
const TRANSLATABLE_ATTRIBUTES = new Set(['aria-label', 'title', 'placeholder', 'data-tooltip', 'data-label']);
const PLACEHOLDER_PATTERN = /\{([a-z][a-zA-Z0-9]*)\}/g;
const TOOL_ROUTE_PATTERN = /\/(en|es|de|el|cs|zh)(?=\/tools\/muscles(?:\/|$))/i;

export const SUPPORTED_LANGUAGES = Object.freeze({
    en: Object.freeze({ route: 'en', locale: 'en', catalog: 'en.json' }),
    es: Object.freeze({ route: 'es', locale: 'es', catalog: 'es.json' }),
    de: Object.freeze({ route: 'de', locale: 'de', catalog: 'de.json' }),
    el: Object.freeze({ route: 'el', locale: 'el', catalog: 'el.json' }),
    cs: Object.freeze({ route: 'cs', locale: 'cs', catalog: 'cs.json' }),
    zh: Object.freeze({ route: 'zh', locale: 'zh-Hans', catalog: 'zh-Hans.json' })
});

let activeCatalog = null;

function catalogError(message) {
    return new Error(`Invalid localization catalog: ${message}`);
}

function validateCatalog(catalog) {
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
        throw catalogError('expected an object');
    }
    if (catalog.schemaVersion !== CATALOG_SCHEMA_VERSION) {
        throw catalogError(`unsupported schema version ${String(catalog.schemaVersion)}`);
    }
    if (typeof catalog.locale !== 'string' || !catalog.locale.trim()) {
        throw catalogError('locale is required');
    }
    if (!['ltr', 'rtl'].includes(catalog.dir)) {
        throw catalogError('dir must be "ltr" or "rtl"');
    }
    if (!catalog.messages || typeof catalog.messages !== 'object' || Array.isArray(catalog.messages)) {
        throw catalogError('messages must be an object');
    }
    for (const [key, value] of Object.entries(catalog.messages)) {
        if (!KEY_PATTERN.test(key)) throw catalogError(`invalid message key "${key}"`);
        if (typeof value !== 'string' || !value.trim()) throw catalogError(`message "${key}" is empty`);
    }
    return Object.freeze({
        schemaVersion: catalog.schemaVersion,
        locale: catalog.locale,
        dir: catalog.dir,
        messages: Object.freeze({ ...catalog.messages })
    });
}

function message(key) {
    if (!activeCatalog) throw new Error('Localization has not been initialized.');
    if (!Object.hasOwn(activeCatalog.messages, key)) throw new Error(`Missing localization message: ${key}`);
    return activeCatalog.messages[key];
}

export function t(key, parameters = {}) {
    const used = new Set();
    const translated = message(key).replace(PLACEHOLDER_PATTERN, (_, name) => {
        used.add(name);
        if (!Object.hasOwn(parameters, name)) {
            throw new Error(`Missing localization parameter "${name}" for ${key}`);
        }
        return String(parameters[name]);
    });
    const unexpected = Object.keys(parameters).filter((name) => !used.has(name));
    if (unexpected.length) throw new Error(`Unexpected localization parameter "${unexpected[0]}" for ${key}`);
    return translated;
}

export function plural(key, count, parameters = {}) {
    const category = new Intl.PluralRules(locale()).select(Number(count));
    const categoryKey = `${key}.${category}`;
    const fallbackKey = `${key}.other`;
    const selectedKey = Object.hasOwn(activeCatalog.messages, categoryKey) ? categoryKey : fallbackKey;
    return t(selectedKey, { ...parameters, count: formatNumber(count) });
}

export function locale() {
    if (!activeCatalog) throw new Error('Localization has not been initialized.');
    return activeCatalog.locale;
}

export function formatNumber(value, options) {
    return new Intl.NumberFormat(locale(), options).format(value);
}

export function formatDate(value, options) {
    return new Intl.DateTimeFormat(locale(), options).format(value);
}

export function resolveLanguage(locationLike = globalThis.location) {
    const pathname = String(locationLike?.pathname ?? '');
    const routeMatch = pathname.match(TOOL_ROUTE_PATTERN);
    if (routeMatch) return SUPPORTED_LANGUAGES[routeMatch[1].toLowerCase()];

    const requested = new URLSearchParams(String(locationLike?.search ?? '')).get('lang');
    return SUPPORTED_LANGUAGES[String(requested ?? '').toLowerCase()] ?? SUPPORTED_LANGUAGES.en;
}

export function routeLanguage(pathname = globalThis.location?.pathname) {
    return String(pathname ?? '').match(TOOL_ROUTE_PATTERN)?.[1]?.toLowerCase() ?? null;
}

export function languageUrl(route, locationLike = globalThis.location) {
    if (!Object.hasOwn(SUPPORTED_LANGUAGES, route)) {
        throw new Error(`Unsupported language route: ${String(route)}`);
    }
    const url = new URL(String(locationLike?.href ?? locationLike));
    if (TOOL_ROUTE_PATTERN.test(url.pathname)) {
        url.pathname = url.pathname.replace(TOOL_ROUTE_PATTERN, `/${route}`);
        url.searchParams.delete('lang');
    } else if (route === 'en') {
        url.searchParams.delete('lang');
    } else {
        url.searchParams.set('lang', route);
    }
    return url.href;
}

export function applyDocumentTranslations(root = document) {
    const documentElement = root.documentElement ?? document.documentElement;
    documentElement.lang = activeCatalog.locale;
    documentElement.dir = activeCatalog.dir;

    for (const element of root.querySelectorAll('[data-i18n]')) {
        element.textContent = t(element.dataset.i18n);
    }
    for (const element of root.querySelectorAll('[data-i18n-attrs]')) {
        for (const binding of element.dataset.i18nAttrs.split(';')) {
            const separator = binding.indexOf(':');
            if (separator < 1) throw catalogError(`invalid attribute binding "${binding}"`);
            const attribute = binding.slice(0, separator).trim();
            const key = binding.slice(separator + 1).trim();
            if (!attribute || !key) throw catalogError(`invalid attribute binding "${binding}"`);
            if (!TRANSLATABLE_ATTRIBUTES.has(attribute)) throw catalogError(`attribute "${attribute}" may not be translated`);
            element.setAttribute(attribute, t(key));
        }
    }
    document.title = t('meta.title');
}

export async function loadCatalog(url, expectedLocale = null) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-cache' });
    if (!response.ok) throw new Error(`Could not load localization catalog (${response.status}).`);
    activeCatalog = validateCatalog(await response.json());
    if (expectedLocale && activeCatalog.locale !== expectedLocale) {
        activeCatalog = null;
        throw catalogError(`expected locale "${expectedLocale}"`);
    }
    return activeCatalog;
}

export function installCatalogForTest(catalog) {
    activeCatalog = validateCatalog(catalog);
}
