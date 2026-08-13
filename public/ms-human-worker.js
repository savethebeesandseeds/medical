import loadMujoco from './vendor/mujoco.js';

const CONTRACT_VERSION = 1;
const STATE_SCHEMA_VERSION = 1;
const EXPECTED_MUJOCO_VERSION = '3.10.0';
const MODEL_ID = 'MS_HUMAN_700_RIGHT_ARM_STATIC_V1';
const SOLVER_CONFIG_NAME = 'MS_HUMAN_700_RIGHT_ARM_STATIC_MIN_NORM_V1';
const DEFAULT_SELECTED_MUSCLE = 'DELT1_r';
const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;

const URLS = Object.freeze({
    metadata: new URL('./models/ms_human_700/right-arm.json', import.meta.url).href,
    geometry: new URL('./models/ms_human_700/right-arm.meshbin', import.meta.url).href,
    runtime: new URL('./models/ms_human_700/right-arm-runtime.mjb', import.meta.url).href,
    mujocoJs: new URL('./vendor/mujoco.js', import.meta.url).href,
    mujocoWasm: new URL('./vendor/mujoco.wasm', import.meta.url).href
});

// These are pinned by verify-ms-human.ps1. The worker verifies every asset it
// executes directly. The geometry digest is exported for the renderer, which
// owns and verifies the separate mesh download.
const ASSET_SHA256 = Object.freeze({
    metadata: '4278ffe5171328047dd240711386ac2ea84ba7bcc54e1740df359f263956414e',
    geometry: '5cbdf2aebd44da09dbd9b546cca35abc7b3b2f64e927f879c0d03595e087f68c',
    runtime: '13d2b0bed35db2b07f3b8076931abef4ec4e149ca8d89f326bde22b84f821ad3',
    mujocoJs: '45e8e0e1617c19fbf7f00b36a6a72d1c0c980c0a4f38523e04f0641e8fbab7b9',
    mujocoWasm: '832597ae0a0e306c97ed43d2a9bbca033cf3e547eced410fb9011d87a68d4207'
});

const EXPECTED_SOURCE_TREE_SHA256 = '38815fed122d1beb61155f0afd85e72a52093111fcae183bbb273f2483291971';

let initializationPromise = null;
let disposed = false;
let rawMetadata = null;
let publicMetadata = null;
let solverConfig = null;
let mujoco = null;
let model = null;
let data = null;
let coordinateSpecs = [];
let coordinateByInputName = new Map();
let muscleDescriptors = [];
let muscleByName = new Map();
let muscleByActuatorId = new Map();

function assert(condition, message, code = 'MODEL_INTEGRITY_ERROR') {
    if (condition) return;
    const error = new Error(message);
    error.code = code;
    throw error;
}

function canonicalCoordinateName(engineName) {
    return engineName.endsWith('_r') ? engineName.slice(0, -2) : engineName;
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

function buildSolverConfig(metadata) {
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
        gravityMPerS2: [...source.gravityMPerS2],
        solvedCoordinates: coordinateSpecs.map((coordinate) => coordinate.name),
        fixedSupport: 'All non-solved model coordinates remain prescribed at keyframe 0; their support reactions are not solved or interpreted.',
        momentArmMethod: 'Negative MuJoCo actuator-length gradient projected through authored joint-equality derivatives; finite-difference fallback uses the same compiled model.',
        assumptions: [...source.assumptions]
    };
}

async function buildPublicMetadata(metadata, verifiedAssets) {
    const configDigest = await sha256Text(stableStringify(solverConfig));
    const configId = `${SOLVER_CONFIG_NAME}:${configDigest.slice(0, 16)}`;
    solverConfig = { id: configId, digest: configDigest, ...solverConfig };

    const geoms = metadata.geometry.geoms.map((geom) => ({ ...geom, rgba: [...geom.rgba] }));
    const muscles = muscleDescriptors.map((muscle) => ({ ...muscle }));
    const coordinates = coordinateSpecs.map((coordinate) => ({ ...coordinate }));
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
        identity: {
            modelId: MODEL_ID,
            modelDigest: EXPECTED_SOURCE_TREE_SHA256,
            digestAlgorithm: 'SHA-256',
            sourceTreeSha256: metadata.source.sourceTreeSha256,
            sourceCommit: metadata.source.commit,
            runtimeModelSha256: ASSET_SHA256.runtime,
            runtimeVersion: EXPECTED_MUJOCO_VERSION,
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
            muscles: muscleDescriptors.length,
            ligaments: 0,
            meshes: geoms.length
        },
        capabilities: {
            pose: true,
            staticHold: true,
            dynamicMotion: false,
            externalLoads: false,
            patientSpecific: false,
            leftArm: false,
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
        notice: 'Generic MS-Human-700 right-arm model; static, gravity-only, non-patient-specific, and not diagnostic.'
    };
}

function validateRuntimeInventory(metadata) {
    assert(mujoco.mj_versionString() === EXPECTED_MUJOCO_VERSION,
        `Expected MuJoCo ${EXPECTED_MUJOCO_VERSION}; loaded ${mujoco.mj_versionString()}.`);
    assert(metadata.schemaVersion === 1, `Unsupported right-arm metadata schema ${metadata.schemaVersion}.`);
    assert(metadata.source.sourceTreeSha256 === EXPECTED_SOURCE_TREE_SHA256,
        'The MS-Human source-tree identity does not match this engine.');
    assert(model.nu === metadata.model.totalMuscles,
        'The runtime actuator count does not match the right-arm metadata.');
    assert(metadata.muscles.length === 88 && metadata.model.functionalMuscles === 88,
        'The functional right-arm inventory must contain exactly 88 muscles.');
    assert(metadata.coordinates.length === 7 && metadata.model.independentCoordinates === 7,
        'The right-arm runtime must expose exactly seven independent coordinates.');

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

async function initializeRuntime() {
    if (publicMetadata) return publicMetadata;
    if (initializationPromise) return initializationPromise;
    initializationPromise = (async () => {
        const [metadataBytes, runtimeBytes, mujocoJsBytes, mujocoWasmBytes] = await Promise.all([
            fetchBytes(URLS.metadata, 'Right-arm metadata'),
            fetchBytes(URLS.runtime, 'Right-arm runtime model'),
            fetchBytes(URLS.mujocoJs, 'MuJoCo JavaScript runtime'),
            fetchBytes(URLS.mujocoWasm, 'MuJoCo WebAssembly runtime')
        ]);
        await Promise.all([
            verifyDigest('Right-arm metadata', metadataBytes, ASSET_SHA256.metadata),
            verifyDigest('Right-arm runtime model', runtimeBytes, ASSET_SHA256.runtime),
            verifyDigest('MuJoCo JavaScript runtime', mujocoJsBytes, ASSET_SHA256.mujocoJs),
            verifyDigest('MuJoCo WebAssembly runtime', mujocoWasmBytes, ASSET_SHA256.mujocoWasm)
        ]);

        rawMetadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metadataBytes));
        coordinateSpecs = rawMetadata.coordinates.map((coordinate) => ({
            name: canonicalCoordinateName(coordinate.name),
            engineName: coordinate.name,
            label: coordinate.label,
            minimum: coordinate.minimumDegrees,
            maximum: coordinate.maximumDegrees,
            default: coordinate.defaultDegrees,
            units: 'degrees',
            jointId: coordinate.jointId,
            qposAddress: coordinate.qposAddress,
            dofAddress: coordinate.dofAddress
        }));
        coordinateByInputName = new Map();
        for (const coordinate of coordinateSpecs) {
            coordinateByInputName.set(coordinate.name, coordinate);
            coordinateByInputName.set(coordinate.engineName, coordinate);
        }
        muscleDescriptors = rawMetadata.muscles.map((muscle) => ({
            id: `${MODEL_ID}:actuator:${muscle.actuatorId}`,
            actuatorId: muscle.actuatorId,
            name: muscle.name,
            tendonId: muscle.tendonId,
            tendon: muscle.tendon,
            group: muscle.group,
            visibleByDefault: muscle.visibleByDefault
        }));
        muscleByName = new Map(muscleDescriptors.map((muscle) => [muscle.name, muscle]));
        muscleByActuatorId = new Map(muscleDescriptors.map((muscle) => [muscle.actuatorId, muscle]));
        solverConfig = buildSolverConfig(rawMetadata);

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
        publicMetadata = await buildPublicMetadata(
            rawMetadata,
            ['metadata', 'runtime', 'mujocoJs', 'mujocoWasm']
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

function resolveCoordinates(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError('Coordinates must be an object keyed by canonical coordinate name.');
    }
    const supplied = new Map();
    for (const [inputName, rawValue] of Object.entries(input)) {
        const coordinate = coordinateByInputName.get(inputName);
        if (!coordinate) throw new RangeError(`Unknown MS-Human coordinate: ${inputName}.`);
        const value = numericCoordinate(rawValue, inputName);
        const existing = supplied.get(coordinate.name);
        if (existing !== undefined && Math.abs(existing - value) > 1e-10) {
            throw new RangeError(`Conflicting values were supplied for ${coordinate.name}.`);
        }
        supplied.set(coordinate.name, value);
    }

    const resolved = {};
    for (const coordinate of coordinateSpecs) {
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

function resolveSelectedMuscle(value) {
    if (value && typeof value === 'object') value = value.actuatorId ?? value.name ?? value.id;
    let selected = null;
    if (value === undefined || value === null || value === '') {
        selected = muscleByName.get(DEFAULT_SELECTED_MUSCLE) || muscleDescriptors[0];
    } else if (typeof value === 'number' || (/^\d+$/.test(String(value)))) {
        selected = muscleByActuatorId.get(Number(value));
    } else {
        selected = muscleByName.get(String(value));
        if (!selected) selected = muscleDescriptors.find((muscle) => muscle.id === String(value));
    }
    if (!selected) throw new RangeError(`Unknown MS-Human muscle: ${String(value)}.`);
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

function realizeCoordinates(coordinates) {
    mujoco.mj_resetDataKeyframe(model, data, 0);
    data.qvel.fill(0);
    data.qacc.fill(0);
    data.ctrl.fill(0);
    data.act.fill(0);

    const independentColumns = new Map();
    for (const [column, coordinate] of coordinateSpecs.entries()) {
        data.qpos[coordinate.qposAddress] = coordinates[coordinate.name] * DEGREES_TO_RADIANS;
        independentColumns.set(coordinate.jointId, column);
    }

    const equalityStride = model.neq ? model.eq_data.length / model.neq : 0;
    const jointEqualityType = mujoco.mjtEq.mjEQ_JOINT.value;
    const equalityDerivatives = [];
    for (let equalityId = 0; equalityId < model.neq; equalityId += 1) {
        if (model.eq_type[equalityId] !== jointEqualityType) continue;
        const sourceJoint = model.eq_obj2id[equalityId];
        const column = independentColumns.get(sourceJoint);
        if (column === undefined) continue;
        const dependentJoint = model.eq_obj1id[equalityId];
        const sourceQpos = model.jnt_qposadr[sourceJoint];
        const dependentQpos = model.jnt_qposadr[dependentJoint];
        const coefficients = new Float64Array(5);
        for (let coefficient = 0; coefficient < 5; coefficient += 1) {
            coefficients[coefficient] = model.eq_data[equalityId * equalityStride + coefficient];
        }
        const evaluated = polynomialValueAndDerivative(coefficients, data.qpos[sourceQpos]);
        data.qpos[dependentQpos] = evaluated.value;
        equalityDerivatives.push({
            column,
            dependentDof: model.jnt_dofadr[dependentJoint],
            derivative: evaluated.derivative
        });
    }

    mujoco.mj_forward(model, data);
    const reduction = coordinateSpecs.map((coordinate) => {
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

function momentArmsFromRuntime(reduction) {
    const result = muscleDescriptors.map(() => ({}));
    for (const [muscleIndex, muscle] of muscleDescriptors.entries()) {
        for (const [coordinateIndex, coordinate] of coordinateSpecs.entries()) {
            // MuJoCo's actuator moment is d(length)/dq. Anatomical moment arm
            // uses the opposite sign, matching OpenSim's computeMomentArm.
            const value = -projectedActuatorLengthGradient(muscle, reduction[coordinateIndex]);
            if (!Number.isFinite(value)) return null;
            result[muscleIndex][coordinate.name] = value;
        }
    }
    return result;
}

function currentTendonLengths() {
    return Float64Array.from(muscleDescriptors, (muscle) => data.ten_length[muscle.tendonId]);
}

function finiteDifferenceMomentArms(coordinates) {
    const result = muscleDescriptors.map(() => ({}));
    const stepRadians = 1e-6;
    const stepDegrees = stepRadians * RADIANS_TO_DEGREES;
    for (const coordinate of coordinateSpecs) {
        const base = coordinates[coordinate.name];
        const lowerRoom = base - coordinate.minimum;
        const upperRoom = coordinate.maximum - base;
        const minusDegrees = lowerRoom >= stepDegrees ? base - stepDegrees : base;
        const plusDegrees = upperRoom >= stepDegrees ? base + stepDegrees : base;
        assert(plusDegrees > minusDegrees, `No finite-difference interval is available for ${coordinate.name}.`);

        let minusLengths = null;
        let plusLengths = null;
        if (minusDegrees === base) {
            realizeCoordinates(coordinates);
            minusLengths = currentTendonLengths();
        } else {
            realizeCoordinates({ ...coordinates, [coordinate.name]: minusDegrees });
            minusLengths = currentTendonLengths();
        }
        if (plusDegrees === base) {
            realizeCoordinates(coordinates);
            plusLengths = currentTendonLengths();
        } else {
            realizeCoordinates({ ...coordinates, [coordinate.name]: plusDegrees });
            plusLengths = currentTendonLengths();
        }
        const intervalRadians = (plusDegrees - minusDegrees) * DEGREES_TO_RADIANS;
        for (let muscleIndex = 0; muscleIndex < muscleDescriptors.length; muscleIndex += 1) {
            result[muscleIndex][coordinate.name] = -(
                (plusLengths[muscleIndex] - minusLengths[muscleIndex]) / intervalRadians
            );
        }
    }
    return result;
}

function capturePaths(momentArms) {
    const wrapPoints = data.wrap_xpos;
    const wrapObjects = data.wrap_obj;
    return muscleDescriptors.map((descriptor, muscleIndex) => {
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

function realizePoseData(coordinates) {
    let reduction = realizeCoordinates(coordinates);
    let momentArms = momentArmsFromRuntime(reduction);
    if (!momentArms) {
        momentArms = finiteDifferenceMomentArms(coordinates);
        reduction = realizeCoordinates(coordinates);
    }
    return {
        reduction,
        bodies: captureBodies(),
        muscles: capturePaths(momentArms)
    };
}

function poseIdentifier(coordinates) {
    const signature = coordinateSpecs
        .map((coordinate) => `${coordinate.name}=${coordinates[coordinate.name].toFixed(8)}`)
        .join('|');
    return `${MODEL_ID}:${EXPECTED_SOURCE_TREE_SHA256.slice(0, 12)}:${signature}`;
}

function makeState(requestId, mode, coordinates, selected, realized) {
    const bodies = realized.bodies;
    const bodyTransforms = Object.fromEntries(bodies.map((body) => [String(body.bodyId), body]));
    return {
        schemaVersion: STATE_SCHEMA_VERSION,
        contractVersion: CONTRACT_VERSION,
        requestId,
        poseId: poseIdentifier(coordinates),
        model: MODEL_ID,
        modelId: MODEL_ID,
        modelDigest: EXPECTED_SOURCE_TREE_SHA256,
        runtimeModelSha256: ASSET_SHA256.runtime,
        solverConfigId: solverConfig.id,
        mode,
        calculationSide: 'right',
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
        assumptions: [...rawMetadata.staticHold.assumptions],
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

function staticQualityStatus(result) {
    if (!result.converged) return ['solver_failed', result.detail || 'The bounded static equilibrium solve did not converge.'];
    if (!result.finite) return ['nonfinite_result', 'The solve produced a non-finite value.'];
    if (!result.pathsValid) return ['invalid_paths', 'One or more compiled muscle paths was incomplete or non-finite.'];
    if (result.maxResidualNm > solverConfig.maximumResidualNm) {
        return ['equilibrium_residual_too_high', 'The replayed generalized-force equilibrium residual exceeded the numerical limit.'];
    }
    if (result.maxReserveNm > solverConfig.maximumReserveNm) {
        return [
            'reserve_torque_too_high',
            `The model needed ${result.maxReserveNm.toFixed(3)} N·m of reserve torque, above the ${solverConfig.maximumReserveNm.toFixed(2)} N·m display limit.`
        ];
    }
    if (result.capacityLimited) {
        return ['capacity_limited', 'One or more modeled muscles reached capacity while nontrivial reserve torque was still required.'];
    }
    return ['usable', 'The static result passed the finite-value, path, replayed-equilibrium, reserve, and capacity checks.'];
}

function calculateStaticHold(reduction, muscles) {
    const started = performance.now();
    const coordinateCount = coordinateSpecs.length;
    const muscleCount = muscleDescriptors.length;
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
        for (const [muscleIndex, muscle] of muscleDescriptors.entries()) {
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
        weights.fill(solverConfig.reserveObjectiveWeightPerNm2, muscleCount);
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
        for (const [index, muscle] of muscleDescriptors.entries()) {
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
            .filter((value) => value >= solverConfig.capacityActivation).length;
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
        const capacityLimited = musclesAtCapacity > 0 && maxReserveNm > solverConfig.capacityReserveNm;
        const usable = finite
            && pathsValid
            && maxResidualNm <= solverConfig.maximumResidualNm
            && maxReserveNm <= solverConfig.maximumReserveNm
            && !capacityLimited;
        const objective = [...activations].reduce((sum, value) => sum + value * value, 0)
            + solverConfig.reserveObjectiveWeightPerNm2
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

function valueByCoordinate(values) {
    return Object.fromEntries(coordinateSpecs.map((coordinate, index) => [
        coordinate.name,
        values?.length > index && Number.isFinite(values[index]) ? values[index] : null
    ]));
}

function buildStaticHolding(result, coordinates) {
    const [status, reason] = staticQualityStatus(result);
    return {
        ready: result.usable,
        method: 'MuJoCo pose-linearized active-muscle torque balance with bounded weighted minimum-norm optimization',
        requestedCoordinatesDegrees: { ...coordinates },
        assumptions: {
            velocity: 'zero',
            acceleration: 'zero',
            externalLoad: 'none',
            contact: 'none',
            gravityMPerS2: [...solverConfig.gravityMPerS2],
            segmentWeights: 'model-defined',
            passiveModelForcesIncluded: true,
            equilibrium: 'Seven reduced right-arm coordinate torques; authored joint-equality derivatives included.',
            fixedSupport: solverConfig.fixedSupport
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
            algorithm: solverConfig.algorithm,
            configId: solverConfig.id,
            configDigest: solverConfig.digest,
            converged: result.converged,
            iterations: result.iterations,
            durationMs: result.durationMilliseconds,
            objective: result.objective,
            activationExponent: solverConfig.activationExponent,
            activationBounds: [...solverConfig.activationBounds],
            reserveObjectiveWeightPerNm2: solverConfig.reserveObjectiveWeightPerNm2,
            detail: result.detail || null
        },
        quality: {
            usable: result.usable,
            status,
            reason,
            finite: result.finite,
            pathsValid: result.pathsValid,
            activationCount: result.usable ? muscleDescriptors.length : 0,
            activeActuatorForceCount: result.usable ? muscleDescriptors.length : 0,
            maxGeneralizedForceEquilibriumResidual: result.maxResidualNm,
            rmsGeneralizedForceEquilibriumResidual: result.rmsResidualNm,
            equilibriumResidualLimit: solverConfig.maximumResidualNm,
            equilibriumResidualUnits: 'N·m for the seven rotational coordinates',
            maxReserveTorqueNm: result.maxReserveNm,
            rmsReserveTorqueNm: result.rmsReserveNm,
            reserveTorqueLimitNm: solverConfig.maximumReserveNm,
            capacityLimitedReserveThresholdNm: solverConfig.capacityReserveNm,
            muscleCapacityThreshold: solverConfig.capacityActivation,
            musclesAtUpperControlLimit: result.musclesAtCapacity,
            capacityLimited: result.capacityLimited,
            reserveTorqueNmByCoordinate: valueByCoordinate(result.reserves),
            residualTorqueNmByCoordinate: valueByCoordinate(result.residuals)
        }
    };
}

async function poseState(requestId, rawCoordinates, rawSelectedMuscle) {
    await initializeRuntime();
    const coordinates = resolveCoordinates(rawCoordinates);
    const selected = resolveSelectedMuscle(rawSelectedMuscle);
    const realized = realizePoseData(coordinates);
    return makeState(requestId, 'pose', coordinates, selected, realized);
}

async function staticHoldState(requestId, rawCoordinates, rawSelectedMuscle) {
    await initializeRuntime();
    const coordinates = resolveCoordinates(rawCoordinates);
    const selected = resolveSelectedMuscle(rawSelectedMuscle);
    const realized = realizePoseData(coordinates);
    const state = makeState(requestId, 'static', coordinates, selected, realized);
    const started = performance.now();
    let result;
    try {
        result = calculateStaticHold(realized.reduction, state.muscles);
    } catch (error) {
        result = failedStaticResult(error, state.muscles, started);
    }
    state.staticHolding = buildStaticHolding(result, coordinates);
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
            result = await poseState(message.requestId, message.coordinates, message.selectedMuscle);
        } else if (message.action === 'staticHold') {
            result = await staticHoldState(message.requestId, message.coordinates, message.selectedMuscle);
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
