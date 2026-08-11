import * as THREE from '/vendor/three.module.min.js';

const $ = (selector) => document.querySelector(selector);

const app = {
    health: null,
    model: null,
    benchmark: null,
    supportedPoses: null,
    supportedPoseCoordinateIndex: new Map(),
    supportedPoseRanges: new Map(),
    state: null,
    staticCoordinates: null,
    mode: 'static',
    pathView: 'all',
    meshObjects: new Map(),
    pathCables: new Map(),
    activationRows: new Map(),
    muscleDetailRequest: 0,
    selectedSegments: [],
    selectedMarkers: [],
    poseTimer: null,
    poseRequest: 0,
    staticTimer: null,
    staticRequest: 0,
    staticCalculating: false,
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

function hasCompleteActivationData(state) {
    if (!state) return false;
    const acceptedSource = state.mode === 'benchmark' ||
        (state.mode === 'static' &&
            state.staticHolding?.solver?.converged === true &&
            state.staticHolding?.quality?.usable === true);
    if (!acceptedSource) return false;
    if (!Array.isArray(state.muscles) ||
            state.muscles.length !== app.model?.muscles?.length) {
        return false;
    }
    const values = new Map(
        state.muscles.map((muscle) => [muscle.name, muscle.activation])
    );
    return app.model.muscles.every((name) => Number.isFinite(values.get(name)));
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
    const activationAvailable = hasCompleteActivationData(state);
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
    } else if (app.state?.mode === 'static' && hasCompleteActivationData(app.state)) {
        setText(
            '#viewer-subtitle',
            app.pathView === 'all'
                ? 'Exact static posture with all 50 paths colored by the validated holding estimate.'
                : 'Exact static posture with the selected path colored by the validated holding estimate.'
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
    select.value = name;
    setPathView('one', false);
    if (app.state) {
        app.state.selectedMuscle = name;
        applyState(app.state);
        const requestId = app.muscleDetailRequest + 1;
        app.muscleDetailRequest = requestId;
        requestSelectedMuscleDetails(name, requestId);
    }
}

async function requestSelectedMuscleDetails(name, requestId) {
    const sourceMode = app.mode;
    let url;
    if (sourceMode === 'benchmark') {
        const parameters = new URLSearchParams({
            t: String(app.state?.benchmark?.time ?? app.benchmarkTime),
            muscle: name
        });
        url = `/api/benchmark/frame?${parameters.toString()}`;
    } else url = capturePoseRequest().exactUrl;

    try {
        const detailsState = await fetchJson(url);
        if (requestId !== app.muscleDetailRequest || app.mode !== sourceMode ||
                $('#muscle-select').value !== name || !app.state) return;
        const details = detailsState.muscles.find((muscle) => muscle.name === name);
        const current = app.state.muscles.find((muscle) => muscle.name === name);
        if (!details || !current) return;
        current.lengthM = details.lengthM;
        current.momentArms = details.momentArms;
        setText('#muscle-length', (current.lengthM * 100).toFixed(2));
        setText('#path-points', String(current.points.length));
        updateMomentArms(current);
    } catch (error) {
        if (requestId === app.muscleDetailRequest &&
                $('#muscle-select').value === name) {
            showError(`The selected muscle details could not be loaded: ${error.message}`);
        }
    }
}

function updateActivationRanking(muscles) {
    const host = $('#activation-ranking');
    host.replaceChildren();
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
        if (input && (force || document.activeElement !== input)) {
            input.value = String(value);
        }
        if (output) output.textContent = formatDegrees(Number(value));
    }
}

function setPositionStatus(className, heading, detail) {
    const status = $('#position-status');
    status.className = `position-status ${className}`;
    status.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = heading;
    const span = document.createElement('span');
    span.textContent = detail;
    status.append(strong, span);
}

function neutralizeDisplayedActivation() {
    if (app.state && hasCompleteActivationData(app.state)) {
        const neutralState = {
            ...app.state,
            mode: 'pose',
            staticHolding: null,
            muscles: app.state.muscles.map((muscle) => {
                const copy = { ...muscle };
                delete copy.activation;
                return copy;
            })
        };
        app.state = neutralState;
        renderMusclePaths(neutralState);
    }
    $('#activation-reading').classList.add('hidden');
    $('#geometry-legend').classList.remove('hidden');
    $('#activation-legend').classList.add('hidden');
    $('#activation-ranking').classList.add('hidden');
    $('#activation-ranking').replaceChildren();
    $('#activation-empty').classList.remove('hidden');
    updateViewerSubtitle();
}

function setStaticButtonState(busy, retry = false) {
    const button = $('#calculate-static');
    if (!button) return;
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
    button.textContent = busy
        ? 'Calculating…'
        : (retry ? 'Retry static calculation' : 'Calculate now');
}

function showStaticPending(phase = 'waiting') {
    neutralizeDisplayedActivation();
    const solving = phase === 'solving';
    $('#mode-explanation').className = 'mode-explanation static';
    $('#mode-explanation').innerHTML = solving
        ? '<strong>Calculating the exact static posture.</strong> Old colors stay hidden until the solver returns a result that passes its quality checks.'
        : '<strong>Static posture estimate.</strong> Geometry follows the exact slider values; activation is recalculated after the controls settle.';
    setText('#muscle-fine-print', 'Geometry, path length, and moment arms use the exact requested pose. Static activation is shown only after a validated solve.');
    setText('#effort-source-label', solving ? 'Static solve in progress' : 'Exact static posture');
    setText('#effort-panel-title', solving ? 'Calculating activation' : 'Activation pending');
    setText('#effort-panel-subtitle', 'No activation colors from an earlier posture are retained.');
    setText('#activation-empty strong', solving ? 'Calculating the holding estimate.' : 'Waiting for the exact posture.');
    setText(
        '#activation-empty span',
        solving
            ? 'OpenSim is solving all 50 muscle activations under gravity with no external hand load.'
            : 'The static solve starts automatically after the sliders stop moving.'
    );
    setPositionStatus(
        solving ? 'static' : 'manual',
        solving ? 'Calculating exact static activation' : 'Exact angles changed',
        solving
            ? 'The displayed paths remain neutral until this posture is validated.'
            : 'Geometry updates now; activation will recalculate after a short pause.'
    );
    setStaticButtonState(solving);
}

function showStaticFailure(message, analysis = null) {
    neutralizeDisplayedActivation();
    const reason = analysis?.quality?.reason || analysis?.solver?.detail ||
        analysis?.message || analysis?.reason || message ||
        'The solver did not return a validated result for this posture.';
    $('#mode-explanation').className = 'mode-explanation unavailable';
    $('#mode-explanation').innerHTML = '<strong>Static activation was not accepted.</strong> The exact geometry remains visible, but no effort colors are shown.';
    setText('#muscle-fine-print', 'The exact posture geometry remains available. No activation is shown because the static solve failed or did not pass its quality checks.');
    setText('#effort-source-label', 'Static result withheld');
    setText('#effort-panel-title', 'Activation not shown');
    setText('#effort-panel-subtitle', reason);
    setText('#activation-empty strong', 'No activation colors shown.');
    setText('#activation-empty span', `${reason} Adjust the posture or retry the calculation.`);
    setPositionStatus(
        'unavailable',
        'Static activation withheld',
        reason
    );
    setStaticButtonState(false, true);
    updateViewerSubtitle();
}

function describeStaticQuality(analysis) {
    const details = [];
    const elapsed = Number(analysis?.solver?.durationMs);
    const reserve = Number(analysis?.quality?.maxReserveTorqueNm);
    if (Number.isFinite(elapsed)) details.push(`Solved in ${elapsed.toFixed(0)} ms`);
    if (Number.isFinite(reserve)) details.push(`maximum reserve ${reserve.toFixed(3)} N·m`);
    return details.length ? `${details.join(' · ')}.` : 'Backend convergence and quality checks passed.';
}

function applyState(state) {
    app.state = state;
    if (app.mode === 'static' && state.coordinates) {
        app.staticCoordinates = { ...state.coordinates };
    }
    applyMeshTransforms(state);
    const selected = renderMusclePaths(state);
    if (!selected) throw new Error(`OpenSim returned no path for ${state.selectedMuscle}.`);

    setText('#muscle-length', (selected.lengthM * 100).toFixed(2));
    setText('#path-points', String(selected.points.length));
    updateMomentArms(selected);

    const activationAvailable = hasCompleteActivationData(state);
    if (activationAvailable) {
        if (state.mode === 'benchmark' &&
                !(app.mode === 'benchmark' && app.benchmarkPlaying)) {
            app.benchmarkTime = state.benchmark.time;
            updateBenchmarkTimeline(state.benchmark.time);
        }
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
        if (state.mode === 'benchmark') {
            setText(
                '#effort-panel-subtitle',
                `Every modeled compartment at authored frame ${state.benchmark.frame + 1} of ${app.supportedPoses.poses.length}, ${formatTime(state.benchmark.time)}.`
            );
            setPositionStatus(
                'effort',
                'Recorded Reach8 activation',
                `Authored frame ${state.benchmark.frame + 1} of ${app.supportedPoses.poses.length} at ${formatTime(state.benchmark.time)}.`
            );
        } else if (state.mode === 'static') {
            const quality = describeStaticQuality(state.staticHolding);
            $('#mode-explanation').className = 'mode-explanation static';
            $('#mode-explanation').innerHTML = '<strong>Validated static posture estimate.</strong> Colors show the generic model’s minimum-effort solution for holding these exact angles under gravity, with no external hand load.';
            setText('#muscle-fine-print', 'Static activation is a generic optimized model estimate under gravity, not measured patient effort, force, pain, injury, or diagnostic confidence.');
            setText('#effort-source-label', 'Validated static solve');
            setText('#effort-panel-title', 'All 50 static activation estimates');
            setText('#effort-panel-subtitle', quality);
            setText('#activation-note', 'Effort proxy—not patient data. This is a generic minimum-effort holding solution; real co-contraction and patient-specific recruitment may differ.');
            setPositionStatus('static', 'Static holding estimate ready', quality);
            setStaticButtonState(false);
        }
        updateViewerSubtitle();
    } else {
        updateCoordinateReadings(state);
        if (app.mode === 'static' && !app.staticCalculating) showStaticPending('waiting');
    }
}

function capturePoseRequest() {
    const parameters = new URLSearchParams();
    for (const coordinate of app.model.coordinates) {
        const input = document.getElementById(`coordinate-${coordinate.name}`);
        parameters.set(coordinate.name, input.value);
    }
    parameters.set('muscle', $('#muscle-select').value);
    return {
        exactUrl: `/api/pose?${parameters.toString()}`,
        staticUrl: `/api/static-hold?${parameters.toString()}`,
        muscle: $('#muscle-select').value
    };
}

async function requestPose(snapshot = capturePoseRequest(), requestId = null) {
    if (requestId === null) {
        requestId = ++app.poseRequest;
    }
    try {
        const state = await fetchJson(snapshot.exactUrl);
        if (requestId !== app.poseRequest || app.mode !== 'static') return;
        state.mode = 'pose';
        for (const muscle of state.muscles) delete muscle.activation;
        applyState(state);
        clearError();
    } catch (error) {
        if (requestId !== app.poseRequest || app.mode !== 'static') return;
        showError(`The exact pose geometry could not be updated: ${error.message}`);
    }
}

function schedulePose(delay = 65) {
    window.clearTimeout(app.poseTimer);
    const snapshot = capturePoseRequest();
    const requestId = ++app.poseRequest;
    app.poseTimer = window.setTimeout(
        () => requestPose(snapshot, requestId),
        delay
    );
}

function scheduleStaticSolve(delay = 550) {
    window.clearTimeout(app.staticTimer);
    const requestId = ++app.staticRequest;
    app.staticTimer = window.setTimeout(() => {
        if (requestId === app.staticRequest && app.mode === 'static') {
            calculateStaticActivation();
        }
    }, delay);
}

async function calculateStaticActivation() {
    if (app.mode !== 'static') return;
    window.clearTimeout(app.staticTimer);
    const snapshot = capturePoseRequest();
    const requestId = ++app.staticRequest;
    app.staticCalculating = true;
    showStaticPending('solving');
    clearError();
    try {
        const state = await fetchJson(snapshot.staticUrl);
        if (requestId !== app.staticRequest || app.mode !== 'static') return;
        if (state.mode !== 'static') {
            throw new Error('The server did not identify this as a static analysis result.');
        }
        if (state.staticHolding?.solver?.converged !== true ||
                state.staticHolding?.quality?.usable !== true) {
            const reason = state.staticHolding?.quality?.reason ||
                state.staticHolding?.solver?.detail ||
                'The solver did not accept this posture.';
            window.clearTimeout(app.poseTimer);
            app.poseRequest += 1;
            const analysis = state.staticHolding;
            state.mode = 'pose';
            for (const muscle of state.muscles ?? []) delete muscle.activation;
            applyState(state);
            showStaticFailure(reason, analysis);
            clearError();
            return;
        }
        if (!hasCompleteActivationData(state)) {
            throw new Error('The validated static result did not include all 50 finite activation values.');
        }
        window.clearTimeout(app.poseTimer);
        app.poseRequest += 1;
        applyState(state);
    } catch (error) {
        if (requestId !== app.staticRequest || app.mode !== 'static') return;
        showStaticFailure(error.message);
        showError(`Static activation could not be calculated: ${error.message}`);
    } finally {
        if (requestId === app.staticRequest && app.mode === 'static') {
            app.staticCalculating = false;
            if (hasCompleteActivationData(app.state)) setStaticButtonState(false);
        }
    }
}

function commitAngleChange(geometryDelay = 55, solveDelay = 550) {
    stopSweep();
    if (app.mode !== 'static') setMode('static');
    app.staticCalculating = false;
    app.staticRequest += 1;
    showStaticPending('waiting');
    schedulePose(geometryDelay);
    scheduleStaticSolve(solveDelay);
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
        if (app.mode === 'benchmark' && generation === app.benchmarkGeneration &&
                $('#muscle-select').value === requestedMuscle) {
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
    const coverage = match.coverage?.status === 'high'
        ? 'high-coverage projection'
        : 'approximate projection';
    const detail = `Angles remain exact. Nearest point on Reach8: maximum difference ${Number(match.maxErrorDegrees).toFixed(1)} degrees, RMS ${Number(match.rmsErrorDegrees).toFixed(1)} degrees across ${names.length} angles.`;
    setPositionStatus(
        'effort match',
        `Exact pose - ${coverage} at ${formatTime(match.time)}`,
        detail
    );
    setText(
        '#effort-panel-subtitle',
        `Linear interpolation along Reach8 near ${formatTime(match.time)}. ${detail}`
    );
}

function stopSweep() {
    app.sweepPlaying = false;
}

function stopBenchmark() {
    app.benchmarkPlaying = false;
    $('#toggle-benchmark').textContent = app.mode === 'benchmark'
        ? 'Play'
        : 'Open Reach8 movement';
    $('#toggle-benchmark').setAttribute('aria-pressed', 'false');
}

function buildCoordinateControls() {
    const controls = $('#coordinate-controls');
    controls.replaceChildren();

    for (const coordinate of app.model.coordinates) {
        const wrapper = document.createElement('div');
        wrapper.className = 'coordinate-control';
        const label = document.createElement('div');
        label.className = 'coordinate-label';
        const labelText = document.createElement('span');
        labelText.textContent = coordinate.label;
        const output = document.createElement('output');
        output.id = `coordinate-output-${coordinate.name}`;
        output.htmlFor = `coordinate-${coordinate.name}`;
        output.textContent = formatDegrees(coordinate.default);
        label.append(labelText, output);

        const input = document.createElement('input');
        input.type = 'range';
        input.id = `coordinate-${coordinate.name}`;
        const minimumValue = Math.round(Number(coordinate.min) * 10) / 10;
        const maximumValue = Math.round(Number(coordinate.max) * 10) / 10;
        input.min = String(minimumValue);
        input.max = String(maximumValue);
        input.step = '0.5';
        input.value = String(coordinate.default);
        input.dataset.default = String(coordinate.default);
        input.setAttribute('aria-label', coordinate.label);
        input.addEventListener('input', () => {
            output.textContent = formatDegrees(Number(input.value));
            app.staticCoordinates[coordinate.name] = Number(input.value);
            for (const button of document.querySelectorAll('[data-preset]')) {
                button.classList.remove('active');
                button.setAttribute('aria-pressed', 'false');
            }
            commitAngleChange();
        });
        input.addEventListener('change', () => scheduleStaticSolve(100));

        const limits = document.createElement('div');
        limits.className = 'range-limits';
        const minimum = document.createElement('span');
        minimum.textContent = formatDegrees(minimumValue);
        const maximum = document.createElement('span');
        maximum.textContent = formatDegrees(maximumValue);
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
    if (app.mode === 'benchmark') {
        app.benchmarkTime = app.benchmark.timeStart;
        updateBenchmarkTimeline(app.benchmarkTime);
        app.benchmarkGeneration += 1;
        requestBenchmarkFrame(app.benchmarkTime);
        return;
    }
    for (const button of document.querySelectorAll('[data-preset]')) {
        button.classList.remove('active');
        button.setAttribute('aria-pressed', 'false');
    }
    for (const coordinate of app.model.coordinates) {
        const value = Number(coordinate.default);
        app.staticCoordinates[coordinate.name] = value;
        const input = document.getElementById(`coordinate-${coordinate.name}`);
        input.value = String(value);
        setText(`#coordinate-output-${coordinate.name}`, formatDegrees(value));
    }
    commitAngleChange(0, 100);
}

function applyPosePreset(name) {
    const values = POSE_PRESETS[name];
    if (!values) return;
    if (app.mode !== 'static') setMode('static');
    stopBenchmark();
    for (const coordinate of app.model.coordinates) {
        const value = values[coordinate.name] ?? coordinate.default;
        app.staticCoordinates[coordinate.name] = Number(value);
        const input = document.getElementById(`coordinate-${coordinate.name}`);
        input.value = String(value);
        setText(`#coordinate-output-${coordinate.name}`, formatDegrees(value));
    }
    for (const button of document.querySelectorAll('[data-preset]')) {
        const active = button.dataset.preset === name;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    }
    commitAngleChange(0, 100);
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

function setMode(mode, force = false) {
    const nextMode = mode === 'benchmark' ? 'benchmark' : 'static';
    if (!force && nextMode === app.mode && app.state) return;
    app.mode = nextMode;
    stopSweep();
    stopBenchmark();
    app.benchmarkGeneration += 1;
    app.queuedBenchmarkTime = null;
    window.clearTimeout(app.poseTimer);
    window.clearTimeout(app.staticTimer);
    app.poseRequest += 1;
    app.staticRequest += 1;
    app.staticCalculating = false;
    clearError();

    const benchmarkMode = nextMode === 'benchmark';
    $('#mode-static').classList.toggle('active', !benchmarkMode);
    $('#mode-benchmark').classList.toggle('active', benchmarkMode);
    $('#mode-static').setAttribute('aria-pressed', String(!benchmarkMode));
    $('#mode-benchmark').setAttribute('aria-pressed', String(benchmarkMode));
    $('#benchmark-transport').classList.toggle('hidden', !benchmarkMode);
    $('#static-presets').classList.toggle('hidden', benchmarkMode);
    $('#static-actions').classList.toggle('hidden', benchmarkMode);
    $('#activation-panel').classList.toggle('static-source', !benchmarkMode);
    $('#reset-pose').textContent = benchmarkMode ? 'Restart movement' : 'Reset posture';
    for (const coordinate of app.model.coordinates) {
        const input = document.getElementById(`coordinate-${coordinate.name}`);
        input.disabled = benchmarkMode;
    }

    if (benchmarkMode) {
        neutralizeDisplayedActivation();
        for (const button of document.querySelectorAll('[data-preset]')) {
            button.classList.remove('active');
            button.setAttribute('aria-pressed', 'false');
        }
        $('#mode-explanation').classList.add('benchmark');
        $('#mode-explanation').classList.remove('unavailable');
        $('#mode-explanation').innerHTML = '<strong>Reach8 authored movement reference.</strong> Colors and angles come directly from the authors\' stored CMC simulation. These values are not mixed with the static-posture solver.';
        setText('#muscle-fine-print', 'Activation is a stored OpenSim CMC model state - not measured patient effort, force, pain, or tissue damage.');
        setText('#effort-source-label', 'Current Reach8 frame');
        setText('#effort-panel-title', 'All 50 muscle activations');
        setText('#effort-panel-subtitle', 'Every modeled compartment, ranked by its value at the current frame.');
        setText('#activation-note', 'Effort proxy—not patient data. Reach8 activation is an authored CMC model state, not muscle force, pain, damage, fatigue, or diagnostic confidence.');
        setText('#angle-control-note', 'Reach8 angles are read-only here and follow the authored movement timeline. Return to Static posture estimate to choose exact angles.');
        $('#toggle-benchmark').textContent = 'Play';
        setPositionStatus(
            'effort',
            'Recorded Reach8 activation',
            'The disabled sliders report the current authored frame; use the timeline below to move through the recording.'
        );
        requestBenchmarkFrame(app.benchmarkTime);
    } else {
        for (const coordinate of app.model.coordinates) {
            const value = Number(app.staticCoordinates?.[coordinate.name] ?? coordinate.default);
            const input = document.getElementById(`coordinate-${coordinate.name}`);
            input.value = String(value);
            setText(`#coordinate-output-${coordinate.name}`, formatDegrees(value));
        }
        setText('#angle-control-note', 'Exact static angles: geometry follows the sliders. Changing a value clears the previous colors and automatically solves this exact posture after a short pause; Reach8 is not used.');
        setText('#activation-note', 'Effort proxy—not patient data. Static activation is a generic minimum-effort holding estimate, not muscle force, pain, damage, fatigue, or diagnostic confidence.');
        showStaticPending('waiting');
        schedulePose(0);
        scheduleStaticSolve(180);
    }
    updateViewerSubtitle();
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
    app.benchmarkGeneration += 1;
    app.queuedBenchmarkTime = null;
    app.benchmarkPlaying = true;
    app.benchmarkAnchorTime = app.benchmarkTime;
    app.benchmarkAnchorStamp = performance.now();
    app.lastBenchmarkRequest = 0;
    $('#toggle-benchmark').textContent = 'Pause';
    $('#toggle-benchmark').setAttribute('aria-pressed', 'true');
    setPositionStatus(
        'effort',
        'Recorded Reach8 activation',
        'The angle controls follow the current authored frame.'
    );
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
        [app.health, app.model, app.benchmark, app.supportedPoses] = await Promise.all([
            fetchJson('/api/health'),
            fetchJson('/api/model'),
            fetchJson('/api/benchmark'),
            fetchJson('/api/benchmark/poses')
        ]);
        $('#server-status').className = 'server-status online';
        $('#server-status span:last-child').textContent = 'OpenSim connected';
        updateInventory();
        app.staticCoordinates = Object.fromEntries(
            app.model.coordinates.map((coordinate) => [coordinate.name, Number(coordinate.default)])
        );
        buildCoordinateControls();
        buildMuscleSelect();
        setPathView('all', false);
        configureBenchmarkTimeline();

        setLoading('Calculating the default OpenSim pose…');
        await requestPose();
        await loadMeshes(app.model.meshes);
        fitCameraToModel();
        setLoading('', false);
        setMode('static', true);
    } catch (error) {
        $('#server-status').className = 'server-status offline';
        $('#server-status span:last-child').textContent = 'Unavailable';
        setLoading('', false);
        showError(`The official model could not be loaded: ${error.message}`);
    }
}

$('#reset-view').addEventListener('click', resetView);
$('#reset-pose').addEventListener('click', resetPose);
$('#mode-static').addEventListener('click', () => setMode('static'));
$('#mode-benchmark').addEventListener('click', () => setMode('benchmark'));
$('#calculate-static').addEventListener('click', calculateStaticActivation);
$('#toggle-benchmark').addEventListener('click', toggleBenchmark);
$('#benchmark-timeline').addEventListener('input', (event) => {
    stopBenchmark();
    app.benchmarkTime = Number(event.target.value);
    updateBenchmarkTimeline(app.benchmarkTime);
    if (app.mode !== 'benchmark') {
        setMode('benchmark');
        return;
    }
    app.benchmarkGeneration += 1;
    app.queuedBenchmarkTime = null;
    setPositionStatus(
        'effort',
        'Recorded Reach8 activation',
        'Timeline and angles show an authored movement frame.'
    );
    requestBenchmarkFrame(app.benchmarkTime);
});
$('#muscle-select').addEventListener('change', () => {
    selectMuscle($('#muscle-select').value);
});
$('#view-all-muscles').addEventListener('click', () => setPathView('all'));
$('#view-one-muscle').addEventListener('click', () => setPathView('one'));
for (const button of document.querySelectorAll('[data-preset]')) {
    button.addEventListener('click', () => applyPosePreset(button.dataset.preset));
}
window.addEventListener('resize', resizeRenderer);

initialize();
