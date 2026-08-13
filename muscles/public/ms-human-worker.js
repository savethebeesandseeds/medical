import loadMujoco from './vendor/mujoco.js';

const CONTRACT_VERSION = 1;
const STATE_SCHEMA_VERSION = 1;
const EXPECTED_MUJOCO_VERSION = '3.10.0';
const PROFILE = new URL(import.meta.url).searchParams.get('profile') === 'hand' ? 'hand' : 'primary';
const HAND_PROFILE = PROFILE === 'hand';
const MODEL_ID = HAND_PROFILE ? 'MS_HUMAN_700_RIGHT_HAND_STATIC_V1' : 'MS_HUMAN_700_RIGHT_ARM_STATIC_V1';
const SOLVER_CONFIG_NAME = HAND_PROFILE
    ? 'MS_HUMAN_700_RIGHT_HAND_STATIC_MIN_NORM_V1'
    : 'MS_HUMAN_700_RIGHT_ARM_STATIC_MIN_NORM_V1';
const DEFAULT_SELECTED_MUSCLE = HAND_PROFILE ? 'OPP' : 'DELT1_r';
const EXPECTED_FUNCTIONAL_MUSCLES = HAND_PROFILE ? 44 : 88;
const EXPECTED_COORDINATES = HAND_PROFILE ? 23 : 7;
const EXPECTED_REGION_MANIFEST_ID = HAND_PROFILE
    ? 'MS_HUMAN_700_HAND_REGION_MANIFEST_V1'
    : 'MS_HUMAN_700_REGION_MANIFEST_V1';
const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;

const URLS = Object.freeze({
    metadata: new URL(HAND_PROFILE ? './models/ms_human_700/right-hand.json' : './models/ms_human_700/right-arm.json', import.meta.url).href,
    regions: new URL(HAND_PROFILE ? './models/ms_human_700/hand-region.json' : './models/ms_human_700/body-regions.json', import.meta.url).href,
    geometry: new URL(HAND_PROFILE ? './models/ms_human_700/right-hand.meshbin' : './models/ms_human_700/right-arm.meshbin', import.meta.url).href,
    runtime: new URL(HAND_PROFILE ? './models/ms_human_700/right-hand-runtime.mjb' : './models/ms_human_700/right-arm-runtime.mjb', import.meta.url).href,
    mujocoJs: new URL('./vendor/mujoco.js', import.meta.url).href,
    mujocoWasm: new URL('./vendor/mujoco.wasm', import.meta.url).href
});

// These are pinned by verify-ms-human.ps1. The worker verifies every asset it
// executes directly. The geometry digest is exported for the renderer, which
// owns and verifies the separate mesh download.
const ASSET_SHA256 = Object.freeze({
    metadata: HAND_PROFILE ? 'e6d169bdc2edeed3e846d7ccbe03d7ef68968fb2f715c61f4b892bfa85307a46' : '4278ffe5171328047dd240711386ac2ea84ba7bcc54e1740df359f263956414e',
    regions: HAND_PROFILE ? 'f6406c25bbb82593c96a639efa020bea758abae77d385f00ab6d16e7c6ce8005' : '485e389aebe640687974a719ed7adf176c637617afc0800387b4fa5860c0da4e',
    geometry: HAND_PROFILE ? '5054f8ff61ca45db638bd36729f1ed71100fd889c58a60d219c673a3162f03ea' : '5cbdf2aebd44da09dbd9b546cca35abc7b3b2f64e927f879c0d03595e087f68c',
    runtime: HAND_PROFILE ? '40b75b5583aeb5f20cbda668c4b7e035109dab97175ce30b368551a204e98e1d' : '13d2b0bed35db2b07f3b8076931abef4ec4e149ca8d89f326bde22b84f821ad3',
    mujocoJs: '45e8e0e1617c19fbf7f00b36a6a72d1c0c980c0a4f38523e04f0641e8fbab7b9',
    mujocoWasm: '832597ae0a0e306c97ed43d2a9bbca033cf3e547eced410fb9011d87a68d4207'
});

const EXPECTED_SOURCE_TREE_SHA256 = '38815fed122d1beb61155f0afd85e72a52093111fcae183bbb273f2483291971';

let initializationPromise = null;
let disposed = false;
let rawMetadata = null;
let rawRegionManifest = null;
let publicMetadata = null;
let solverConfig = null;
let mujoco = null;
let model = null;
let data = null;
let defaultRegionContext = null;
let regionContexts = new Map();
let regionManifestDigest = null;

function assert(condition, message, code = 'MODEL_INTEGRITY_ERROR') {
    if (condition) return;
    const error = new Error(message);
    error.code = code;
    throw error;
}

function canonicalCoordinateName(engineName) {
    return engineName.endsWith('_r') ? engineName.slice(0, -2) : engineName;
}

function nameSuffixAwareCoordinate(name, engineName) {
    if (name === engineName) return name;
    return engineName;
}

function canonicalJsonValue(value) {
    if (Array.isArray(value)) return value.map(canonicalJsonValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value).sort().map((key) => [key, canonicalJsonValue(value[key])])
        );
    }
    return value;
}

function deepFreeze(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const child of Object.values(value)) deepFreeze(child, seen);
    return Object.freeze(value);
}

function humanizeIdentifier(value) {
    return String(value)
        .replace(/_[rl]$/i, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        const fields = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
        return `{${fields.join(',')}}`;
    }
    return JSON.stringify(value);
}

async function sha256Hex(bytes) {
    assert(globalThis.crypto?.subtle, 'SHA-256 verification is unavailable in this browser.', 'INTEGRITY_UNAVAILABLE');
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const exactBuffer = view.byteOffset === 0 && view.byteLength === view.buffer.byteLength
        ? view.buffer
        : view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    const digest = await crypto.subtle.digest('SHA-256', exactBuffer);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256Text(value) {
    return sha256Hex(new TextEncoder().encode(value));
}

async function fetchBytes(url, label) {
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error(`${label} request failed (${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
}

async function verifyDigest(label, bytes, expected) {
    const actual = await sha256Hex(bytes);
    assert(actual === expected, `${label} SHA-256 mismatch. Expected ${expected}; received ${actual}.`);
    return actual;
}

function runtimeCount(value) {
    return Number.isInteger(value) && value >= 0 ? value : null;
}

function buildSolverConfig(metadata, coordinates, semantics = {}) {
    const source = metadata.staticHold;
    return {
        algorithm: 'bounded weighted minimum-norm equality solve with active-set bounds',
        activationExponent: 2,
        activationBounds: [0, 1],
        reserveObjectiveWeightPerNm2: source.reserveObjectiveWeightPerNm2,
        reserveVariablesUnbounded: true,
        maximumResidualNm: source.maximumResidualNm,
        maximumReserveNm: source.maximumReserveNm,
        capacityActivation: source.capacityActivation,
        capacityReserveNm: source.capacityReserveNm,
        gravityMPerS2: [...(semantics.gravityMPerS2 || source.gravityMPerS2)],
        solvedCoordinates: coordinates.map((coordinate) => coordinate.name),
        fixedSupport: semantics.fixedSupport
            || 'All non-solved model coordinates remain prescribed at keyframe 0; their support reactions are not solved or interpreted.',
        momentArmMethod: 'Negative MuJoCo actuator-length gradient projected through authored joint-equality derivatives; finite-difference fallback uses the same compiled model.',
        assumptions: [...(semantics.assumptions || source.assumptions)]
    };
}

function publicRegionMetadata(context) {
    const muscles = context.muscles.map((muscle) => ({ ...muscle }));
    return {
        id: context.id,
        digest: context.digest,
        label: context.label,
        description: context.description,
        laterality: context.laterality,
        coordinates: context.coordinates.map((coordinate) => ({ ...coordinate })),
        muscles,
        muscleNames: muscles.map((muscle) => muscle.name),
        defaultSelectedMuscle: context.defaultSelectedMuscle.name,
        defaultSelectedMuscleId: context.defaultSelectedMuscle.id,
        presets: context.presets.map((preset) => ({ ...preset, coordinates: { ...preset.coordinates } })),
        presetGroups: context.presetGroups.map((group) => ({
            ...group,
            presets: group.presets.map((preset) => ({ ...preset, coordinates: { ...preset.coordinates } }))
        })),
        solverConfig: {
            ...context.solverConfig,
            activationBounds: [...context.solverConfig.activationBounds],
            gravityMPerS2: [...context.solverConfig.gravityMPerS2],
            solvedCoordinates: [...context.solverConfig.solvedCoordinates],
            assumptions: [...context.solverConfig.assumptions]
        },
        capabilities: { ...context.capabilities },
        geometryActiveBodyIds: [...context.activeBodyIds],
        semantics: { ...context.semantics, assumptions: [...context.semantics.assumptions] }
    };
}

async function buildPublicMetadata(metadata, verifiedAssets) {
    const geoms = metadata.geometry.geoms.map((geom) => ({ ...geom, rgba: [...geom.rgba] }));
    const muscles = defaultRegionContext.muscles.map((muscle) => ({ ...muscle }));
    const coordinates = defaultRegionContext.coordinates.map((coordinate) => ({ ...coordinate }));
    const presets = metadata.presets.map((preset) => ({
        ...preset,
        coordinates: Object.fromEntries(
            Object.entries(preset.coordinates).map(([name, value]) => [canonicalCoordinateName(name), value])
        )
    }));
    const bodyIds = new Set(geoms.map((geom) => geom.bodyId));

    return {
        schemaVersion: STATE_SCHEMA_VERSION,
        contractVersion: CONTRACT_VERSION,
        defaultRegionId: defaultRegionContext.id,
        regions: [...regionContexts.values()].map(publicRegionMetadata),
        identity: {
            modelId: MODEL_ID,
            modelDigest: EXPECTED_SOURCE_TREE_SHA256,
            digestAlgorithm: 'SHA-256',
            sourceTreeSha256: metadata.source.sourceTreeSha256,
            sourceCommit: metadata.source.commit,
            runtimeModelSha256: ASSET_SHA256.runtime,
            runtimeVersion: EXPECTED_MUJOCO_VERSION,
            regionManifestSha256: regionManifestDigest,
            assetSha256: { ...ASSET_SHA256 },
            verifiedAtInitialization: [...verifiedAssets]
        },
        model: {
            id: MODEL_ID,
            name: metadata.model.name,
            variant: metadata.model.variant,
            runtime: metadata.model.runtime,
            totalMuscles: metadata.model.totalMuscles,
            functionalMuscles: metadata.model.functionalMuscles,
            armBodies: metadata.model.armBodies,
            independentCoordinates: metadata.model.independentCoordinates,
            runtimeCounts: {
                bodies: runtimeCount(model.nbody),
                degreesOfFreedom: runtimeCount(model.nv),
                actuators: runtimeCount(model.nu),
                activationStates: runtimeCount(model.na),
                tendons: runtimeCount(model.ntendon),
                equalities: runtimeCount(model.neq)
            }
        },
        counts: {
            bodies: runtimeCount(model.nbody),
            renderedBodies: bodyIds.size,
            muscles: defaultRegionContext.muscles.length,
            ligaments: 0,
            meshes: geoms.length
        },
        capabilities: {
            pose: true,
            staticHold: true,
            dynamicMotion: false,
            externalLoads: false,
            patientSpecific: false,
            leftArm: !HAND_PROFILE,
            calculationSide: 'right'
        },
        coordinates,
        presets,
        muscles,
        muscleNames: muscles.map((muscle) => muscle.name),
        geometry: {
            url: URLS.geometry,
            sha256: ASSET_SHA256.geometry,
            format: 'MSHARM01',
            coordinateSystem: 'MuJoCo Z-up; body-local vertices with world body transforms',
            geoms,
            vertices: metadata.geometry.vertices,
            triangles: metadata.geometry.triangles,
            fitBounds: {
                min: [...metadata.geometry.fitBounds.min],
                max: [...metadata.geometry.fitBounds.max]
            }
        },
        runtime: {
            ...metadata.runtime,
            url: URLS.runtime,
            mujocoModule: URLS.mujocoJs,
            mujocoWasm: URLS.mujocoWasm,
            sha256: ASSET_SHA256.runtime,
            mujocoModuleSha256: ASSET_SHA256.mujocoJs,
            mujocoWasmSha256: ASSET_SHA256.mujocoWasm
        },
        solverConfig: { ...solverConfig, assumptions: [...solverConfig.assumptions] },
        source: {
            ...metadata.source,
            localCorrections: [...metadata.source.localCorrections]
        },
        validation: { ...metadata.validation },
        notice: HAND_PROFILE
            ? 'Generic articulated MS-Human-700 right-hand model; unloaded, static, gravity-only, non-patient-specific, and not diagnostic.'
            : 'Generic MS-Human-700 right-arm model; static, gravity-only, non-patient-specific, and not diagnostic.'
    };
}

function validateRuntimeInventory(metadata) {
    assert(mujoco.mj_versionString() === EXPECTED_MUJOCO_VERSION,
        `Expected MuJoCo ${EXPECTED_MUJOCO_VERSION}; loaded ${mujoco.mj_versionString()}.`);
    assert(metadata.schemaVersion === 1, `Unsupported MS-Human metadata schema ${metadata.schemaVersion}.`);
    assert(metadata.source.sourceTreeSha256 === EXPECTED_SOURCE_TREE_SHA256,
        'The MS-Human source-tree identity does not match this engine.');
    assert(model.nu === metadata.model.totalMuscles,
        'The runtime actuator count does not match the selected profile metadata.');
    assert(metadata.muscles.length === EXPECTED_FUNCTIONAL_MUSCLES
            && metadata.model.functionalMuscles === EXPECTED_FUNCTIONAL_MUSCLES,
        `The functional ${PROFILE} inventory must contain exactly ${EXPECTED_FUNCTIONAL_MUSCLES} muscles.`);
    assert(metadata.coordinates.length === EXPECTED_COORDINATES
            && metadata.model.independentCoordinates === EXPECTED_COORDINATES,
        `The ${PROFILE} runtime must expose exactly ${EXPECTED_COORDINATES} independent coordinates.`);

    const seenActuators = new Set();
    const seenTendons = new Set();
    for (const muscle of metadata.muscles) {
        assert(!seenActuators.has(muscle.actuatorId), `Duplicate actuator ID ${muscle.actuatorId}.`);
        assert(!seenTendons.has(muscle.tendonId), `Duplicate tendon ID ${muscle.tendonId}.`);
        seenActuators.add(muscle.actuatorId);
        seenTendons.add(muscle.tendonId);
        const actuatorName = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_ACTUATOR.value, muscle.actuatorId);
        const tendonName = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_TENDON.value, muscle.tendonId);
        assert(actuatorName === muscle.name, `Actuator mapping changed for ${muscle.name}.`);
        assert(tendonName === muscle.tendon, `Tendon mapping changed for ${muscle.name}.`);
        assert(model.actuator_actadr[muscle.actuatorId] >= 0,
            `Muscle ${muscle.name} has no activation state.`);
    }

    for (const coordinate of metadata.coordinates) {
        const jointName = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_JOINT.value, coordinate.jointId);
        assert(jointName === coordinate.name, `Joint mapping changed for ${coordinate.name}.`);
        assert(model.jnt_qposadr[coordinate.jointId] === coordinate.qposAddress,
            `Q-position mapping changed for ${coordinate.name}.`);
        assert(model.jnt_dofadr[coordinate.jointId] === coordinate.dofAddress,
            `Degree-of-freedom mapping changed for ${coordinate.name}.`);
    }

    for (const descriptor of metadata.geometry.geoms) {
        const bodyName = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY.value, descriptor.bodyId);
        assert(bodyName === descriptor.body, `Body mapping changed for ${descriptor.body}.`);
    }
}

function objectIdByName(objectType, count, name, label) {
    assert(typeof name === 'string' && name.length > 0, `${label} must have a runtime name.`);
    for (let id = 0; id < count; id += 1) {
        if (mujoco.mj_id2name(model, objectType, id) === name) return id;
    }
    assert(false, `Unknown runtime ${label}: ${name}.`);
}

function finiteNumber(value, label) {
    const numeric = Number(value);
    assert(Number.isFinite(numeric), `${label} must be finite.`);
    return numeric;
}

function semanticValue(semantics, names, fallback = null) {
    for (const name of names) {
        if (typeof semantics?.[name] === 'string' && semantics[name].trim()) return semantics[name].trim();
    }
    return fallback;
}

function coordinateAlias(regionId, engineName, compatibility, declaredName) {
    const regionAliases = compatibility?.coordinateAliases?.[regionId]
        || compatibility?.coordinateAliases
        || compatibility?.rightArmCoordinateAliases
        || (regionId === 'right-upper-limb'
            ? compatibility?.rightUpperLimb?.canonicalCoordinateAliases
            : null)
        || {};
    if (typeof regionAliases[declaredName] === 'string'
            && regionAliases[declaredName] === engineName) return declaredName;
    if (typeof regionAliases[engineName] === 'string') return regionAliases[engineName];
    for (const [alias, target] of Object.entries(regionAliases)) {
        if (target === engineName) return alias;
    }
    return regionId === (rawRegionManifest?.defaultRegionId || compatibility?.defaultRegionId)
        ? canonicalCoordinateName(engineName)
        : engineName;
}

function normalizeCoordinate(region, rawCoordinate, compatibility) {
    const source = typeof rawCoordinate === 'string' ? { name: rawCoordinate } : rawCoordinate;
    assert(source && typeof source === 'object' && !Array.isArray(source),
        `Region ${region.id} has an invalid coordinate descriptor.`);
    const engineName = source.engineName || source.name;
    const jointId = source.jointId ?? objectIdByName(
        mujoco.mjtObj.mjOBJ_JOINT.value,
        model.njnt,
        engineName,
        'joint'
    );
    const runtimeName = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_JOINT.value, jointId);
    assert(runtimeName === engineName, `Joint mapping changed for ${engineName}.`);
    const qposAddress = source.qposAddress ?? model.jnt_qposadr[jointId];
    const dofAddress = source.dofAddress ?? model.jnt_dofadr[jointId];
    assert(model.jnt_qposadr[jointId] === qposAddress, `Q-position mapping changed for ${engineName}.`);
    assert(model.jnt_dofadr[jointId] === dofAddress, `Degree-of-freedom mapping changed for ${engineName}.`);

    const runtimeMinimum = model.jnt_range[jointId * 2] * RADIANS_TO_DEGREES;
    const runtimeMaximum = model.jnt_range[jointId * 2 + 1] * RADIANS_TO_DEGREES;
    const legacy = rawMetadata.coordinates.find((coordinate) => coordinate.name === engineName);
    const minimum = finiteNumber(
        source.minimumDegrees ?? source.minimum ?? legacy?.minimumDegrees ?? runtimeMinimum,
        `${engineName} minimum`
    );
    const maximum = finiteNumber(
        source.maximumDegrees ?? source.maximum ?? legacy?.maximumDegrees ?? runtimeMaximum,
        `${engineName} maximum`
    );
    const defaultValue = finiteNumber(
        source.defaultDegrees ?? source.default ?? legacy?.defaultDegrees ?? 0,
        `${engineName} default`
    );
    assert(minimum <= maximum && defaultValue >= minimum - 1e-8 && defaultValue <= maximum + 1e-8,
        `Region ${region.id} has an invalid authored range for ${engineName}.`);
    assert(Math.abs(minimum - runtimeMinimum) <= 5e-4 && Math.abs(maximum - runtimeMaximum) <= 5e-4,
        `Region ${region.id} range for ${engineName} does not match the compiled model.`);
    const name = source.inputName || source.canonicalName
        || coordinateAlias(region.id, engineName, compatibility, nameSuffixAwareCoordinate(source.name, engineName));
    return {
        name,
        engineName,
        label: source.label || legacy?.label || humanizeIdentifier(engineName),
        minimum,
        maximum,
        default: defaultValue,
        units: 'degrees',
        jointId,
        qposAddress,
        dofAddress,
        equalityDependents: Array.isArray(source.equalityDependents)
            ? source.equalityDependents.map((dependent) => ({ ...dependent }))
            : []
    };
}

function normalizeMuscle(region, rawMuscle) {
    assert(rawMuscle && typeof rawMuscle === 'object' && !Array.isArray(rawMuscle),
        `Region ${region.id} has an invalid muscle descriptor.`);
    const name = rawMuscle.name;
    const actuatorId = rawMuscle.actuatorId ?? objectIdByName(
        mujoco.mjtObj.mjOBJ_ACTUATOR.value,
        model.nu,
        name,
        'actuator'
    );
    const runtimeName = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_ACTUATOR.value, actuatorId);
    assert(runtimeName === name, `Actuator mapping changed for ${name}.`);
    const tendon = rawMuscle.tendon || `${name}_tendon`;
    const tendonId = rawMuscle.tendonId ?? objectIdByName(
        mujoco.mjtObj.mjOBJ_TENDON.value,
        model.ntendon,
        tendon,
        'tendon'
    );
    assert(mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_TENDON.value, tendonId) === tendon,
        `Tendon mapping changed for ${name}.`);
    assert(model.actuator_actadr[actuatorId] >= 0, `Muscle ${name} has no activation state.`);
    assert(Array.isArray(rawMuscle.pathBodyIds) && rawMuscle.pathBodyIds.length > 0,
        `Muscle ${name} has no declared path-body inventory.`);
    for (const bodyId of rawMuscle.pathBodyIds) {
        assert(Number.isInteger(bodyId) && bodyId >= 0 && bodyId < model.nbody,
            `Muscle ${name} has invalid path body ID ${String(bodyId)}.`);
    }
    return {
        id: rawMuscle.id || `${MODEL_ID}:actuator:${actuatorId}`,
        actuatorId,
        name,
        tendonId,
        tendon,
        group: rawMuscle.group || region.presentationName || region.label,
        visibleByDefault: rawMuscle.visibleByDefault !== false
    };
}

function buildEqualityMappings(region, coordinates) {
    const independentColumns = new Map(coordinates.map((coordinate, index) => [coordinate.jointId, index]));
    const selectedJointIds = new Set(independentColumns.keys());
    const seenDependents = new Set();
    const mappings = [];
    const equalityStride = model.neq ? model.eq_data.length / model.neq : 0;
    assert(!model.neq || Number.isInteger(equalityStride) && equalityStride >= 5,
        'The compiled equality data layout is unsupported.');
    const jointEqualityType = mujoco.mjtEq.mjEQ_JOINT.value;
    for (let equalityId = 0; equalityId < model.neq; equalityId += 1) {
        if (model.eq_type[equalityId] !== jointEqualityType) continue;
        const sourceJoint = model.eq_obj2id[equalityId];
        const column = independentColumns.get(sourceJoint);
        if (column === undefined) continue;
        const dependentJoint = model.eq_obj1id[equalityId];
        assert(!selectedJointIds.has(dependentJoint),
            `Region ${region.id} selects equality-dependent joint ${dependentJoint} as an input.`);
        assert(!seenDependents.has(dependentJoint),
            `Region ${region.id} has duplicate equality mappings for joint ${dependentJoint}.`);
        seenDependents.add(dependentJoint);
        const coefficients = Array.from({ length: 5 }, (_, index) =>
            finiteNumber(model.eq_data[equalityId * equalityStride + index], `Equality ${equalityId} coefficient`));
        const coordinate = coordinates[column];
        for (const degrees of [coordinate.minimum, coordinate.default, coordinate.maximum]) {
            const evaluated = polynomialValueAndDerivative(coefficients, degrees * DEGREES_TO_RADIANS);
            assert(Number.isFinite(evaluated.value) && Number.isFinite(evaluated.derivative),
                `Region ${region.id} equality ${equalityId} has a non-finite realization or derivative.`);
        }
        mappings.push({
            equalityId,
            sourceJoint,
            dependentJoint,
            column,
            sourceQpos: model.jnt_qposadr[sourceJoint],
            dependentQpos: model.jnt_qposadr[dependentJoint],
            dependentDof: model.jnt_dofadr[dependentJoint],
            coefficients
        });
    }
    for (const [column, coordinate] of coordinates.entries()) {
        const actual = mappings.filter((mapping) => mapping.column === column);
        const expected = coordinate.equalityDependents;
        assert(expected.length === actual.length,
            `Region ${region.id} equality inventory changed for ${coordinate.engineName}.`);
        for (const descriptor of expected) {
            const mapping = actual.find((candidate) => candidate.equalityId === descriptor.equalityId);
            assert(mapping, `Region ${region.id} is missing equality ${descriptor.equalityId}.`);
            assert(mapping.dependentJoint === descriptor.jointId,
                `Region ${region.id} equality ${descriptor.equalityId} dependent joint changed.`);
            const dependentName = mujoco.mj_id2name(
                model,
                mujoco.mjtObj.mjOBJ_JOINT.value,
                mapping.dependentJoint
            );
            assert(dependentName === descriptor.name,
                `Region ${region.id} equality ${descriptor.equalityId} dependent name changed.`);
        }
    }
    return mappings;
}

function normalizePresetCoordinates(rawCoordinates, coordinateByInputName, regionId) {
    assert(rawCoordinates && typeof rawCoordinates === 'object' && !Array.isArray(rawCoordinates),
        `Region ${regionId} preset coordinates must be an object.`);
    const result = {};
    for (const [inputName, rawValue] of Object.entries(rawCoordinates)) {
        const coordinate = coordinateByInputName[inputName];
        assert(coordinate, `Region ${regionId} preset uses unknown coordinate ${inputName}.`);
        const value = finiteNumber(rawValue, `${regionId} preset ${inputName}`);
        assert(value >= coordinate.minimum - 1e-8 && value <= coordinate.maximum + 1e-8,
            `Region ${regionId} preset value for ${inputName} is outside the authored range.`);
        result[coordinate.name] = value;
    }
    return result;
}

function normalizePresetGroups(region, coordinateByInputName) {
    const rawGroups = Array.isArray(region.presetGroups) ? region.presetGroups : [];
    const loosePresets = Array.isArray(region.presets) ? region.presets : [];
    const groups = rawGroups.length ? rawGroups : [{ id: 'reference', label: 'Reference', presets: loosePresets }];
    const seenIds = new Set();
    return groups.map((group, groupIndex) => {
        const sourcePresets = group.presets || group.items || group.postures || [];
        assert(Array.isArray(sourcePresets), `Region ${region.id} preset group must contain an array.`);
        const presets = sourcePresets.map((preset, presetIndex) => {
            assert(preset && typeof preset === 'object', `Region ${region.id} has an invalid preset.`);
            const id = preset.id || `preset-${groupIndex + 1}-${presetIndex + 1}`;
            assert(!seenIds.has(id), `Region ${region.id} has duplicate preset ID ${id}.`);
            seenIds.add(id);
            return {
                ...preset,
                id,
                coordinates: normalizePresetCoordinates(preset.coordinates || {}, coordinateByInputName, region.id)
            };
        });
        return { ...group, id: group.id || `group-${groupIndex + 1}`, presets };
    });
}

async function buildRegionContext(region, compatibility, isDefault) {
    assert(region && typeof region === 'object' && !Array.isArray(region), 'Invalid regional manifest entry.');
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(region.id || ''), `Invalid region ID ${String(region.id)}.`);
    const regionLabel = region.presentationName || region.label;
    assert(typeof regionLabel === 'string' && regionLabel.trim(), `Region ${region.id} must have a label.`);
    assert(Array.isArray(region.coordinates) && region.coordinates.length > 0,
        `Region ${region.id} must select at least one coordinate.`);
    const coordinates = region.coordinates.map((coordinate) => normalizeCoordinate(region, coordinate, compatibility));
    const coordinateNames = new Set();
    const engineNames = new Set();
    const jointIds = new Set();
    const coordinateByInputName = Object.create(null);
    for (const coordinate of coordinates) {
        assert(!coordinateNames.has(coordinate.name), `Region ${region.id} has duplicate coordinate ${coordinate.name}.`);
        assert(!engineNames.has(coordinate.engineName), `Region ${region.id} repeats joint ${coordinate.engineName}.`);
        assert(!jointIds.has(coordinate.jointId), `Region ${region.id} repeats joint ID ${coordinate.jointId}.`);
        coordinateNames.add(coordinate.name);
        engineNames.add(coordinate.engineName);
        jointIds.add(coordinate.jointId);
        coordinateByInputName[coordinate.name] = coordinate;
        coordinateByInputName[coordinate.engineName] = coordinate;
    }

    const rawMuscles = region.candidateMuscles || region.muscles;
    assert(Array.isArray(rawMuscles) && rawMuscles.length > 0,
        `Region ${region.id} must select at least one candidate muscle.`);
    const muscles = rawMuscles.map((muscle) => normalizeMuscle(region, muscle));
    const actuatorIds = new Set();
    const tendonIds = new Set();
    const muscleByName = Object.create(null);
    const muscleByActuatorId = Object.create(null);
    const muscleById = Object.create(null);
    for (const muscle of muscles) {
        assert(!actuatorIds.has(muscle.actuatorId), `Region ${region.id} repeats actuator ${muscle.actuatorId}.`);
        assert(!tendonIds.has(muscle.tendonId), `Region ${region.id} repeats tendon ${muscle.tendonId}.`);
        actuatorIds.add(muscle.actuatorId);
        tendonIds.add(muscle.tendonId);
        muscleByName[muscle.name] = muscle;
        muscleByActuatorId[String(muscle.actuatorId)] = muscle;
        muscleById[muscle.id] = muscle;
    }

    const activeBodyIds = region.activeBodyIds || region.geometryActiveBodyIds;
    assert(Array.isArray(activeBodyIds) && activeBodyIds.length > 0,
        `Region ${region.id} must select at least one active body.`);
    const uniqueBodyIds = new Set();
    for (const rawBodyId of activeBodyIds) {
        const bodyId = Number(rawBodyId);
        assert(Number.isInteger(bodyId) && bodyId > 0 && bodyId < model.nbody,
            `Region ${region.id} has invalid active body ID ${String(rawBodyId)}.`);
        assert(!uniqueBodyIds.has(bodyId), `Region ${region.id} repeats active body ID ${bodyId}.`);
        uniqueBodyIds.add(bodyId);
        assert(mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY.value, bodyId),
            `Region ${region.id} active body ${bodyId} has no runtime name.`);
    }
    if (Array.isArray(region.activeBodies)) {
        assert(region.activeBodies.length === activeBodyIds.length,
            `Region ${region.id} active-body descriptor count changed.`);
        for (const descriptor of region.activeBodies) {
            assert(uniqueBodyIds.has(descriptor.bodyId),
                `Region ${region.id} describes inactive body ${String(descriptor.bodyId)}.`);
            const runtimeName = mujoco.mj_id2name(
                model,
                mujoco.mjtObj.mjOBJ_BODY.value,
                descriptor.bodyId
            );
            assert(runtimeName === descriptor.name,
                `Region ${region.id} body mapping changed for ${String(descriptor.name)}.`);
            assert(model.body_parentid[descriptor.bodyId] === descriptor.parentBodyId,
                `Region ${region.id} parent mapping changed for ${descriptor.name}.`);
        }
    }

    const semantics = region.semantics || {};
    const fixedSupport = semanticValue(semantics, ['fixedSupport', 'fixedSupportDescription']);
    const equilibrium = semanticValue(semantics, ['equilibrium', 'equilibriumDescription']);
    assert(fixedSupport, `Region ${region.id} must declare fixed-support semantics.`);
    assert(equilibrium, `Region ${region.id} must declare equilibrium semantics.`);
    const assumptions = Array.isArray(semantics.assumptions) && semantics.assumptions.length
        ? semantics.assumptions.map((value) => String(value))
        : [...rawMetadata.staticHold.assumptions];
    const gravityMPerS2 = Array.isArray(semantics.gravityMPerS2)
        ? semantics.gravityMPerS2.map((value, index) => finiteNumber(value, `${region.id} gravity[${index}]`))
        : [...rawMetadata.staticHold.gravityMPerS2];
    assert(gravityMPerS2.length === 3, `Region ${region.id} gravity must have three components.`);
    for (let index = 0; index < 3; index += 1) {
        assert(Math.abs(gravityMPerS2[index] - model.opt.gravity[index]) <= 1e-12,
            `Region ${region.id} gravity differs from the compiled model.`);
    }
    assert(semantics.clinicalValidation === false,
        `Region ${region.id} must explicitly remain clinically unvalidated.`);
    const normalizedSemantics = {
        ...semantics,
        fixedSupport,
        equilibrium,
        assumptions,
        gravityMPerS2,
        calculationSide: region.calculationSide || semantics.calculationSide || region.laterality || 'midline',
        generalizedForceUnits: semanticValue(
            semantics,
            ['generalizedForceUnits', 'equilibriumResidualUnits'],
            `N\u00b7m for the ${coordinates.length} rotational coordinates`
        )
    };
    const equalityMappings = buildEqualityMappings(region, coordinates);
    const presetGroups = normalizePresetGroups(region, coordinateByInputName);
    const presets = presetGroups.flatMap((group) => group.presets.map((preset) => ({ ...preset, groupId: group.id })));
    const defaultMuscleName = typeof region.defaultSelectedMuscle === 'object'
        ? region.defaultSelectedMuscle.name
        : region.defaultSelectedMuscle;
    const defaultSelectedMuscle = muscleByName[defaultMuscleName]
        || (isDefault ? muscleByName[DEFAULT_SELECTED_MUSCLE] : null)
        || muscles[0];
    assert(defaultSelectedMuscle, `Region ${region.id} has no valid default selected muscle.`);
    if (typeof region.defaultSelectedMuscle === 'object') {
        assert(defaultSelectedMuscle.actuatorId === region.defaultSelectedMuscle.actuatorId,
            `Region ${region.id} default selected-muscle mapping changed.`);
    }

    // Keep the legacy right-arm solver identity byte-for-byte stable for
    // Diagnosis; every non-default region derives its support contract here.
    const legacyDefault = !HAND_PROFILE && isDefault;
    const rawConfig = buildSolverConfig(rawMetadata, coordinates, legacyDefault ? {} : normalizedSemantics);
    const configDigest = await sha256Text(stableStringify(rawConfig));
    const configName = legacyDefault || HAND_PROFILE && isDefault
        ? SOLVER_CONFIG_NAME
        : `MS_HUMAN_700_${region.id.toUpperCase().replace(/-/g, '_')}_STATIC_MIN_NORM_V1`;
    const regionalSolverConfig = { id: `${configName}:${configDigest.slice(0, 16)}`, digest: configDigest, ...rawConfig };
    const calculatedRegionDigest = await sha256Text(JSON.stringify(canonicalJsonValue(region)));
    if (region.digest || region.sha256) {
        assert((region.digest || region.sha256) === calculatedRegionDigest,
            `Region ${region.id} digest does not match its canonical contents.`);
    }

    return deepFreeze({
        id: region.id,
        digest: calculatedRegionDigest,
        label: regionLabel,
        description: region.description || '',
        laterality: region.laterality || normalizedSemantics.calculationSide,
        coordinates,
        coordinateByInputName,
        muscles,
        muscleByName,
        muscleByActuatorId,
        muscleById,
        activeBodyIds: [...uniqueBodyIds],
        presetGroups,
        presets,
        defaultSelectedMuscle,
        equalityMappings,
        semantics: normalizedSemantics,
        solverConfig: regionalSolverConfig,
        capabilities: {
            pose: true,
            staticHold: true,
            dynamicMotion: false,
            externalLoads: false,
            patientSpecific: false,
            calculationSide: normalizedSemantics.calculationSide
        }
    });
}

async function buildRegionContexts(manifest) {
    assert(manifest && typeof manifest === 'object' && !Array.isArray(manifest),
        'The body-region manifest must be an object.');
    assert(manifest.schemaVersion === 1, `Unsupported body-region schema ${manifest.schemaVersion}.`);
    assert(manifest.manifestId === EXPECTED_REGION_MANIFEST_ID,
        `Unexpected body-region manifest identity ${String(manifest.manifestId)}.`);
    const { contentDigestSha256, ...canonicalContent } = manifest;
    assert(typeof contentDigestSha256 === 'string' && /^[a-f0-9]{64}$/.test(contentDigestSha256),
        'The body-region manifest has no canonical content digest.');
    const calculatedContentDigest = await sha256Text(JSON.stringify(canonicalJsonValue(canonicalContent)));
    assert(calculatedContentDigest === contentDigestSha256,
        'The body-region canonical content digest does not match its contents.');
    assert(Array.isArray(manifest.regions) && manifest.regions.length > 0,
        'The body-region manifest has no regions.');
    assert(typeof manifest.defaultRegionId === 'string' && manifest.defaultRegionId,
        'The body-region manifest has no default region ID.');
    assert(manifest.model?.sourceTreeSha256 === EXPECTED_SOURCE_TREE_SHA256,
        'The body-region source-tree identity does not match this engine.');
    assert(manifest.model?.runtime?.sha256 === ASSET_SHA256.runtime,
        'The body-region manifest references a different runtime model.');
    assert(manifest.model?.geometry?.sha256 === ASSET_SHA256.geometry,
        'The body-region manifest references different geometry.');
    const contexts = new Map();
    for (const region of manifest.regions) {
        assert(!contexts.has(region.id), `Duplicate region ID ${region.id}.`);
        const context = await buildRegionContext(
            region,
            manifest.compatibility || {},
            region.id === manifest.defaultRegionId
        );
        contexts.set(context.id, context);
    }
    assert(contexts.has(manifest.defaultRegionId),
        `Default region ${manifest.defaultRegionId} does not exist.`);
    return contexts;
}

async function initializeRuntime() {
    if (publicMetadata) return publicMetadata;
    if (initializationPromise) return initializationPromise;
    initializationPromise = (async () => {
        const [metadataBytes, regionBytes, runtimeBytes, mujocoJsBytes, mujocoWasmBytes] = await Promise.all([
            fetchBytes(URLS.metadata, HAND_PROFILE ? 'Right-hand metadata' : 'Right-arm metadata'),
            fetchBytes(URLS.regions, HAND_PROFILE ? 'Hand-region manifest' : 'Body-region manifest'),
            fetchBytes(URLS.runtime, HAND_PROFILE ? 'Right-hand runtime model' : 'Right-arm runtime model'),
            fetchBytes(URLS.mujocoJs, 'MuJoCo JavaScript runtime'),
            fetchBytes(URLS.mujocoWasm, 'MuJoCo WebAssembly runtime')
        ]);
        await Promise.all([
            verifyDigest(HAND_PROFILE ? 'Right-hand metadata' : 'Right-arm metadata', metadataBytes, ASSET_SHA256.metadata),
            verifyDigest(HAND_PROFILE ? 'Hand-region manifest' : 'Body-region manifest', regionBytes, ASSET_SHA256.regions),
            verifyDigest(HAND_PROFILE ? 'Right-hand runtime model' : 'Right-arm runtime model', runtimeBytes, ASSET_SHA256.runtime),
            verifyDigest('MuJoCo JavaScript runtime', mujocoJsBytes, ASSET_SHA256.mujocoJs),
            verifyDigest('MuJoCo WebAssembly runtime', mujocoWasmBytes, ASSET_SHA256.mujocoWasm)
        ]);

        rawMetadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metadataBytes));
        rawRegionManifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(regionBytes));
        regionManifestDigest = ASSET_SHA256.regions;

        mujoco = await loadMujoco({
            wasmBinary: mujocoWasmBytes,
            locateFile: (path) => path.endsWith('.wasm') ? URLS.mujocoWasm : new URL(`./vendor/${path}`, import.meta.url).href
        });
        const virtualFileSystem = new mujoco.MjVFS();
        try {
            virtualFileSystem.addBuffer('right-arm-runtime.mjb', runtimeBytes);
            model = mujoco.MjModel.from_binary_path('right-arm-runtime.mjb', virtualFileSystem);
        } finally {
            virtualFileSystem.delete();
        }
        assert(model, 'MuJoCo could not open the pinned right-arm runtime model.');
        data = new mujoco.MjData(model);
        validateRuntimeInventory(rawMetadata);
        regionContexts = await buildRegionContexts(rawRegionManifest);
        defaultRegionContext = regionContexts.get(rawRegionManifest.defaultRegionId);
        solverConfig = defaultRegionContext.solverConfig;
        assert(defaultRegionContext.coordinates.length === rawMetadata.coordinates.length,
            'The default region no longer matches the legacy right-arm coordinate inventory.');
        assert(defaultRegionContext.muscles.length === rawMetadata.muscles.length,
            'The default region no longer matches the legacy right-arm muscle inventory.');
        for (const [index, coordinate] of defaultRegionContext.coordinates.entries()) {
            assert(coordinate.engineName === rawMetadata.coordinates[index].name,
                'The default region changed the legacy right-arm coordinate order.');
        }
        for (const [index, muscle] of defaultRegionContext.muscles.entries()) {
            assert(muscle.actuatorId === rawMetadata.muscles[index].actuatorId,
                'The default region changed the legacy right-arm muscle order.');
        }
        publicMetadata = await buildPublicMetadata(
            rawMetadata,
            ['metadata', 'regions', 'runtime', 'mujocoJs', 'mujocoWasm']
        );
        return publicMetadata;
    })().catch((error) => {
        initializationPromise = null;
        if (data) {
            data.delete();
            data = null;
        }
        if (model) {
            model.delete();
            model = null;
        }
        throw error;
    });
    return initializationPromise;
}

function numericCoordinate(value, name) {
    if (typeof value !== 'number' && typeof value !== 'string') {
        throw new TypeError(`Coordinate ${name} must be a finite number.`);
    }
    if (typeof value === 'string' && value.trim() === '') {
        throw new TypeError(`Coordinate ${name} must be a finite number.`);
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new TypeError(`Coordinate ${name} must be a finite number.`);
    return Object.is(numeric, -0) ? 0 : numeric;
}

function resolveRegion(regionId) {
    const resolvedId = regionId === undefined || regionId === null || regionId === ''
        ? defaultRegionContext.id
        : String(regionId);
    const context = regionContexts.get(resolvedId);
    if (!context) throw new RangeError(`Unknown MS-Human region: ${resolvedId}.`);
    return context;
}

function resolveCoordinates(context, input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError('Coordinates must be an object keyed by canonical coordinate name.');
    }
    const supplied = new Map();
    for (const [inputName, rawValue] of Object.entries(input)) {
        const coordinate = context.coordinateByInputName[inputName];
        if (!coordinate) throw new RangeError(`Unknown MS-Human coordinate for ${context.id}: ${inputName}.`);
        const value = numericCoordinate(rawValue, inputName);
        const existing = supplied.get(coordinate.name);
        if (existing !== undefined && Math.abs(existing - value) > 1e-10) {
            throw new RangeError(`Conflicting values were supplied for ${coordinate.name}.`);
        }
        supplied.set(coordinate.name, value);
    }

    const resolved = {};
    for (const coordinate of context.coordinates) {
        const value = supplied.has(coordinate.name) ? supplied.get(coordinate.name) : coordinate.default;
        if (value < coordinate.minimum - 1e-8 || value > coordinate.maximum + 1e-8) {
            throw new RangeError(
                `${coordinate.name}=${value} degrees is outside the authored range `
                + `[${coordinate.minimum}, ${coordinate.maximum}].`
            );
        }
        resolved[coordinate.name] = value;
    }
    return resolved;
}

function resolveSelectedMuscle(context, value) {
    if (value && typeof value === 'object') value = value.actuatorId ?? value.name ?? value.id;
    let selected = null;
    if (value === undefined || value === null || value === '') {
        selected = context.defaultSelectedMuscle;
    } else if (typeof value === 'number' || (/^\d+$/.test(String(value)))) {
        selected = context.muscleByActuatorId[String(Number(value))];
    } else {
        selected = context.muscleByName[String(value)] || context.muscleById[String(value)];
    }
    if (!selected) throw new RangeError(`Unknown MS-Human muscle for ${context.id}: ${String(value)}.`);
    return selected;
}

function polynomialValueAndDerivative(coefficients, x) {
    let value = 0;
    let derivative = 0;
    let power = 1;
    for (let degree = 0; degree < 5; degree += 1) {
        const coefficient = coefficients[degree];
        value += coefficient * power;
        if (degree) derivative += degree * coefficient * (x ** (degree - 1));
        power *= x;
    }
    return { value, derivative };
}

function realizeCoordinates(context, coordinates) {
    mujoco.mj_resetDataKeyframe(model, data, 0);
    data.qvel.fill(0);
    data.qacc.fill(0);
    data.ctrl.fill(0);
    data.act.fill(0);

    for (const coordinate of context.coordinates) {
        data.qpos[coordinate.qposAddress] = coordinates[coordinate.name] * DEGREES_TO_RADIANS;
    }

    const equalityDerivatives = [];
    for (const mapping of context.equalityMappings) {
        const evaluated = polynomialValueAndDerivative(mapping.coefficients, data.qpos[mapping.sourceQpos]);
        assert(Number.isFinite(evaluated.value) && Number.isFinite(evaluated.derivative),
            `Region ${context.id} equality ${mapping.equalityId} produced a non-finite result.`);
        data.qpos[mapping.dependentQpos] = evaluated.value;
        equalityDerivatives.push({
            column: mapping.column,
            dependentDof: mapping.dependentDof,
            derivative: evaluated.derivative
        });
    }

    mujoco.mj_forward(model, data);
    const reduction = context.coordinates.map((coordinate) => {
        const column = new Float64Array(model.nv);
        column[coordinate.dofAddress] = 1;
        return column;
    });
    for (const item of equalityDerivatives) {
        reduction[item.column][item.dependentDof] += item.derivative;
    }
    return reduction;
}

function projectedDenseRow(values, row, rowWidth, reduction) {
    const offset = row * rowWidth;
    let result = 0;
    for (let column = 0; column < rowWidth; column += 1) {
        result += values[offset + column] * reduction[column];
    }
    return result;
}

function projectedSparseRow(values, rownnz, rowadr, colind, row, reduction) {
    let result = 0;
    const start = rowadr[row];
    const count = rownnz[row];
    for (let index = start; index < start + count; index += 1) {
        result += values[index] * reduction[colind[index]];
    }
    return result;
}

function projectedActuatorLengthGradient(muscle, reduction) {
    const moments = data.actuator_moment;
    if (moments?.length >= model.nu * model.nv) {
        return projectedDenseRow(moments, muscle.actuatorId, model.nv, reduction);
    }
    if (moments && data.moment_rownnz?.length >= model.nu
            && data.moment_rowadr?.length >= model.nu && data.moment_colind) {
        return projectedSparseRow(
            moments,
            data.moment_rownnz,
            data.moment_rowadr,
            data.moment_colind,
            muscle.actuatorId,
            reduction
        );
    }

    const tendonJacobian = data.ten_J;
    if (tendonJacobian?.length >= model.ntendon * model.nv) {
        return projectedDenseRow(tendonJacobian, muscle.tendonId, model.nv, reduction);
    }
    if (tendonJacobian && data.ten_J_rownnz?.length >= model.ntendon
            && data.ten_J_rowadr?.length >= model.ntendon && data.ten_J_colind) {
        return projectedSparseRow(
            tendonJacobian,
            data.ten_J_rownnz,
            data.ten_J_rowadr,
            data.ten_J_colind,
            muscle.tendonId,
            reduction
        );
    }
    return Number.NaN;
}

function momentArmsFromRuntime(context, reduction) {
    const result = context.muscles.map(() => ({}));
    for (const [muscleIndex, muscle] of context.muscles.entries()) {
        for (const [coordinateIndex, coordinate] of context.coordinates.entries()) {
            // MuJoCo's actuator moment is d(length)/dq. Anatomical moment arm
            // uses the opposite sign, matching OpenSim's computeMomentArm.
            const value = -projectedActuatorLengthGradient(muscle, reduction[coordinateIndex]);
            if (!Number.isFinite(value)) return null;
            result[muscleIndex][coordinate.name] = value;
        }
    }
    return result;
}

function currentTendonLengths(context) {
    return Float64Array.from(context.muscles, (muscle) => data.ten_length[muscle.tendonId]);
}

function finiteDifferenceMomentArms(context, coordinates) {
    const result = context.muscles.map(() => ({}));
    const stepRadians = 1e-6;
    const stepDegrees = stepRadians * RADIANS_TO_DEGREES;
    for (const coordinate of context.coordinates) {
        const base = coordinates[coordinate.name];
        const lowerRoom = base - coordinate.minimum;
        const upperRoom = coordinate.maximum - base;
        const minusDegrees = lowerRoom >= stepDegrees ? base - stepDegrees : base;
        const plusDegrees = upperRoom >= stepDegrees ? base + stepDegrees : base;
        assert(plusDegrees > minusDegrees, `No finite-difference interval is available for ${coordinate.name}.`);

        let minusLengths = null;
        let plusLengths = null;
        if (minusDegrees === base) {
            realizeCoordinates(context, coordinates);
            minusLengths = currentTendonLengths(context);
        } else {
            realizeCoordinates(context, { ...coordinates, [coordinate.name]: minusDegrees });
            minusLengths = currentTendonLengths(context);
        }
        if (plusDegrees === base) {
            realizeCoordinates(context, coordinates);
            plusLengths = currentTendonLengths(context);
        } else {
            realizeCoordinates(context, { ...coordinates, [coordinate.name]: plusDegrees });
            plusLengths = currentTendonLengths(context);
        }
        const intervalRadians = (plusDegrees - minusDegrees) * DEGREES_TO_RADIANS;
        for (let muscleIndex = 0; muscleIndex < context.muscles.length; muscleIndex += 1) {
            result[muscleIndex][coordinate.name] = -(
                (plusLengths[muscleIndex] - minusLengths[muscleIndex]) / intervalRadians
            );
        }
    }
    return result;
}

function capturePaths(context, momentArms) {
    const wrapPoints = data.wrap_xpos;
    const wrapObjects = data.wrap_obj;
    return context.muscles.map((descriptor, muscleIndex) => {
        const start = data.ten_wrapadr[descriptor.tendonId];
        const count = data.ten_wrapnum[descriptor.tendonId];
        const points = [];
        const pointKinds = [];
        const segments = [];
        const segmentInsideWrap = [];
        for (let pointIndex = 0; pointIndex < count; pointIndex += 1) {
            const absoluteIndex = start + pointIndex;
            const objectId = wrapObjects[absoluteIndex];
            if (objectId !== -2) {
                points.push([
                    wrapPoints[absoluteIndex * 3],
                    wrapPoints[absoluteIndex * 3 + 1],
                    wrapPoints[absoluteIndex * 3 + 2]
                ]);
                pointKinds.push(objectId >= 0 ? 'wrap' : 'site');
            }
            if (pointIndex >= count - 1 || objectId === -2 || wrapObjects[absoluteIndex + 1] === -2) continue;
            segments.push([
                wrapPoints[absoluteIndex * 3],
                wrapPoints[absoluteIndex * 3 + 1],
                wrapPoints[absoluteIndex * 3 + 2],
                wrapPoints[(absoluteIndex + 1) * 3],
                wrapPoints[(absoluteIndex + 1) * 3 + 1],
                wrapPoints[(absoluteIndex + 1) * 3 + 2]
            ]);
            segmentInsideWrap.push(objectId >= 0 && wrapObjects[absoluteIndex + 1] >= 0);
        }
        return {
            ...descriptor,
            lengthM: data.ten_length[descriptor.tendonId],
            points,
            pointKinds,
            segments,
            segmentInsideWrap,
            momentArms: momentArms[muscleIndex]
        };
    });
}

function captureBodies() {
    const bodies = [];
    for (let bodyId = 1; bodyId < model.nbody; bodyId += 1) {
        const positionOffset = bodyId * 3;
        const rotationOffset = bodyId * 9;
        bodies.push({
            bodyId,
            name: mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY.value, bodyId) || `body_${bodyId}`,
            position: [
                data.xpos[positionOffset],
                data.xpos[positionOffset + 1],
                data.xpos[positionOffset + 2]
            ],
            rotation: [
                data.xmat[rotationOffset],
                data.xmat[rotationOffset + 1],
                data.xmat[rotationOffset + 2],
                data.xmat[rotationOffset + 3],
                data.xmat[rotationOffset + 4],
                data.xmat[rotationOffset + 5],
                data.xmat[rotationOffset + 6],
                data.xmat[rotationOffset + 7],
                data.xmat[rotationOffset + 8]
            ]
        });
    }
    return bodies;
}

function realizePoseData(context, coordinates) {
    let reduction = realizeCoordinates(context, coordinates);
    let momentArms = momentArmsFromRuntime(context, reduction);
    if (!momentArms) {
        momentArms = finiteDifferenceMomentArms(context, coordinates);
        reduction = realizeCoordinates(context, coordinates);
    }
    return {
        reduction,
        bodies: captureBodies(),
        muscles: capturePaths(context, momentArms)
    };
}

function poseIdentifier(context, coordinates) {
    const signature = context.coordinates
        .map((coordinate) => `${coordinate.name}=${coordinates[coordinate.name].toFixed(8)}`)
        .join('|');
    const regionSignature = context === defaultRegionContext ? '' : `:${context.id}`;
    return `${MODEL_ID}:${EXPECTED_SOURCE_TREE_SHA256.slice(0, 12)}${regionSignature}:${signature}`;
}

function makeState(context, requestId, mode, coordinates, selected, realized) {
    const bodies = realized.bodies;
    const bodyTransforms = Object.fromEntries(bodies.map((body) => [String(body.bodyId), body]));
    return {
        schemaVersion: STATE_SCHEMA_VERSION,
        contractVersion: CONTRACT_VERSION,
        requestId,
        poseId: poseIdentifier(context, coordinates),
        model: MODEL_ID,
        modelId: MODEL_ID,
        modelDigest: EXPECTED_SOURCE_TREE_SHA256,
        runtimeModelSha256: ASSET_SHA256.runtime,
        regionId: context.id,
        regionDigest: context.digest,
        solverConfigId: context.solverConfig.id,
        mode,
        calculationSide: context.semantics.calculationSide,
        displayMirrored: false,
        coordinates: { ...coordinates },
        coordinateUnits: 'degrees',
        selectedMuscle: selected.name,
        selectedMuscleId: selected.id,
        bodies,
        bodyTransforms,
        muscles: realized.muscles,
        pathSemantics: {
            pointsIncludePulleySeparators: false,
            segmentsAreAuthoritative: true,
            segmentInsideWrapAlignedWithSegments: true,
            coordinates: 'MuJoCo world coordinates, Z-up'
        },
        assumptions: [...context.semantics.assumptions],
        activationSource: null,
        staticHolding: null,
        interpretation: 'Exact compiled-model pose geometry only. No activation, patient force, pain, injury, or diagnosis is inferred.'
    };
}

function effectiveForce(reductionColumn, values) {
    let result = 0;
    for (let dof = 0; dof < reductionColumn.length; dof += 1) {
        result += reductionColumn[dof] * values[dof];
    }
    return result;
}

function solveLinearSystem(matrix, rightHandSide) {
    const size = rightHandSide.length;
    const augmented = matrix.map((row, index) => [...row, rightHandSide[index]]);
    for (let pivotColumn = 0; pivotColumn < size; pivotColumn += 1) {
        let pivotRow = pivotColumn;
        for (let row = pivotColumn + 1; row < size; row += 1) {
            if (Math.abs(augmented[row][pivotColumn]) > Math.abs(augmented[pivotRow][pivotColumn])) {
                pivotRow = row;
            }
        }
        if (Math.abs(augmented[pivotRow][pivotColumn]) < 1e-15) {
            throw new Error('Static equilibrium matrix is singular.');
        }
        [augmented[pivotColumn], augmented[pivotRow]] = [augmented[pivotRow], augmented[pivotColumn]];
        const pivot = augmented[pivotColumn][pivotColumn];
        for (let column = pivotColumn; column <= size; column += 1) {
            augmented[pivotColumn][column] /= pivot;
        }
        for (let row = 0; row < size; row += 1) {
            if (row === pivotColumn) continue;
            const factor = augmented[row][pivotColumn];
            if (factor === 0) continue;
            for (let column = pivotColumn; column <= size; column += 1) {
                augmented[row][column] -= factor * augmented[pivotColumn][column];
            }
        }
    }
    return augmented.map((row) => row[size]);
}

function solveBoundedMinimumNorm(matrix, target, weights, lower, upper) {
    const rows = matrix.length;
    const count = weights.length;
    const fixed = new Uint8Array(count);
    const solution = new Float64Array(count);

    for (let iteration = 0; iteration < count * 3; iteration += 1) {
        const adjusted = Float64Array.from(target);
        for (let variable = 0; variable < count; variable += 1) {
            if (!fixed[variable]) continue;
            for (let row = 0; row < rows; row += 1) {
                adjusted[row] -= matrix[row][variable] * solution[variable];
            }
        }
        const gram = Array.from({ length: rows }, () => new Float64Array(rows));
        for (let variable = 0; variable < count; variable += 1) {
            if (fixed[variable]) continue;
            const inverseWeight = 1 / weights[variable];
            for (let row = 0; row < rows; row += 1) {
                for (let column = 0; column < rows; column += 1) {
                    gram[row][column] += matrix[row][variable] * inverseWeight * matrix[column][variable];
                }
            }
        }
        const multiplier = solveLinearSystem(gram, adjusted);
        for (let variable = 0; variable < count; variable += 1) {
            if (fixed[variable]) continue;
            let value = 0;
            for (let row = 0; row < rows; row += 1) value += matrix[row][variable] * multiplier[row];
            solution[variable] = value / weights[variable];
        }

        let largestViolation = 0;
        let violatingVariable = -1;
        let violatingBound = 0;
        for (let variable = 0; variable < count; variable += 1) {
            if (fixed[variable]) continue;
            if (solution[variable] < lower[variable] - 1e-10
                    && lower[variable] - solution[variable] > largestViolation) {
                largestViolation = lower[variable] - solution[variable];
                violatingVariable = variable;
                violatingBound = lower[variable];
            } else if (solution[variable] > upper[variable] + 1e-10
                    && solution[variable] - upper[variable] > largestViolation) {
                largestViolation = solution[variable] - upper[variable];
                violatingVariable = variable;
                violatingBound = upper[variable];
            }
        }
        if (violatingVariable >= 0) {
            solution[violatingVariable] = violatingBound;
            fixed[violatingVariable] = 1;
            continue;
        }

        let releaseStrength = 0;
        let releaseVariable = -1;
        for (let variable = 0; variable < count; variable += 1) {
            if (!fixed[variable]) continue;
            let gradient = weights[variable] * solution[variable];
            for (let row = 0; row < rows; row += 1) {
                gradient -= matrix[row][variable] * multiplier[row];
            }
            if (Math.abs(solution[variable] - lower[variable]) < 1e-10
                    && gradient < -1e-9 && -gradient > releaseStrength) {
                releaseStrength = -gradient;
                releaseVariable = variable;
            } else if (Math.abs(solution[variable] - upper[variable]) < 1e-10
                    && gradient > 1e-9 && gradient > releaseStrength) {
                releaseStrength = gradient;
                releaseVariable = variable;
            }
        }
        if (releaseVariable >= 0) {
            fixed[releaseVariable] = 0;
            continue;
        }
        return { solution, iterations: iteration + 1 };
    }
    throw new Error('Bounded static equilibrium did not converge.');
}

function rms(values) {
    if (!values.length) return 0;
    return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}

function staticQualityStatus(context, result) {
    const config = context.solverConfig;
    if (!result.converged) return ['solver_failed', result.detail || 'The bounded static equilibrium solve did not converge.'];
    if (!result.finite) return ['nonfinite_result', 'The solve produced a non-finite value.'];
    if (!result.pathsValid) return ['invalid_paths', 'One or more compiled muscle paths was incomplete or non-finite.'];
    if (result.maxResidualNm > config.maximumResidualNm) {
        return ['equilibrium_residual_too_high', 'The replayed generalized-force equilibrium residual exceeded the numerical limit.'];
    }
    if (result.maxReserveNm > config.maximumReserveNm) {
        return [
            'reserve_torque_too_high',
            `The model needed ${result.maxReserveNm.toFixed(3)} N·m of reserve torque, above the ${config.maximumReserveNm.toFixed(2)} N·m display limit.`
        ];
    }
    if (result.capacityLimited) {
        return ['capacity_limited', 'One or more modeled muscles reached capacity while nontrivial reserve torque was still required.'];
    }
    return ['usable', 'The static result passed the finite-value, path, replayed-equilibrium, reserve, and capacity checks.'];
}

function calculateStaticHold(context, reduction, muscles) {
    const started = performance.now();
    const config = context.solverConfig;
    const coordinateCount = context.coordinates.length;
    const muscleCount = context.muscles.length;
    const baselineActuatorGeneralized = Float64Array.from(data.qfrc_actuator);
    const baselineActuatorForce = Float64Array.from(data.actuator_force);
    const baselineFull = new Float64Array(model.nv);
    for (let dof = 0; dof < model.nv; dof += 1) {
        baselineFull[dof] = data.qfrc_actuator[dof] + data.qfrc_passive[dof] - data.qfrc_bias[dof];
    }
    const baseline = reduction.map((column) => effectiveForce(column, baselineFull));
    const columns = Array.from({ length: coordinateCount }, () => new Float64Array(muscleCount));
    const activeForceCapacity = new Float64Array(muscleCount);

    try {
        for (const [muscleIndex, muscle] of context.muscles.entries()) {
            const activationAddress = model.actuator_actadr[muscle.actuatorId];
            assert(activationAddress >= 0, `Muscle ${muscle.name} has no activation state.`);
            data.act[activationAddress] = 1;
            mujoco.mj_forward(model, data);
            for (let coordinate = 0; coordinate < coordinateCount; coordinate += 1) {
                let torque = 0;
                for (let dof = 0; dof < model.nv; dof += 1) {
                    torque += reduction[coordinate][dof]
                        * (data.qfrc_actuator[dof] - baselineActuatorGeneralized[dof]);
                }
                columns[coordinate][muscleIndex] = torque;
            }
            activeForceCapacity[muscleIndex] = data.actuator_force[muscle.actuatorId]
                - baselineActuatorForce[muscle.actuatorId];
            data.act[activationAddress] = 0;
        }

        const variableCount = muscleCount + coordinateCount;
        const solveMatrix = Array.from({ length: coordinateCount }, (_, row) => {
            const values = new Float64Array(variableCount);
            values.set(columns[row], 0);
            values[muscleCount + row] = 1;
            return values;
        });
        const weights = new Float64Array(variableCount);
        const lower = new Float64Array(variableCount);
        const upper = new Float64Array(variableCount);
        weights.fill(1, 0, muscleCount);
        weights.fill(config.reserveObjectiveWeightPerNm2, muscleCount);
        lower.fill(0, 0, muscleCount);
        upper.fill(1, 0, muscleCount);
        lower.fill(Number.NEGATIVE_INFINITY, muscleCount);
        upper.fill(Number.POSITIVE_INFINITY, muscleCount);
        const solved = solveBoundedMinimumNorm(
            solveMatrix,
            Float64Array.from(baseline, (value) => -value),
            weights,
            lower,
            upper
        );
        const activations = solved.solution.slice(0, muscleCount);
        const reserves = solved.solution.slice(muscleCount);

        data.act.fill(0);
        for (const [index, muscle] of context.muscles.entries()) {
            data.act[model.actuator_actadr[muscle.actuatorId]] = activations[index];
        }
        mujoco.mj_forward(model, data);
        const replayFull = new Float64Array(model.nv);
        for (let dof = 0; dof < model.nv; dof += 1) {
            replayFull[dof] = data.qfrc_actuator[dof] + data.qfrc_passive[dof] - data.qfrc_bias[dof];
        }
        const residuals = reduction.map((column, index) => effectiveForce(column, replayFull) + reserves[index]);
        const maxResidualNm = Math.max(...residuals.map((value) => Math.abs(value)));
        const maxReserveNm = Math.max(...reserves.map((value) => Math.abs(value)));
        const musclesAtCapacity = [...activations]
            .filter((value) => value >= config.capacityActivation).length;
        const finite = [...activations, ...reserves, ...residuals, ...activeForceCapacity]
            .every((value) => Number.isFinite(value));
        const pathsValid = muscles.every((muscle) =>
            Number.isFinite(muscle.lengthM)
            && muscle.lengthM > 0
            && muscle.points.length >= 2
            && muscle.segments.length >= 1
            && muscle.points.every((point) => point.every((value) => Number.isFinite(value)))
            && muscle.segments.every((segment) => segment.every((value) => Number.isFinite(value)))
            && Object.values(muscle.momentArms).every((value) => Number.isFinite(value))
        );
        const capacityLimited = musclesAtCapacity > 0 && maxReserveNm > config.capacityReserveNm;
        const usable = finite
            && pathsValid
            && maxResidualNm <= config.maximumResidualNm
            && maxReserveNm <= config.maximumReserveNm
            && !capacityLimited;
        const objective = [...activations].reduce((sum, value) => sum + value * value, 0)
            + config.reserveObjectiveWeightPerNm2
                * [...reserves].reduce((sum, value) => sum + value * value, 0);

        return {
            converged: true,
            usable,
            finite,
            pathsValid,
            activations,
            activeForceCapacity,
            passiveForces: baselineActuatorForce,
            reserves,
            residuals,
            maxResidualNm,
            rmsResidualNm: rms([...residuals]),
            maxReserveNm,
            rmsReserveNm: rms([...reserves]),
            musclesAtCapacity,
            capacityLimited,
            iterations: solved.iterations,
            objective,
            durationMilliseconds: performance.now() - started
        };
    } finally {
        data.act.fill(0);
        mujoco.mj_forward(model, data);
    }
}

function failedStaticResult(error, muscles, started) {
    return {
        converged: false,
        usable: false,
        finite: false,
        pathsValid: muscles.every((muscle) => muscle.points.length >= 2 && muscle.segments.length >= 1),
        activations: new Float64Array(),
        activeForceCapacity: new Float64Array(),
        passiveForces: new Float64Array(),
        reserves: new Float64Array(),
        residuals: new Float64Array(),
        maxResidualNm: null,
        rmsResidualNm: null,
        maxReserveNm: null,
        rmsReserveNm: null,
        musclesAtCapacity: 0,
        capacityLimited: false,
        iterations: 0,
        objective: null,
        durationMilliseconds: performance.now() - started,
        detail: error.message
    };
}

function valueByCoordinate(context, values) {
    return Object.fromEntries(context.coordinates.map((coordinate, index) => [
        coordinate.name,
        values?.length > index && Number.isFinite(values[index]) ? values[index] : null
    ]));
}

function buildStaticHolding(context, result, coordinates) {
    const config = context.solverConfig;
    const [status, reason] = staticQualityStatus(context, result);
    return {
        ready: result.usable,
        method: 'MuJoCo pose-linearized active-muscle torque balance with bounded weighted minimum-norm optimization',
        requestedCoordinatesDegrees: { ...coordinates },
        assumptions: {
            velocity: 'zero',
            acceleration: 'zero',
            externalLoad: context.semantics.externalLoad || 'none',
            contact: context.semantics.contact || 'none',
            gravityMPerS2: [...config.gravityMPerS2],
            segmentWeights: 'model-defined',
            passiveModelForcesIncluded: true,
            equilibrium: context.semantics.equilibrium,
            fixedSupport: context.semantics.fixedSupport
        },
        activeActuatorForce: {
            available: result.usable,
            field: 'muscles[].activeActuatorForceN',
            units: 'N',
            method: 'Activation multiplied by pose-linearized active actuator-force capacity.',
            component: 'active actuator contribution only',
            linearizedAtRequestedPose: true,
            passiveModelForcesIncludedInBalance: true,
            externalLoadIncluded: false,
            measuredPatientForce: false,
            interpretation: 'Generic-model solver output; not measured fiber force, tissue load, pain, injury, fatigue, or diagnosis.'
        },
        solver: {
            algorithm: config.algorithm,
            configId: config.id,
            configDigest: config.digest,
            converged: result.converged,
            iterations: result.iterations,
            durationMs: result.durationMilliseconds,
            objective: result.objective,
            activationExponent: config.activationExponent,
            activationBounds: [...config.activationBounds],
            reserveObjectiveWeightPerNm2: config.reserveObjectiveWeightPerNm2,
            detail: result.detail || null
        },
        quality: {
            usable: result.usable,
            status,
            reason,
            finite: result.finite,
            pathsValid: result.pathsValid,
            activationCount: result.usable ? context.muscles.length : 0,
            activeActuatorForceCount: result.usable ? context.muscles.length : 0,
            maxGeneralizedForceEquilibriumResidual: result.maxResidualNm,
            rmsGeneralizedForceEquilibriumResidual: result.rmsResidualNm,
            equilibriumResidualLimit: config.maximumResidualNm,
            equilibriumResidualUnits: context.semantics.generalizedForceUnits,
            maxReserveTorqueNm: result.maxReserveNm,
            rmsReserveTorqueNm: result.rmsReserveNm,
            reserveTorqueLimitNm: config.maximumReserveNm,
            capacityLimitedReserveThresholdNm: config.capacityReserveNm,
            muscleCapacityThreshold: config.capacityActivation,
            musclesAtUpperControlLimit: result.musclesAtCapacity,
            capacityLimited: result.capacityLimited,
            reserveTorqueNmByCoordinate: valueByCoordinate(context, result.reserves),
            residualTorqueNmByCoordinate: valueByCoordinate(context, result.residuals)
        }
    };
}

async function poseState(requestId, rawCoordinates, rawSelectedMuscle, regionId) {
    await initializeRuntime();
    const context = resolveRegion(regionId);
    const coordinates = resolveCoordinates(context, rawCoordinates);
    const selected = resolveSelectedMuscle(context, rawSelectedMuscle);
    const realized = realizePoseData(context, coordinates);
    return makeState(context, requestId, 'pose', coordinates, selected, realized);
}

async function staticHoldState(requestId, rawCoordinates, rawSelectedMuscle, regionId) {
    await initializeRuntime();
    const context = resolveRegion(regionId);
    const coordinates = resolveCoordinates(context, rawCoordinates);
    const selected = resolveSelectedMuscle(context, rawSelectedMuscle);
    const realized = realizePoseData(context, coordinates);
    const state = makeState(context, requestId, 'static', coordinates, selected, realized);
    const started = performance.now();
    let result;
    try {
        result = calculateStaticHold(context, realized.reduction, state.muscles);
    } catch (error) {
        result = failedStaticResult(error, state.muscles, started);
    }
    state.staticHolding = buildStaticHolding(context, result, coordinates);
    if (result.usable) {
        for (const [index, muscle] of state.muscles.entries()) {
            muscle.activation = result.activations[index];
            muscle.activeActuatorForceN = Math.abs(result.activations[index] * result.activeForceCapacity[index]);
            muscle.passiveActuatorForceN = Math.abs(result.passiveForces[muscle.actuatorId]);
        }
        state.activationSource = 'on-demand MuJoCo 3.10.0 static weighted minimum-norm solve';
        state.interpretation = 'Generic-model, gravity-only static recruitment estimate for this exact posture. It is not measured patient force, pain, injury, fatigue, or diagnosis.';
    } else {
        state.interpretation = 'Exact pose geometry only. Activation and actuator-force values were withheld because the static result did not pass every quality gate.';
    }
    return state;
}

function serializedError(error) {
    return {
        name: error?.name || 'Error',
        message: error?.message || String(error),
        code: error?.code || 'MS_HUMAN_ENGINE_ERROR',
        details: error?.details,
        stack: error?.stack
    };
}

function releaseRuntime() {
    if (data) {
        data.delete();
        data = null;
    }
    if (model) {
        model.delete();
        model = null;
    }
    publicMetadata = null;
    rawMetadata = null;
    rawRegionManifest = null;
    defaultRegionContext = null;
    regionContexts = new Map();
    regionManifestDigest = null;
    solverConfig = null;
    mujoco = null;
}

self.addEventListener('message', async (event) => {
    const message = event.data || {};
    if (message.action === 'dispose') {
        disposed = true;
        releaseRuntime();
        self.close();
        return;
    }
    if (disposed) return;

    try {
        let result;
        if (message.action === 'initialize') result = await initializeRuntime();
        else if (message.action === 'pose') {
            result = await poseState(message.requestId, message.coordinates, message.selectedMuscle, message.regionId);
        } else if (message.action === 'staticHold') {
            result = await staticHoldState(
                message.requestId,
                message.coordinates,
                message.selectedMuscle,
                message.regionId
            );
        } else {
            const error = new Error(`Unknown MS-Human worker action: ${String(message.action)}.`);
            error.code = 'UNKNOWN_ACTION';
            throw error;
        }
        if (!disposed) self.postMessage({ type: 'response', requestId: message.requestId, ok: true, result });
    } catch (error) {
        if (!disposed) {
            self.postMessage({
                type: 'response',
                requestId: message.requestId,
                ok: false,
                error: serializedError(error)
            });
        }
    }
});
