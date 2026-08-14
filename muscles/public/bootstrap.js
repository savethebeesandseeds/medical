import {
    applyDocumentTranslations,
    languageUrl,
    loadCatalog,
    resolveLanguage,
    routeLanguage,
    t
} from './i18n.js';

const appShell = document.querySelector('.app-shell');
const bootstrapError = document.querySelector('#bootstrap-error');

let catalogReady = false;
let activeLanguage = null;

const navigateToLanguage = (targetUrl) => {
    document.documentElement.classList.remove('i18n-ready');
    document.documentElement.classList.add('i18n-loading');
    appShell?.setAttribute('inert', '');
    appShell?.setAttribute('aria-busy', 'true');
    window.location.assign(targetUrl);
};

try {
    const language = resolveLanguage(window.location);
    activeLanguage = language;
    await loadCatalog(new URL(`./locales/${language.catalog}`, import.meta.url), language.locale);
    applyDocumentTranslations(document);
    catalogReady = true;

    const canonicalRoute = routeLanguage(window.location.pathname);
    if (canonicalRoute) {
        document.querySelector('link[rel="canonical"]')?.remove();
        const canonical = document.createElement('link');
        canonical.rel = 'canonical';
        canonical.href = languageUrl(canonicalRoute, window.location);
        canonical.search = '';
        canonical.hash = '';
        document.head.append(canonical);
        for (const route of ['en', 'es', 'de', 'el', 'cs', 'zh']) {
            const alternate = document.createElement('link');
            alternate.rel = 'alternate';
            alternate.hreflang = route === 'zh' ? 'zh-Hans' : route;
            alternate.href = languageUrl(route, window.location);
            alternate.search = '';
            alternate.hash = '';
            document.head.append(alternate);
        }
    }

    const selector = document.querySelector('#language-selector');
    if (selector) {
        selector.value = language.route;
        selector.addEventListener('change', () => {
            if (selector.value === language.route) return;
            const targetUrl = languageUrl(selector.value, window.location);
            const request = new CustomEvent('waajacu:language-change-request', {
                cancelable: true,
                detail: { targetUrl }
            });
            if (!window.dispatchEvent(request)) {
                selector.value = language.route;
                return;
            }
            selector.disabled = true;
            navigateToLanguage(targetUrl);
        });
    }

    await import('./app-ms-human.js');
    appShell?.removeAttribute('inert');
    appShell?.removeAttribute('aria-busy');
    document.documentElement.classList.remove('i18n-loading');
    document.documentElement.classList.add('i18n-ready');
} catch (error) {
    console.error(error);
    appShell?.setAttribute('inert', '');
    if (bootstrapError) {
        let message = 'The application language could not be loaded. Reload this page to try again.';
        try { message = t(catalogReady ? 'bootstrap.app-failure' : 'bootstrap.catalog-failure'); } catch { /* The English catalog itself is unavailable. */ }
        bootstrapError.textContent = message;
        bootstrapError.classList.remove('hidden');
        if (!catalogReady && activeLanguage?.route && activeLanguage.route !== 'en') {
            const fallback = document.createElement('a');
            fallback.href = languageUrl('en', window.location);
            fallback.textContent = 'Open the English version';
            bootstrapError.append(document.createElement('br'), fallback);
        }
    }
}
