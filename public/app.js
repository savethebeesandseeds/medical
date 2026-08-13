import * as THREE from '/vendor/three.module.min.js';
import { createDiagnosisWorkflow, MOBL_ARMS_ROTATION_SIGN } from '/diagnosis.js';

const $ = (selector) => document.querySelector(selector);

const app = {
    health: null,
    model: null,
    benchmark: null,
    state: null,
    staticCoordinates: null,
    mode: 'static',
    pathView: 'all',
    presetLibraryVisible: false,
    activationPanelVisible: true,
    musclePanelVisible: true,
    mirrored: false,
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

let diagnosisViewerSnapshot = null;
let diagnosisWorkflow = null;
let viewerExporting = false;

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
const cameraAimOffset = new THREE.Vector3();
const cameraLookTarget = new THREE.Vector3();
const orbitCameraOffset = new THREE.Vector3();
const orbitXAxis = new THREE.Vector3(1, 0, 0);
const orbitYAxis = new THREE.Vector3(0, 1, 0);
const orbitOrientation = new THREE.Quaternion();
const orbitPitchRotation = new THREE.Quaternion();
const zoomRaycaster = new THREE.Raycaster();
const zoomPointer = new THREE.Vector2();
const zoomPlane = new THREE.Plane();
const zoomPlaneNormal = new THREE.Vector3();
const zoomAnchor = new THREE.Vector3();
const zoomCameraPosition = new THREE.Vector3();
const zoomNextLookTarget = new THREE.Vector3();
const zoomFromPivot = new THREE.Vector3();
const mirrorCameraPosition = new THREE.Vector3();
const mirrorLookTarget = new THREE.Vector3();
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
    'forward-reach': {
        elv_angle: 90, shoulder_elv: 45, shoulder_rot: 0,
        elbow_flexion: 30, pro_sup: 0, deviation: 0, flexion: 0
    },
    'hand-to-mouth': {
        elv_angle: 90, shoulder_elv: 35, shoulder_rot: 0,
        elbow_flexion: 120, pro_sup: MOBL_ARMS_ROTATION_SIGN.forearmSupination * 45, deviation: 0, flexion: 0
    },
    'cross-body-reach': {
        elv_angle: 130, shoulder_elv: 90, shoulder_rot: 0,
        elbow_flexion: 30, pro_sup: 0, deviation: 0, flexion: 0
    },
    'hand-behind-head': {
        elv_angle: 30, shoulder_elv: 120, shoulder_rot: MOBL_ARMS_ROTATION_SIGN.shoulderExternal * 45,
        elbow_flexion: 120, pro_sup: 0, deviation: 0, flexion: 0
    },
    'high-forward-reach': {
        elv_angle: 90, shoulder_elv: 110, shoulder_rot: 0,
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
        elv_angle: 30, shoulder_elv: 90, shoulder_rot: MOBL_ARMS_ROTATION_SIGN.shoulderInternal * 45,
        elbow_flexion: 0, pro_sup: 0, deviation: 0, flexion: 0
    },
    'external-side': {
        elv_angle: 0, shoulder_elv: 0, shoulder_rot: MOBL_ARMS_ROTATION_SIGN.shoulderExternal * 45,
        elbow_flexion: 90, pro_sup: 0, deviation: 0, flexion: 0
    },
    'internal-side': {
        elv_angle: 0, shoulder_elv: 0, shoulder_rot: MOBL_ARMS_ROTATION_SIGN.shoulderInternal * 45,
        elbow_flexion: 90, pro_sup: 0, deviation: 0, flexion: 0
    },
    'rotation-90-90': {
        elv_angle: 0, shoulder_elv: 90, shoulder_rot: MOBL_ARMS_ROTATION_SIGN.shoulderExternal * 45,
        elbow_flexion: 90, pro_sup: 0, deviation: 0, flexion: 0
    },
    'elbow-90': {
        elv_angle: 0, shoulder_elv: 0, shoulder_rot: 0,
        elbow_flexion: 90, pro_sup: 0, deviation: 0, flexion: 0
    },
    'elbow-supinated': {
        elv_angle: 0, shoulder_elv: 0, shoulder_rot: 0,
        elbow_flexion: 90, pro_sup: MOBL_ARMS_ROTATION_SIGN.forearmSupination * 60, deviation: 0, flexion: 0
    },
    'elbow-120': {
        elv_angle: 0, shoulder_elv: 0, shoulder_rot: 0,
        elbow_flexion: 120, pro_sup: 0, deviation: 0, flexion: 0
    },
    'forearm-pronated': {
        elv_angle: 0, shoulder_elv: 0, shoulder_rot: 0,
        elbow_flexion: 90, pro_sup: MOBL_ARMS_ROTATION_SIGN.forearmPronation * 60, deviation: 0, flexion: 0
    },
    'wrist-extension-30': {
        elv_angle: 0, shoulder_elv: 0, shoulder_rot: 0,
        elbow_flexion: 90, pro_sup: 0, deviation: 0, flexion: -30
    },
    'wrist-flexion-30': {
        elv_angle: 0, shoulder_elv: 0, shoulder_rot: 0,
        elbow_flexion: 90, pro_sup: 0, deviation: 0, flexion: 30
    },
    'wrist-deviation-positive': {
        elv_angle: 0, shoulder_elv: 0, shoulder_rot: 0,
        elbow_flexion: 90, pro_sup: 0, deviation: 20, flexion: 0
    },
    'wrist-deviation-negative': {
        elv_angle: 0, shoulder_elv: 0, shoulder_rot: 0,
        elbow_flexion: 90, pro_sup: 0, deviation: -10, flexion: 0
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

function setOrbitOrientation() {
    orbitOrientation.setFromAxisAngle(orbitYAxis, orbitYaw);
    orbitPitchRotation.setFromAxisAngle(orbitXAxis, -orbitPitch);
    orbitOrientation.multiply(orbitPitchRotation);
}

function updateCamera() {
    setOrbitOrientation();
    orbitCameraOffset.set(0, 0, orbitRadius).applyQuaternion(orbitOrientation);
    camera.position.copy(cameraTarget).add(orbitCameraOffset);
    cameraLookTarget.copy(cameraAimOffset)
        .applyQuaternion(orbitOrientation)
        .add(cameraTarget);
    camera.lookAt(cameraLookTarget);
}

function resetView() {
    orbitYaw = 0.72;
    orbitPitch = 0.12;
    cameraAimOffset.set(0, 0, 0);
    if (app.meshObjects.size) fitCameraToModel();
    updateCamera();
}

function setMirroredView(mirrored) {
    const nextMirrored = Boolean(mirrored);
    if (nextMirrored === app.mirrored) return;
    if (app.cameraFitted) {
        setOrbitOrientation();
        cameraLookTarget.copy(cameraAimOffset)
            .applyQuaternion(orbitOrientation)
            .add(cameraTarget);
        mirrorCameraPosition.copy(camera.position);
        mirrorLookTarget.copy(cameraLookTarget);
    }

    app.mirrored = nextMirrored;
    modelRoot.scale.set(1, 1, app.mirrored ? -1 : 1);
    modelRoot.updateMatrixWorld(true);
    if (app.cameraFitted) {
        cameraTarget.z *= -1;
        mirrorCameraPosition.z *= -1;
        mirrorLookTarget.z *= -1;
        zoomFromPivot.copy(mirrorCameraPosition).sub(cameraTarget);
        orbitRadius = zoomFromPivot.length();
        zoomFromPivot.multiplyScalar(1 / orbitRadius);
        orbitPitch = Math.asin(THREE.MathUtils.clamp(zoomFromPivot.y, -1, 1));
        orbitYaw = Math.atan2(zoomFromPivot.x, zoomFromPivot.z);
        setOrbitOrientation();
        cameraAimOffset.copy(mirrorLookTarget)
            .sub(cameraTarget)
            .applyQuaternion(orbitOrientation.invert());
    }
    updateCamera();

    const button = $('#mirror-view');
    const buttonLabel = app.mirrored ? 'Show right' : 'Mirror left';
    button.classList.toggle('active', app.mirrored);
    button.setAttribute('aria-pressed', String(app.mirrored));
    button.setAttribute('aria-label', buttonLabel);
    button.dataset.tooltip = buttonLabel;
    setText('#viewer-title', app.mirrored ? 'Left upper limb (mirrored)' : 'Right upper limb');
    setText(
        '#viewer-instructions',
        app.mirrored
            ? 'Visual mirror of the right-arm model · drag to rotate · scroll to zoom'
            : 'Drag to rotate · scroll to zoom'
    );
    renderer.domElement.setAttribute(
        'aria-label',
        app.mirrored
            ? 'Mirrored left-side visualization of the official MoBL-ARMS right upper-extremity model'
            : 'Interactive rendering of the official MoBL-ARMS right upper-extremity model'
    );
}

function toggleMirroredView() {
    setMirroredView(!app.mirrored);
}

function viewerImageFilename({ transparent, scale, includeActivation }) {
    const side = app.mirrored ? 'left-mirrored' : 'right';
    const source = app.mode === 'benchmark' ? 'reach8-movement' : 'static-posture';
    const background = transparent ? 'transparent' : 'background';
    const activation = includeActivation ? '-activation-table' : '';
    return `waajacu-upper-limb-${side}-${source}-${background}${activation}-${scale}x.png`;
}

function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('The browser could not encode the image.'));
        }, 'image/png');
    });
}

function drawActivationExportOverlay(context, pixelScale, sourceWidth, sourceHeight) {
    const muscles = hasCompleteActivationData(app.state)
        ? [...app.state.muscles]
            .filter((muscle) => Number.isFinite(muscle.activation))
            .sort((left, right) => right.activation - left.activation)
        : [];
    const panelX = 12;
    const panelY = 12;
    const panelWidth = Math.min(300, sourceWidth - 24);
    const availableHeight = Math.max(sourceHeight - 24, 120);
    const headerHeight = 55;
    const rowHeight = muscles.length
        ? Math.max(8.5, Math.min(13, (availableHeight - headerHeight - 10) / muscles.length))
        : 0;
    const panelHeight = Math.min(
        availableHeight,
        headerHeight + Math.max(muscles.length * rowHeight, 34) + 10
    );
    const nameWidth = 72;
    const valueWidth = 35;
    const barX = panelX + 8 + nameWidth;
    const barWidth = panelWidth - nameWidth - valueWidth - 23;

    context.save();
    context.scale(pixelScale, pixelScale);
    context.fillStyle = 'rgba(250, 252, 251, 0.90)';
    context.strokeStyle = 'rgba(104, 120, 114, 0.48)';
    context.lineWidth = 1;
    context.fillRect(panelX, panelY, panelWidth, panelHeight);
    context.strokeRect(panelX + 0.5, panelY + 0.5, panelWidth - 1, panelHeight - 1);

    context.fillStyle = '#17201d';
    context.font = '700 10px system-ui, sans-serif';
    context.textBaseline = 'middle';
    context.fillText('Activation scale', panelX + 8, panelY + 12);
    context.fillStyle = '#5d6864';
    context.font = '8px system-ui, sans-serif';
    context.textAlign = 'right';
    context.fillText('0-1', panelX + panelWidth - 8, panelY + 12);

    const rampX = panelX + 8;
    const rampY = panelY + 21;
    const rampWidth = panelWidth - 16;
    const rampHeight = 6;
    for (let index = 0; index < rampWidth; index += 1) {
        context.fillStyle = activationColor(index / Math.max(rampWidth - 1, 1)).getStyle();
        context.fillRect(rampX + index, rampY, 1, rampHeight);
    }
    context.strokeStyle = 'rgba(44, 53, 68, 0.28)';
    context.strokeRect(rampX + 0.5, rampY + 0.5, rampWidth - 1, rampHeight - 1);
    context.fillStyle = '#5d6864';
    context.font = '7px system-ui, sans-serif';
    context.textAlign = 'left';
    context.fillText('0', rampX, panelY + 34);
    context.textAlign = 'center';
    context.fillText('0.5', rampX + rampWidth / 2, panelY + 34);
    context.textAlign = 'right';
    context.fillText('1', rampX + rampWidth, panelY + 34);
    context.textAlign = 'left';
    context.fillText('Nonlinear scale - numeric values remain 0-1', rampX, panelY + 45);

    if (!muscles.length) {
        context.fillStyle = '#5d6864';
        context.font = '9px system-ui, sans-serif';
        context.fillText('No validated activation result.', panelX + 8, panelY + 72);
        context.restore();
        return;
    }

    const fontSize = Math.max(7, Math.min(9.5, rowHeight - 2));
    context.font = `600 ${fontSize}px system-ui, sans-serif`;
    muscles.forEach((muscle, index) => {
        const rowY = panelY + headerHeight + index * rowHeight;
        if (index % 2 === 0) {
            context.fillStyle = 'rgba(225, 232, 229, 0.34)';
            context.fillRect(panelX + 4, rowY, panelWidth - 8, rowHeight);
        }
        context.fillStyle = '#17201d';
        context.textAlign = 'left';
        context.fillText(muscle.name, panelX + 8, rowY + rowHeight / 2);

        const trackY = rowY + Math.max((rowHeight - 5) / 2, 1);
        context.fillStyle = 'rgba(237, 240, 238, 0.78)';
        context.fillRect(barX, trackY, barWidth, 5);
        context.strokeStyle = 'rgba(157, 170, 164, 0.55)';
        context.strokeRect(barX + 0.5, trackY + 0.5, barWidth - 1, 4);
        context.fillStyle = activationColor(muscle.activation).getStyle();
        context.fillRect(
            barX,
            trackY,
            Math.max(1, barWidth * THREE.MathUtils.clamp(muscle.activation, 0, 1)),
            5
        );
        context.fillStyle = '#17201d';
        context.textAlign = 'right';
        context.fillText(
            muscle.activation.toFixed(3),
            panelX + panelWidth - 8,
            rowY + rowHeight / 2
        );
    });
    context.restore();
}

async function downloadViewerImage({ transparent, scale, includeActivation = false }) {
    if (viewerExporting) return;
    viewerExporting = true;

    const menu = $('#viewer-download-menu');
    const status = $('#viewer-download-status');
    const optionButtons = [...document.querySelectorAll('[data-viewer-download]')];
    optionButtons.forEach((button) => { button.disabled = true; });
    status.textContent = 'Preparing image...';

    let exportRenderer = null;
    const gridWasVisible = grid.visible;
    try {
        updateCamera();
        const requestedWidth = Math.max(Math.round(sceneHost.clientWidth * scale), 1);
        const requestedHeight = Math.max(Math.round(sceneHost.clientHeight * scale), 1);
        const sizeLimit = 4096;
        const reduction = Math.min(1, sizeLimit / Math.max(requestedWidth, requestedHeight));
        const width = Math.max(Math.round(requestedWidth * reduction), 1);
        const height = Math.max(Math.round(requestedHeight * reduction), 1);

        exportRenderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            preserveDrawingBuffer: true
        });
        exportRenderer.setPixelRatio(1);
        exportRenderer.setSize(width, height, false);
        exportRenderer.setClearColor(transparent ? 0x000000 : 0xe8ece9, transparent ? 0 : 1);
        exportRenderer.outputColorSpace = THREE.SRGBColorSpace;

        const exportCamera = camera.clone();
        exportCamera.aspect = width / height;
        exportCamera.updateProjectionMatrix();
        exportCamera.updateMatrixWorld(true);

        if (transparent) grid.visible = false;
        exportRenderer.render(scene, exportCamera);
        grid.visible = gridWasVisible;
        let imageCanvas = exportRenderer.domElement;
        if (includeActivation) {
            const composite = document.createElement('canvas');
            composite.width = width;
            composite.height = height;
            const context = composite.getContext('2d');
            context.drawImage(exportRenderer.domElement, 0, 0, width, height);
            drawActivationExportOverlay(
                context,
                width / Math.max(sceneHost.clientWidth, 1),
                sceneHost.clientWidth,
                sceneHost.clientHeight
            );
            imageCanvas = composite;
        }
        const blob = await canvasToPngBlob(imageCanvas);

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = viewerImageFilename({ transparent, scale, includeActivation });
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);

        status.textContent = `Download started - ${width} x ${height} PNG`;
        window.setTimeout(() => {
            if (menu.open) menu.open = false;
            status.textContent = '';
        }, 650);
    } catch (error) {
        status.textContent = 'Image could not be created.';
        showError(`The viewer image could not be downloaded: ${error.message}`);
    } finally {
        grid.visible = gridWasVisible;
        if (exportRenderer) {
            exportRenderer.dispose();
            exportRenderer.forceContextLoss();
        }
        optionButtons.forEach((button) => { button.disabled = false; });
        viewerExporting = false;
    }
}

function fitCameraToModel() {
    modelRoot.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(modelRoot);
    if (bounds.isEmpty()) return;
    const size = bounds.getSize(new THREE.Vector3());
    bounds.getCenter(cameraTarget);
    cameraAimOffset.set(0, 0, 0);
    orbitRadius = Math.max(size.length() * 1.5, 0.9);
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

function bodyMeshMatrix(transform, scale) {
    const r = transform.rotation;
    const p = transform.position;
    const matrix = new THREE.Matrix4();
    matrix.set(
        r[0], r[1], r[2], p[0],
        r[3], r[4], r[5], p[1],
        r[6], r[7], r[8], p[2],
        0, 0, 0, 1
    );
    matrix.scale(new THREE.Vector3(...scale));
    return matrix;
}

function presetPoseUrl(values) {
    const parameters = new URLSearchParams();
    for (const coordinate of app.model.coordinates) {
        parameters.set(
            coordinate.name,
            String(values[coordinate.name] ?? coordinate.default)
        );
    }
    parameters.set('muscle', 'BIClong');
    return `/api/pose?${parameters.toString()}`;
}

async function renderPresetThumbnails() {
    const thumbnailRenderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true
    });
    thumbnailRenderer.setPixelRatio(2);
    thumbnailRenderer.setSize(52, 52, false);
    thumbnailRenderer.setClearColor(0x000000, 0);
    thumbnailRenderer.outputColorSpace = THREE.SRGBColorSpace;

    const thumbnailScene = new THREE.Scene();
    const thumbnailRoot = new THREE.Group();
    thumbnailScene.add(thumbnailRoot);
    const blackMaterial = new THREE.MeshBasicMaterial({
        color: 0x111514,
        side: THREE.DoubleSide
    });
    const thumbnailMeshes = new Map();
    for (const [name, source] of app.meshObjects) {
        const mesh = new THREE.Mesh(source.geometry, blackMaterial);
        mesh.matrixAutoUpdate = false;
        mesh.userData.frame = source.userData.frame;
        mesh.userData.scale = source.userData.scale;
        thumbnailRoot.add(mesh);
        thumbnailMeshes.set(name, mesh);
    }

    const thumbnailCamera = new THREE.PerspectiveCamera(30, 1, 0.001, 100);
    thumbnailCamera.up.set(0, 1, 0);
    const viewDirection = new THREE.Vector3(0.66, 0.12, 0.75).normalize();
    const presets = Object.entries(POSE_PRESETS);

    try {
        for (let index = 0; index < presets.length; index += 1) {
            const [name, values] = presets[index];
            setLoading(`Rendering posture thumbnail ${index + 1} of ${presets.length}…`);
            const state = await fetchJson(presetPoseUrl(values));
            const transforms = new Map(state.bodies.map((body) => [body.name, body]));
            for (const mesh of thumbnailMeshes.values()) {
                const transform = transforms.get(mesh.userData.frame);
                mesh.visible = Boolean(transform);
                if (transform) {
                    mesh.matrix.copy(bodyMeshMatrix(transform, mesh.userData.scale));
                }
            }
            thumbnailRoot.updateMatrixWorld(true);
            const bounds = new THREE.Box3().setFromObject(thumbnailRoot);
            const sphere = bounds.getBoundingSphere(new THREE.Sphere());
            const distance = Math.max(
                sphere.radius / Math.sin(THREE.MathUtils.degToRad(thumbnailCamera.fov / 2)) * 1.08,
                0.1
            );
            thumbnailCamera.near = Math.max(distance / 200, 0.001);
            thumbnailCamera.far = Math.max(distance * 5, 10);
            thumbnailCamera.position.copy(sphere.center).addScaledVector(viewDirection, distance);
            thumbnailCamera.lookAt(sphere.center);
            thumbnailCamera.updateProjectionMatrix();
            thumbnailRenderer.render(thumbnailScene, thumbnailCamera);

            const targets = document.querySelectorAll(
                `[data-preset="${name}"] .preset-thumbnail, [data-thumbnail-preset="${name}"]`
            );
            for (const target of targets) {
                const context = target.getContext('2d');
                context.clearRect(0, 0, target.width, target.height);
                context.drawImage(thumbnailRenderer.domElement, 0, 0, target.width, target.height);
                target.classList.add('ready');
            }
        }
    } finally {
        blackMaterial.dispose();
        thumbnailRenderer.dispose();
    }
}

function applyMeshTransforms(state) {
    const transforms = new Map(state.bodies.map((body) => [body.name, body]));
    for (const object of app.meshObjects.values()) {
        const transform = transforms.get(object.userData.frame);
        if (!transform) {
            object.visible = false;
            continue;
        }
        object.matrix.copy(bodyMeshMatrix(transform, object.userData.scale));
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

function updatePathCable(muscle, selectedName, pathView, activationAvailable) {
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

    const selected = muscle.name === selectedName;
    const showAll = pathView === 'all';
    const focused = pathView === 'focus';
    const visible = pathView !== 'one' || selected;
    const radius = selected && !showAll ? 0.002 : 0.00175;
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

    if (focused && !selected) {
        cable.material.color.copy(neutralColor);
        cable.material.opacity = 0.34;
    } else if (activationAvailable) {
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
        updatePathCable(muscle, selectedName, app.pathView, activationAvailable);
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

function syncViewerDrawers() {
    const showDetailsView = app.pathView !== 'all';
    const showActivation = !showDetailsView && app.activationPanelVisible;
    const showDetails = showDetailsView && app.musclePanelVisible;
    $('#activation-panel').classList.toggle('hidden', showDetailsView);
    $('#activation-panel').classList.toggle('collapsed', !showActivation);
    $('#muscle-panel').classList.toggle('hidden', !showDetailsView);
    $('#muscle-panel').classList.toggle('collapsed', !showDetails);
    $('#toggle-activation-panel').textContent = showActivation ? 'Hide list' : 'Show list';
    $('#toggle-activation-panel').setAttribute('aria-expanded', String(showActivation));
    $('#toggle-muscle-panel').textContent = showDetails ? 'Hide' : 'Show';
    $('#toggle-muscle-panel').setAttribute('aria-expanded', String(showDetails));
    $('#back-to-activations').textContent = app.pathView === 'focus'
        ? '← Back to all activations'
        : '← Show all muscles';
}

function setPathView(view, refresh = true) {
    const nextView = view === 'one' ? 'one' : (view === 'focus' ? 'focus' : 'all');
    const changed = nextView !== app.pathView;
    app.pathView = nextView;
    const showOne = app.pathView === 'one';
    const showDetails = app.pathView !== 'all';
    if (changed && showDetails) {
        app.activationPanelVisible = false;
        app.musclePanelVisible = true;
    } else if (changed) {
        app.activationPanelVisible = true;
        app.musclePanelVisible = false;
    }
    $('#view-all-muscles').classList.toggle('active', !showOne);
    $('#view-one-muscle').classList.toggle('active', showOne);
    $('#view-all-muscles').setAttribute('aria-pressed', String(!showOne));
    $('#view-one-muscle').setAttribute('aria-pressed', String(showOne));
    $('#selected-path-legend').classList.toggle('hidden', !showDetails);
    syncViewerDrawers();
    if (refresh && app.state) applyState(app.state);
}

function toggleActivationPanel() {
    app.activationPanelVisible = !app.activationPanelVisible;
    syncViewerDrawers();
}

function toggleMusclePanel() {
    if (app.pathView === 'all') return;
    app.musclePanelVisible = !app.musclePanelVisible;
    syncViewerDrawers();
}

function selectMuscle(name, view = app.pathView === 'all' ? 'focus' : app.pathView) {
    const select = $('#muscle-select');
    select.value = name;
    setPathView(view, false);
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
            row.addEventListener('click', () => selectMuscle(muscle.name, 'focus'));
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
        if (input) updateRangeProgress(input);
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
    status.title = `${heading}: ${detail}`;
}

function updateRangeProgress(input) {
    const minimum = Number(input.min);
    const maximum = Number(input.max);
    const value = Number(input.value);
    const progress = maximum > minimum
        ? ((value - minimum) / (maximum - minimum)) * 100
        : 0;
    input.style.setProperty('--range-progress', `${Math.max(0, Math.min(100, progress))}%`);
}

function syncPresetLibrary() {
    const benchmarkMode = app.mode === 'benchmark';
    const visible = !benchmarkMode && app.presetLibraryVisible;
    $('#static-presets').classList.toggle('hidden', !visible);
    $('#toggle-preset-library').classList.toggle('hidden', benchmarkMode);
    $('#toggle-preset-library').classList.toggle('active', visible);
    $('#toggle-preset-library').setAttribute('aria-expanded', String(visible));
}

function togglePresetLibrary() {
    if (app.mode === 'benchmark') return;
    app.presetLibraryVisible = !app.presetLibraryVisible;
    syncPresetLibrary();
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
    $('#activation-ranking').classList.add('hidden');
    $('#activation-ranking').replaceChildren();
    $('#activation-empty').classList.remove('hidden');
}

function setStaticButtonState(busy, retry = false) {
    const button = $('#calculate-static');
    if (!button) return;
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
    button.textContent = busy
        ? 'Calculating…'
        : (retry ? 'Try again' : 'Recalculate');
}

function showStaticPending(phase = 'waiting') {
    neutralizeDisplayedActivation();
    const solving = phase === 'solving';
    setText('#effort-source-label', 'Static · 50');
    setText('#activation-empty strong', solving ? 'Calculating…' : 'Posture changed');
    setText(
        '#activation-empty span',
        solving
            ? 'Waiting for a validated result.'
            : 'Activation will update automatically.'
    );
    setPositionStatus(
        solving ? 'static' : 'manual',
        solving ? 'Calculating activation…' : 'Updating posture',
        solving
            ? 'Colors appear only after quality checks pass.'
            : 'Geometry updates first; activation follows.'
    );
    setStaticButtonState(solving);
}

function showStaticFailure(message, analysis = null) {
    neutralizeDisplayedActivation();
    const reason = analysis?.quality?.reason || analysis?.solver?.detail ||
        analysis?.message || analysis?.reason || message ||
        'The solver did not return a validated result for this posture.';
    setText('#effort-source-label', 'Static · 50');
    setText('#activation-empty strong', 'No activation result');
    setText('#activation-empty span', 'This posture did not pass the model checks.');
    setPositionStatus(
        'unavailable',
        'No activation result',
        reason
    );
    setStaticButtonState(false, true);
}

function describeStaticQuality(analysis) {
    const details = [];
    const elapsed = Number(analysis?.solver?.durationMs);
    const reserve = Number(analysis?.quality?.maxReserveTorqueNm);
    if (Number.isFinite(elapsed)) details.push(`${elapsed.toFixed(0)} ms`);
    if (Number.isFinite(reserve)) details.push(`reserve ${reserve.toFixed(3)} N·m`);
    return details.length ? details.join(' · ') : 'Quality checks passed';
}

function applyState(state) {
    app.state = state;
    if (app.mode === 'static' && state.coordinates) {
        app.staticCoordinates = { ...state.coordinates };
    }
    applyMeshTransforms(state);
    const selected = renderMusclePaths(state);
    if (!selected) throw new Error(`No path was returned for ${state.selectedMuscle}.`);

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
        $('#activation-ranking').classList.remove('hidden');
        $('#activation-empty').classList.add('hidden');
        updateActivationRanking(state.muscles);
        if (state.mode === 'benchmark') {
            setText('#effort-source-label', 'Reach8 · 50');
            setPositionStatus(
                'effort',
                `Reach8 frame ${state.benchmark.frame + 1} of ${app.benchmark.frames}`,
                `${formatTime(state.benchmark.time)} · authored CMC activation`
            );
        } else if (state.mode === 'static') {
            const quality = describeStaticQuality(state.staticHolding);
            setText('#effort-source-label', 'Static · 50');
            setPositionStatus('static', 'Ready', quality);
            setStaticButtonState(false);
        }
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
        updateRangeProgress(input);
        input.addEventListener('input', () => {
            output.textContent = formatDegrees(Number(input.value));
            app.staticCoordinates[coordinate.name] = Number(input.value);
            updateRangeProgress(input);
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
    stopBenchmark();
    if (app.mode === 'benchmark') {
        app.benchmarkTime = app.benchmark.timeStart;
        updateBenchmarkTimeline(app.benchmarkTime);
        app.benchmarkGeneration += 1;
        requestBenchmarkFrame(app.benchmarkTime);
        return;
    }
    app.presetLibraryVisible = false;
    syncPresetLibrary();
    for (const button of document.querySelectorAll('[data-preset]')) {
        button.classList.remove('active');
        button.setAttribute('aria-pressed', 'false');
    }
    for (const coordinate of app.model.coordinates) {
        const value = Number(coordinate.default);
        app.staticCoordinates[coordinate.name] = value;
        const input = document.getElementById(`coordinate-${coordinate.name}`);
        input.value = String(value);
        updateRangeProgress(input);
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
    stopBenchmark();
    app.benchmarkGeneration += 1;
    app.muscleDetailRequest += 1;
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
    $('#movement-choice').classList.toggle('hidden', !benchmarkMode);
    $('#movement-select').disabled = !benchmarkMode;
    $('#benchmark-transport').classList.toggle('hidden', !benchmarkMode);
    if (benchmarkMode) app.presetLibraryVisible = false;
    syncPresetLibrary();
    $('#static-actions').classList.toggle('hidden', benchmarkMode);
    $('#activation-panel').classList.toggle('static-source', !benchmarkMode);
    $('#reset-pose').textContent = benchmarkMode ? 'Restart' : 'Reset';
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
        setText('#effort-source-label', 'Reach8 · 50');
        setText('#activation-empty strong', 'Loading Reach8 frame…');
        setText('#activation-empty span', 'Waiting for authored activation values.');
        $('#toggle-benchmark').textContent = 'Play';
        setPositionStatus(
            'effort',
            'Reach8 movement',
            'Use the timeline below; posture sliders are read-only.'
        );
        requestBenchmarkFrame(app.benchmarkTime);
    } else {
        for (const coordinate of app.model.coordinates) {
            const value = Number(app.staticCoordinates?.[coordinate.name] ?? coordinate.default);
            const input = document.getElementById(`coordinate-${coordinate.name}`);
            input.value = String(value);
            updateRangeProgress(input);
            setText(`#coordinate-output-${coordinate.name}`, formatDegrees(value));
        }
        setText('#effort-source-label', 'Static · 50');
        showStaticPending('waiting');
        schedulePose(0);
        scheduleStaticSolve(180);
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
        'Reach8 playback',
        'Playing authored CMC frames.'
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
        setOrbitOrientation();
        cameraLookTarget.copy(cameraAimOffset)
            .applyQuaternion(orbitOrientation)
            .add(cameraTarget);
        const viewDistance = camera.position.distanceTo(cameraLookTarget);
        const nextViewDistance = THREE.MathUtils.clamp(
            viewDistance * Math.exp(event.deltaY * 0.0012),
            0.18,
            8
        );
        if (nextViewDistance === viewDistance) return;

        const bounds = canvas.getBoundingClientRect();
        zoomPointer.set(
            ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
            -((event.clientY - bounds.top) / bounds.height) * 2 + 1
        );
        camera.updateMatrixWorld();
        zoomRaycaster.setFromCamera(zoomPointer, camera);

        const surfaceHit = zoomRaycaster.intersectObject(modelRoot, true)
            .find((intersection) => intersection.object.visible);
        if (surfaceHit) {
            zoomAnchor.copy(surfaceHit.point);
        } else {
            camera.getWorldDirection(zoomPlaneNormal);
            zoomPlane.setFromNormalAndCoplanarPoint(zoomPlaneNormal, cameraLookTarget);
            if (!zoomRaycaster.ray.intersectPlane(zoomPlane, zoomAnchor)) {
                return;
            }
        }

        const scale = nextViewDistance / viewDistance;
        zoomCameraPosition.copy(camera.position)
            .sub(zoomAnchor)
            .multiplyScalar(scale)
            .add(zoomAnchor);
        zoomNextLookTarget.copy(cameraLookTarget)
            .sub(zoomAnchor)
            .multiplyScalar(scale)
            .add(zoomAnchor);

        zoomFromPivot.copy(zoomCameraPosition).sub(cameraTarget);
        const nextOrbitRadius = zoomFromPivot.length();
        if (nextOrbitRadius < 1e-6) return;
        orbitRadius = nextOrbitRadius;
        zoomFromPivot.multiplyScalar(1 / orbitRadius);
        orbitPitch = Math.asin(THREE.MathUtils.clamp(zoomFromPivot.y, -1, 1));
        orbitYaw = Math.atan2(zoomFromPivot.x, zoomFromPivot.z);

        setOrbitOrientation();
        cameraAimOffset.copy(zoomNextLookTarget)
            .sub(cameraTarget)
            .applyQuaternion(orbitOrientation.invert());
        updateCamera();
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
        $('#server-status span:last-child').textContent = 'Ready';
        updateInventory();
        app.staticCoordinates = Object.fromEntries(
            app.model.coordinates.map((coordinate) => [coordinate.name, Number(coordinate.default)])
        );
        buildCoordinateControls();
        buildMuscleSelect();
        setPathView('all', false);
        configureBenchmarkTimeline();

        setLoading('Calculating the default posture…');
        await requestPose();
        await loadMeshes(app.model.meshes);
        try {
            await renderPresetThumbnails();
        } catch {
            // Posture thumbnails are optional; the model and controls remain usable.
        }
        fitCameraToModel();
        setLoading('', false);
        setMode('static', true);
        diagnosisWorkflow?.setReady(true);
    } catch (error) {
        $('#server-status').className = 'server-status offline';
        $('#server-status span:last-child').textContent = 'Unavailable';
        setLoading('', false);
        diagnosisWorkflow?.setReady(false);
        showError(`The official model could not be loaded: ${error.message}`);
    }
}

function enterDiagnosisWorkspace() {
    const viewerPanel = document.querySelector('.viewer-panel');
    const slot = $('#diagnosis-viewer-slot');
    if (!viewerPanel || !slot || viewerPanel.parentElement === slot) return;

    diagnosisViewerSnapshot = {
        mode: app.mode,
        staticCoordinates: app.staticCoordinates ? { ...app.staticCoordinates } : null,
        benchmarkTime: app.benchmarkTime,
        pathView: app.pathView,
        activationPanelVisible: app.activationPanelVisible,
        musclePanelVisible: app.musclePanelVisible,
        mirrored: app.mirrored
    };

    stopBenchmark();
    window.clearTimeout(app.poseTimer);
    window.clearTimeout(app.staticTimer);
    app.poseRequest += 1;
    app.staticRequest += 1;
    app.benchmarkGeneration += 1;
    app.mode = 'static';
    app.staticCalculating = false;
    app.pathView = 'all';
    app.activationPanelVisible = false;
    app.musclePanelVisible = false;
    $('#activation-panel').classList.add('static-source');
    neutralizeDisplayedActivation();
    syncViewerDrawers();
    slot.append(viewerPanel);
}

function leaveDiagnosisWorkspace() {
    const viewerPanel = document.querySelector('.viewer-panel');
    const explorer = $('#explorer-workspace');
    if (viewerPanel && explorer && viewerPanel.parentElement !== explorer) {
        explorer.append(viewerPanel);
    }
    if (!diagnosisViewerSnapshot) return;

    const snapshot = diagnosisViewerSnapshot;
    diagnosisViewerSnapshot = null;
    window.clearTimeout(app.poseTimer);
    window.clearTimeout(app.staticTimer);
    app.poseRequest += 1;
    app.staticRequest += 1;
    app.benchmarkGeneration += 1;
    app.staticCalculating = false;
    app.staticCoordinates = snapshot.staticCoordinates
        ? { ...snapshot.staticCoordinates }
        : app.staticCoordinates;
    app.benchmarkTime = snapshot.benchmarkTime;
    app.pathView = snapshot.pathView;
    app.activationPanelVisible = snapshot.activationPanelVisible;
    app.musclePanelVisible = snapshot.musclePanelVisible;
    setMirroredView(snapshot.mirrored);
    syncViewerDrawers();
    if (app.model) setMode(snapshot.mode, true);
    else app.mode = snapshot.mode;
}

diagnosisWorkflow = createDiagnosisWorkflow({
    fetchJson,
    applyState,
    getModel: () => app.model,
    getSelectedMuscle: () => $('#muscle-select')?.value || 'BIClong',
    setMirroredView,
    resetView,
    neutralizeActivation: neutralizeDisplayedActivation,
    enterDiagnosis: enterDiagnosisWorkspace,
    leaveDiagnosis: leaveDiagnosisWorkspace,
    resizeViewer: resizeRenderer
});

$('#reset-view').addEventListener('click', resetView);
$('#mirror-view').addEventListener('click', toggleMirroredView);
document.querySelectorAll('[data-viewer-download]').forEach((button) => {
    button.addEventListener('click', () => {
        downloadViewerImage({
            scale: Number(button.dataset.scale),
            transparent: button.dataset.transparent === 'true',
            includeActivation: button.dataset.includeActivation === 'true'
        });
    });
});
$('#viewer-download-menu').addEventListener('toggle', (event) => {
    event.currentTarget.querySelector('summary')
        .setAttribute('aria-expanded', String(event.currentTarget.open));
});
document.addEventListener('pointerdown', (event) => {
    const menu = $('#viewer-download-menu');
    if (menu.open && !menu.contains(event.target) && !viewerExporting) menu.open = false;
});
$('#reset-pose').addEventListener('click', resetPose);
$('#toggle-preset-library').addEventListener('click', togglePresetLibrary);
$('#mode-static').addEventListener('click', () => setMode('static'));
$('#mode-benchmark').addEventListener('click', () => setMode('benchmark'));
$('#movement-select').addEventListener('change', () => {
    if ($('#movement-select').value === 'reach8') setMode('benchmark', true);
});
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
        'Loading Reach8 frame…',
        'Posture and activation come from the authored recording.'
    );
    requestBenchmarkFrame(app.benchmarkTime);
});
$('#muscle-select').addEventListener('change', () => {
    selectMuscle(
        $('#muscle-select').value,
        app.pathView === 'one' ? 'one' : 'focus'
    );
});
$('#view-all-muscles').addEventListener('click', () => setPathView('all'));
$('#view-one-muscle').addEventListener('click', () => setPathView('one'));
$('#toggle-activation-panel').addEventListener('click', toggleActivationPanel);
$('#toggle-muscle-panel').addEventListener('click', toggleMusclePanel);
$('#back-to-activations').addEventListener('click', () => setPathView('all'));
for (const button of document.querySelectorAll('[data-preset]')) {
    button.addEventListener('click', () => applyPosePreset(button.dataset.preset));
}
window.addEventListener('resize', resizeRenderer);

initialize();
