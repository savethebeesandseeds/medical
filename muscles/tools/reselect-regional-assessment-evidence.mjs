#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGIONAL_ASSESSMENT_CONFIGS } from './search-ms-human/regional-assessment-config.js';
import { round, selectPanel } from './search-ms-human/regional-assessment-core.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_DIRECTORY = join(ROOT, 'tools', 'regional-assessment-evidence');
const FILES = Object.freeze([
    'left-upper-limb-atlas.json', 'right-lower-limb-atlas.json', 'left-lower-limb-atlas.json',
    'right-foot-ankle-atlas.json', 'left-foot-ankle-atlas.json', 'trunk-atlas.json',
    'head-neck-atlas.json', 'right-hand-atlas.json'
]);

function coordinatesFromEvidence(evidence) {
    return evidence.search.coordinateOrder.map((name) => ({
        name,
        minimumDegrees: evidence.search.authoredRangesDegrees[name].minimumDegrees,
        maximumDegrees: evidence.search.authoredRangesDegrees[name].maximumDegrees,
        defaultDegrees: evidence.search.authoredRangesDegrees[name].defaultDegrees
    }));
}

function actualTravelFraction(record, coordinates) {
    return Math.max(0, ...coordinates.map((coordinate) => {
        const value = Number(record.coordinates[coordinate.name] ?? coordinate.defaultDegrees);
        const available = value < coordinate.defaultDegrees
            ? coordinate.defaultDegrees - coordinate.minimumDegrees
            : coordinate.maximumDegrees - coordinate.defaultDegrees;
        return available > 0 ? Math.abs(value - coordinate.defaultDegrees) / available : 0;
    }));
}

function reclassify(record, coordinates, config) {
    const actual = actualTravelFraction(record, coordinates);
    if (record.source === 'authored-default') {
        return { ...record, tier: 'neutral-reference', travelFraction: 0, actualTravelFraction: 0 };
    }
    if (record.source === 'generated') {
        return { ...record, actualTravelFraction: round(actual) };
    }
    const tier = config.tiers.find((item) => actual <= item.travelFraction + 1e-9)?.id || 'outside-envelope';
    return { ...record, tier, travelFraction: round(actual), actualTravelFraction: round(actual) };
}

for (const file of FILES) {
    const path = join(EVIDENCE_DIRECTORY, file);
    const evidence = JSON.parse(await readFile(path, 'utf8'));
    const config = REGIONAL_ASSESSMENT_CONFIGS[evidence.model.regionId];
    assert(config, `${file}: no regional configuration.`);
    const coordinates = coordinatesFromEvidence(evidence);
    const region = { id: evidence.model.regionId, coordinates, muscles: evidence.muscles };
    evidence.usableCandidates = evidence.usableCandidates.map((record) => reclassify(record, coordinates, config));
    evidence.failedCandidates = evidence.failedCandidates.map((record) => reclassify(record, coordinates, config));
    evidence.selection = selectPanel(evidence.usableCandidates, region, config);
    evidence.search.candidateTierClassification = 'Generated candidates retain their configured envelope; authored presets and axis probes are classified by actual maximum directional travel. Candidates beyond the broad envelope remain evidence only and cannot enter the observation panel.';
    await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    const counts = Object.entries(evidence.selection.objective.selectedByTier).map(([tier, count]) => `${tier}:${count}`).join(', ');
    process.stdout.write(`${evidence.model.regionId}: ${evidence.selection.selectedPositions.length} selected (${counts}); effective rank ${evidence.selection.rankEvidence.effectiveRank}; robust rank ${evidence.selection.rankEvidence.robustRank}\n`);
}
