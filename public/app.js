import * as THREE from '/vendor/three.module.min.js';

const $ = (selector) => document.querySelector(selector);

const app = {
    health: null,
    model: null,
    benchmark: null,
    state: null,
    mode: 'pose',
    pathView: 'all',
    meshObjects: new Map(),
    pathCables: new Map(),
    activationRows: new Map(),
    selectedSegments: [],
    selectedMarkers: [],
    poseTimer: null,
    poseRequest: 0,
    sweepPlaying: false,
    sweepStartedAt: 0,
    sweepStart: 0,
    sweepEnd: 0,
    lastSweepRequest: 0,
    benchmarkTime: 0.62,
    benchmarkPlaying: false,
    benchmarkAnchorTime: 0.62,
    benchmarkAnchorStamp: 0,
    lastBenchmarkRequest: 0,
    benchmarkRequestInFlight: false,
    queuedBenchmarkTime: null,
    benchmarkGeneration: 0,
    nearestTimer: null,
    cameraFitted: false
};

const sceneHost = $('#scene');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0xe8ece9, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.setAttribute(
    'aria-label',
    'Interactive rendering of the official MoBL-ARMS right upper-extremity model'
);
sceneHost.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const modelRoot = new THREE.Group();
scene.add(modelRoot);

const camera = new THREE.PerspectiveCamera(34, 1, 0.005, 50);
const cameraTarget = new THREE.Vector3(0, 0, 0);
let orbitYaw = 0.72;
let orbitPitch = 0.12;
let orbitRadius = 1.4;

scene.add(new THREE.HemisphereLight(0xffffff, 0x98a19d, 2.25));
scene.add(new THREE.AmbientLight(0xffffff, 0.72));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
keyLight.position.set(2.5, 4.5, 3.5);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xcbd9d5, 1.3);
fillLight.position.set(-3, 1.5, -2.5);
scene.add(fillLight);

const grid = new THREE.GridHelper(2.4, 24, 0xb7bfbb, 0xd6dad7);
grid.material.transparent = true;
grid.material.opacity = 0.58;
scene.add(grid);

const boneMaterial = new THREE.MeshStandardMaterial({
    color: 0xd9d4c8,
    roughness: 0.78,
    metalness: 0,
    side: THREE.DoubleSide
});
const thoraxMaterial = new THREE.MeshStandardMaterial({
    color: 0xc9d0cd,
    roughness: 0.82,
    metalness: 0,
    side: THREE.DoubleSide
});
const selectedTubeMaterial = new THREE.MeshBasicMaterial({ color: 0xb74a41 });
const selectedMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 9, 1, false);
const markerSphere = new THREE.SphereGeometry(0.0046, 10, 7);
const yAxis = new THREE.Vector3(0, 1, 0);
const neutralColor = new THREE.Color(0x82938d);
const selectedPoseColor = new THREE.Color(0xb74a41);
const segmentStart = new THREE.Vector3();
const segmentEnd = new THREE.Vector3();
const segmentDirection = new THREE.Vector3();
const segmentColor = new THREE.Color();
const ACTIVATION_COLOR_GAMMA = 0.45;
const ACTIVATION_RED_RAW = 0.34;
const ACTIVATION_RED_START = Math.pow(ACTIVATION_RED_RAW, ACTIVATION_COLOR_GAMMA);

const POSE_PRESETS = {
    'arm-side': {
        elv_angle: 0, shoulder_elv: 0, shoulder_rot: 0,
        elbow_flexion: 0, pro_sup: 0, deviation: 0, flexion: 0
    },
    'flexion-90': {
        elv_angle: 90, shoulder_elv: 90, shoulder_rot: 0,
        elbow_flexion: 0, pro_sup: 0, deviation: 0, flexion: 0
    },
    'abduction-90': {
        elv_angle: 0, shoulder_elv: 90, shoulder_rot: 0,
        elbow_flexion: 0, pro_sup: 0, deviation: 0, flexion: 0
    },
    'scaption-90': {
        elv_angle: 30, shoulder_elv: 90, shoulder_rot: 0,
        elbow_flexion: 0, pro_sup: 0, deviation: 0, flexion: 0
    },
    'scaption-ir': {
        elv_angle: 30, shoulder_elv: 90, shoulder_rot: 45,
        elbow_flexion: 0, pro_sup: 90, deviation: 0, flexion: 0
    },
    'external-side': {
        elv_angle: 0, shoulder_elv: 0, shoulder_rot: -45,
        elbow_flexion: 90, pro_sup: 0, deviation: 0, flexion: 0
    },
    'rotation-90-90': {
        elv_angle: 0, shoulder_elv: 90, shoulder_rot: -45,
        elbow_flexion: 90, pro_sup: 0, deviation: 0, flexion: 0
    },
    'elbow-supinated': {
        elv_angle: 0, shoulder_elv: 0, shoulder_rot: 0,
        elbow_flexion: 90, pro_sup: -90, deviation: 0, flexion: 0
    }
};

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

function setLoading(message, visible = true) {
    setText('#loading-text', message);
    $('#loading').classList.toggle('hidden', !visible);
}

function formatDegrees(value) {
    const rounded = Math.abs(value) < 0.05 ? 0 : value;
    return `${rounded.toFixed(1)}°`;
}

function formatTime(value) {
    return `${Number(value).toFixed(3)} s`;
}

function activationColor(value, target = new THREE.Color()) {
    const normalized = THREE.MathUtils.clamp(Number(value), 0, 1);
    const scaled = Math.pow(normalized, ACTIVATION_COLOR_GAMMA);
    const hueProgress = Math.min(scaled / ACTIVATION_RED_START, 1);
    const darkening = THREE.MathUtils.clamp(
        (scaled - ACTIVATION_RED_START) / (1 - ACTIVATION_RED_START),
        0,
        1
    );
    const lightness = THREE.MathUtils.lerp(0.49, 0.24, darkening);
    return target.setHSL((1 - hueProgress) * (2 / 3), 0.78, lightness);
}

function updateCamera() {
    const cosPitch = Math.cos(orbitPitch);
    camera.position.set(
        cameraTarget.x + orbitRadius * Math.sin(orbitYaw) * cosPitch,
        cameraTarget.y + orbitRadius * Math.sin(orbitPitch),
        cameraTarget.z + orbitRadius * Math.cos(orbitYaw) * cosPitch
    );
    camera.lookAt(cameraTarget);
}

function resetView() {
    orbitYaw = 0.72;
    orbitPitch = 0.12;
    if (app.meshObjects.size) fitCameraToModel();
    updateCamera();
}

function fitCameraToModel() {
    modelRoot.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(modelRoot);
    if (bounds.isEmpty()) return;
    const size = bounds.getSize(new THREE.Vector3());
    bounds.getCenter(cameraTarget);
    orbitRadius = Math.max(size.length() * 1.05, 0.65);
    camera.near = Math.max(orbitRadius / 500, 0.001);
    camera.far = Math.max(orbitRadius * 20, 10);
    camera.updateProjectionMatrix();
    grid.position.y = bounds.min.y - Math.max(size.y * 0.025, 0.005);
    grid.scale.setScalar(Math.max(size.length() / 2.4, 0.5));
    app.cameraFitted = true;
    updateCamera();
}

function parseNumbers(text, Type = Float32Array) {
    const tokens = text.trim().split(/\s+/);
    const values = new Type(tokens.length);
    for (let index = 0; index < tokens.length; index += 1) {
        values[index] = Number(tokens[index]);
    }
    return values;
}

function namedDataArray(parent, name) {
    return [...parent.getElementsByTagName('DataArray')]
        .find((element) => element.getAttribute('Name') === name);
}

function parseVtp(xmlText) {
    const documentNode = new DOMParser().parseFromString(xmlText, 'application/xml');
    const parseError = documentNode.querySelector('parsererror');
    if (parseError) throw new Error('The VTP mesh is not valid XML.');

    const piece = documentNode.getElementsByTagName('Piece')[0];
    const pointsNode = piece?.getElementsByTagName('Points')[0];
    const polysNode = piece?.getElementsByTagName('Polys')[0];
    if (!piece || !pointsNode || !polysNode) {
        throw new Error('The VTP mesh has no polygon data.');
    }

    const pointArray = pointsNode.getElementsByTagName('DataArray')[0];
    const connectivityArray = namedDataArray(polysNode, 'connectivity');
    const offsetsArray = namedDataArray(polysNode, 'offsets');
    if (!pointArray || !connectivityArray || !offsetsArray) {
        throw new Error('The VTP mesh is missing points or polygon indices.');
    }

    const positions = parseNumbers(pointArray.textContent, Float32Array);
    const connectivity = parseNumbers(connectivityArray.textContent, Int32Array);
    const offsets = parseNumbers(offsetsArray.textContent, Int32Array);
    const triangles = [];
    let start = 0;
    for (const end of offsets) {
        const count = end - start;
        for (let index = 1; index < count - 1; index += 1) {
            triangles.push(
                connectivity[start],
                connectivity[start + index],
                connectivity[start + index + 1]
            );
        }
        start = end;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pointData = piece.getElementsByTagName('PointData')[0];
    const normalsArray = pointData ? namedDataArray(pointData, 'Normals') : null;
    if (normalsArray) {
        const normals = parseNumbers(normalsArray.textContent, Float32Array);
        if (normals.length === positions.length) {
            geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        }
    }
    const IndexType = positions.length / 3 > 65535 ? Uint32Array : Uint16Array;
    geometry.setIndex(new THREE.BufferAttribute(new IndexType(triangles), 1));
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
}

async function fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) {
        throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
    }
    return payload;
}

async function loadMesh(meshInfo) {
    const response = await fetch(meshInfo.url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`${meshInfo.file}: HTTP ${response.status}`);
    const geometry = parseVtp(await response.text());
    const material = meshInfo.frame === 'thorax' ? thoraxMaterial : boneMaterial;
    const object = new THREE.Mesh(geometry, material);
    object.name = meshInfo.name;
    object.matrixAutoUpdate = false;
    object.userData.frame = meshInfo.frame;
    object.userData.scale = meshInfo.scale;
    modelRoot.add(object);
    app.meshObjects.set(meshInfo.name, object);
    if (app.state) applyMeshTransforms(app.state);
}

async function loadMeshes(meshes) {
    let nextIndex = 0;
    let completed = 0;
    const workers = Array.from({ length: Math.min(5, meshes.length) }, async () => {
        while (nextIndex < meshes.length) {
            const mesh = meshes[nextIndex];
            nextIndex += 1;
            await loadMesh(mesh);
            completed += 1;
            setLoading(`Loading official surface geometry ${completed} of ${meshes.length}…`);
        }
    });
    await Promise.all(workers);
}

function applyMeshTransforms(state) {
    const transforms = new Map(state.bodies.map((body) => [body.name, body]));
    for (const object of app.meshObjects.values()) {
        const transform = transforms.get(object.userData.frame);
        if (!transform) {
            object.visible = false;
            continue;
        }
        const r = transform.rotation;
        const p = transform.position;
        const matrix = new THREE.Matrix4();
        matrix.set(
            r[0], r[1], r[2], p[0],
            r[3], r[4], r[5], p[1],
            r[6], r[7], r[8], p[2],
            0, 0, 0, 1
        );
        matrix.scale(new THREE.Vector3(...object.userData.scale));
        object.matrix.copy(matrix);
        object.visible = true;
    }
    modelRoot.updateMatrixWorld(true);
}

function positionCableSegment(segment, startValues, endValues, radius) {
    segmentStart.fromArray(startValues);
    segmentEnd.fromArray(endValues);
    segmentDirection.copy(segmentEnd).sub(segmentStart);
    const length = segmentDirection.length();
    if (!Number.isFinite(length) || length < 1e-7) {
        segment.visible = false;
        return;
    }
    segment.position.copy(segmentStart).add(segmentEnd).multiplyScalar(0.5);
    segment.quaternion.setFromUnitVectors(yAxis, segmentDirection.normalize());
    segment.scale.set(radius, length, radius);
    segment.visible = true;
}

function updatePathCable(muscle, selectedName, showAll, activationAvailable) {
    let cable = app.pathCables.get(muscle.name);
    if (!cable) {
        const material = new THREE.MeshBasicMaterial({
            color: 0x82938d,
            transparent: true,
            opacity: 0.84,
            depthWrite: false
        });
        cable = { material, segments: [] };
        app.pathCables.set(muscle.name, cable);
    }

    const segmentCount = Math.max(0, muscle.points.length - 1);
    while (cable.segments.length < segmentCount) {
        const segment = new THREE.Mesh(unitCylinder, cable.material);
        segment.frustumCulled = false;
        segment.renderOrder = 2;
        modelRoot.add(segment);
        cable.segments.push(segment);
    }

    const visible = showAll || muscle.name === selectedName;
    const radius = activationAvailable || showAll ? 0.00175 : 0.0014;
    for (let index = 0; index < cable.segments.length; index += 1) {
        const segment = cable.segments[index];
        if (!visible || index >= segmentCount) {
            segment.visible = false;
            continue;
        }
        positionCableSegment(
            segment,
            muscle.points[index],
            muscle.points[index + 1],
            radius
        );
    }

    if (activationAvailable) {
        cable.material.color.copy(activationColor(muscle.activation, segmentColor));
        cable.material.opacity = showAll ? 0.9 : 1;
    } else {
        cable.material.color.copy(
            !showAll && muscle.name === selectedName ? selectedPoseColor : neutralColor
        );
        cable.material.opacity = showAll ? 0.82 : 1;
    }
}

function clearSelectedGlyphs() {
    for (const segment of app.selectedSegments) modelRoot.remove(segment);
    for (const marker of app.selectedMarkers) modelRoot.remove(marker);
    app.selectedSegments = [];
    app.selectedMarkers = [];
}

function addSelectedSegment(startValues, endValues) {
    const segment = new THREE.Mesh(unitCylinder, selectedTubeMaterial);
    positionCableSegment(segment, startValues, endValues, 0.00325);
    if (!segment.visible) return;
    segment.renderOrder = 3;
    modelRoot.add(segment);
    app.selectedSegments.push(segment);
}

function renderSelectedGlyph(muscle, activationAvailable) {
    clearSelectedGlyphs();
    const selectedColor = activationAvailable
        ? activationColor(muscle.activation, segmentColor)
        : selectedPoseColor;
    selectedTubeMaterial.color.copy(selectedColor);
    for (let index = 1; index < muscle.points.length; index += 1) {
        addSelectedSegment(muscle.points[index - 1], muscle.points[index]);
    }
    for (const point of muscle.points) {
        const marker = new THREE.Mesh(markerSphere, selectedMarkerMaterial);
        marker.position.fromArray(point);
        marker.renderOrder = 4;
        modelRoot.add(marker);
        app.selectedMarkers.push(marker);
    }
}

function renderMusclePaths(state) {
    const selectedName = state.selectedMuscle;
    const showAll = app.pathView === 'all';
    const activationAvailable = state.mode === 'benchmark' || state.mode === 'matched';
    let selected = null;
    for (const muscle of state.muscles) {
        updatePathCable(muscle, selectedName, showAll, activationAvailable);
        if (muscle.name === selectedName) selected = muscle;
    }
    if (selected && !showAll) renderSelectedGlyph(selected, activationAvailable);
    else clearSelectedGlyphs();
    return selected;
}

function updateMomentArms(muscle) {
    const host = $('#moment-arms');
    host.replaceChildren();
    for (const coordinate of app.model.coordinates) {
        const row = document.createElement('div');
        row.className = 'moment-row';
        const label = document.createElement('span');
        label.textContent = coordinate.label;
        const value = document.createElement('strong');
        const momentArm = muscle.momentArms?.[coordinate.name];
        value.textContent = Number.isFinite(momentArm)
            ? `${(momentArm * 1000).toFixed(1)} mm`
            : '—';
        row.append(label, value);
        host.append(row);
    }
}

function updateViewerSubtitle() {
    if (app.mode === 'benchmark') {
        setText(
            '#viewer-subtitle',
            app.pathView === 'all'
                ? 'All 50 OpenSim muscle paths, colored by activation at the current Reach8 frame.'
                : 'One selected OpenSim muscle path, colored by its activation at the current Reach8 frame.'
        );
    } else if (app.state?.mode === 'matched') {
        setText(
            '#viewer-subtitle',
            app.pathView === 'all'
                ? 'Exact pose geometry with all 50 paths colored by the closest Reach8 activation frame.'
                : 'Exact pose geometry with the selected path colored by the closest Reach8 activation frame.'
        );
    } else {
        setText(
            '#viewer-subtitle',
            app.pathView === 'all'
                ? 'All 50 OpenSim muscle centerlines at this exact pose. Neutral color does not represent effort.'
                : 'One selected OpenSim muscle centerline at this exact pose. Neutral color does not represent effort.'
        );
    }
}

function setPathView(view, refresh = true) {
    app.pathView = view === 'one' ? 'one' : 'all';
    const showOne = app.pathView === 'one';
    $('#view-all-muscles').classList.toggle('active', !showOne);
    $('#view-one-muscle').classList.toggle('active', showOne);
    $('#view-all-muscles').setAttribute('aria-pressed', String(!showOne));
    $('#view-one-muscle').setAttribute('aria-pressed', String(showOne));
    $('#muscle-panel').classList.toggle('hidden', !showOne);
    $('#selected-path-legend').classList.toggle('hidden', !showOne);
    updateViewerSubtitle();
    if (refresh && app.state) applyState(app.state);
}

function selectMuscle(name) {
    const select = $('#muscle-select');
    const changed = select.value !== name;
    select.value = name;
    setPathView('one', false);
    if (!changed) {
        if (app.state) applyState(app.state);
        return;
    }
    if (app.mode === 'benchmark') {
        app.queuedBenchmarkTime = app.benchmarkTime;
        requestBenchmarkFrame(app.benchmarkTime);
    } else {
        stopSweep();
        schedulePose(0);
    }
}

function updateActivationRanking(muscles) {
    const host = $('#activation-ranking');
    const ranked = [...muscles]
        .filter((muscle) => Number.isFinite(muscle.activation))
        .sort((left, right) => right.activation - left.activation);

    for (const muscle of ranked) {
        let rowData = app.activationRows.get(muscle.name);
        if (!rowData) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'activation-row';
            row.title = `Select ${muscle.name}`;
            const name = document.createElement('span');
            name.className = 'rank-name';
            name.textContent = muscle.name;
            const track = document.createElement('span');
            track.className = 'rank-track';
            const fill = document.createElement('span');
            fill.className = 'rank-fill';
            track.append(fill);
            const value = document.createElement('span');
            value.className = 'rank-value';
            row.append(name, track, value);
            row.addEventListener('click', () => selectMuscle(muscle.name));
            rowData = { row, fill, value };
            app.activationRows.set(muscle.name, rowData);
        }

        const { row, fill, value } = rowData;
        fill.style.width = `${THREE.MathUtils.clamp(muscle.activation, 0, 1) * 100}%`;
        fill.style.background = activationColor(muscle.activation).getStyle();
        value.textContent = muscle.activation.toFixed(3);
        row.setAttribute(
            'aria-label',
            `${muscle.name}, activation ${muscle.activation.toFixed(3)}`
        );
        host.append(row);
    }
}

function updateCoordinateReadings(state, force = false) {
    for (const [name, value] of Object.entries(state.coordinates)) {
        const input = document.getElementById(`coordinate-${name}`);
        const output = document.getElementById(`coordinate-output-${name}`);
        if (input && (force || document.activeElement !== input) && !app.sweepPlaying) {
            input.value = String(value);
        }
        if (output) output.textContent = formatDegrees(Number(input?.value ?? value));
    }
}

function applyState(state) {
    app.state = state;
    applyMeshTransforms(state);
    const selected = renderMusclePaths(state);
    if (!selected) throw new Error(`OpenSim returned no path for ${state.selectedMuscle}.`);

    setText('#muscle-length', (selected.lengthM * 100).toFixed(2));
    setText('#path-points', String(selected.points.length));
    updateMomentArms(selected);

    const activationAvailable = state.mode === 'benchmark' || state.mode === 'matched';
    if (activationAvailable) {
        app.benchmarkTime = state.benchmark.time;
        updateBenchmarkTimeline(state.benchmark.time);
        updateCoordinateReadings(state, false);
        setText('#muscle-activation', selected.activation.toFixed(3));
        $('#activation-reading').classList.remove('hidden');
        const reading = $('#activation-reading');
        reading.style.borderLeft = `4px solid ${activationColor(selected.activation).getStyle()}`;
        $('#geometry-legend').classList.add('hidden');
        $('#activation-legend').classList.remove('hidden');
        $('#activation-ranking').classList.remove('hidden');
        $('#activation-empty').classList.add('hidden');
        updateActivationRanking(state.muscles);
        if (state.mode === 'matched') {
            $('#mode-explanation').classList.add('benchmark');
            $('#mode-explanation').innerHTML = '<strong>Exact angles with a closest-Reach8 activation proxy.</strong> Geometry uses the requested angles; colors use the nearest authored Reach8 frame and never move the sliders.';
            setText('#muscle-fine-print', 'Activation color is copied from the closest Reach8 frame. Geometry, path length, and moment arms use the exact requested pose.');
            setText('#effort-source-label', 'Closest Reach8 frame');
            setText('#effort-panel-title', 'All 50 activation proxies');
            setText('#effort-panel-subtitle', 'Ranked values from the authored Reach8 frame closest to the exact pose above.');
            $('#toggle-benchmark').textContent = 'Open Reach8 movement';
            if (state.match) updateReach8MatchStatus(state.match);
        }
        updateViewerSubtitle();
    } else {
        updateCoordinateReadings(state);
        $('#activation-reading').classList.add('hidden');
    }
}

function poseUrl() {
    const parameters = new URLSearchParams();
    for (const coordinate of app.model.coordinates) {
        const input = document.getElementById(`coordinate-${coordinate.name}`);
        parameters.set(coordinate.name, input.value);
    }
    parameters.set('muscle', $('#muscle-select').value);
    return `/api/pose?${parameters.toString()}`;
}

function nearestBenchmarkUrl() {
    const parameters = new URLSearchParams({
        t: String(app.benchmarkTime),
        muscle: $('#muscle-select').value
    });
    for (const coordinate of app.model.coordinates) {
        const input = document.getElementById(`coordinate-${coordinate.name}`);
        parameters.set(coordinate.name, input.value);
    }
    return `/api/benchmark/nearest?${parameters.toString()}`;
}

async function requestPose() {
    const requestId = app.poseRequest + 1;
    app.poseRequest = requestId;
    try {
        const state = await fetchJson(poseUrl());
        const nearest = await fetchJson(nearestBenchmarkUrl());
        if (requestId !== app.poseRequest || app.mode !== 'pose') return;
        const activations = new Map(
            nearest.muscles.map((muscle) => [muscle.name, muscle.activation])
        );
        for (const muscle of state.muscles) {
            muscle.activation = activations.get(muscle.name);
        }
        state.mode = 'matched';
        state.benchmark = nearest.benchmark;
        state.match = nearest.match;
        applyState(state);
        clearError();
    } catch (error) {
        if (requestId === app.poseRequest && app.mode === 'pose') {
            showError(`The exact pose or closest Reach8 activation frame could not be calculated: ${error.message}`);
        }
    }
}

function schedulePose(delay = 65) {
    window.clearTimeout(app.poseTimer);
    app.poseTimer = window.setTimeout(requestPose, delay);
}

function commitAngleChange(delay = 65) {
    stopSweep();
    if (app.mode === 'benchmark') setMode('pose');
    else {
        $('#position-status').className = 'position-status effort matching';
        $('#position-status').innerHTML = '<strong>Exact pose · updating activation colors</strong><span>Your angles remain unchanged while the closest Reach8 frame is found.</span>';
        schedulePose(delay);
    }
}

async function requestBenchmarkFrame(time) {
    if (app.mode !== 'benchmark') return;
    if (app.benchmarkRequestInFlight) {
        app.queuedBenchmarkTime = time;
        return;
    }
    app.benchmarkRequestInFlight = true;
    const generation = app.benchmarkGeneration;
    const requestedMuscle = $('#muscle-select').value;
    try {
        const parameters = new URLSearchParams({
            t: String(time),
            muscle: requestedMuscle
        });
        const state = await fetchJson(`/api/benchmark/frame?${parameters.toString()}`);
        if (app.mode === 'benchmark' && generation === app.benchmarkGeneration &&
                $('#muscle-select').value === requestedMuscle) {
            applyState(state);
            clearError();
        }
    } catch (error) {
        if (app.mode === 'benchmark') {
            stopBenchmark();
            showError(`The CMC benchmark frame could not be loaded: ${error.message}`);
        }
    } finally {
        app.benchmarkRequestInFlight = false;
        if (app.mode === 'benchmark' && app.queuedBenchmarkTime !== null) {
            const queued = app.queuedBenchmarkTime;
            app.queuedBenchmarkTime = null;
            requestBenchmarkFrame(queued);
        }
    }
}

function updateReach8MatchStatus(match) {
    const names = Object.keys(match.requested ?? {});
    $('#position-status').className = 'position-status effort match';
    if (names.length === 1) {
        const name = names[0];
        const coordinate = app.model.coordinates.find((item) => item.name === name);
        const requested = Number(match.requested[name]);
        const actual = Number(match.actual[name]);
        const difference = actual - requested;
        const sign = difference > 0.05 ? '+' : '';
        $('#position-status').innerHTML = `<strong>Exact pose · colors from Reach8 ${formatTime(match.time)}</strong><span>Your angle stays at ${formatDegrees(requested)}. The color source used ${formatDegrees(actual)} for ${coordinate?.label ?? name} (${sign}${difference.toFixed(1)}° difference).</span>`;
    } else {
        $('#position-status').innerHTML = `<strong>Exact pose · colors from Reach8 ${formatTime(match.time)}</strong><span>Your angles are unchanged. Closest recorded posture: maximum difference ${Number(match.maxErrorDegrees).toFixed(1)}°, RMS difference ${Number(match.rmsErrorDegrees).toFixed(1)}° across ${names.length} angles.</span>`;
    }
}

async function requestNearestBenchmark(values, generation) {
    if (app.mode !== 'benchmark' || generation !== app.benchmarkGeneration) return;
    const requestedMuscle = $('#muscle-select').value;
    const parameters = new URLSearchParams({
        t: String(app.benchmarkTime),
        muscle: requestedMuscle
    });
    for (const [name, value] of Object.entries(values)) {
        parameters.set(name, String(value));
    }
    try {
        const state = await fetchJson(`/api/benchmark/nearest?${parameters.toString()}`);
        if (app.mode === 'benchmark' && generation === app.benchmarkGeneration &&
                $('#muscle-select').value === requestedMuscle) {
            applyState(state);
            clearError();
        }
    } catch (error) {
        if (app.mode === 'benchmark' && generation === app.benchmarkGeneration) {
            showError(`The closest Reach8 effort frame could not be calculated: ${error.message}`);
        }
    }
}

function scheduleNearestBenchmark(values, delay = 80) {
    stopBenchmark();
    window.clearTimeout(app.nearestTimer);
    app.queuedBenchmarkTime = null;
    const generation = app.benchmarkGeneration + 1;
    app.benchmarkGeneration = generation;
    $('#position-status').className = 'position-status effort matching';
    $('#position-status').innerHTML = '<strong>Finding the closest Reach8 frame…</strong><span>Activation colors remain tied to an authored simulation frame.</span>';
    app.nearestTimer = window.setTimeout(
        () => requestNearestBenchmark(values, generation),
        delay
    );
}

function stopSweep() {
    app.sweepPlaying = false;
}

function stopBenchmark() {
    app.benchmarkPlaying = false;
    $('#toggle-benchmark').textContent = 'Play';
    $('#toggle-benchmark').setAttribute('aria-pressed', 'false');
}

function buildCoordinateControls() {
    const controls = $('#coordinate-controls');
    controls.replaceChildren();

    for (const coordinate of app.model.coordinates) {
        const wrapper = document.createElement('div');
        wrapper.className = 'coordinate-control';
        const label = document.createElement('label');
        label.className = 'coordinate-label';
        label.htmlFor = `coordinate-${coordinate.name}`;
        const labelText = document.createElement('span');
        labelText.textContent = coordinate.label;
        const output = document.createElement('output');
        output.id = `coordinate-output-${coordinate.name}`;
        output.textContent = formatDegrees(coordinate.default);
        label.append(labelText, output);

        const input = document.createElement('input');
        input.type = 'range';
        input.id = `coordinate-${coordinate.name}`;
        input.min = coordinate.min;
        input.max = coordinate.max;
        input.step = '0.5';
        input.value = coordinate.default;
        input.dataset.default = coordinate.default;
        input.addEventListener('input', () => {
            output.textContent = formatDegrees(Number(input.value));
            for (const button of document.querySelectorAll('[data-preset]')) {
                button.classList.remove('active');
            }
            commitAngleChange();
        });

        const limits = document.createElement('div');
        limits.className = 'range-limits';
        const minimum = document.createElement('span');
        minimum.textContent = formatDegrees(coordinate.min);
        const maximum = document.createElement('span');
        maximum.textContent = formatDegrees(coordinate.max);
        limits.append(minimum, maximum);
        wrapper.append(label, input, limits);
        controls.append(wrapper);

    }
}

function buildMuscleSelect() {
    const select = $('#muscle-select');
    select.replaceChildren();
    for (const name of app.model.muscles) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        if (name === 'BIClong') option.selected = true;
        select.append(option);
    }
}

function resetPose() {
    stopSweep();
    stopBenchmark();
    for (const coordinate of app.model.coordinates) {
        const input = document.getElementById(`coordinate-${coordinate.name}`);
        input.value = String(coordinate.default);
        setText(`#coordinate-output-${coordinate.name}`, formatDegrees(coordinate.default));
    }
    for (const button of document.querySelectorAll('[data-preset]')) {
        button.classList.remove('active');
    }
    if (app.mode === 'benchmark') setMode('pose');
    else schedulePose(0);
}

function applyPosePreset(name) {
    const values = POSE_PRESETS[name];
    if (!values) return;
    stopBenchmark();
    for (const coordinate of app.model.coordinates) {
        const value = values[coordinate.name] ?? coordinate.default;
        const input = document.getElementById(`coordinate-${coordinate.name}`);
        input.value = String(value);
        setText(`#coordinate-output-${coordinate.name}`, formatDegrees(value));
    }
    for (const button of document.querySelectorAll('[data-preset]')) {
        button.classList.toggle('active', button.dataset.preset === name);
    }
    commitAngleChange(0);
}

function updateInventory() {
    const counts = app.model.counts;
    setText('#count-bodies', counts.bodies);
    setText('#count-muscles', counts.muscles);
    setText('#count-ligaments', counts.ligaments);
    setText('#count-meshes', counts.meshes);
    setText(
        '#runtime-note',
        `Authored for OpenSim ${app.health.model.sourceVersion}; loaded by OpenSim ${app.health.model.runtimeVersion}. ${app.health.validation}`
    );
    setText('#model-hash', `Model SHA-256: ${app.model.source.modelSha256}`);
    setText('#benchmark-hash', `CMC states SHA-256: ${app.benchmark.source.sha256}`);
    setText(
        '#gpu-note',
        app.health.gpu.available
            ? `GPU visible: ${app.health.gpu.name} (OpenSim state calculations use CPU)`
            : 'GPU not reported; OpenSim state calculations use CPU'
    );
}

function configureBenchmarkTimeline() {
    app.benchmarkTime = app.benchmark.timeStart;
    app.benchmarkAnchorTime = app.benchmark.timeStart;
    const timeline = $('#benchmark-timeline');
    timeline.min = String(app.benchmark.timeStart);
    timeline.max = String(app.benchmark.timeEnd);
    timeline.value = String(app.benchmark.timeStart);
    setText('#benchmark-start', formatTime(app.benchmark.timeStart));
    setText('#benchmark-end', formatTime(app.benchmark.timeEnd));
    updateBenchmarkTimeline(app.benchmark.timeStart);
}

function updateBenchmarkTimeline(time) {
    const value = THREE.MathUtils.clamp(
        Number(time),
        app.benchmark.timeStart,
        app.benchmark.timeEnd
    );
    if (document.activeElement !== $('#benchmark-timeline')) {
        $('#benchmark-timeline').value = String(value);
    }
    setText('#benchmark-time', formatTime(value));
}

function setMode(mode) {
    if (mode === app.mode && app.state) return;
    app.mode = mode;
    stopSweep();
    stopBenchmark();
    window.clearTimeout(app.nearestTimer);
    app.benchmarkGeneration += 1;
    app.queuedBenchmarkTime = null;
    window.clearTimeout(app.poseTimer);
    app.poseRequest += 1;

    const benchmarkMode = mode === 'benchmark';
    $('#geometry-legend').classList.toggle('hidden', benchmarkMode);
    $('#activation-legend').classList.toggle('hidden', !benchmarkMode);
    $('#activation-reading').classList.toggle('hidden', !benchmarkMode);
    $('#activation-ranking').classList.toggle('hidden', !benchmarkMode);
    $('#activation-empty').classList.toggle('hidden', benchmarkMode);
    updateViewerSubtitle();

    if (benchmarkMode) {
        for (const button of document.querySelectorAll('[data-preset]')) {
            button.classList.remove('active');
        }
        $('#mode-explanation').classList.add('benchmark');
        $('#mode-explanation').innerHTML = '<strong>Reach8 effort data is active.</strong> Muscle colors and rankings come from the authors\' recorded CMC simulation. Move the timeline or press Play to inspect it.';
        setText('#muscle-fine-print', 'Activation is the selected effort proxy. It is a stored CMC model state—not measured patient effort, force, pain, or tissue damage.');
        setText('#effort-source-label', 'Current Reach8 frame');
        setText('#effort-panel-title', 'All 50 muscle activations');
        setText('#effort-panel-subtitle', 'Every modeled compartment, ranked by its value at the current frame.');
        $('#toggle-benchmark').textContent = 'Play';
        $('#position-status').className = 'position-status effort';
        $('#position-status').innerHTML = '<strong>Reach8 effort is available</strong><span>The sliders show this recorded frame. Moving one keeps the new angle exact and rematches the activation colors.</span>';
        requestBenchmarkFrame(app.benchmarkTime);
    } else {
        $('#mode-explanation').classList.remove('benchmark');
        $('#mode-explanation').innerHTML = '<strong>Updating the exact pose.</strong> Finding the closest authored Reach8 frame for activation color coding.';
        setText('#muscle-fine-print', 'Geometry uses the exact requested pose. Activation color will use the closest authored Reach8 frame.');
        setText('#effort-source-label', 'Matching Reach8');
        setText('#effort-panel-title', 'Updating activation proxies');
        setText('#effort-panel-subtitle', 'Comparing the requested angles with the authored Reach8 movement.');
        $('#toggle-benchmark').textContent = 'Open Reach8 movement';
        $('#position-status').className = 'position-status effort matching';
        $('#position-status').innerHTML = '<strong>Exact pose · matching activation colors</strong><span>Your angles will remain unchanged.</span>';
        requestPose();
    }
}

function toggleBenchmark() {
    if (app.mode !== 'benchmark') {
        setMode('benchmark');
        return;
    }
    if (app.benchmarkPlaying) {
        stopBenchmark();
        return;
    }
    window.clearTimeout(app.nearestTimer);
    app.benchmarkGeneration += 1;
    app.queuedBenchmarkTime = null;
    app.benchmarkPlaying = true;
    app.benchmarkAnchorTime = app.benchmarkTime;
    app.benchmarkAnchorStamp = performance.now();
    app.lastBenchmarkRequest = 0;
    $('#toggle-benchmark').textContent = 'Pause';
    $('#toggle-benchmark').setAttribute('aria-pressed', 'true');
    $('#position-status').className = 'position-status effort';
    $('#position-status').innerHTML = '<strong>Effort linked to Reach8</strong><span>Sliders follow the current authored frame.</span>';
}

function updateBenchmarkPlayback(timestamp) {
    if (app.mode !== 'benchmark' || !app.benchmarkPlaying) return;
    const duration = app.benchmark.timeEnd - app.benchmark.timeStart;
    let desired = app.benchmarkAnchorTime + (timestamp - app.benchmarkAnchorStamp) / 1000;
    if (desired > app.benchmark.timeEnd) {
        desired = app.benchmark.timeStart + ((desired - app.benchmark.timeStart) % duration);
        app.benchmarkAnchorTime = desired;
        app.benchmarkAnchorStamp = timestamp;
    }
    app.benchmarkTime = desired;
    updateBenchmarkTimeline(desired);
    if (timestamp - app.lastBenchmarkRequest >= 80) {
        app.lastBenchmarkRequest = timestamp;
        requestBenchmarkFrame(desired);
    }
}

function resizeRenderer() {
    const width = Math.max(sceneHost.clientWidth, 1);
    const height = Math.max(sceneHost.clientHeight, 1);
    const pixelRatio = renderer.getPixelRatio();
    if (renderer.domElement.width !== Math.floor(width * pixelRatio) ||
            renderer.domElement.height !== Math.floor(height * pixelRatio)) {
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }
}

function animate(timestamp) {
    updateBenchmarkPlayback(timestamp);
    resizeRenderer();
    updateCamera();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}

function attachViewerInteraction() {
    const canvas = renderer.domElement;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener('pointerdown', (event) => {
        dragging = true;
        lastX = event.clientX;
        lastY = event.clientY;
        canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        orbitYaw -= (event.clientX - lastX) * 0.008;
        orbitPitch = THREE.MathUtils.clamp(
            orbitPitch + (event.clientY - lastY) * 0.006,
            -1.25,
            1.25
        );
        lastX = event.clientX;
        lastY = event.clientY;
    });
    const endDrag = (event) => {
        dragging = false;
        if (canvas.hasPointerCapture(event.pointerId)) {
            canvas.releasePointerCapture(event.pointerId);
        }
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('wheel', (event) => {
        event.preventDefault();
        orbitRadius = THREE.MathUtils.clamp(
            orbitRadius * Math.exp(event.deltaY * 0.0012),
            0.18,
            8
        );
    }, { passive: false });
}

async function initialize() {
    attachViewerInteraction();
    requestAnimationFrame(animate);
    try {
        setLoading('Reading the official model and benchmark inventory…');
        [app.health, app.model, app.benchmark] = await Promise.all([
            fetchJson('/api/health'),
            fetchJson('/api/model'),
            fetchJson('/api/benchmark')
        ]);
        $('#server-status').className = 'server-status online';
        $('#server-status span:last-child').textContent = 'OpenSim connected';
        updateInventory();
        buildCoordinateControls();
        buildMuscleSelect();
        setPathView('all', false);
        configureBenchmarkTimeline();

        setLoading('Calculating the default OpenSim pose…');
        await requestPose();
        await loadMeshes(app.model.meshes);
        fitCameraToModel();
        setLoading('', false);
        setMode('benchmark');
    } catch (error) {
        $('#server-status').className = 'server-status offline';
        $('#server-status span:last-child').textContent = 'Unavailable';
        setLoading('', false);
        showError(`The official model could not be loaded: ${error.message}`);
    }
}

$('#reset-view').addEventListener('click', resetView);
$('#reset-pose').addEventListener('click', resetPose);
$('#toggle-benchmark').addEventListener('click', toggleBenchmark);
$('#benchmark-timeline').addEventListener('input', (event) => {
    stopBenchmark();
    app.benchmarkTime = Number(event.target.value);
    updateBenchmarkTimeline(app.benchmarkTime);
    if (app.mode !== 'benchmark') {
        setMode('benchmark');
        return;
    }
    window.clearTimeout(app.nearestTimer);
    app.benchmarkGeneration += 1;
    app.queuedBenchmarkTime = null;
    $('#position-status').className = 'position-status effort';
    $('#position-status').innerHTML = '<strong>Effort linked to Reach8</strong><span>Timeline and angles show an authored movement frame.</span>';
    requestBenchmarkFrame(app.benchmarkTime);
});
$('#muscle-select').addEventListener('change', () => {
    if (app.mode === 'benchmark') {
        window.clearTimeout(app.nearestTimer);
        app.benchmarkGeneration += 1;
        requestBenchmarkFrame(app.benchmarkTime);
    } else {
        stopSweep();
        schedulePose(0);
    }
});
$('#view-all-muscles').addEventListener('click', () => setPathView('all'));
$('#view-one-muscle').addEventListener('click', () => setPathView('one'));
for (const button of document.querySelectorAll('[data-preset]')) {
    button.addEventListener('click', () => applyPosePreset(button.dataset.preset));
}
window.addEventListener('resize', resizeRenderer);

initialize();
