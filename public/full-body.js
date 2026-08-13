import * as THREE from '/vendor/three.module.min.js';
import loadMujoco from '/vendor/mujoco.js';

const $ = (selector) => document.querySelector(selector);
const ARM_MAGIC = 'MSHARM01';
const EXPECTED_MUJOCO_VERSION = '3.10.0';
const MIN_CAMERA_RADIUS = 0.12;
const MAX_CAMERA_RADIUS = 8;
const STATIC_SOLVE_DELAY_MS = 180;
const NEUTRAL_COLOR = new THREE.Color(0x87958f);
const SELECTED_NEUTRAL_COLOR = new THREE.Color(0x263b34);
const ACTIVATION_STOPS = [
    [0, new THREE.Color(0x2f78a7)],
    [0.25, new THREE.Color(0x36b6b0)],
    [0.5, new THREE.Color(0xe5c750)],
    [0.75, new THREE.Color(0xee853d)],
    [1, new THREE.Color(0xd53d35)]
];

const state = {
    metadata: null,
    mujoco: null,
    model: null,
    data: null,
    coordinateValues: {},
    coordinateInputs: new Map(),
    muscles: [],
    filteredMuscles: [],
    selected: null,
    armGroup: new THREE.Group(),
    contextGroup: new THREE.Group(),
    pathLines: null,
    selectedGroup: null,
    bodyMeshes: [],
    activationAvailable: false,
    solveState: 'loading',
    poseGeneration: 0,
    poseFrame: 0,
    solveTimer: 0,
    activePreset: 'neutral',
    yaw: Math.PI / 2,
    pitch: 0.025,
    radius: 1.7,
    target: new THREE.Vector3(0, 1.25, -0.2),
    initialTarget: new THREE.Vector3(0, 1.25, -0.2),
    initialRadius: 1.7
};

const host = $('#arm-scene');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('role', 'img');
renderer.domElement.setAttribute(
    'aria-label',
    'Interactive right-arm rendering of MS-Human-700. Drag or use arrow keys to rotate; scroll or use plus and minus to zoom.'
);
host.prepend(renderer.domElement);

const scene = new THREE.Scene();
const modelRoot = new THREE.Group();
// MuJoCo is Z-up. Rotate the complete model into Three.js Y-up coordinates.
modelRoot.rotation.x = -Math.PI / 2;
modelRoot.add(state.contextGroup, state.armGroup);
scene.add(modelRoot);
scene.add(new THREE.HemisphereLight(0xffffff, 0x55675f, 2.35));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.75);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xb9d9d0, 1.35);
fillLight.position.set(-4, 2, -3);
scene.add(fillLight);
const rimLight = new THREE.DirectionalLight(0xf4d5bc, 0.8);
rimLight.position.set(1, 2, -5);
scene.add(rimLight);

const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
let renderFrame = 0;
let dragging = false;
let lastPointer = { x: 0, y: 0 };
const activePointers = new Map();
let lastPinchDistance = 0;

function requestRender() {
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => {
        renderFrame = 0;
        renderer.render(scene, camera);
    });
}

function parseGeometry(buffer) {
    if (buffer.byteLength < 16) throw new Error('Right-arm geometry file is incomplete.');
    const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 8));
    if (magic !== ARM_MAGIC) throw new Error('Right-arm geometry has an unsupported format.');
    const header = new DataView(buffer, 8, 8);
    const vertexCount = header.getUint32(0, true);
    const indexCount = header.getUint32(4, true);
    const positionsOffset = 16;
    const indicesOffset = positionsOffset + vertexCount * 3 * 4;
    const expectedBytes = indicesOffset + indexCount * 4;
    if (expectedBytes !== buffer.byteLength) throw new Error('Right-arm geometry size does not match its header.');
    return {
        vertexCount,
        indexCount,
        positions: new Float32Array(buffer, positionsOffset, vertexCount * 3),
        indices: new Uint32Array(buffer, indicesOffset, indexCount)
    };
}

function activationColor(value) {
    const activation = THREE.MathUtils.clamp(value, 0, 1);
    for (let index = 1; index < ACTIVATION_STOPS.length; index += 1) {
        const [upperValue, upperColor] = ACTIVATION_STOPS[index];
        const [lowerValue, lowerColor] = ACTIVATION_STOPS[index - 1];
        if (activation <= upperValue) {
            const span = upperValue - lowerValue;
            return lowerColor.clone().lerp(upperColor, span ? (activation - lowerValue) / span : 0);
        }
    }
    return ACTIVATION_STOPS.at(-1)[1].clone();
}

function colorCss(color) {
    return `#${color.getHexString(THREE.SRGBColorSpace)}`;
}

function setBodyMatrix(mesh, bodyId) {
    const positionBase = bodyId * 3;
    const rotationBase = bodyId * 9;
    const p = state.data.xpos;
    const r = state.data.xmat;
    mesh.matrix.set(
        r[rotationBase], r[rotationBase + 1], r[rotationBase + 2], p[positionBase],
        r[rotationBase + 3], r[rotationBase + 4], r[rotationBase + 5], p[positionBase + 1],
        r[rotationBase + 6], r[rotationBase + 7], r[rotationBase + 8], p[positionBase + 2],
        0, 0, 0, 1
    );
    mesh.matrixWorldNeedsUpdate = true;
}

function buildBoneMeshes(geometryAsset) {
    const armMaterial = new THREE.MeshStandardMaterial({
        color: 0xdcc9ad,
        roughness: 0.78,
        metalness: 0,
        side: THREE.DoubleSide
    });
    const contextMaterial = new THREE.MeshStandardMaterial({
        color: 0x9ca9a3,
        roughness: 0.9,
        metalness: 0,
        transparent: true,
        opacity: 0.13,
        depthWrite: false,
        side: THREE.DoubleSide
    });

    for (const descriptor of state.metadata.geometry.geoms) {
        const positionStart = descriptor.vertexStart * 3;
        const positionEnd = positionStart + descriptor.vertexCount * 3;
        const indexStart = descriptor.indexStart;
        const indexEnd = indexStart + descriptor.indexCount;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(geometryAsset.positions.slice(positionStart, positionEnd), 3)
        );
        geometry.setIndex(new THREE.Uint32BufferAttribute(geometryAsset.indices.slice(indexStart, indexEnd), 1));
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(
            geometry,
            descriptor.role === 'arm' ? armMaterial : contextMaterial
        );
        mesh.name = descriptor.name;
        mesh.matrixAutoUpdate = false;
        mesh.userData.bodyId = descriptor.bodyId;
        mesh.userData.role = descriptor.role;
        setBodyMatrix(mesh, descriptor.bodyId);
        state.bodyMeshes.push(mesh);
        (descriptor.role === 'arm' ? state.armGroup : state.contextGroup).add(mesh);
    }
}

function updateBoneTransforms() {
    for (const mesh of state.bodyMeshes) setBodyMatrix(mesh, mesh.userData.bodyId);
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

function realizePose() {
    const { model, data, mujoco, metadata } = state;
    mujoco.mj_resetDataKeyframe(model, data, 0);
    data.qvel.fill(0);
    data.qacc.fill(0);
    data.ctrl.fill(0);
    data.act.fill(0);

    const independentColumns = new Map();
    for (const [column, coordinate] of metadata.coordinates.entries()) {
        const radians = THREE.MathUtils.degToRad(state.coordinateValues[coordinate.name]);
        data.qpos[coordinate.qposAddress] = radians;
        independentColumns.set(coordinate.jointId, column);
    }

    const equalityStride = model.eq_data.length / model.neq;
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
        for (let index = 0; index < 5; index += 1) {
            coefficients[index] = model.eq_data[equalityId * equalityStride + index];
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
    updateBoneTransforms();
    updateMusclePaths();
    renderPaths();
    renderSelected();
    requestRender();

    const reduction = metadata.coordinates.map((coordinate) => {
        const column = new Float64Array(model.nv);
        column[coordinate.dofAddress] = 1;
        return column;
    });
    for (const item of equalityDerivatives) {
        reduction[item.column][item.dependentDof] += item.derivative;
    }
    return reduction;
}

function updateMusclePaths() {
    const points = state.data.wrap_xpos;
    const objects = state.data.wrap_obj;
    for (const muscle of state.muscles) {
        const start = state.data.ten_wrapadr[muscle.tendonId];
        const count = state.data.ten_wrapnum[muscle.tendonId];
        const pathPoints = [];
        const pointKinds = [];
        const segments = [];
        const segmentInsideWrap = [];
        for (let pointIndex = 0; pointIndex < count; pointIndex += 1) {
            const absoluteIndex = start + pointIndex;
            const objectId = objects[absoluteIndex];
            if (objectId !== -2) {
                pathPoints.push([
                    points[absoluteIndex * 3],
                    points[absoluteIndex * 3 + 1],
                    points[absoluteIndex * 3 + 2]
                ]);
                pointKinds.push(objectId >= 0 ? 'wrap' : 'site');
            }
            if (pointIndex >= count - 1 || objectId === -2 || objects[absoluteIndex + 1] === -2) continue;
            segments.push([
                points[absoluteIndex * 3],
                points[absoluteIndex * 3 + 1],
                points[absoluteIndex * 3 + 2],
                points[(absoluteIndex + 1) * 3],
                points[(absoluteIndex + 1) * 3 + 1],
                points[(absoluteIndex + 1) * 3 + 2]
            ]);
            segmentInsideWrap.push(objectId >= 0 && objects[absoluteIndex + 1] >= 0);
        }
        muscle.points = pathPoints;
        muscle.pointKinds = pointKinds;
        muscle.segments = segments;
        muscle.segmentInsideWrap = segmentInsideWrap;
        muscle.lengthM = state.data.ten_length[muscle.tendonId];
    }
}

function pathIsVisible(muscle) {
    return muscle.group !== 'Long torso origin' || $('#show-long-origins').checked;
}

function renderPaths() {
    if (state.pathLines) {
        modelRoot.remove(state.pathLines);
        state.pathLines.geometry.dispose();
        state.pathLines.material.dispose();
        state.pathLines = null;
    }
    const positions = [];
    const colors = [];
    let visibleMuscles = 0;
    for (const muscle of state.muscles) {
        if (!pathIsVisible(muscle)) continue;
        visibleMuscles += 1;
        const color = state.activationAvailable ? activationColor(muscle.activation) : NEUTRAL_COLOR;
        for (const segment of muscle.segments) {
            positions.push(...segment);
            colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    state.pathLines = new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: state.activationAvailable ? 0.76 : 0.42,
            depthWrite: false
        })
    );
    state.pathLines.visible = $('#show-paths').checked;
    modelRoot.add(state.pathLines);
    $('#stat-visible').textContent = $('#show-paths').checked ? visibleMuscles : '0';
}

function addCylinder(group, segment, material, radius) {
    const from = new THREE.Vector3(segment[0], segment[1], segment[2]);
    const to = new THREE.Vector3(segment[3], segment[4], segment[5]);
    const direction = to.clone().sub(from);
    const length = direction.length();
    if (length < 1e-8) return;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8, 1), material);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    group.add(mesh);
}

function disposeGroup(group) {
    const geometries = new Set();
    const materials = new Set();
    group.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        if (Array.isArray(object.material)) object.material.forEach((material) => materials.add(material));
        else if (object.material) materials.add(object.material);
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
}

function renderSelected() {
    if (state.selectedGroup) {
        modelRoot.remove(state.selectedGroup);
        disposeGroup(state.selectedGroup);
        state.selectedGroup = null;
    }
    const muscle = state.selected;
    if (!muscle?.segments?.length) {
        updateInspector();
        return;
    }
    const group = new THREE.Group();
    const color = state.activationAvailable ? activationColor(muscle.activation) : SELECTED_NEUTRAL_COLOR;
    const pathMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0 });
    for (const [index, segment] of muscle.segments.entries()) {
        addCylinder(group, segment, pathMaterial, muscle.segmentInsideWrap[index] ? 0.0017 : 0.0031);
    }
    const endpointMaterial = new THREE.MeshStandardMaterial({ color: 0x18241f, roughness: 0.65 });
    const siteMaterial = new THREE.MeshStandardMaterial({ color: 0xf8faf9, roughness: 0.75 });
    const wrapMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.65 });
    for (const [index, point] of muscle.points.entries()) {
        const endpoint = index === 0 || index === muscle.points.length - 1;
        const wrap = muscle.pointKinds[index] === 'wrap';
        const marker = new THREE.Mesh(
            new THREE.SphereGeometry(endpoint ? 0.0065 : wrap ? 0.0032 : 0.0044, 11, 8),
            endpoint ? endpointMaterial : wrap ? wrapMaterial : siteMaterial
        );
        marker.position.set(...point);
        group.add(marker);
    }
    group.visible = $('#show-paths').checked;
    state.selectedGroup = group;
    modelRoot.add(group);
    updateInspector();
    requestRender();
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
            for (let row = 0; row < rows; row += 1) adjusted[row] -= matrix[row][variable] * solution[variable];
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
            if (solution[variable] < lower[variable] - 1e-10 && lower[variable] - solution[variable] > largestViolation) {
                largestViolation = lower[variable] - solution[variable];
                violatingVariable = variable;
                violatingBound = lower[variable];
            } else if (solution[variable] > upper[variable] + 1e-10 && solution[variable] - upper[variable] > largestViolation) {
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
            for (let row = 0; row < rows; row += 1) gradient -= matrix[row][variable] * multiplier[row];
            if (Math.abs(solution[variable] - lower[variable]) < 1e-10 && gradient < -1e-9 && -gradient > releaseStrength) {
                releaseStrength = -gradient;
                releaseVariable = variable;
            } else if (Math.abs(solution[variable] - upper[variable]) < 1e-10 && gradient > 1e-9 && gradient > releaseStrength) {
                releaseStrength = gradient;
                releaseVariable = variable;
            }
        }
        if (releaseVariable >= 0) {
            fixed[releaseVariable] = 0;
            continue;
        }
        return solution;
    }
    throw new Error('Bounded static equilibrium did not converge.');
}

function calculateStaticHold(reduction) {
    const started = performance.now();
    const { model, data, mujoco, metadata, muscles } = state;
    const coordinateCount = metadata.coordinates.length;
    const muscleCount = muscles.length;
    const baselineActuatorGeneralized = Float64Array.from(data.qfrc_actuator);
    const baselineActuatorForce = Float64Array.from(data.actuator_force);
    const baselineFull = new Float64Array(model.nv);
    for (let dof = 0; dof < model.nv; dof += 1) {
        baselineFull[dof] = data.qfrc_actuator[dof] + data.qfrc_passive[dof] - data.qfrc_bias[dof];
    }
    const baseline = reduction.map((column) => effectiveForce(column, baselineFull));
    const columns = Array.from({ length: coordinateCount }, () => new Float64Array(muscleCount));
    const activeForceCapacity = new Float64Array(muscleCount);

    for (const [muscleIndex, muscle] of muscles.entries()) {
        const activationAddress = model.actuator_actadr[muscle.actuatorId];
        if (activationAddress < 0) throw new Error(`Muscle ${muscle.name} has no activation state.`);
        data.act[activationAddress] = 1;
        mujoco.mj_forward(model, data);
        for (let coordinate = 0; coordinate < coordinateCount; coordinate += 1) {
            let torque = 0;
            for (let dof = 0; dof < model.nv; dof += 1) {
                torque += reduction[coordinate][dof] * (data.qfrc_actuator[dof] - baselineActuatorGeneralized[dof]);
            }
            columns[coordinate][muscleIndex] = torque;
        }
        activeForceCapacity[muscleIndex] = data.actuator_force[muscle.actuatorId] - baselineActuatorForce[muscle.actuatorId];
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
    weights.fill(metadata.staticHold.reserveObjectiveWeightPerNm2, muscleCount);
    lower.fill(0, 0, muscleCount);
    upper.fill(1, 0, muscleCount);
    lower.fill(Number.NEGATIVE_INFINITY, muscleCount);
    upper.fill(Number.POSITIVE_INFINITY, muscleCount);
    const solution = solveBoundedMinimumNorm(
        solveMatrix,
        Float64Array.from(baseline, (value) => -value),
        weights,
        lower,
        upper
    );
    const activations = solution.slice(0, muscleCount);
    const reserves = solution.slice(muscleCount);

    // Replay the result through MuJoCo rather than accepting the affine solve
    // alone.  This is the value used by the user-facing quality gate.
    data.act.fill(0);
    for (const [index, muscle] of muscles.entries()) {
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
    const musclesAtCapacity = [...activations].filter((value) => value >= metadata.staticHold.capacityActivation).length;
    const finite = [...activations, ...reserves, ...residuals, ...activeForceCapacity]
        .every((value) => Number.isFinite(value));
    const pathsValid = muscles.every((muscle) =>
        Number.isFinite(muscle.lengthM)
        && muscle.lengthM > 0
        && muscle.points.length >= 2
        && muscle.segments.length >= 1
        && muscle.points.every((point) => point.every((value) => Number.isFinite(value)))
        && muscle.segments.every((segment) => segment.every((value) => Number.isFinite(value)))
    );
    const capacityLimited = musclesAtCapacity > 0 && maxReserveNm > metadata.staticHold.capacityReserveNm;
    const usable = finite
        && pathsValid
        && maxResidualNm <= metadata.staticHold.maximumResidualNm
        && maxReserveNm <= metadata.staticHold.maximumReserveNm
        && !capacityLimited;

    data.act.fill(0);
    mujoco.mj_forward(model, data);
    return {
        usable,
        finite,
        pathsValid,
        activations,
        activeForceCapacity,
        passiveForces: baselineActuatorForce,
        reserves,
        residuals,
        maxResidualNm,
        maxReserveNm,
        musclesAtCapacity,
        capacityLimited,
        durationMilliseconds: performance.now() - started
    };
}

function clearActivations() {
    state.activationAvailable = false;
    for (const muscle of state.muscles) {
        muscle.activation = null;
        muscle.activeForceN = null;
        muscle.passiveForceN = null;
    }
}

function setSolverStatus(kind, label, title, detail) {
    state.solveState = kind;
    const status = $('#solver-status');
    status.className = `solver-status is-${kind}`;
    status.querySelector('span').textContent = label;
    $('#solver-readout-title').textContent = title;
    $('#solver-readout-detail').textContent = detail;
    const summary = $('.summary-status');
    summary.className = `summary-status is-${kind}`;
    $('#stat-balance').textContent = kind === 'ready'
        ? 'Balanced'
        : kind === 'unavailable' || kind === 'error'
            ? 'Unavailable'
            : kind === 'solving'
                ? 'Solving'
                : 'Loading';
}

function scheduleStaticSolve(delay = STATIC_SOLVE_DELAY_MS) {
    window.clearTimeout(state.solveTimer);
    const generation = state.poseGeneration;
    state.solveTimer = window.setTimeout(() => {
        if (generation !== state.poseGeneration) return;
        setSolverStatus(
            'solving',
            'Solving static hold',
            'Balancing model self-weight',
            'Activation stays gray until equilibrium, reserve, and capacity checks pass.'
        );
        requestRender();
        window.setTimeout(() => runStaticSolve(generation), 16);
    }, delay);
}

function runStaticSolve(generation) {
    if (generation !== state.poseGeneration) return;
    try {
        const reduction = realizePose();
        const result = calculateStaticHold(reduction);
        if (generation !== state.poseGeneration) return;
        $('#solver-residual').textContent = `${result.maxResidualNm.toExponential(2)} N·m`;
        $('#solver-reserve').textContent = result.maxReserveNm < 0.001
            ? `${result.maxReserveNm.toExponential(2)} N·m`
            : `${result.maxReserveNm.toFixed(4)} N·m`;
        $('#solver-time').textContent = `${result.durationMilliseconds.toFixed(0)} ms`;
        if (result.usable) {
            state.activationAvailable = true;
            for (const [index, muscle] of state.muscles.entries()) {
                muscle.activation = result.activations[index];
                muscle.activeForceN = Math.abs(result.activations[index] * result.activeForceCapacity[index]);
                muscle.passiveForceN = Math.abs(result.passiveForces[muscle.actuatorId]);
            }
            setSolverStatus(
                'ready',
                'Static balance passed',
                'Activation available for this posture',
                `${state.muscles.length} muscles replayed within the numerical and reserve limits.`
            );
            $('#legend-state').textContent = 'Color is estimated static activation from 0 to 100%.';
        } else {
            clearActivations();
            const reason = !result.finite
                ? 'The solve produced a non-finite value.'
                : !result.pathsValid
                    ? 'One or more compiled muscle paths was incomplete or non-finite.'
                : result.maxResidualNm > state.metadata.staticHold.maximumResidualNm
                    ? 'The replayed equilibrium residual exceeded the numerical limit.'
                    : result.maxReserveNm > state.metadata.staticHold.maximumReserveNm
                        ? `The model needed ${result.maxReserveNm.toFixed(3)} N·m of reserve torque, above the 0.05 N·m display limit.`
                        : 'One or more muscles reached capacity while reserve torque was still required.';
            setSolverStatus(
                'unavailable',
                'Static balance unavailable',
                'Activation withheld for this posture',
                reason
            );
            $('#legend-state').textContent = 'Gray: this posture did not pass the static balance checks.';
        }
        renderPaths();
        renderSelected();
        renderList();
        requestRender();
    } catch (error) {
        clearActivations();
        setSolverStatus(
            'error',
            'Static solve failed',
            'Activation unavailable',
            error.message
        );
        $('#solver-residual').textContent = '—';
        $('#solver-reserve').textContent = '—';
        $('#solver-time').textContent = '—';
        renderPaths();
        renderSelected();
        renderList();
        console.error(error);
    }
}

function queuePoseUpdate(solveDelay = STATIC_SOLVE_DELAY_MS) {
    state.poseGeneration += 1;
    clearActivations();
    setSolverStatus(
        'solving',
        'Pose changed',
        'Geometry updated; activation pending',
        'Waiting for the posture controls to settle before solving static balance.'
    );
    $('#solver-residual').textContent = '—';
    $('#solver-reserve').textContent = '—';
    $('#solver-time').textContent = '—';
    $('#legend-state').textContent = 'Gray until the static balance checks pass.';
    if (!state.poseFrame) {
        state.poseFrame = requestAnimationFrame(() => {
            state.poseFrame = 0;
            try {
                realizePose();
                renderList();
            } catch (error) {
                showFatalError(error);
            }
        });
    }
    scheduleStaticSolve(solveDelay);
}

function formatDegrees(value) {
    const rounded = Math.abs(value) < 0.05 ? 0 : value;
    return `${rounded.toFixed(Math.abs(rounded % 1) > 0.01 ? 1 : 0)}°`;
}

function createCoordinateControls() {
    const fragment = document.createDocumentFragment();
    for (const coordinate of state.metadata.coordinates) {
        state.coordinateValues[coordinate.name] = coordinate.defaultDegrees;
        const wrapper = document.createElement('div');
        wrapper.className = 'coordinate-control';
        const label = document.createElement('label');
        label.className = 'coordinate-label';
        const text = document.createElement('span');
        text.textContent = coordinate.label;
        const output = document.createElement('output');
        output.textContent = formatDegrees(coordinate.defaultDegrees);
        label.append(text, output);
        const input = document.createElement('input');
        input.type = 'range';
        input.min = coordinate.minimumDegrees;
        input.max = coordinate.maximumDegrees;
        // `any` keeps authored range endpoints while allowing an exact neutral
        // zero.  A numeric step anchored at an asymmetric minimum silently
        // snaps zero to an offset value in HTML range controls.
        input.step = 'any';
        input.value = coordinate.defaultDegrees;
        input.disabled = true;
        input.setAttribute('aria-label', `${coordinate.label} in degrees`);
        label.htmlFor = `coordinate-${coordinate.name}`;
        input.id = `coordinate-${coordinate.name}`;
        const limits = document.createElement('div');
        limits.className = 'range-limits';
        limits.innerHTML = `<span>${formatDegrees(coordinate.minimumDegrees)}</span><span>${formatDegrees(coordinate.maximumDegrees)}</span>`;
        input.addEventListener('input', () => {
            const value = Number(input.value);
            state.coordinateValues[coordinate.name] = value;
            output.textContent = formatDegrees(value);
            state.activePreset = null;
            updatePresetButtons();
            queuePoseUpdate();
        });
        input.addEventListener('change', () => scheduleStaticSolve(25));
        wrapper.append(label, input, limits);
        fragment.appendChild(wrapper);
        state.coordinateInputs.set(coordinate.name, { input, output });
    }
    $('#coordinate-controls').replaceChildren(fragment);
}

function createPresetButtons() {
    const fragment = document.createDocumentFragment();
    for (const preset of state.metadata.presets) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.preset = preset.id;
        button.textContent = preset.label;
        button.title = preset.description;
        button.disabled = true;
        button.addEventListener('click', () => applyPreset(preset));
        fragment.appendChild(button);
    }
    $('#preset-buttons').replaceChildren(fragment);
    updatePresetButtons();
}

function updatePresetButtons() {
    document.querySelectorAll('[data-preset]').forEach((button) => {
        const active = button.dataset.preset === state.activePreset;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function applyPreset(preset) {
    state.activePreset = preset.id;
    for (const coordinate of state.metadata.coordinates) {
        const value = preset.coordinates[coordinate.name] ?? coordinate.defaultDegrees;
        state.coordinateValues[coordinate.name] = value;
        const controls = state.coordinateInputs.get(coordinate.name);
        controls.input.value = value;
        controls.output.textContent = formatDegrees(value);
    }
    updatePresetButtons();
    queuePoseUpdate(25);
}

function resetPose() {
    applyPreset(state.metadata.presets.find((preset) => preset.id === 'neutral'));
}

function updateInspector() {
    const muscle = state.selected;
    if (!muscle) return;
    $('#selected-muscle-title').textContent = muscle.name;
    $('#selected-group').textContent = muscle.group;
    $('#selected-activation').textContent = state.activationAvailable
        ? `${(muscle.activation * 100).toFixed(1)}%`
        : state.solveState === 'unavailable' || state.solveState === 'error'
            ? 'Unavailable'
            : 'Pending';
    $('#selected-force').textContent = state.activationAvailable
        ? `${muscle.activeForceN.toFixed(1)} N`
        : '—';
    $('#selected-length').textContent = Number.isFinite(muscle.lengthM)
        ? `${(muscle.lengthM * 100).toFixed(2)} cm`
        : '—';
    $('#selected-points').textContent = muscle.points?.length ?? '—';
}

function selectMuscle(muscle, scrollIntoView = true) {
    state.selected = muscle;
    renderSelected();
    document.querySelectorAll('.muscle-row').forEach((row) => {
        const active = Number(row.dataset.actuatorId) === muscle.actuatorId;
        row.classList.toggle('active', active);
        row.setAttribute('aria-selected', active ? 'true' : 'false');
        row.tabIndex = active ? 0 : -1;
    });
    const activeRow = document.querySelector(`.muscle-row[data-actuator-id="${muscle.actuatorId}"]`);
    if (scrollIntoView && activeRow) activeRow.scrollIntoView({ block: 'nearest' });
    $('#focus-selected-path').disabled = !muscle.points?.length;
}

function renderList() {
    if (!state.metadata) return;
    const query = $('#muscle-search').value.trim().toLowerCase();
    const group = $('#muscle-group').value;
    state.filteredMuscles = state.muscles
        .filter((muscle) => (!group || muscle.group === group) && (!query || muscle.name.toLowerCase().includes(query)))
        .sort((left, right) => state.activationAvailable
            ? right.activation - left.activation || left.name.localeCompare(right.name)
            : left.actuatorId - right.actuatorId);
    $('#result-count').textContent = `${state.filteredMuscles.length} of ${state.muscles.length} solved muscles`;
    const selectedVisible = state.filteredMuscles.some((muscle) => muscle === state.selected);
    const fragment = document.createDocumentFragment();
    for (const [index, muscle] of state.filteredMuscles.entries()) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `muscle-row${muscle === state.selected ? ' active' : ''}`;
        button.dataset.actuatorId = muscle.actuatorId;
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', muscle === state.selected ? 'true' : 'false');
        button.tabIndex = muscle === state.selected || (!selectedVisible && index === 0) ? 0 : -1;
        const color = state.activationAvailable ? activationColor(muscle.activation) : NEUTRAL_COLOR;
        button.style.setProperty('--muscle-color', colorCss(color));
        button.style.setProperty('--activation-width', state.activationAvailable ? `${muscle.activation * 100}%` : '0%');
        const dot = document.createElement('i');
        dot.className = 'activation-dot';
        dot.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.className = 'muscle-name';
        name.textContent = muscle.name;
        const value = document.createElement('output');
        value.textContent = state.activationAvailable ? `${(muscle.activation * 100).toFixed(1)}%` : '—';
        const groupLabel = document.createElement('span');
        groupLabel.className = 'muscle-group-label';
        groupLabel.textContent = muscle.group;
        const track = document.createElement('span');
        track.className = 'mini-track';
        track.appendChild(document.createElement('i'));
        button.append(dot, name, value, groupLabel, track);
        button.addEventListener('click', () => selectMuscle(muscle, false));
        fragment.appendChild(button);
    }
    $('#muscle-list').replaceChildren(fragment);
    updateInspector();
}

function rawPointToView(point) {
    return new THREE.Vector3(point[0], point[2], -point[1]);
}

function updateCamera() {
    const cosPitch = Math.cos(state.pitch);
    camera.position.set(
        state.target.x + state.radius * Math.sin(state.yaw) * cosPitch,
        state.target.y + state.radius * Math.sin(state.pitch),
        state.target.z + state.radius * Math.cos(state.yaw) * cosPitch
    );
    camera.lookAt(state.target);
    requestRender();
}

function fitView(bounds) {
    const minimum = new THREE.Vector3(...bounds.min);
    const maximum = new THREE.Vector3(...bounds.max);
    const size = maximum.clone().sub(minimum);
    state.target.copy(minimum).add(maximum).multiplyScalar(0.5);
    state.initialTarget.copy(state.target);
    const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const verticalRadius = size.y / (2 * Math.tan(halfFov));
    const horizontalRadius = size.z / (2 * Math.tan(halfFov) * Math.max(camera.aspect, 0.5));
    state.radius = THREE.MathUtils.clamp(Math.max(verticalRadius, horizontalRadius) * 1.18, 0.6, MAX_CAMERA_RADIUS);
    state.initialRadius = state.radius;
    state.yaw = Math.PI / 2;
    state.pitch = 0.025;
    updateCamera();
}

function resetView() {
    state.yaw = Math.PI / 2;
    state.pitch = 0.025;
    state.radius = state.initialRadius;
    state.target.copy(state.initialTarget);
    updateCamera();
}

function focusSelectedPath() {
    if (!state.selected?.points?.length) return;
    const bounds = new THREE.Box3().setFromPoints(state.selected.points.map(rawPointToView));
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
    state.target.copy(sphere.center);
    state.radius = THREE.MathUtils.clamp(
        Math.max(sphere.radius / Math.sin(halfFov) * 1.35, 0.22),
        MIN_CAMERA_RADIUS,
        state.initialRadius
    );
    updateCamera();
}

function resize() {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestRender();
}

function showFatalError(error) {
    window.clearTimeout(state.solveTimer);
    $('#arm-loading').classList.add('hidden');
    $('#arm-error').textContent = `The right-arm prototype could not load. ${error.message}`;
    $('#arm-error').classList.remove('hidden');
    setSolverStatus('error', 'Model unavailable', 'Right-arm runtime failed', error.message);
    console.error(error);
}

renderer.domElement.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    renderer.domElement.focus({ preventScroll: true });
    dragging = true;
    lastPointer = { x: event.clientX, y: event.clientY };
    activePointers.set(event.pointerId, lastPointer);
    renderer.domElement.setPointerCapture(event.pointerId);
});

renderer.domElement.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size >= 2) {
        const [first, second] = [...activePointers.values()];
        const distance = Math.hypot(second.x - first.x, second.y - first.y);
        if (lastPinchDistance > 0) {
            state.radius = THREE.MathUtils.clamp(
                state.radius * (lastPinchDistance / Math.max(distance, 1)),
                MIN_CAMERA_RADIUS,
                MAX_CAMERA_RADIUS
            );
            updateCamera();
        }
        lastPinchDistance = distance;
        return;
    }
    lastPinchDistance = 0;
    state.yaw -= (event.clientX - lastPointer.x) * 0.008;
    state.pitch = THREE.MathUtils.clamp(state.pitch + (event.clientY - lastPointer.y) * 0.006, -1.25, 1.25);
    lastPointer = { x: event.clientX, y: event.clientY };
    updateCamera();
});

function finishPointer(event) {
    activePointers.delete(event.pointerId);
    dragging = activePointers.size > 0;
    lastPinchDistance = 0;
    if (activePointers.size === 1) lastPointer = [...activePointers.values()][0];
}

renderer.domElement.addEventListener('pointerup', finishPointer);
renderer.domElement.addEventListener('pointercancel', finishPointer);
renderer.domElement.addEventListener('wheel', (event) => {
    event.preventDefault();
    state.radius = THREE.MathUtils.clamp(state.radius * Math.exp(event.deltaY * 0.001), MIN_CAMERA_RADIUS, MAX_CAMERA_RADIUS);
    updateCamera();
}, { passive: false });

renderer.domElement.addEventListener('keydown', (event) => {
    const step = 0.12;
    if (event.key === 'ArrowLeft') state.yaw += step;
    else if (event.key === 'ArrowRight') state.yaw -= step;
    else if (event.key === 'ArrowUp') state.pitch = THREE.MathUtils.clamp(state.pitch - step, -1.25, 1.25);
    else if (event.key === 'ArrowDown') state.pitch = THREE.MathUtils.clamp(state.pitch + step, -1.25, 1.25);
    else if (event.key === '+' || event.key === '=') state.radius = THREE.MathUtils.clamp(state.radius / 1.12, MIN_CAMERA_RADIUS, MAX_CAMERA_RADIUS);
    else if (event.key === '-' || event.key === '_') state.radius = THREE.MathUtils.clamp(state.radius * 1.12, MIN_CAMERA_RADIUS, MAX_CAMERA_RADIUS);
    else if (event.key === 'Home') {
        event.preventDefault();
        resetView();
        return;
    } else return;
    event.preventDefault();
    updateCamera();
});

$('#muscle-list').addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const rows = [...document.querySelectorAll('.muscle-row')];
    if (!rows.length) return;
    const current = Math.max(0, rows.indexOf(document.activeElement));
    const next = event.key === 'Home'
        ? 0
        : event.key === 'End'
            ? rows.length - 1
            : THREE.MathUtils.clamp(current + (event.key === 'ArrowDown' ? 1 : -1), 0, rows.length - 1);
    event.preventDefault();
    const row = rows[next];
    const muscle = state.muscles.find((candidate) => candidate.actuatorId === Number(row.dataset.actuatorId));
    if (muscle) selectMuscle(muscle, false);
    row.focus();
});

$('#muscle-search').addEventListener('input', renderList);
$('#muscle-group').addEventListener('change', renderList);
$('#show-geometry').addEventListener('change', (event) => {
    state.armGroup.visible = event.target.checked;
    requestRender();
});
$('#show-context').addEventListener('change', (event) => {
    state.contextGroup.visible = event.target.checked;
    requestRender();
});
$('#show-paths').addEventListener('change', (event) => {
    if (state.pathLines) state.pathLines.visible = event.target.checked;
    if (state.selectedGroup) state.selectedGroup.visible = event.target.checked;
    $('#stat-visible').textContent = event.target.checked
        ? state.muscles.filter(pathIsVisible).length
        : '0';
    requestRender();
});
$('#show-long-origins').addEventListener('change', () => {
    renderPaths();
    renderSelected();
});
$('#focus-selected-path').addEventListener('click', focusSelectedPath);
$('#reset-arm-view').addEventListener('click', resetView);
$('#reset-arm-pose').addEventListener('click', resetPose);
$('#zoom-arm-in').addEventListener('click', () => {
    state.radius = THREE.MathUtils.clamp(state.radius / 1.2, MIN_CAMERA_RADIUS, MAX_CAMERA_RADIUS);
    updateCamera();
});
$('#zoom-arm-out').addEventListener('click', () => {
    state.radius = THREE.MathUtils.clamp(state.radius * 1.2, MIN_CAMERA_RADIUS, MAX_CAMERA_RADIUS);
    updateCamera();
});

new ResizeObserver(resize).observe(host);
resize();

async function initialize() {
    try {
        const modulePromise = loadMujoco({
            locateFile: (path) => path.endsWith('.wasm') ? '/vendor/mujoco.wasm' : `/vendor/${path}`
        });
        const [metadataResponse, geometryResponse, runtimeResponse, mujoco] = await Promise.all([
            fetch('/models/ms_human_700/right-arm.json'),
            fetch('/models/ms_human_700/right-arm.meshbin'),
            fetch('/models/ms_human_700/right-arm-runtime.mjb'),
            modulePromise
        ]);
        if (!metadataResponse.ok) throw new Error(`Metadata request failed (${metadataResponse.status}).`);
        if (!geometryResponse.ok) throw new Error(`Geometry request failed (${geometryResponse.status}).`);
        if (!runtimeResponse.ok) throw new Error(`Runtime model request failed (${runtimeResponse.status}).`);
        state.metadata = await metadataResponse.json();
        const geometryAsset = parseGeometry(await geometryResponse.arrayBuffer());
        const runtimeBytes = new Uint8Array(await runtimeResponse.arrayBuffer());
        if (mujoco.mj_versionString() !== EXPECTED_MUJOCO_VERSION) {
            throw new Error(`Expected MuJoCo ${EXPECTED_MUJOCO_VERSION}; loaded ${mujoco.mj_versionString()}.`);
        }
        const virtualFileSystem = new mujoco.MjVFS();
        virtualFileSystem.addBuffer('right-arm-runtime.mjb', runtimeBytes);
        const model = mujoco.MjModel.from_binary_path('right-arm-runtime.mjb', virtualFileSystem);
        const data = new mujoco.MjData(model);
        virtualFileSystem.delete();
        state.mujoco = mujoco;
        state.model = model;
        state.data = data;
        if (model.nu !== state.metadata.model.totalMuscles || state.metadata.muscles.length !== 88) {
            throw new Error('The runtime and right-arm metadata inventories do not match.');
        }
        for (const descriptor of state.metadata.geometry.geoms) {
            const runtimeBodyName = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY.value, descriptor.bodyId);
            if (runtimeBodyName !== descriptor.body) {
                throw new Error(`Body mapping changed for ${descriptor.body}.`);
            }
        }
        state.muscles = state.metadata.muscles.map((muscle) => ({
            ...muscle,
            activation: null,
            activeForceN: null,
            passiveForceN: null,
            points: [],
            pointKinds: [],
            segments: [],
            segmentInsideWrap: [],
            lengthM: Number.NaN
        }));
        createCoordinateControls();
        createPresetButtons();
        mujoco.mj_resetDataKeyframe(model, data, 0);
        mujoco.mj_forward(model, data);
        buildBoneMeshes(geometryAsset);
        realizePose();
        state.selected = state.muscles.find((muscle) => muscle.name === 'DELT1_r') || state.muscles[0];
        renderList();
        selectMuscle(state.selected, false);
        fitView(state.metadata.geometry.fitBounds);

        $('#stat-muscles').textContent = state.metadata.model.functionalMuscles;
        $('#stat-coordinates').textContent = state.metadata.model.independentCoordinates;
        $('#stat-arm-geoms').textContent = state.metadata.geometry.geoms.filter((geom) => geom.role === 'arm').length;
        document.querySelectorAll(
            '#coordinate-controls input, #preset-buttons button, #reset-arm-pose, #muscle-search, #muscle-group, #show-geometry, #show-context, #show-paths, #show-long-origins, #zoom-arm-out, #zoom-arm-in, #reset-arm-view'
        ).forEach((control) => { control.disabled = false; });
        $('#focus-selected-path').disabled = false;
        $('#arm-loading').classList.add('hidden');
        setSolverStatus(
            'solving',
            'Solving initial posture',
            'Exact arm model ready',
            'Checking whether the default posture can be held against gravity.'
        );
        scheduleStaticSolve(25);
    } catch (error) {
        showFatalError(error);
    }
}

window.addEventListener('beforeunload', () => {
    if (state.data) state.data.delete();
    if (state.model) state.model.delete();
});

initialize();
