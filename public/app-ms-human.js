import * as THREE from './vendor/three.module.min.js';
import { createMsHumanEngine, StaleRequestError } from './ms-human-engine.js';
import { createDiagnosisWorkflow } from './diagnosis.js';

const GEOMETRY_URL = new URL('./models/ms_human_700/right-arm.meshbin', import.meta.url);

const $ = (selector) => document.querySelector(selector);
const CANONICAL_KEYS = [
    'elv_angle', 'shoulder_elv', 'shoulder_rot', 'elbow_flexion',
    'pro_sup', 'deviation', 'flexion'
];
const MS_HUMAN_ROTATION_SIGN = Object.freeze({
    shoulderExternal: -1,
    shoulderInternal: 1,
    forearmSupination: -1,
    forearmPronation: 1
});
const ACTIVATION_STOPS = [
    [0, new THREE.Color(0x2f78a7)],
    [0.25, new THREE.Color(0x36b6b0)],
    [0.5, new THREE.Color(0xe5c750)],
    [0.75, new THREE.Color(0xee853d)],
    [1, new THREE.Color(0xd53d35)]
];
const NEUTRAL_COLOR = new THREE.Color(0x7f8f89);
const SELECTED_COLOR = new THREE.Color(0x9d352f);
const MIN_CAMERA_RADIUS = 0.12;
const MAX_CAMERA_RADIUS = 8;
const POSE_DELAY_MS = 45;
const SOLVE_DELAY_MS = 280;
const CONTROL_STEP_DEGREES = 0.1;

const POSE_PRESETS = {
    'arm-side': {},
    'forward-reach': { elv_angle: 90, shoulder_elv: 45, elbow_flexion: 30 },
    'hand-to-mouth': { elv_angle: 90, shoulder_elv: 35, elbow_flexion: 120, pro_sup: MS_HUMAN_ROTATION_SIGN.forearmSupination * 45 },
    'cross-body-reach': { elv_angle: 120, shoulder_elv: 90, elbow_flexion: 30 },
    'hand-behind-head': { elv_angle: 30, shoulder_elv: 120, shoulder_rot: MS_HUMAN_ROTATION_SIGN.shoulderExternal * 35, elbow_flexion: 120 },
    'high-forward-reach': { elv_angle: 90, shoulder_elv: 110 },
    'flexion-90': { elv_angle: 90, shoulder_elv: 90 },
    'abduction-90': { shoulder_elv: 90 },
    'scaption-90': { elv_angle: 30, shoulder_elv: 90 },
    'external-side': { shoulder_rot: MS_HUMAN_ROTATION_SIGN.shoulderExternal * 35, elbow_flexion: 90 },
    'internal-side': { shoulder_rot: MS_HUMAN_ROTATION_SIGN.shoulderInternal * 45, elbow_flexion: 90 },
    'rotation-90-90': { shoulder_elv: 90, shoulder_rot: MS_HUMAN_ROTATION_SIGN.shoulderExternal * 35, elbow_flexion: 90 },
    'scaption-ir': { elv_angle: 30, shoulder_elv: 90, shoulder_rot: MS_HUMAN_ROTATION_SIGN.shoulderInternal * 45 },
    'elbow-90': { elbow_flexion: 90 },
    'elbow-120': { elbow_flexion: 120 },
    'elbow-supinated': { elbow_flexion: 90, pro_sup: MS_HUMAN_ROTATION_SIGN.forearmSupination * 60 },
    'forearm-pronated': { elbow_flexion: 90, pro_sup: MS_HUMAN_ROTATION_SIGN.forearmPronation * 60 },
    'wrist-extension-30': { elbow_flexion: 90, flexion: -30 },
    'wrist-flexion-30': { elbow_flexion: 90, flexion: 30 },
    'wrist-deviation-positive': { elbow_flexion: 90, deviation: 20 },
    'wrist-deviation-negative': { elbow_flexion: 90, deviation: -9.7 }
};

const app = {
    engine: createMsHumanEngine({ onFatalError: handleFatalEngineError }),
    metadata: null,
    model: null,
    state: null,
    coordinates: {},
    selectedMuscle: 'DELT1_r',
    pathView: 'all',
    activationPanelVisible: true,
    activationRankingExpanded: false,
    musclePanelVisible: false,
    presetLibraryVisible: false,
    mirrored: false,
    showContext: true,
    showLongOrigins: false,
    bodyMeshes: [],
    armGroup: new THREE.Group(),
    contextGroup: new THREE.Group(),
    pathGroup: new THREE.Group(),
    selectedGroup: new THREE.Group(),
    poseTimer: 0,
    solveTimer: 0,
    poseGeneration: 0,
    solveGeneration: 0,
    diagnosisViewerSnapshot: null,
    diagnosis: null,
    cameraFitted: false
};

const sceneHost = $('#scene');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0xe8ece9, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('role', 'application');
renderer.domElement.setAttribute('aria-label', 'Interactive right-arm rendering of MS-Human-700. Drag or use arrow keys to rotate; scroll or use plus and minus to zoom.');
sceneHost.append(renderer.domElement);

const scene = new THREE.Scene();
const displayRoot = new THREE.Group();
const modelRoot = new THREE.Group();
modelRoot.rotation.x = -Math.PI / 2;
modelRoot.add(app.contextGroup, app.armGroup, app.pathGroup, app.selectedGroup);
displayRoot.add(modelRoot);
scene.add(displayRoot);
scene.add(new THREE.HemisphereLight(0xffffff, 0x64706b, 2.35));
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.75);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xb9d9d0, 1.25);
fillLight.position.set(-4, 2, -3);
scene.add(fillLight);

const grid = new THREE.GridHelper(2.4, 24, 0xb7bfbb, 0xd6dad7);
grid.material.transparent = true;
grid.material.opacity = 0.45;
scene.add(grid);

const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
const cameraState = {
    yaw: Math.PI / 2,
    pitch: 0.025,
    radius: 1.7,
    initialRadius: 1.7,
    target: new THREE.Vector3(0, 1.25, -0.2),
    initialTarget: new THREE.Vector3(0, 1.25, -0.2)
};

const boneMaterial = new THREE.MeshStandardMaterial({ color: 0xd9d0bf, roughness: 0.78, metalness: 0, side: THREE.DoubleSide });
const contextMaterial = new THREE.MeshStandardMaterial({ color: 0x8f9d97, roughness: 0.9, metalness: 0, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide });
const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false);
const markerSphere = new THREE.SphereGeometry(1, 10, 7);
const axisY = new THREE.Vector3(0, 1, 0);
const scratchStart = new THREE.Vector3();
const scratchEnd = new THREE.Vector3();
const scratchDirection = new THREE.Vector3();
let diagnosisViewerSnapshot = null;
let viewerExporting = false;
let renderFrame = 0;

function setText(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value;
}

function showError(message) {
    const element = $('#error');
    element.textContent = message;
    element.classList.remove('hidden');
}

function clearError() {
    $('#error').classList.add('hidden');
}

function handleFatalEngineError(error) {
    window.clearTimeout(app.poseTimer);
    window.clearTimeout(app.solveTimer);
    app.poseGeneration += 1;
    app.solveGeneration += 1;
    $('#server-status').className = 'server-status offline';
    $('#server-status span:last-child').textContent = 'Model unavailable';
    app.diagnosis?.setReady(false);
    neutralizeDisplayedActivation();
    setPositionStatus(
        'unavailable',
        'Model unavailable',
        'The model worker stopped unexpectedly. Reload the page to start a fresh model session.'
    );
    $('#calculate-static').disabled = true;
    showError(`The model stopped unexpectedly: ${error?.message || 'Unknown calculation failure.'} Reload the page to continue.`);
}

function setLoading(message, visible = true) {
    setText('#loading-text', message);
    $('#loading').classList.toggle('hidden', !visible);
}

function requestRender() {
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => {
        renderFrame = 0;
        renderer.render(scene, camera);
    });
}

function formatDegrees(value) {
    const rounded = Math.abs(value) < 0.05 ? 0 : value;
    return `${rounded.toFixed(1)}°`;
}

function activationColor(value) {
    const activation = THREE.MathUtils.clamp(Number(value), 0, 1);
    for (let index = 1; index < ACTIVATION_STOPS.length; index += 1) {
        const [upperValue, upperColor] = ACTIVATION_STOPS[index];
        const [lowerValue, lowerColor] = ACTIVATION_STOPS[index - 1];
        if (activation <= upperValue) {
            return lowerColor.clone().lerp(upperColor, (activation - lowerValue) / (upperValue - lowerValue));
        }
    }
    return ACTIVATION_STOPS.at(-1)[1].clone();
}

function activationAvailable(state = app.state) {
    if (state?.mode !== 'static' || state.staticHolding?.quality?.usable !== true) return false;
    if (state.modelDigest !== app.metadata?.identity?.modelDigest) return false;
    if (state.solverConfigId !== app.metadata?.solverConfig?.id) return false;
    if (!Array.isArray(state.muscles) || state.muscles.length !== app.metadata.muscles.length) return false;
    const expectedIds = new Set(app.metadata.muscles.map((muscle) => muscle.actuatorId));
    const ids = new Set();
    for (const muscle of state.muscles) {
        if (!expectedIds.has(muscle.actuatorId) || ids.has(muscle.actuatorId) || !Number.isFinite(muscle.activation)) return false;
        ids.add(muscle.actuatorId);
    }
    return ids.size === expectedIds.size;
}

async function sha256Hex(buffer) {
    if (!globalThis.crypto?.subtle) throw new Error('SHA-256 verification is unavailable in this browser.');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function verifiedGeometryBuffer(response, expectedDigest) {
    const buffer = await response.arrayBuffer();
    const actualDigest = await sha256Hex(buffer);
    if (actualDigest !== expectedDigest) {
        throw new Error(`Right-arm geometry SHA-256 mismatch. Expected ${expectedDigest}; received ${actualDigest}.`);
    }
    return buffer;
}

function parseGeometry(buffer) {
    if (buffer.byteLength < 16) throw new Error('Right-arm geometry file is incomplete.');
    const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 8));
    if (magic !== 'MSHARM01') throw new Error('Right-arm geometry has an unsupported format.');
    const header = new DataView(buffer, 8, 8);
    const vertexCount = header.getUint32(0, true);
    const indexCount = header.getUint32(4, true);
    const positionsOffset = 16;
    const indicesOffset = positionsOffset + vertexCount * 3 * 4;
    const expectedBytes = indicesOffset + indexCount * 4;
    if (expectedBytes !== buffer.byteLength) throw new Error('Right-arm geometry size does not match its header.');
    return {
        positions: new Float32Array(buffer, positionsOffset, vertexCount * 3),
        indices: new Uint32Array(buffer, indicesOffset, indexCount)
    };
}

function buildBodyMeshes(asset) {
    for (const descriptor of app.metadata.geometry.geoms) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(asset.positions.slice(descriptor.vertexStart * 3, (descriptor.vertexStart + descriptor.vertexCount) * 3), 3));
        geometry.setIndex(new THREE.Uint32BufferAttribute(asset.indices.slice(descriptor.indexStart, descriptor.indexStart + descriptor.indexCount), 1));
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, descriptor.role === 'arm' ? boneMaterial : contextMaterial);
        mesh.matrixAutoUpdate = false;
        mesh.name = descriptor.name;
        mesh.userData.bodyId = descriptor.bodyId;
        mesh.userData.role = descriptor.role;
        app.bodyMeshes.push(mesh);
        (descriptor.role === 'arm' ? app.armGroup : app.contextGroup).add(mesh);
    }
}

function bodyMatrix(transform, target) {
    const r = transform.rotation;
    const p = transform.position;
    target.set(
        r[0], r[1], r[2], p[0],
        r[3], r[4], r[5], p[1],
        r[6], r[7], r[8], p[2],
        0, 0, 0, 1
    );
}

function applyBodyTransforms(state) {
    for (const mesh of app.bodyMeshes) {
        const transform = state.bodyTransforms?.[mesh.userData.bodyId] ?? state.bodies?.find((body) => body.bodyId === mesh.userData.bodyId);
        mesh.visible = Boolean(transform);
        if (transform) bodyMatrix(transform, mesh.matrix);
        mesh.matrixWorldNeedsUpdate = true;
    }
    app.contextGroup.visible = app.showContext;
    displayRoot.updateMatrixWorld(true);
}

function disposeChildren(group) {
    for (const child of [...group.children]) {
        group.remove(child);
        if (child.geometry && child.geometry !== unitCylinder && child.geometry !== markerSphere) {
            child.geometry.dispose();
        }
        if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
        else child.material?.dispose();
    }
}

function positionSegment(mesh, segment, radius) {
    scratchStart.set(segment[0], segment[1], segment[2]);
    scratchEnd.set(segment[3], segment[4], segment[5]);
    scratchDirection.copy(scratchEnd).sub(scratchStart);
    const length = scratchDirection.length();
    if (!Number.isFinite(length) || length < 1e-8) {
        mesh.visible = false;
        return;
    }
    mesh.position.copy(scratchStart).add(scratchEnd).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(axisY, scratchDirection.normalize());
    mesh.scale.set(radius, length, radius);
}

function pathVisible(muscle) {
    return muscle.visibleByDefault !== false || app.showLongOrigins;
}

function renderPaths() {
    disposeChildren(app.pathGroup);
    const available = activationAvailable();
    const showOnly = app.pathView === 'one';
    for (const muscle of app.state?.muscles ?? []) {
        if (!pathVisible(muscle) || (showOnly && muscle.name !== app.selectedMuscle)) continue;
        const selected = muscle.name === app.selectedMuscle;
        const color = available ? activationColor(muscle.activation) : (selected && showOnly ? SELECTED_COLOR : NEUTRAL_COLOR);
        const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: selected ? 1 : available ? 0.82 : 0.58, depthWrite: false });
        for (const [index, segment] of (muscle.segments ?? []).entries()) {
            const mesh = new THREE.Mesh(unitCylinder, material);
            mesh.renderOrder = 2;
            mesh.frustumCulled = false;
            positionSegment(mesh, segment, muscle.segmentInsideWrap?.[index] ? 0.0011 : selected && showOnly ? 0.003 : 0.00155);
            app.pathGroup.add(mesh);
        }
    }
    renderSelected();
    requestRender();
}

function renderSelected() {
    disposeChildren(app.selectedGroup);
    if (app.pathView === 'all') return;
    const muscle = app.state?.muscles?.find((candidate) => candidate.name === app.selectedMuscle);
    if (!muscle) return;
    const available = activationAvailable();
    const color = available ? activationColor(muscle.activation) : SELECTED_COLOR;
    const endpointMaterial = new THREE.MeshBasicMaterial({ color: 0x17201d });
    const siteMaterial = new THREE.MeshBasicMaterial({ color: 0xf7faf8 });
    const wrapMaterial = new THREE.MeshBasicMaterial({ color });
    for (const [index, point] of muscle.points.entries()) {
        const endpoint = index === 0 || index === muscle.points.length - 1;
        const marker = new THREE.Mesh(markerSphere, endpoint ? endpointMaterial : muscle.pointKinds?.[index] === 'wrap' ? wrapMaterial : siteMaterial);
        marker.position.set(...point);
        marker.scale.setScalar(endpoint ? 0.006 : muscle.pointKinds?.[index] === 'wrap' ? 0.003 : 0.004);
        marker.renderOrder = 4;
        app.selectedGroup.add(marker);
    }
}

function updateCamera() {
    const cosPitch = Math.cos(cameraState.pitch);
    camera.position.set(
        cameraState.target.x + cameraState.radius * Math.sin(cameraState.yaw) * cosPitch,
        cameraState.target.y + cameraState.radius * Math.sin(cameraState.pitch),
        cameraState.target.z + cameraState.radius * Math.cos(cameraState.yaw) * cosPitch
    );
    camera.lookAt(cameraState.target);
    requestRender();
}

function fitCameraToModel() {
    displayRoot.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(app.armGroup);
    if (app.showContext) bounds.union(new THREE.Box3().setFromObject(app.contextGroup));
    if (bounds.isEmpty()) return;
    const size = bounds.getSize(new THREE.Vector3());
    bounds.getCenter(cameraState.target);
    const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const radius = Math.max(size.y / (2 * Math.tan(halfFov)), size.z / (2 * Math.tan(halfFov) * Math.max(camera.aspect, 0.5))) * 1.18;
    cameraState.radius = THREE.MathUtils.clamp(radius, 0.6, MAX_CAMERA_RADIUS);
    cameraState.initialRadius = cameraState.radius;
    cameraState.initialTarget.copy(cameraState.target);
    cameraState.yaw = Math.PI / 2;
    cameraState.pitch = 0.025;
    camera.near = Math.max(cameraState.radius / 500, 0.001);
    camera.far = Math.max(cameraState.radius * 20, 10);
    camera.updateProjectionMatrix();
    grid.position.y = bounds.min.y - Math.max(size.y * 0.025, 0.005);
    grid.scale.setScalar(Math.max(size.length() / 2.4, 0.5));
    app.cameraFitted = true;
    updateCamera();
}

function resetView() {
    cameraState.yaw = Math.PI / 2;
    cameraState.pitch = 0.025;
    cameraState.radius = cameraState.initialRadius;
    cameraState.target.copy(cameraState.initialTarget);
    updateCamera();
}

function setMirroredView(mirrored) {
    app.mirrored = Boolean(mirrored);
    displayRoot.scale.x = app.mirrored ? -1 : 1;
    const button = $('#mirror-view');
    button.classList.toggle('active', app.mirrored);
    button.setAttribute('aria-pressed', String(app.mirrored));
    button.setAttribute('aria-label', app.mirrored ? 'Show right' : 'Mirror left');
    button.dataset.tooltip = app.mirrored ? 'Show right' : 'Mirror left';
    setText('#viewer-title', app.mirrored ? 'Left display (mirrored right-arm calculation)' : 'Right upper limb');
    setText('#viewer-instructions', app.mirrored
        ? 'Visual mirror only · right-arm calculation · drag or use arrow keys to rotate · scroll or use zoom buttons'
        : 'Drag or use arrow keys to rotate · scroll or use zoom buttons');
    requestRender();
}

function toggleMirroredView() {
    setMirroredView(!app.mirrored);
}

function updateRangeProgress(input) {
    const minimum = Number(input.min);
    const maximum = Number(input.max);
    const progress = maximum > minimum ? ((Number(input.value) - minimum) / (maximum - minimum)) * 100 : 0;
    input.style.setProperty('--range-progress', `${THREE.MathUtils.clamp(progress, 0, 100)}%`);
}

function coordinateControlBounds(coordinate) {
    return {
        minimum: Number((Math.ceil(coordinate.minimum / CONTROL_STEP_DEGREES) * CONTROL_STEP_DEGREES).toFixed(1)),
        maximum: Number((Math.floor(coordinate.maximum / CONTROL_STEP_DEGREES) * CONTROL_STEP_DEGREES).toFixed(1))
    };
}

function buildCoordinateControls() {
    const fragment = document.createDocumentFragment();
    for (const coordinate of app.metadata.coordinates) {
        const bounds = coordinateControlBounds(coordinate);
        app.coordinates[coordinate.name] = coordinate.default;
        const wrapper = document.createElement('label');
        wrapper.className = 'coordinate-control';
        const label = document.createElement('span');
        label.className = 'coordinate-label';
        const text = document.createElement('span');
        text.textContent = coordinate.label;
        const output = document.createElement('output');
        output.id = `coordinate-output-${coordinate.name}`;
        output.textContent = formatDegrees(coordinate.default);
        label.append(text, output);
        const input = document.createElement('input');
        input.id = `coordinate-${coordinate.name}`;
        input.type = 'range';
        input.min = bounds.minimum;
        input.max = bounds.maximum;
        input.step = CONTROL_STEP_DEGREES;
        input.value = coordinate.default;
        input.setAttribute('aria-label', `${coordinate.label} in degrees`);
        const limits = document.createElement('span');
        limits.className = 'coordinate-limits';
        limits.innerHTML = `<span>${formatDegrees(bounds.minimum)}</span><span>${formatDegrees(bounds.maximum)}</span>`;
        input.addEventListener('input', () => {
            app.coordinates[coordinate.name] = Number(input.value);
            output.textContent = formatDegrees(Number(input.value));
            updateRangeProgress(input);
            clearPresetSelection();
            schedulePostureUpdate();
        });
        input.addEventListener('change', () => schedulePostureUpdate(0, 80));
        wrapper.append(label, input, limits);
        fragment.append(wrapper);
        updateRangeProgress(input);
    }
    $('#coordinate-controls').replaceChildren(fragment);
}

function clearPresetSelection() {
    for (const button of document.querySelectorAll('[data-preset]')) {
        button.classList.remove('active');
        button.setAttribute('aria-pressed', 'false');
    }
}

function applyPosePreset(name) {
    const preset = POSE_PRESETS[name];
    if (!preset) return;
    for (const coordinate of app.metadata.coordinates) {
        const value = preset[coordinate.name] ?? coordinate.default;
        if (value < coordinate.minimum || value > coordinate.maximum) return;
        app.coordinates[coordinate.name] = value;
        const input = document.getElementById(`coordinate-${coordinate.name}`);
        input.value = value;
        updateRangeProgress(input);
        setText(`#coordinate-output-${coordinate.name}`, formatDegrees(value));
    }
    for (const button of document.querySelectorAll('[data-preset]')) {
        const active = button.dataset.preset === name;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    }
    app.presetLibraryVisible = false;
    syncPresetLibrary();
    schedulePostureUpdate(0, 50);
}

function resetPose() {
    clearPresetSelection();
    for (const coordinate of app.metadata.coordinates) {
        app.coordinates[coordinate.name] = coordinate.default;
        const input = document.getElementById(`coordinate-${coordinate.name}`);
        input.value = coordinate.default;
        updateRangeProgress(input);
        setText(`#coordinate-output-${coordinate.name}`, formatDegrees(coordinate.default));
    }
    schedulePostureUpdate(0, 50);
}

function syncPresetLibrary() {
    $('#static-presets').classList.toggle('hidden', !app.presetLibraryVisible);
    $('#toggle-preset-library').classList.toggle('active', app.presetLibraryVisible);
    $('#toggle-preset-library').setAttribute('aria-expanded', String(app.presetLibraryVisible));
}

function buildMuscleSelect() {
    const select = $('#muscle-select');
    select.replaceChildren();
    const groups = new Map();
    for (const muscle of app.metadata.muscles) {
        if (!groups.has(muscle.group)) groups.set(muscle.group, []);
        groups.get(muscle.group).push(muscle);
    }
    for (const [group, muscles] of groups) {
        const options = document.createElement('optgroup');
        options.label = group;
        for (const muscle of muscles) {
            const option = document.createElement('option');
            option.value = muscle.name;
            option.textContent = muscle.name;
            option.selected = muscle.name === app.selectedMuscle;
            options.append(option);
        }
        select.append(options);
    }
}

function setPositionStatus(kind, title, detail) {
    const status = $('#position-status');
    status.className = `position-status ${kind}`;
    status.innerHTML = `<strong></strong><span></span>`;
    status.querySelector('strong').textContent = title;
    status.querySelector('span').textContent = detail;
    status.title = `${title}: ${detail}`;
}

function syncViewerDrawers() {
    const details = app.pathView !== 'all';
    $('#activation-panel').classList.toggle('hidden', details);
    $('#activation-panel').classList.toggle('collapsed', !app.activationPanelVisible);
    $('#muscle-panel').classList.toggle('hidden', !details);
    $('#muscle-panel').classList.toggle('collapsed', !app.musclePanelVisible);
    $('#toggle-activation-panel').textContent = app.activationPanelVisible ? 'Hide list' : 'Show list';
    $('#toggle-activation-panel').setAttribute('aria-expanded', String(app.activationPanelVisible));
    $('#toggle-muscle-panel').textContent = app.musclePanelVisible ? 'Hide' : 'Show';
    $('#toggle-muscle-panel').setAttribute('aria-expanded', String(app.musclePanelVisible));
    $('#selected-path-legend').classList.toggle('hidden', !details);
}

function setPathView(view) {
    app.pathView = view === 'one' || view === 'focus' ? view : 'all';
    const details = app.pathView !== 'all';
    app.activationPanelVisible = !details;
    app.musclePanelVisible = details;
    $('#view-all-muscles').classList.toggle('active', app.pathView === 'all');
    $('#view-one-muscle').classList.toggle('active', app.pathView === 'one');
    $('#view-all-muscles').setAttribute('aria-pressed', String(app.pathView === 'all'));
    $('#view-one-muscle').setAttribute('aria-pressed', String(app.pathView === 'one'));
    syncViewerDrawers();
    renderPaths();
    updateDetails();
}

function selectMuscle(name, view = app.pathView === 'all' ? 'focus' : app.pathView) {
    if (!app.metadata.muscleNames.includes(name)) return;
    app.selectedMuscle = name;
    $('#muscle-select').value = name;
    setPathView(view);
}

function updateMomentArms(muscle) {
    const host = $('#moment-arms');
    host.replaceChildren();
    for (const coordinate of app.metadata.coordinates) {
        const row = document.createElement('div');
        row.className = 'moment-row';
        const label = document.createElement('span');
        label.textContent = coordinate.label;
        const value = document.createElement('strong');
        const arm = muscle?.momentArms?.[coordinate.name];
        value.textContent = Number.isFinite(arm) ? `${(arm * 1000).toFixed(1)} mm` : '—';
        row.append(label, value);
        host.append(row);
    }
}

function updateDetails() {
    const muscle = app.state?.muscles?.find((candidate) => candidate.name === app.selectedMuscle);
    if (!muscle) return;
    setText('#muscle-title', muscle.name);
    setText('#muscle-length', Number.isFinite(muscle.lengthM) ? (muscle.lengthM * 100).toFixed(2) : '—');
    setText('#path-points', String(muscle.points?.length ?? 0));
    updateMomentArms(muscle);
    const available = activationAvailable();
    $('#activation-reading').classList.toggle('hidden', !available);
    $('#force-reading').classList.toggle('hidden', !available);
    setText('#muscle-activation', available ? muscle.activation.toFixed(3) : '—');
    setText('#muscle-force', available && Number.isFinite(muscle.activeActuatorForceN) ? muscle.activeActuatorForceN.toFixed(1) : '—');
}

function updateActivationRanking() {
    const host = $('#activation-ranking');
    host.replaceChildren();
    if (!activationAvailable()) return;
    const ranked = [...app.state.muscles].sort((left, right) => right.activation - left.activation);
    const visible = app.activationRankingExpanded ? ranked : ranked.slice(0, 12);
    for (const muscle of visible) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'activation-row';
        row.title = `${muscle.group} · select ${muscle.name}`;
        row.innerHTML = '<span class="rank-name"></span><span class="rank-track"><span class="rank-fill"></span></span><span class="rank-value"></span>';
        row.querySelector('.rank-name').textContent = muscle.name;
        row.querySelector('.rank-fill').style.width = `${THREE.MathUtils.clamp(muscle.activation, 0, 1) * 100}%`;
        row.querySelector('.rank-fill').style.background = `#${activationColor(muscle.activation).getHexString()}`;
        row.querySelector('.rank-value').textContent = muscle.activation.toFixed(3);
        row.setAttribute('aria-label', `${muscle.name}, ${muscle.group}, activation ${muscle.activation.toFixed(3)}`);
        row.addEventListener('click', () => selectMuscle(muscle.name, 'focus'));
        host.append(row);
    }
    const toggle = $('#toggle-all-activations');
    toggle.classList.toggle('hidden', ranked.length <= 12);
    toggle.textContent = app.activationRankingExpanded ? 'Show top 12' : `Show all ${ranked.length}`;
    toggle.setAttribute('aria-expanded', String(app.activationRankingExpanded));
}

function neutralizeDisplayedActivation() {
    $('#activation-reading').classList.add('hidden');
    $('#force-reading').classList.add('hidden');
    $('#activation-ranking').replaceChildren();
    $('#activation-ranking').classList.add('hidden');
    $('#toggle-all-activations').classList.add('hidden');
    $('#activation-empty').classList.remove('hidden');
    setText('#activation-empty strong', 'Posture changed');
    setText('#activation-empty span', 'Activation will update after the static balance checks.');
    setText('#solver-residual', '—');
    setText('#solver-reserve', '—');
    if (app.state) {
        app.state = {
            ...app.state,
            mode: 'pose',
            staticHolding: null,
            muscles: app.state.muscles.map((muscle) => {
                const copy = { ...muscle };
                delete copy.activation;
                delete copy.activeActuatorForceN;
                delete copy.passiveActuatorForceN;
                return copy;
            })
        };
        renderPaths();
    }
}

function applyState(state) {
    if (state.modelDigest !== app.metadata.identity.modelDigest) throw new Error('A result from a different model build was rejected.');
    if (state.selectedMuscle && app.metadata.muscleNames.includes(state.selectedMuscle)) app.selectedMuscle = state.selectedMuscle;
    app.state = state;
    app.coordinates = { ...state.coordinates };
    for (const [name, value] of Object.entries(state.coordinates)) {
        const input = document.getElementById(`coordinate-${name}`);
        if (input && document.activeElement !== input) input.value = value;
        if (input) updateRangeProgress(input);
        setText(`#coordinate-output-${name}`, formatDegrees(value));
    }
    applyBodyTransforms(state);
    renderPaths();
    updateDetails();
    const available = activationAvailable(state);
    $('#activation-ranking').classList.toggle('hidden', !available);
    $('#activation-empty').classList.toggle('hidden', available);
    if (available) {
        updateActivationRanking();
        const quality = state.staticHolding.quality;
        setText('#solver-residual', `${quality.maxGeneralizedForceEquilibriumResidual.toExponential(2)} N·m`);
        setText('#solver-reserve', quality.maxReserveTorqueNm < 0.001 ? `${quality.maxReserveTorqueNm.toExponential(2)} N·m` : `${quality.maxReserveTorqueNm.toFixed(4)} N·m`);
        setPositionStatus('static', 'Activation ready', 'Static balance checks passed.');
        $('#calculate-static').classList.add('hidden');
    } else if (state.mode === 'static') {
        const reason = state.staticHolding?.quality?.reason || 'The posture did not pass the static balance checks.';
        setText('#activation-empty strong', 'Activation withheld');
        setText('#activation-empty span', reason);
        setPositionStatus('unavailable', 'Static balance unavailable', reason);
        $('#calculate-static').textContent = 'Try again';
        $('#calculate-static').classList.remove('hidden');
    } else {
        setPositionStatus('manual', 'Posture ready', 'Calculating static activation.');
    }
    clearError();
    requestRender();
}

async function requestPose(coordinates = app.coordinates, selectedMuscle = app.selectedMuscle) {
    const generation = ++app.poseGeneration;
    try {
        const state = await app.engine.pose(coordinates, selectedMuscle);
        if (generation !== app.poseGeneration) return null;
        applyState(state);
        return state;
    } catch (error) {
        if (generation !== app.poseGeneration || error instanceof StaleRequestError || error?.name === 'StaleRequestError') return null;
        showError(`This posture could not be calculated: ${error.message}`);
        return null;
    }
}

async function requestStaticHold(coordinates = app.coordinates, selectedMuscle = app.selectedMuscle) {
    const generation = ++app.solveGeneration;
    $('#calculate-static').disabled = true;
    $('#calculate-static').textContent = 'Calculating…';
    setPositionStatus('static', 'Calculating activation…', 'Colors remain gray until every quality check passes.');
    try {
        const state = await app.engine.staticHold(coordinates, selectedMuscle);
        if (generation !== app.solveGeneration) return null;
        applyState(state);
        return state;
    } catch (error) {
        if (generation !== app.solveGeneration || error instanceof StaleRequestError || error?.name === 'StaleRequestError') return null;
        showError(`Static activation could not be calculated: ${error.message}`);
        setPositionStatus('unavailable', 'Static balance unavailable', error.message);
        $('#calculate-static').textContent = 'Try again';
        $('#calculate-static').classList.remove('hidden');
        return null;
    } finally {
        if (generation === app.solveGeneration) $('#calculate-static').disabled = false;
    }
}

function schedulePostureUpdate(poseDelay = POSE_DELAY_MS, solveDelay = SOLVE_DELAY_MS) {
    window.clearTimeout(app.poseTimer);
    window.clearTimeout(app.solveTimer);
    app.poseGeneration += 1;
    app.solveGeneration += 1;
    neutralizeDisplayedActivation();
    const coordinates = { ...app.coordinates };
    const selected = app.selectedMuscle;
    app.poseTimer = window.setTimeout(() => requestPose(coordinates, selected), poseDelay);
    app.solveTimer = window.setTimeout(() => requestStaticHold(coordinates, selected), solveDelay);
}

function updateInventory() {
    setText('#count-bodies', app.metadata.model.armBodies);
    setText('#count-muscles', app.metadata.model.functionalMuscles);
    setText('#count-meshes', app.metadata.geometry.geoms.filter((geom) => geom.role === 'arm').length);
    setText('#runtime-note', `${app.metadata.model.runtime}; ${app.metadata.capabilities.calculationSide}-arm static posture only.`);
    setText('#model-hash', 'Model files verified in this browser.');
}

function rawPointToView(point) {
    return new THREE.Vector3(point[0], point[2], -point[1]);
}

function focusSelectedPath() {
    const muscle = app.state?.muscles?.find((candidate) => candidate.name === app.selectedMuscle);
    if (!muscle?.points?.length) return;
    const bounds = new THREE.Box3().setFromPoints(muscle.points.map(rawPointToView));
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    cameraState.target.copy(sphere.center);
    cameraState.radius = THREE.MathUtils.clamp(Math.max(sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.35, 0.22), MIN_CAMERA_RADIUS, cameraState.initialRadius);
    updateCamera();
}

function viewerImageFilename({ transparent, scale, includeActivation }) {
    const side = app.mirrored ? 'left-mirrored-right-calculation' : 'right';
    const background = transparent ? 'transparent' : 'background';
    return `waajacu-ms-human-${side}-static-${background}${includeActivation ? '-activation-table' : ''}-${scale}x.png`;
}

function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The browser could not encode the image.')), 'image/png'));
}

function drawActivationExportOverlay(context, pixelScale, sourceWidth, sourceHeight) {
    const muscles = activationAvailable() ? [...app.state.muscles].sort((a, b) => b.activation - a.activation) : [];
    const visibleRows = muscles.slice(0, Math.max(1, Math.floor((sourceHeight - 90) / 12)));
    const x = 12;
    const y = 12;
    const width = Math.min(310, sourceWidth - 24);
    const height = 58 + Math.max(34, visibleRows.length * 12);
    context.save();
    context.scale(pixelScale, pixelScale);
    context.fillStyle = 'rgba(250,252,251,.92)';
    context.fillRect(x, y, width, height);
    context.strokeStyle = 'rgba(104,120,114,.48)';
    context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    context.fillStyle = '#17201d';
    context.font = '700 10px system-ui, sans-serif';
    context.fillText('MS-Human static activation · generic model', x + 8, y + 16);
    context.font = '8px system-ui, sans-serif';
    context.fillStyle = '#5d6864';
    context.fillText(app.mirrored ? 'Mirrored display; calculation side remains right' : 'Right-arm calculation', x + 8, y + 31);
    if (!visibleRows.length) {
        context.fillText('No activation result available.', x + 8, y + 49);
        context.restore();
        return;
    }
    visibleRows.forEach((muscle, index) => {
        const rowY = y + 49 + index * 12;
        context.fillStyle = '#17201d';
        context.font = '600 8px system-ui, sans-serif';
        context.fillText(muscle.name, x + 8, rowY);
        context.fillStyle = `#${activationColor(muscle.activation).getHexString()}`;
        context.fillRect(x + 104, rowY - 7, Math.max(1, (width - 148) * muscle.activation), 6);
        context.fillStyle = '#17201d';
        context.textAlign = 'right';
        context.fillText(muscle.activation.toFixed(3), x + width - 8, rowY);
        context.textAlign = 'left';
    });
    if (visibleRows.length < muscles.length) context.fillText(`Top ${visibleRows.length} of ${muscles.length}; full ranking remains in the app.`, x + 8, y + height - 7);
    context.restore();
}

async function downloadViewerImage({ transparent, scale, includeActivation = false }) {
    if (viewerExporting) return;
    viewerExporting = true;
    const status = $('#viewer-download-status');
    const buttons = [...document.querySelectorAll('[data-viewer-download]')];
    buttons.forEach((button) => { button.disabled = true; });
    status.textContent = 'Preparing image…';
    let exportRenderer;
    const gridVisible = grid.visible;
    try {
        const width = Math.min(4096, Math.max(1, Math.round(sceneHost.clientWidth * scale)));
        const height = Math.min(4096, Math.max(1, Math.round(sceneHost.clientHeight * scale)));
        exportRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        exportRenderer.setSize(width, height, false);
        exportRenderer.setClearColor(transparent ? 0x000000 : 0xe8ece9, transparent ? 0 : 1);
        exportRenderer.outputColorSpace = THREE.SRGBColorSpace;
        const exportCamera = camera.clone();
        exportCamera.aspect = width / height;
        exportCamera.updateProjectionMatrix();
        if (transparent) grid.visible = false;
        exportRenderer.render(scene, exportCamera);
        grid.visible = gridVisible;
        let canvas = exportRenderer.domElement;
        if (includeActivation) {
            const composite = document.createElement('canvas');
            composite.width = width;
            composite.height = height;
            const context = composite.getContext('2d');
            context.drawImage(canvas, 0, 0, width, height);
            drawActivationExportOverlay(context, width / Math.max(sceneHost.clientWidth, 1), sceneHost.clientWidth, sceneHost.clientHeight);
            canvas = composite;
        }
        const blob = await canvasToPngBlob(canvas);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = viewerImageFilename({ transparent, scale, includeActivation });
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        status.textContent = `Download started · ${width} × ${height} PNG`;
    } catch (error) {
        status.textContent = 'Image could not be created.';
        showError(`The viewer image could not be downloaded: ${error.message}`);
    } finally {
        grid.visible = gridVisible;
        exportRenderer?.dispose();
        buttons.forEach((button) => { button.disabled = false; });
        viewerExporting = false;
    }
}

function resizeRenderer() {
    const width = Math.max(sceneHost.clientWidth, 1);
    const height = Math.max(sceneHost.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestRender();
}

function attachViewerInteraction() {
    const canvas = renderer.domElement;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    canvas.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        dragging = true;
        lastX = event.clientX;
        lastY = event.clientY;
        canvas.focus({ preventScroll: true });
        canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        cameraState.yaw -= (event.clientX - lastX) * 0.008;
        cameraState.pitch = THREE.MathUtils.clamp(cameraState.pitch + (event.clientY - lastY) * 0.006, -1.25, 1.25);
        lastX = event.clientX;
        lastY = event.clientY;
        updateCamera();
    });
    const finish = (event) => {
        dragging = false;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    canvas.addEventListener('wheel', (event) => {
        event.preventDefault();
        cameraState.radius = THREE.MathUtils.clamp(cameraState.radius * Math.exp(event.deltaY * 0.0012), MIN_CAMERA_RADIUS, MAX_CAMERA_RADIUS);
        updateCamera();
    }, { passive: false });
    canvas.addEventListener('keydown', (event) => {
        const step = 0.12;
        if (event.key === 'ArrowLeft') cameraState.yaw += step;
        else if (event.key === 'ArrowRight') cameraState.yaw -= step;
        else if (event.key === 'ArrowUp') cameraState.pitch = THREE.MathUtils.clamp(cameraState.pitch - step, -1.25, 1.25);
        else if (event.key === 'ArrowDown') cameraState.pitch = THREE.MathUtils.clamp(cameraState.pitch + step, -1.25, 1.25);
        else if (event.key === '+' || event.key === '=') cameraState.radius = THREE.MathUtils.clamp(cameraState.radius / 1.12, MIN_CAMERA_RADIUS, MAX_CAMERA_RADIUS);
        else if (event.key === '-' || event.key === '_') cameraState.radius = THREE.MathUtils.clamp(cameraState.radius * 1.12, MIN_CAMERA_RADIUS, MAX_CAMERA_RADIUS);
        else if (event.key === 'Home') resetView();
        else return;
        event.preventDefault();
        updateCamera();
    });
}

function zoomView(factor) {
    cameraState.radius = THREE.MathUtils.clamp(cameraState.radius * factor, MIN_CAMERA_RADIUS, MAX_CAMERA_RADIUS);
    updateCamera();
}

function enterDiagnosisWorkspace() {
    const viewer = document.querySelector('.viewer-panel');
    const slot = $('#diagnosis-viewer-slot');
    if (!viewer || !slot || viewer.parentElement === slot) return;
    diagnosisViewerSnapshot = { pathView: app.pathView, activationPanelVisible: app.activationPanelVisible, musclePanelVisible: app.musclePanelVisible, mirrored: app.mirrored };
    window.clearTimeout(app.poseTimer);
    window.clearTimeout(app.solveTimer);
    app.poseGeneration += 1;
    app.solveGeneration += 1;
    app.pathView = 'all';
    app.activationPanelVisible = false;
    app.musclePanelVisible = false;
    neutralizeDisplayedActivation();
    syncViewerDrawers();
    slot.append(viewer);
    resizeRenderer();
}

function leaveDiagnosisWorkspace() {
    const viewer = document.querySelector('.viewer-panel');
    if (viewer && viewer.parentElement !== $('#explorer-workspace')) $('#explorer-workspace').append(viewer);
    if (diagnosisViewerSnapshot) {
        app.pathView = diagnosisViewerSnapshot.pathView;
        app.activationPanelVisible = diagnosisViewerSnapshot.activationPanelVisible;
        app.musclePanelVisible = diagnosisViewerSnapshot.musclePanelVisible;
        setMirroredView(diagnosisViewerSnapshot.mirrored);
        diagnosisViewerSnapshot = null;
    }
    syncViewerDrawers();
    resizeRenderer();
    schedulePostureUpdate(0, 80);
}

function bindInterface() {
    $('#reset-view').addEventListener('click', resetView);
    $('#zoom-in').addEventListener('click', () => zoomView(1 / 1.18));
    $('#zoom-out').addEventListener('click', () => zoomView(1.18));
    $('#mirror-view').addEventListener('click', toggleMirroredView);
    $('#reset-pose').addEventListener('click', resetPose);
    $('#calculate-static').addEventListener('click', () => requestStaticHold());
    $('#toggle-preset-library').addEventListener('click', () => { app.presetLibraryVisible = !app.presetLibraryVisible; syncPresetLibrary(); });
    $('#view-all-muscles').addEventListener('click', () => setPathView('all'));
    $('#view-one-muscle').addEventListener('click', () => setPathView('one'));
    $('#muscle-select').addEventListener('change', () => selectMuscle($('#muscle-select').value));
    $('#toggle-activation-panel').addEventListener('click', () => { app.activationPanelVisible = !app.activationPanelVisible; syncViewerDrawers(); });
    $('#toggle-all-activations').addEventListener('click', () => {
        app.activationRankingExpanded = !app.activationRankingExpanded;
        updateActivationRanking();
    });
    $('#toggle-muscle-panel').addEventListener('click', () => { app.musclePanelVisible = !app.musclePanelVisible; syncViewerDrawers(); });
    $('#back-to-activations').addEventListener('click', () => setPathView('all'));
    $('#toggle-context').addEventListener('click', () => {
        app.showContext = !app.showContext;
        app.contextGroup.visible = app.showContext;
        $('#toggle-context').classList.toggle('active', app.showContext);
        $('#toggle-context').setAttribute('aria-pressed', String(app.showContext));
        requestRender();
    });
    $('#toggle-long-origins').addEventListener('click', () => {
        app.showLongOrigins = !app.showLongOrigins;
        $('#toggle-long-origins').classList.toggle('active', app.showLongOrigins);
        $('#toggle-long-origins').setAttribute('aria-pressed', String(app.showLongOrigins));
        renderPaths();
    });
    for (const button of document.querySelectorAll('[data-preset]')) button.addEventListener('click', () => applyPosePreset(button.dataset.preset));
    for (const button of document.querySelectorAll('[data-viewer-download]')) button.addEventListener('click', () => downloadViewerImage({ scale: Number(button.dataset.scale), transparent: button.dataset.transparent === 'true', includeActivation: button.dataset.includeActivation === 'true' }));
    $('#viewer-download-menu').addEventListener('toggle', (event) => event.currentTarget.querySelector('summary').setAttribute('aria-expanded', String(event.currentTarget.open)));
    window.addEventListener('resize', resizeRenderer);
}

async function initialize() {
    attachViewerInteraction();
    bindInterface();
    resizeRenderer();
    try {
        setLoading('Loading the model…');
        const [metadata, geometryResponse] = await Promise.all([
            app.engine.initialize(),
            fetch(GEOMETRY_URL, { cache: 'force-cache' })
        ]);
        if (!geometryResponse.ok) throw new Error(`Right-arm geometry request failed (${geometryResponse.status}).`);
        app.metadata = metadata;
        app.model = {
            id: metadata.identity.modelId,
            modelDigest: metadata.identity.modelDigest,
            name: metadata.model.name,
            variant: metadata.model.variant,
            scope: metadata.model.variant,
            runtime: metadata.model.runtime,
            source: metadata.source,
            solverConfigurationId: metadata.solverConfig.id,
            staticHold: metadata.solverConfig,
            analysisType: metadata.solverConfig.algorithm,
            controlFloor: 0,
            functionalMuscleCount: metadata.model.functionalMuscles,
            coordinates: metadata.coordinates,
            muscles: metadata.muscleNames,
            actuatorIds: metadata.muscles.map((muscle) => muscle.actuatorId),
            scapularStabilizers: metadata.muscles
                .filter((muscle) => muscle.group === 'Shoulder stabilizer')
                .map((muscle) => muscle.name)
        };
        const geometryBuffer = await verifiedGeometryBuffer(geometryResponse, metadata.geometry.sha256);
        const geometry = parseGeometry(geometryBuffer);
        buildBodyMeshes(geometry);
        buildCoordinateControls();
        buildMuscleSelect();
        updateInventory();
        $('#server-status').className = 'server-status online';
        $('#server-status span:last-child').textContent = 'Model ready · runs locally';
        app.diagnosis = createDiagnosisWorkflow({
            pose: (coordinates, selected) => app.engine.pose(coordinates, selected),
            staticHold: (coordinates, selected) => app.engine.staticHold(coordinates, selected),
            applyState,
            getModel: () => app.model,
            getSelectedMuscle: () => app.selectedMuscle,
            setMirroredView,
            resetView,
            neutralizeActivation: neutralizeDisplayedActivation,
            enterDiagnosis: enterDiagnosisWorkspace,
            leaveDiagnosis: leaveDiagnosisWorkspace,
            resizeViewer: resizeRenderer
        });
        const pose = await requestPose();
        if (!pose) throw new Error('The initial posture was superseded before it loaded.');
        fitCameraToModel();
        setLoading('', false);
        syncViewerDrawers();
        app.diagnosis.setReady(true);
        await requestStaticHold();
    } catch (error) {
        $('#server-status').className = 'server-status offline';
        $('#server-status span:last-child').textContent = 'Unavailable';
        setLoading('', false);
        app.diagnosis?.setReady(false);
        showError(`MS-Human-700 could not be loaded: ${error.message}`);
        console.error(error);
    }
}

window.addEventListener('beforeunload', () => app.engine.dispose());
initialize();
