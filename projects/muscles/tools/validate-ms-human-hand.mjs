import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetRoot = path.join(root, 'public', 'models', 'ms_human_700');
const paths = Object.freeze({
  metadata: path.join(assetRoot, 'right-hand.json'),
  manifest: path.join(assetRoot, 'hand-region.json'),
  geometry: path.join(assetRoot, 'right-hand.meshbin'),
  runtime: path.join(assetRoot, 'right-hand-runtime.mjb')
});
const expected = Object.freeze({
  metadata: 'e6d169bdc2edeed3e846d7ccbe03d7ef68968fb2f715c61f4b892bfa85307a46',
  manifest: 'f6406c25bbb82593c96a639efa020bea758abae77d385f00ab6d16e7c6ce8005',
  geometry: '5054f8ff61ca45db638bd36729f1ed71100fd889c58a60d219c673a3162f03ea',
  runtime: '40b75b5583aeb5f20cbda668c4b7e035109dab97175ce30b368551a204e98e1d',
  content: '3c2929b7c385dca29f8b3ae21d9834b482c2ad5bccaa303d6692111950fd39c4'
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

const bytes = Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, readFileSync(value)]));
for (const key of Object.keys(paths)) assert(sha256(bytes[key]) === expected[key], `${key} SHA-256 changed.`);

const metadata = JSON.parse(bytes.metadata.toString('utf8'));
const manifest = JSON.parse(bytes.manifest.toString('utf8'));
const { contentDigestSha256, ...content } = manifest;
assert(contentDigestSha256 === expected.content, 'Hand-manifest content digest changed.');
assert(sha256(JSON.stringify(canonical(content))) === contentDigestSha256, 'Hand-manifest canonical digest is invalid.');
assert(manifest.manifestId === 'MS_HUMAN_700_HAND_REGION_MANIFEST_V1', 'Unexpected hand manifest ID.');
assert(manifest.defaultRegionId === 'right-hand' && manifest.regions.length === 1, 'Hand manifest must expose one right-hand region.');
assert(manifest.model.runtime.sha256 === expected.runtime, 'Hand manifest runtime pin changed.');
assert(manifest.model.geometry.sha256 === expected.geometry, 'Hand manifest geometry pin changed.');

const region = manifest.regions[0];
assert(region.id === 'right-hand' && region.calculationSide === 'right', 'Detailed hand must remain a true right-hand calculation.');
assert(region.coordinates.length === 23 && metadata.coordinates.length === 23, 'Expected 23 independent wrist/finger coordinates.');
assert(region.candidateMuscles.length === 44 && metadata.muscles.length === 44, 'Expected 44 wrist/digit/intrinsic muscles.');
assert(region.activeBodyIds.length === 25, 'Expected 25 articulated right-hand bodies.');
assert(region.assessment.supported === false, 'The hand must not inherit the upper-limb assessment protocol.');
assert(region.semantics.contact === 'none' && region.semantics.externalLoad === 'none', 'Hand contact/load semantics changed.');
assert(region.semantics.interpretationBoundary.includes('not grip force'), 'Grip-force interpretation boundary is missing.');

const coordinateByName = new Map(metadata.coordinates.map((coordinate) => [coordinate.name, coordinate]));
assert(coordinateByName.size === 23, 'Hand coordinate names are not unique.');
assert(region.coordinates.every((coordinate) => coordinateByName.has(coordinate.name)), 'Manifest and metadata coordinate inventories differ.');
const muscleById = new Map(metadata.muscles.map((muscle) => [muscle.actuatorId, muscle]));
assert(muscleById.size === 44, 'Hand actuator IDs are not unique.');
assert(region.candidateMuscles.every((muscle) => muscleById.get(muscle.actuatorId)?.name === muscle.name), 'Manifest and metadata muscle inventories differ.');
assert(metadata.muscles.filter((muscle) => muscle.group === 'Intrinsic hand').length === 20, 'Expected 20 intrinsic hand muscles.');

const presets = region.presetGroups.flatMap((group) => group.presets || []);
assert(presets.length === 8 && new Set(presets.map((preset) => preset.id)).size === 8, 'Expected eight unique hand-shape presets.');
for (const preset of presets) {
  assert(/unloaded|source model|no external load|without (?:object )?contact/i.test(preset.description), `Preset ${preset.id} does not disclose its unloaded/source status.`);
  for (const [name, value] of Object.entries(preset.coordinates || {})) {
    const coordinate = coordinateByName.get(name);
    assert(coordinate && Number.isFinite(value), `Preset ${preset.id} has an invalid ${name} value.`);
    assert(value >= coordinate.minimumDegrees && value <= coordinate.maximumDegrees, `Preset ${preset.id} exceeds the ${name} range.`);
  }
}

const geometry = bytes.geometry;
assert(geometry.subarray(0, 8).toString('ascii') === 'MSHARM01', 'Unexpected hand geometry format.');
const vertexCount = geometry.readUInt32LE(8);
const indexCount = geometry.readUInt32LE(12);
assert(geometry.length === 16 + vertexCount * 12 + indexCount * 4, 'Hand geometry byte length is invalid.');
assert(vertexCount === metadata.geometry.vertices && indexCount / 3 === metadata.geometry.triangles, 'Hand geometry counts differ from metadata.');
let vertexCursor = 0;
let indexCursor = 0;
for (const geom of metadata.geometry.geoms) {
  assert(geom.vertexStart === vertexCursor && geom.indexStart === indexCursor, `Non-contiguous geometry descriptor: ${geom.name}.`);
  vertexCursor += geom.vertexCount;
  indexCursor += geom.indexCount;
}
assert(vertexCursor === vertexCount && indexCursor === indexCount, 'Hand geometry descriptors do not cover the binary payload.');

process.stdout.write(`${JSON.stringify({
  valid: true,
  profile: 'right-hand',
  coordinates: region.coordinates.length,
  muscles: region.candidateMuscles.length,
  intrinsicMuscles: metadata.muscles.filter((muscle) => muscle.group === 'Intrinsic hand').length,
  articulatedBodies: region.activeBodyIds.length,
  presets: presets.length,
  vertices: vertexCount,
  triangles: indexCount / 3,
  contentDigestSha256
}, null, 2)}\n`);
