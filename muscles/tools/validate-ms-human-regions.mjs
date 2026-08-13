#!/usr/bin/env node
/** Recompute and validate the pinned MS-Human regional inventory. */

import { writeOrCheckRegionArtifacts } from './export_ms_human_regions.mjs';

const result = await writeOrCheckRegionArtifacts({ check: true });
process.stdout.write(`${JSON.stringify({ valid: true, ...result }, null, 2)}\n`);
