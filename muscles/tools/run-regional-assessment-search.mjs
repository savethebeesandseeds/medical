#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT = resolve(import.meta.dirname, 'regional-assessment-evidence');
const PORT = Number(process.env.MS_HUMAN_SEARCH_PORT || 8766);
const DEFAULT_REGIONS = [
    'left-upper-limb', 'right-lower-limb', 'left-lower-limb',
    'right-foot-ankle', 'left-foot-ankle', 'trunk', 'head-neck', 'right-hand'
];
const args = new Map(process.argv.slice(2).map((argument) => {
    const [key, value = '1'] = argument.replace(/^--/, '').split('=', 2);
    return [key, value];
}));
const regions = (args.get('regions') || DEFAULT_REGIONS.join(',')).split(',').map((value) => value.trim()).filter(Boolean);
const edge = process.env.MS_HUMAN_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

await mkdir(OUTPUT, { recursive: true });
const server = spawn(process.env.PYTHON || 'python', [resolve(import.meta.dirname, 'serve_static.py'), '--root', ROOT, '--host', '127.0.0.1', '--port', String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });

try {
    await new Promise((resolveReady, reject) => {
        const timeout = setTimeout(() => reject(new Error('Static server did not start.')), 15_000);
        server.once('error', reject);
        server.stdout.on('data', (chunk) => {
            if (String(chunk).includes('Serving')) { clearTimeout(timeout); resolveReady(); }
        });
    });
    const browser = await chromium.launch({ executablePath: edge, headless: true });
    try {
        for (const regionId of regions) {
            const page = await browser.newPage();
            page.on('console', (message) => { if (message.type() === 'error') process.stderr.write(`[${regionId}] ${message.text()}\n`); });
            const url = `http://127.0.0.1:${PORT}/tools/search-ms-human/regional-assessment-search.html?region=${encodeURIComponent(regionId)}&autorun=1`;
            process.stdout.write(`Searching ${regionId}…\n`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
            await page.waitForFunction(() => window.__assessmentSearchResult || window.__assessmentSearchError, null, { timeout: 30 * 60_000 });
            const payload = await page.evaluate(() => ({ result: window.__assessmentSearchResult, error: window.__assessmentSearchError }));
            await page.close();
            if (!payload.result) throw new Error(`${regionId} failed: ${payload.error}`);
            const path = resolve(OUTPUT, `${regionId}-atlas.json`);
            await writeFile(path, `${JSON.stringify(payload.result, null, 2)}\n`, 'utf8');
            process.stdout.write(`${regionId}: ${payload.result.run.usableCandidateCount}/${payload.result.run.evaluatedCandidateCount} usable; ${payload.result.selection.selectedPositions.length} selected -> ${path}\n`);
        }
    } finally {
        await browser.close();
    }
} finally {
    server.kill();
}
