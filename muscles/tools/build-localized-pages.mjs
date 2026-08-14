import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ATTRIBUTE_ALLOWLIST = new Set(['aria-label', 'title', 'placeholder', 'data-tooltip', 'data-label']);
const ROUTES = Object.freeze([
    { route: 'en', catalog: 'en.json' },
    { route: 'es', catalog: 'es.json' },
    { route: 'de', catalog: 'de.json' },
    { route: 'el', catalog: 'el.json' },
    { route: 'cs', catalog: 'cs.json' },
    { route: 'zh', catalog: 'zh-Hans.json' }
]);

function escapeText(value) {
    return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value) {
    return escapeText(value).replaceAll('"', '&quot;');
}

function requiredMessage(catalog, key) {
    if (!Object.hasOwn(catalog.messages ?? {}, key)) throw new Error(`Missing localization message: ${key}`);
    return catalog.messages[key];
}

export function renderLocalizedHtml(template, catalog) {
    let html = String(template);
    html = html.replace(/<html\b([^>]*)>/i, (_, attributes) => {
        const withoutLanguage = attributes
            .replace(/\s+lang="[^"]*"/i, '')
            .replace(/\s+dir="[^"]*"/i, '');
        return `<html${withoutLanguage} lang="${escapeAttribute(catalog.locale)}" dir="${escapeAttribute(catalog.dir)}">`;
    });
    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeText(requiredMessage(catalog, 'meta.title'))}</title>`);

    html = html.replace(
        /<([A-Za-z][\w:-]*)\b([^>]*\bdata-i18n="([^"]+)"[^>]*)>[\s\S]*?<\/\1>/gi,
        (match, tag, attributes, key) => `<${tag}${attributes}>${escapeText(requiredMessage(catalog, key))}</${tag}>`
    );

    html = html.replace(/<([A-Za-z][\w:-]*)\b([^>]*\bdata-i18n-attrs="([^"]+)"[^>]*)>/gi, (match, tag, attributes, bindings) => {
        let localizedAttributes = attributes;
        for (const binding of bindings.split(';')) {
            const separator = binding.indexOf(':');
            if (separator < 1) throw new Error(`Invalid translated attribute binding: ${binding}`);
            const attribute = binding.slice(0, separator).trim();
            const key = binding.slice(separator + 1).trim();
            if (!ATTRIBUTE_ALLOWLIST.has(attribute)) throw new Error(`Unsupported translated attribute: ${attribute}`);
            const value = escapeAttribute(requiredMessage(catalog, key));
            const existing = new RegExp(`\\s${attribute.replaceAll('-', '\\-')}="[^"]*"`, 'i');
            localizedAttributes = existing.test(localizedAttributes)
                ? localizedAttributes.replace(existing, ` ${attribute}="${value}"`)
                : `${localizedAttributes} ${attribute}="${value}"`;
        }
        return `<${tag}${localizedAttributes}>`;
    });
    return html;
}

export async function buildLocalizedPages({ sourceRoot, outputRoot }) {
    const template = await readFile(resolve(sourceRoot, 'index.html'), 'utf8');
    for (const { route, catalog: catalogName } of ROUTES) {
        const catalog = JSON.parse(await readFile(resolve(sourceRoot, 'locales', catalogName), 'utf8'));
        const target = resolve(outputRoot, route, 'tools', 'muscles', 'index.html');
        await writeFile(target, renderLocalizedHtml(template, catalog), 'utf8');
    }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
    const sourceIndex = process.argv.indexOf('--source');
    const outputIndex = process.argv.indexOf('--output');
    if (sourceIndex < 0 || !process.argv[sourceIndex + 1] || outputIndex < 0 || !process.argv[outputIndex + 1]) {
        throw new Error('Usage: node build-localized-pages.mjs --source <public> --output <site>');
    }
    await buildLocalizedPages({
        sourceRoot: resolve(process.argv[sourceIndex + 1]),
        outputRoot: resolve(process.argv[outputIndex + 1])
    });
}
