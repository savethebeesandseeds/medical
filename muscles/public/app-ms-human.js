import * as THREE from './vendor/three.module.min.js';
import { createMsHumanEngine, StaleRequestError } from './ms-human-engine.js';
import { createDiagnosisWorkflow } from './diagnosis.js';

const PROFILE_DEFINITIONS = Object.freeze({
    primary: Object.freeze({
        id: 'primary',
        geometryUrl: new URL('./models/ms_human_700/right-arm.meshbin?v=5cbdf2ae', import.meta.url),
        workerUrl: new URL('./ms-human-worker.js', import.meta.url)
    }),
    hand: Object.freeze({
        id: 'hand',
        geometryUrl: new URL('./models/ms_human_700/right-hand.meshbin?v=5054f8ff', import.meta.url),
        workerUrl: new URL('./ms-human-worker.js?profile=hand', import.meta.url)
    })
});

const $ = (selector) => document.querySelector(selector);
const DEFAULT_REGION_ID = 'right-upper-limb';
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
const ANATOMICAL_BODY_RADIAL_SEGMENTS = 12;
const ANATOMICAL_BODY_SAMPLE_SPACING = 0.012;
const compactViewer = () => globalThis.matchMedia?.('(max-width: 700px)').matches === true;
const REGION_OPTION_ORDER = Object.freeze([
    'right-upper-limb',
    'left-upper-limb',
    'right-lower-limb',
    'left-lower-limb',
    'trunk',
    'head-neck',
    'right-hand'
]);
const REGION_OPTION_LABELS = Object.freeze({
    'right-upper-limb': 'Right arm',
    'left-upper-limb': 'Left arm',
    'right-lower-limb': 'Right leg',
    'left-lower-limb': 'Left leg',
    trunk: 'Back & trunk',
    'head-neck': 'Head & neck',
    'right-hand': 'Right hand'
});

// Keep upstream actuator names as stable calculation/export identifiers, but
// translate them at the interface boundary.  Several MS-Human identifiers are
// fascicle codes rather than names a reader can reasonably recognize.
const MUSCLE_DISPLAY_RULES = Object.freeze([
    [/^DELT1(?:_|$)/i, 'Anterior deltoid'],
    [/^DELT2(?:_|$)/i, 'Middle deltoid'],
    [/^DELT3(?:_|$)/i, 'Posterior deltoid'],
    [/^BIClong(?:_|$)/i, 'Biceps brachii · long head'],
    [/^BICshort(?:_|$)/i, 'Biceps brachii · short head'],
    [/^TRIlong(?:_|$)/i, 'Triceps brachii · long head'],
    [/^TRIlat(?:_|$)/i, 'Triceps brachii · lateral head'],
    [/^TRImed(?:_|$)/i, 'Triceps brachii · medial head'],
    [/^BRA(?:_|$)/i, 'Brachialis'],
    [/^BRD(?:_|$)/i, 'Brachioradialis'],
    [/^CORB(?:_|$)/i, 'Coracobrachialis'],
    [/^ANC(?:_|$)/i, 'Anconeus'],
    [/^SUPSP(?:_|$)/i, 'Supraspinatus'],
    [/^INFSP(?:_|$)/i, 'Infraspinatus'],
    [/^SUBSC(?:_|$)/i, 'Subscapularis'],
    [/^TMAJ(?:_|$)/i, 'Teres major'],
    [/^TMIN(?:_|$)/i, 'Teres minor'],
    [/^PECM1(?:_|$)/i, 'Pectoralis major · clavicular'],
    [/^PECM2(?:_|$)/i, 'Pectoralis major · sternal'],
    [/^PECM3(?:_|$)/i, 'Pectoralis major · costal'],
    [/^SerrAnt/i, 'Serratus anterior'],
    [/^trap_/i, 'Trapezius'],
    [/^levator_scap/i, 'Levator scapulae'],
    [/^cleid_/i, 'Sternocleidomastoid'],
    [/^LD_/i, 'Latissimus dorsi'],
    [/^ECRL(?:_|$)/i, 'Extensor carpi radialis longus'],
    [/^ECRB(?:_|$)/i, 'Extensor carpi radialis brevis'],
    [/^ECU(?:_|$)/i, 'Extensor carpi ulnaris'],
    [/^FCR(?:_|$)/i, 'Flexor carpi radialis'],
    [/^FCU(?:_|$)/i, 'Flexor carpi ulnaris'],
    [/^PL(?:_|$)/i, 'Palmaris longus'],
    [/^PT(?:_|$)/i, 'Pronator teres'],
    [/^PQ(?:_|$)/i, 'Pronator quadratus'],
    [/^SUP(?:_|$)/i, 'Supinator'],
    [/^EDCI(?:_|$)/i, 'Extensor digitorum · index'],
    [/^EDCM(?:_|$)/i, 'Extensor digitorum · middle'],
    [/^EDCR(?:_|$)/i, 'Extensor digitorum · ring'],
    [/^EDCL(?:_|$)/i, 'Extensor digitorum · little'],
    [/^EDM(?:_|$)/i, 'Extensor digiti minimi'],
    [/^EIP(?:_|$)/i, 'Extensor indicis'],
    [/^EPL(?:_|$)/i, 'Extensor pollicis longus'],
    [/^EPB(?:_|$)/i, 'Extensor pollicis brevis'],
    [/^APL(?:_|$)/i, 'Abductor pollicis longus'],
    [/^FPL(?:_|$)/i, 'Flexor pollicis longus'],
    [/^FDPI(?:_|$)/i, 'Flexor digitorum profundus · index'],
    [/^FDPM(?:_|$)/i, 'Flexor digitorum profundus · middle'],
    [/^FDPR(?:_|$)/i, 'Flexor digitorum profundus · ring'],
    [/^FDPL(?:_|$)/i, 'Flexor digitorum profundus · little'],
    [/^FDSI(?:_|$)/i, 'Flexor digitorum superficialis · index'],
    [/^FDSM(?:_|$)/i, 'Flexor digitorum superficialis · middle'],
    [/^FDSR(?:_|$)/i, 'Flexor digitorum superficialis · ring'],
    [/^FDSL(?:_|$)/i, 'Flexor digitorum superficialis · little'],
    [/^APB(?:_|$)/i, 'Abductor pollicis brevis'],
    [/^FPB(?:_|$)/i, 'Flexor pollicis brevis'],
    [/^OPP(?:_|$)/i, 'Opponens pollicis'],
    [/^ADPt(?:_|$)/i, 'Adductor pollicis · transverse head'],
    [/^ADPo(?:_|$)/i, 'Adductor pollicis · oblique head'],
    [/^ADM(?:_|$)/i, 'Abductor digiti minimi'],
    [/^FDM(?:_|$)/i, 'Flexor digiti minimi brevis'],
    [/^ODM(?:_|$)/i, 'Opponens digiti minimi'],
    [/^(\d)(?:st|nd|rd|th)?PI(?:_|$)/i, 'Palmar interosseous'],
    [/^(\d)(?:st|nd|rd|th)?DI(?:_|$)/i, 'Dorsal interosseous'],
    [/^LUMI(?:_|$)/i, 'Index lumbrical'],
    [/^LUMM(?:_|$)/i, 'Middle lumbrical'],
    [/^LUMR(?:_|$)/i, 'Ring lumbrical'],
    [/^LUML(?:_|$)/i, 'Little-finger lumbrical'],
    [/^glmax/i, 'Gluteus maximus'],
    [/^glmed/i, 'Gluteus medius'],
    [/^glmin/i, 'Gluteus minimus'],
    [/^addbrev/i, 'Adductor brevis'],
    [/^addlong/i, 'Adductor longus'],
    [/^addmag/i, 'Adductor magnus'],
    [/^iliacus/i, 'Iliacus'],
    [/^piri/i, 'Piriformis'],
    [/^tfl/i, 'Tensor fasciae latae'],
    [/^sart/i, 'Sartorius'],
    [/^grac/i, 'Gracilis'],
    [/^recfem/i, 'Rectus femoris'],
    [/^vaslat/i, 'Vastus lateralis'],
    [/^vasmed/i, 'Vastus medialis'],
    [/^vasint/i, 'Vastus intermedius'],
    [/^bflh/i, 'Biceps femoris · long head'],
    [/^bfsh/i, 'Biceps femoris · short head'],
    [/^semimem/i, 'Semimembranosus'],
    [/^semiten/i, 'Semitendinosus'],
    [/^gasmed/i, 'Gastrocnemius · medial head'],
    [/^gaslat/i, 'Gastrocnemius · lateral head'],
    [/^soleus/i, 'Soleus'],
    [/^tibant/i, 'Tibialis anterior'],
    [/^tibpost/i, 'Tibialis posterior'],
    [/^perlong/i, 'Fibularis longus'],
    [/^perbrev/i, 'Fibularis brevis'],
    [/^ehl/i, 'Extensor hallucis longus'],
    [/^edl/i, 'Extensor digitorum longus'],
    [/^fhl/i, 'Flexor hallucis longus'],
    [/^fdl/i, 'Flexor digitorum longus'],
    [/^rect_abd/i, 'Rectus abdominis'],
    [/^EO_/i, 'External oblique'],
    [/^IO\d/i, 'Internal oblique'],
    [/^TR\d/i, 'Transversus abdominis'],
    [/^Ps_/i, 'Psoas major'],
    [/^QL_/i, 'Quadratus lumborum'],
    [/^(?:MF_|multifidus_)/i, 'Multifidus'],
    [/^LTpL_/i, 'Longissimus lumborum'],
    [/^LTpT_/i, 'Longissimus thoracis'],
    [/^IL_/i, 'Iliocostalis'],
    [/^longissi_cerv/i, 'Longissimus cervicis'],
    [/^iliocost_cerv/i, 'Iliocostalis cervicis'],
    [/^splen_cap/i, 'Splenius capitis'],
    [/^splen_cerv/i, 'Splenius cervicis'],
    [/^semi_cap/i, 'Semispinalis capitis'],
    [/^semi_cerv/i, 'Semispinalis cervicis'],
    [/^(?:supmult|deepmult)/i, 'Cervical multifidus'],
    [/^scalenus_ant/i, 'Anterior scalene'],
    [/^scalenus_med/i, 'Middle scalene'],
    [/^scalenus_post/i, 'Posterior scalene'],
    [/^stern_mast/i, 'Sternocleidomastoid'],
    [/^long_col/i, 'Longus colli']
]);

function muscleModelId(name) {
    return String(name ?? '').replace(/_[rl]$/i, '');
}

function muscleDisplayName(name) {
    const raw = String(name ?? 'Unknown muscle');
    for (const [pattern, label] of MUSCLE_DISPLAY_RULES) {
        if (pattern.test(raw)) return label;
    }
    return muscleModelId(raw).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const primaryEngine = createMsHumanEngine({ onFatalError: handleFatalEngineError });
const app = {
    engine: primaryEngine,
    profileId: 'primary',
    profileGeneration: 0,
    profiles: new Map([['primary', { ...PROFILE_DEFINITIONS.primary, engine: primaryEngine, metadata: null, geometry: null }]]),
    engineMetadata: null,
    metadata: null,
    regionId: DEFAULT_REGION_ID,
    regionGeneration: 0,
    musclePresentation: 'overview',
    presentationMuscleNames: null,
    regionView: 'front',
    model: null,
    state: null,
    coordinates: {},
    selectedMuscle: 'DELT1_r',
    pathView: 'all',
    muscleRendering: 'anatomical',
    activationPanelVisible: !compactViewer(),
    activationRankingExpanded: false,
    musclePanelVisible: false,
    presetLibraryVisible: false,
    mirrored: false,
    showContext: true,
    showLongOrigins: false,
    bodyMeshes: [],
    activeRegionGroup: new THREE.Group(),
    contextGroup: new THREE.Group(),
    pathGroup: new THREE.Group(),
    selectedGroup: new THREE.Group(),
    poseTimer: 0,
    solveTimer: 0,
    poseGeneration: 0,
    solveGeneration: 0,
    diagnosisViewerSnapshot: null,
    diagnosis: null,
    cameraFitted: false,
    inDiagnosis: false,
    initialized: false
};

const sceneHost = $('#scene');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0xe8ece9, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('role', 'application');
renderer.domElement.setAttribute('aria-label', 'Interactive regional rendering of MS-Human-700. Click a muscle to inspect it alone; left-drag or use arrow keys to rotate; right-drag to move; scroll to zoom at the pointer; use plus and minus to zoom at the center.');
sceneHost.append(renderer.domElement);

const scene = new THREE.Scene();
const displayRoot = new THREE.Group();
const modelRoot = new THREE.Group();
modelRoot.rotation.x = -Math.PI / 2;
modelRoot.add(app.contextGroup, app.activeRegionGroup, app.pathGroup, app.selectedGroup);
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
    initialTarget: new THREE.Vector3(0, 1.25, -0.2),
    framingOffset: new THREE.Vector2()
};

const boneMaterial = new THREE.MeshStandardMaterial({ color: 0xd9d0bf, roughness: 0.78, metalness: 0, side: THREE.DoubleSide });
const contextMaterial = new THREE.MeshStandardMaterial({ color: 0x8f9d97, roughness: 0.9, metalness: 0, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide });
const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false);
const markerSphere = new THREE.SphereGeometry(1, 10, 7);
const axisY = new THREE.Vector3(0, 1, 0);
const scratchStart = new THREE.Vector3();
const scratchEnd = new THREE.Vector3();
const scratchDirection = new THREE.Vector3();
const pickStart = new THREE.Vector3();
const pickEnd = new THREE.Vector3();
const pickRayPoint = new THREE.Vector3();
const pickSegmentPoint = new THREE.Vector3();
const muscleRaycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
let diagnosisViewerSnapshot = null;
let viewerExporting = false;
let renderFrame = 0;
let renderingContextLost = false;

function setText(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value;
}

function availableRegions() {
    if (Array.isArray(app.engineMetadata?.regions) && app.engineMetadata.regions.length) return app.engineMetadata.regions;
    if (!app.engineMetadata) return [];
    return [{
        id: DEFAULT_REGION_ID,
        presentationName: 'Right upper limb',
        area: 'upper-limb',
        laterality: 'right',
        calculationSide: 'right',
        status: 'ready',
        coordinates: app.engineMetadata.coordinates,
        muscles: app.engineMetadata.muscles,
        defaultSelectedMuscle: { name: 'DELT1_r' },
        activeBodyIds: [...new Set(app.engineMetadata.geometry.geoms
            .filter((geom) => geom.role === 'arm')
            .map((geom) => geom.bodyId))],
        presets: app.engineMetadata.presets,
        solverConfig: app.engineMetadata.solverConfig
    }];
}

function regionArea(region) {
    if (region?.area === 'upper-limb' || region?.id?.includes('upper-limb')) return 'upper-limb';
    if (region?.area === 'lower-limb' || region?.id?.includes('lower-limb')) return 'lower-limb';
    if (region?.area === 'hand' || region?.id?.includes('hand')) return 'hand';
    if (region?.area === 'head-neck' || region?.id === 'head-neck') return 'head-neck';
    return region?.area || region?.id || 'trunk';
}

function regionDisplayName(region) {
    if (regionArea(region) === 'trunk') return 'Back & trunk';
    return region?.presentationName || region?.label || region?.id || 'Selected region';
}

function profileRegions(profileId) {
    const metadata = app.profiles.get(profileId)?.metadata;
    return Array.isArray(metadata?.regions) ? metadata.regions : [];
}

function explorerRegionOptions() {
    const byId = new Map(profileRegions('primary').map((region) => [region.id, region]));
    const handRegion = profileRegions('hand')[0] || {
        id: 'right-hand',
        presentationName: 'Right hand',
        status: 'data-ready'
    };
    byId.set(handRegion.id, handRegion);
    return REGION_OPTION_ORDER
        .map((id) => byId.get(id))
        .filter((region) => region && (!region.status || ['ready', 'data-ready'].includes(region.status)));
}

function syncRegionControls() {
    const region = app.metadata?.region;
    if (!region) return;
    $('#focus-region').value = region.id;
}

function regionViewYaw() {
    if (app.regionView === 'back') return -Math.PI / 2;
    if (app.regionView === 'side') return 0;
    return Math.PI / 2;
}

function syncRegionPresentationControls() {
    const back = app.regionId === 'trunk';
    $('#back-presentation-controls').classList.toggle('hidden', !back);
    if (!back) return;
    $('#back-muscle-filter').value = app.musclePresentation;
    for (const button of document.querySelectorAll('[data-region-view]')) {
        const active = button.dataset.regionView === app.regionView;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    }
}

function setRegionView(view) {
    app.regionView = ['front', 'back', 'side'].includes(view) ? view : 'front';
    cameraState.yaw = regionViewYaw();
    syncRegionPresentationControls();
    updateCamera();
}

function setMusclePresentation(value) {
    app.musclePresentation = Object.hasOwn(BACK_MUSCLE_PATTERNS, value) || value === 'overview' ? value : 'back';
    app.presentationMuscleNames = buildPresentationMuscleSet();
    app.activationRankingExpanded = false;
    syncRegionPresentationControls();
    updateInventory();
    renderPaths();
    updateActivationRanking();
}

function normalizedCoordinate(coordinate) {
    return {
        ...coordinate,
        name: coordinate.name || coordinate.engineName,
        engineName: coordinate.engineName || coordinate.name,
        minimum: coordinate.minimum ?? coordinate.minimumDegrees,
        maximum: coordinate.maximum ?? coordinate.maximumDegrees,
        default: coordinate.default ?? coordinate.defaultDegrees ?? 0,
        units: coordinate.units || 'degrees'
    };
}

function normalizedMuscle(muscle, region) {
    return {
        ...muscle,
        id: muscle.id || `${app.engineMetadata.identity.modelId}:${region.id}:actuator:${muscle.actuatorId}`,
        group: muscle.group || 'Regional muscles',
        visibleByDefault: muscle.visibleByDefault !== false
    };
}

function regionPresetGroups(region) {
    if (Array.isArray(region.presetGroups)) return region.presetGroups;
    if (Array.isArray(region.presets)) {
        return [{ id: 'reference', label: 'Reference postures', presets: region.presets }];
    }
    return [];
}

function activateRegionMetadata(regionId) {
    const region = availableRegions().find((candidate) => candidate.id === regionId);
    if (!region) throw new RangeError(`Unknown Explorer region: ${regionId}.`);
    const coordinates = (region.coordinates || []).map(normalizedCoordinate);
    const muscles = (region.muscles || region.candidateMuscles || [])
        .map((muscle) => normalizedMuscle(muscle, region));
    const activeBodyIds = [...(region.activeBodyIds || region.geometryActiveBodyIds || region.geometry?.activeBodyIds || [])];
    const presets = regionPresetGroups(region).flatMap((group) => group.presets || []);
    const solverConfig = region.solverConfig || region.solver || app.engineMetadata.solverConfig;
    const calculationSide = region.calculationSide || region.laterality || 'midline';
    app.regionId = region.id;
    app.metadata = {
        ...app.engineMetadata,
        region,
        regionId: region.id,
        regionDigest: region.digest || region.regionDigest || region.regionDigestSha256 || region.contractDigest || region.contentDigestSha256,
        coordinates,
        muscles,
        muscleNames: muscles.map((muscle) => muscle.name),
        presets,
        presetGroups: regionPresetGroups(region),
        solverConfig,
        activeBodyIds,
        capabilities: {
            ...app.engineMetadata.capabilities,
            ...region.capabilities,
            calculationSide
        },
        model: {
            ...app.engineMetadata.model,
            functionalMuscles: muscles.length,
            independentCoordinates: coordinates.length,
            regionBodies: activeBodyIds.length
        }
    };
    app.selectedMuscle = (typeof region.defaultSelectedMuscle === 'string' ? region.defaultSelectedMuscle : region.defaultSelectedMuscle?.name)
        || region.defaultSelectedMuscleName
        || muscles[0]?.name
        || '';
    app.coordinates = Object.fromEntries(coordinates.map((coordinate) => [coordinate.name, coordinate.default]));
    return app.metadata;
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
    if (renderingContextLost) return;
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => {
        renderFrame = 0;
        renderer.render(scene, camera);
    });
}

renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    renderingContextLost = true;
    setLoading('Restoring the 3D view…');
});

renderer.domElement.addEventListener('webglcontextrestored', () => {
    renderingContextLost = false;
    resizeRenderer();
    if (app.state) {
        applyBodyTransforms(app.state);
        renderPaths();
    }
    setLoading('', false);
    requestRender();
});

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
    if (state.regionId && state.regionId !== app.regionId) return false;
    if (app.metadata?.regionDigest && state.regionDigest !== app.metadata.regionDigest) return false;
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
        throw new Error(`Model geometry SHA-256 mismatch. Expected ${expectedDigest}; received ${actualDigest}.`);
    }
    return buffer;
}

function parseGeometry(buffer) {
    if (buffer.byteLength < 16) throw new Error('Model geometry file is incomplete.');
    const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 8));
    if (magic !== 'MSHARM01') throw new Error('Model geometry has an unsupported format.');
    const header = new DataView(buffer, 8, 8);
    const vertexCount = header.getUint32(0, true);
    const indexCount = header.getUint32(4, true);
    const positionsOffset = 16;
    const indicesOffset = positionsOffset + vertexCount * 3 * 4;
    const expectedBytes = indicesOffset + indexCount * 4;
    if (expectedBytes !== buffer.byteLength) throw new Error('Model geometry size does not match its header.');
    return {
        positions: new Float32Array(buffer, positionsOffset, vertexCount * 3),
        indices: new Uint32Array(buffer, indicesOffset, indexCount)
    };
}

function buildBodyMeshes(asset) {
    const activeBodyIds = new Set(app.metadata.activeBodyIds);
    for (const descriptor of app.metadata.geometry.geoms) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(asset.positions.slice(descriptor.vertexStart * 3, (descriptor.vertexStart + descriptor.vertexCount) * 3), 3));
        geometry.setIndex(new THREE.Uint32BufferAttribute(asset.indices.slice(descriptor.indexStart, descriptor.indexStart + descriptor.indexCount), 1));
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        const active = activeBodyIds.has(descriptor.bodyId);
        const mesh = new THREE.Mesh(geometry, active ? boneMaterial : contextMaterial);
        mesh.matrixAutoUpdate = false;
        mesh.name = descriptor.name;
        mesh.userData.bodyId = descriptor.bodyId;
        mesh.userData.activeRegion = active;
        app.bodyMeshes.push(mesh);
        (active ? app.activeRegionGroup : app.contextGroup).add(mesh);
    }
}

function clearBodyMeshes() {
    for (const mesh of app.bodyMeshes) {
        mesh.parent?.remove(mesh);
        mesh.geometry?.dispose();
    }
    app.bodyMeshes = [];
}

function assignRegionGeometry() {
    const activeBodyIds = new Set(app.metadata.activeBodyIds);
    for (const mesh of app.bodyMeshes) {
        const active = activeBodyIds.has(mesh.userData.bodyId);
        mesh.userData.activeRegion = active;
        mesh.material = active ? boneMaterial : contextMaterial;
        (active ? app.activeRegionGroup : app.contextGroup).add(mesh);
    }
    app.contextGroup.visible = app.showContext;
    requestRender();
}

function thumbnailCoordinates(preset) {
    const values = preset?.coordinates || preset || {};
    return Object.fromEntries(app.metadata.coordinates.map((coordinate) => [
        coordinate.name,
        values[coordinate.name] ?? coordinate.default
    ]));
}

function createThumbnailRenderer() {
    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true
    });
    renderer.setPixelRatio(1);
    renderer.setSize(104, 104, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const root = new THREE.Group();
    const context = new THREE.Group();
    const activeRegion = new THREE.Group();
    root.rotation.x = -Math.PI / 2;
    root.add(context, activeRegion);
    scene.add(root);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6d7873, 2.5));
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const light = new THREE.DirectionalLight(0xffffff, 2.8);
    light.position.set(3, 5, 4);
    scene.add(light);

    const armMaterial = new THREE.MeshStandardMaterial({
        color: 0xbfae90,
        roughness: 0.82,
        metalness: 0,
        side: THREE.DoubleSide
    });
    const contextMaterial = new THREE.MeshStandardMaterial({
        color: 0x789189,
        roughness: 0.92,
        metalness: 0,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const meshes = app.bodyMeshes.map((source) => {
        const mesh = new THREE.Mesh(
            source.geometry,
            source.userData.activeRegion ? armMaterial : contextMaterial
        );
        mesh.matrixAutoUpdate = false;
        mesh.userData.bodyId = source.userData.bodyId;
        mesh.userData.activeRegion = source.userData.activeRegion;
        (mesh.userData.activeRegion ? activeRegion : context).add(mesh);
        return mesh;
    });
    const camera = new THREE.PerspectiveCamera(27, 1, 0.005, 50);

    return {
        renderer,
        scene,
        root,
        activeRegion,
        meshes,
        camera,
        dispose() {
            armMaterial.dispose();
            contextMaterial.dispose();
            renderer.dispose();
        }
    };
}

function applyThumbnailPose(thumbnail, state) {
    for (const mesh of thumbnail.meshes) {
        const transform = state.bodyTransforms?.[mesh.userData.bodyId]
            ?? state.bodies?.find((body) => body.bodyId === mesh.userData.bodyId);
        mesh.visible = Boolean(transform);
        if (transform) bodyMatrix(transform, mesh.matrix);
        mesh.matrixWorldNeedsUpdate = true;
    }
    thumbnail.root.updateMatrixWorld(true);
}

function frameThumbnail(thumbnail) {
    const bounds = new THREE.Box3().setFromObject(thumbnail.activeRegion);
    if (bounds.isEmpty()) return false;
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const direction = new THREE.Vector3(1, 0.14, 0.38).normalize();
    const halfFov = THREE.MathUtils.degToRad(thumbnail.camera.fov / 2);
    const distance = Math.max(sphere.radius / Math.sin(halfFov) * 1.16, 0.24);
    thumbnail.camera.position.copy(sphere.center).addScaledVector(direction, distance);
    thumbnail.camera.near = Math.max(distance / 100, 0.002);
    thumbnail.camera.far = Math.max(distance * 8, 4);
    thumbnail.camera.lookAt(sphere.center);
    thumbnail.camera.updateProjectionMatrix();
    return true;
}

function copyThumbnailToCanvas(source, canvas) {
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    canvas.classList.add('ready');
}

async function renderPoseThumbnails() {
    const engine = app.engine;
    const regionId = app.regionId;
    const presetById = new Map(app.metadata.presets.map((preset) => [preset.id || preset.name, preset]));
    const targets = new Map();
    for (const canvas of document.querySelectorAll('canvas.preset-thumbnail')) {
        const requestedRegion = canvas.dataset.thumbnailRegion || app.regionId;
        if (requestedRegion !== app.regionId) continue;
        const presetName = canvas.dataset.thumbnailPreset
            || canvas.closest('[data-preset]')?.dataset.preset;
        if (!presetById.has(presetName)) continue;
        if (!targets.has(presetName)) targets.set(presetName, []);
        targets.get(presetName).push(canvas);
    }
    if (!targets.size) return;

    const thumbnail = createThumbnailRenderer();
    try {
        for (const [presetName, canvases] of targets) {
            const state = await engine.pose(
                thumbnailCoordinates(presetById.get(presetName)),
                app.selectedMuscle,
                regionId
            );
            if (engine !== app.engine || regionId !== app.regionId) return;
            applyThumbnailPose(thumbnail, state);
            if (!frameThumbnail(thumbnail)) continue;
            thumbnail.renderer.render(thumbnail.scene, thumbnail.camera);
            for (const canvas of canvases) {
                copyThumbnailToCanvas(thumbnail.renderer.domElement, canvas);
            }
        }
    } finally {
        thumbnail.dispose();
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

const BACK_MUSCLE_PATTERNS = Object.freeze({
    back: /^(?:LTpT|LTpL|IL_|MF_|multifidus_|QL_|LD_)/i,
    extensors: /^(?:LTpT|LTpL|IL_)/i,
    multifidus: /^(?:MF_|multifidus_)/i,
    ql: /^QL_/i,
    core: /^(?:EO_|IO\d|rect_abd|TR\d|Ps_|iliacus)/i
});

function muscleSelectionScore(muscle) {
    const value = muscle.selection?.maximumProjectedMomentNmPerUnitActivation;
    return Number.isFinite(value) ? value : 0;
}

function presentationCandidates(pattern, limit = 48) {
    return app.metadata.muscles
        .filter((muscle) => pattern.test(muscle.name))
        .sort((left, right) => muscleSelectionScore(right) - muscleSelectionScore(left))
        .slice(0, limit);
}

function buildPresentationMuscleSet() {
    if (app.regionId !== 'trunk') return null;
    if (app.musclePresentation === 'overview') {
        return new Set(app.metadata.muscles.filter((muscle) => muscle.visibleByDefault !== false).map((muscle) => muscle.name));
    }
    if (app.musclePresentation === 'back') {
        const balanced = [
            [/^(?:LTpT|LTpL|IL_)/i, 16],
            [/^(?:MF_|multifidus_)/i, 14],
            [/^QL_/i, 12],
            [/^LD_/i, 6]
        ].flatMap(([pattern, limit]) => presentationCandidates(pattern, limit));
        return new Set(balanced.map((muscle) => muscle.name));
    }
    const pattern = BACK_MUSCLE_PATTERNS[app.musclePresentation] || BACK_MUSCLE_PATTERNS.back;
    return new Set(presentationCandidates(pattern).map((muscle) => muscle.name));
}

function muscleMatchesActivePresentation(muscle) {
    return !app.presentationMuscleNames || app.presentationMuscleNames.has(muscle.name);
}

function pathVisible(muscle) {
    if (app.presentationMuscleNames) return app.presentationMuscleNames.has(muscle.name);
    return muscle.visibleByDefault !== false || app.showLongOrigins;
}

function muscleSegmentChains(segments) {
    const chains = [];
    let current = null;
    for (const segment of segments ?? []) {
        if (!Array.isArray(segment) || segment.length < 6) continue;
        const start = new THREE.Vector3(segment[0], segment[1], segment[2]);
        const end = new THREE.Vector3(segment[3], segment[4], segment[5]);
        if (!start.toArray().every(Number.isFinite) || !end.toArray().every(Number.isFinite)) continue;
        if (start.distanceToSquared(end) < 1e-16) continue;
        const previous = current?.[current.length - 1];
        if (!previous || previous.distanceToSquared(start) > 1e-12) {
            current = [start, end];
            chains.push(current);
        } else {
            current.push(end);
        }
    }
    return chains;
}

function anatomicalMuscleProfile(muscle) {
    const name = String(muscle.name ?? '').toUpperCase();
    const group = String(muscle.group ?? '').toLowerCase();
    if (/DELT|PECM|LD_|TRAP|SERRANT|SUPSP|INFSP|SUBSC|TMAJ|TMIN|LEVATOR/.test(name) || group.includes('shoulder')) {
        return { width: 1.32, depth: 0.52, fullness: 0.56, skew: -0.08, attachmentFlare: 0.55, size: 1.08 };
    }
    if (/BIC|TRI|BRA|BRD|CORB/.test(name)) {
        return { width: 1.02, depth: 0.78, fullness: 0.72, skew: 0.02, attachmentFlare: 0.34, size: 1.08 };
    }
    if (/GLUT|QUAD|RECT_FEM|VAS|BIFEM|SEMIM|SEMIT|ADD|GRAC|SART|TFL|GAS|SOL|TIB|PER|FHL|FDL|EHL|EDL/.test(name)
            || group.includes('lower limb')) {
        return { width: 1.08, depth: 0.72, fullness: 0.68, skew: 0.01, attachmentFlare: 0.32, size: 1.12 };
    }
    if (/OBLIQ|RECTUS|MULT|PSOAS|ILIOC|LONGISS|QUAD_LUMB|TRANSVERS|SPINAL|SEMISP|SPLEN|SCALEN|STERNOMAST/.test(name)
            || group.includes('trunk') || group.includes('neck')) {
        return { width: 1.12, depth: 0.48, fullness: 0.62, skew: 0, attachmentFlare: 0.42, size: 1.02 };
    }
    return { width: 0.88, depth: 0.56, fullness: 0.92, skew: 0.08, attachmentFlare: 0.38, size: 0.9 };
}

function sampleAnatomicalChain(chain, length) {
    const divisions = Math.min(52, Math.max(
        (chain.length - 1) * 4,
        Math.ceil(length / ANATOMICAL_BODY_SAMPLE_SPACING)
    ));
    if (chain.length === 2) {
        return Array.from({ length: divisions + 1 }, (_, index) => (
            chain[0].clone().lerp(chain[1], index / divisions)
        ));
    }
    const curve = new THREE.CatmullRomCurve3(chain, false, 'centripetal');
    return curve.getPoints(divisions);
}

function createAnatomicalMuscleBodyGeometry(muscle, muscleColor, emphasized) {
    const sourceChains = muscleSegmentChains(muscle.segments);
    const sourceLengths = sourceChains.map((chain) => chain.slice(1).reduce(
        (sum, point, index) => sum + point.distanceTo(chain[index]),
        0
    ));
    const chains = sourceChains.map((chain, index) => sampleAnatomicalChain(chain, sourceLengths[index]));
    const chainLengths = chains.map((chain) => chain.slice(1).reduce(
        (sum, point, index) => sum + point.distanceTo(chain[index]),
        0
    ));
    const totalLength = chainLengths.reduce((sum, length) => sum + length, 0);
    if (!Number.isFinite(totalLength) || totalLength < 1e-8) return null;

    const profile = anatomicalMuscleProfile(muscle);
    const positions = [];
    const normals = [];
    const colors = [];
    const indices = [];
    const tendonRadius = emphasized ? 0.0017 : 0.00072;
    const requestedBellyRadius = (emphasized ? 0.0135 : 0.00365) * profile.size;
    const bellyRadius = Math.max(tendonRadius * 1.5, Math.min(requestedBellyRadius, totalLength * 0.052));
    const reference = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const previousTangent = new THREE.Vector3();
    const firstTangent = new THREE.Vector3();
    const lastTangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const binormal = new THREE.Vector3();
    const radial = new THREE.Vector3();
    const surfaceNormal = new THREE.Vector3();
    const transport = new THREE.Quaternion();
    let travelled = 0;

    for (const [chainIndex, chain] of chains.entries()) {
        if (chain.length < 2 || chainLengths[chainIndex] < 1e-8) continue;
        const ringStart = positions.length / 3;
        let localTravel = 0;

        for (let pointIndex = 0; pointIndex < chain.length; pointIndex += 1) {
            const point = chain[pointIndex];
            if (pointIndex > 0) localTravel += point.distanceTo(chain[pointIndex - 1]);
            if (pointIndex === 0) tangent.copy(chain[1]).sub(point);
            else if (pointIndex === chain.length - 1) tangent.copy(point).sub(chain[pointIndex - 1]);
            else tangent.copy(chain[pointIndex + 1]).sub(chain[pointIndex - 1]);
            tangent.normalize();

            if (pointIndex === 0) {
                reference.set(0, 0, 1);
                if (Math.abs(tangent.dot(reference)) > 0.92) reference.set(1, 0, 0);
                normal.copy(reference).addScaledVector(tangent, -reference.dot(tangent)).normalize();
                firstTangent.copy(tangent);
            } else {
                transport.setFromUnitVectors(previousTangent, tangent);
                normal.applyQuaternion(transport);
                normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
            }
            binormal.crossVectors(tangent, normal).normalize();
            previousTangent.copy(tangent);
            lastTangent.copy(tangent);

            const pathPosition = THREE.MathUtils.clamp((travelled + localTravel) / totalLength, 0, 1);
            const shapedPosition = THREE.MathUtils.clamp(
                pathPosition + profile.skew * Math.sin(Math.PI * pathPosition),
                0,
                1
            );
            const belly = Math.pow(Math.max(0, Math.sin(Math.PI * shapedPosition)), profile.fullness);
            const endDistance = Math.min(pathPosition, 1 - pathPosition);
            const attachmentBlend = 1 - THREE.MathUtils.smoothstep(endDistance, 0, 0.13);
            const radius = tendonRadius + (bellyRadius - tendonRadius) * belly;
            const majorRadius = radius * profile.width * (1 + attachmentBlend * profile.attachmentFlare);
            const minorRadius = radius * profile.depth * (1 - attachmentBlend * 0.2);

            for (let side = 0; side < ANATOMICAL_BODY_RADIAL_SEGMENTS; side += 1) {
                const angle = side / ANATOMICAL_BODY_RADIAL_SEGMENTS * Math.PI * 2;
                const cosine = Math.cos(angle);
                const sine = Math.sin(angle);
                radial.copy(normal).multiplyScalar(cosine * majorRadius).addScaledVector(binormal, sine * minorRadius);
                positions.push(point.x + radial.x, point.y + radial.y, point.z + radial.z);
                surfaceNormal.copy(normal).multiplyScalar(cosine / majorRadius)
                    .addScaledVector(binormal, sine / minorRadius)
                    .normalize();
                normals.push(surfaceNormal.x, surfaceNormal.y, surfaceNormal.z);
                colors.push(muscleColor.r, muscleColor.g, muscleColor.b);
            }
            if (pointIndex > 0) {
                const previousRing = ringStart + (pointIndex - 1) * ANATOMICAL_BODY_RADIAL_SEGMENTS;
                const currentRing = ringStart + pointIndex * ANATOMICAL_BODY_RADIAL_SEGMENTS;
                for (let side = 0; side < ANATOMICAL_BODY_RADIAL_SEGMENTS; side += 1) {
                    const next = (side + 1) % ANATOMICAL_BODY_RADIAL_SEGMENTS;
                    indices.push(
                        previousRing + side, currentRing + side, currentRing + next,
                        previousRing + side, currentRing + next, previousRing + next
                    );
                }
            }
        }

        const endRing = ringStart + (chain.length - 1) * ANATOMICAL_BODY_RADIAL_SEGMENTS;
        const startCenter = positions.length / 3;
        positions.push(chain[0].x, chain[0].y, chain[0].z);
        normals.push(-firstTangent.x, -firstTangent.y, -firstTangent.z);
        colors.push(muscleColor.r, muscleColor.g, muscleColor.b);
        const endCenter = positions.length / 3;
        const chainEnd = chain[chain.length - 1];
        positions.push(chainEnd.x, chainEnd.y, chainEnd.z);
        normals.push(lastTangent.x, lastTangent.y, lastTangent.z);
        colors.push(muscleColor.r, muscleColor.g, muscleColor.b);
        for (let side = 0; side < ANATOMICAL_BODY_RADIAL_SEGMENTS; side += 1) {
            const next = (side + 1) % ANATOMICAL_BODY_RADIAL_SEGMENTS;
            indices.push(startCenter, ringStart + next, ringStart + side);
            indices.push(endCenter, endRing + side, endRing + next);
        }
        travelled += chainLengths[chainIndex];
    }

    if (!indices.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
}

function renderPaths() {
    disposeChildren(app.pathGroup);
    const available = activationAvailable();
    const showOnly = app.pathView === 'one';
    for (const muscle of app.state?.muscles ?? []) {
        const selected = muscle.name === app.selectedMuscle;
        if ((!pathVisible(muscle) && !(showOnly && selected)) || (showOnly && !selected)) continue;
        const color = available ? activationColor(muscle.activation) : (selected && showOnly ? SELECTED_COLOR : NEUTRAL_COLOR);
        if (app.muscleRendering === 'anatomical') {
            const geometry = createAnatomicalMuscleBodyGeometry(muscle, color, selected && showOnly);
            if (!geometry) continue;
            const material = new THREE.MeshStandardMaterial({
                vertexColors: true,
                roughness: 0.54,
                metalness: 0,
                transparent: true,
                opacity: selected && showOnly ? 0.98 : available ? 0.84 : 0.56,
                depthWrite: selected && showOnly,
                side: THREE.DoubleSide
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.renderOrder = 2;
            mesh.frustumCulled = false;
            mesh.userData.muscleName = muscle.name;
            app.pathGroup.add(mesh);
        } else {
            const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: selected ? 1 : available ? 0.82 : 0.58, depthWrite: false });
            for (const [index, segment] of (muscle.segments ?? []).entries()) {
                const mesh = new THREE.Mesh(unitCylinder, material);
                mesh.renderOrder = 2;
                mesh.frustumCulled = false;
                mesh.userData.muscleName = muscle.name;
                positionSegment(mesh, segment, muscle.segmentInsideWrap?.[index] ? 0.0011 : selected && showOnly ? 0.003 : 0.00155);
                app.pathGroup.add(mesh);
            }
        }
    }
    renderSelected();
    requestRender();
}

function setMuscleRendering(mode) {
    app.muscleRendering = mode === 'lines' ? 'lines' : 'anatomical';
    const anatomical = app.muscleRendering === 'anatomical';
    const lines = app.muscleRendering === 'lines';
    $('#render-anatomical-bodies').classList.toggle('active', anatomical);
    $('#render-path-lines').classList.toggle('active', lines);
    $('#render-anatomical-bodies').setAttribute('aria-pressed', String(anatomical));
    $('#render-path-lines').setAttribute('aria-pressed', String(lines));
    setText('#muscle-rendering-legend', anatomical ? 'Anatomical bodies' : 'Path lines');
    renderPaths();
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

function updateCameraProjection() {
    camera.updateProjectionMatrix();
    camera.projectionMatrix.elements[8] = -cameraState.framingOffset.x;
    camera.projectionMatrix.elements[9] = -cameraState.framingOffset.y;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

function updateCamera() {
    const cosPitch = Math.cos(cameraState.pitch);
    camera.position.set(
        cameraState.target.x + cameraState.radius * Math.sin(cameraState.yaw) * cosPitch,
        cameraState.target.y + cameraState.radius * Math.sin(cameraState.pitch),
        cameraState.target.z + cameraState.radius * Math.cos(cameraState.yaw) * cosPitch
    );
    camera.lookAt(cameraState.target);
    updateCameraProjection();
    requestRender();
}

function fitCameraToModel() {
    displayRoot.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(app.activeRegionGroup);
    if (app.showContext) bounds.union(new THREE.Box3().setFromObject(app.contextGroup));
    if (bounds.isEmpty()) return;
    const size = bounds.getSize(new THREE.Vector3());
    bounds.getCenter(cameraState.target);
    const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const radius = Math.max(size.y / (2 * Math.tan(halfFov)), size.z / (2 * Math.tan(halfFov) * Math.max(camera.aspect, 0.5))) * 1.18;
    cameraState.radius = THREE.MathUtils.clamp(radius, 0.6, MAX_CAMERA_RADIUS);
    cameraState.initialRadius = cameraState.radius;
    cameraState.initialTarget.copy(cameraState.target);
    cameraState.framingOffset.set(0, 0);
    cameraState.yaw = regionViewYaw();
    cameraState.pitch = 0.025;
    camera.near = Math.max(cameraState.radius / 500, 0.001);
    camera.far = Math.max(cameraState.radius * 20, 10);
    grid.position.y = bounds.min.y - Math.max(size.y * 0.025, 0.005);
    grid.scale.setScalar(Math.max(size.length() / 2.4, 0.5));
    app.cameraFitted = true;
    updateCamera();
}

function resetView() {
    cameraState.yaw = regionViewYaw();
    cameraState.pitch = 0.025;
    cameraState.radius = cameraState.initialRadius;
    cameraState.target.copy(cameraState.initialTarget);
    cameraState.framingOffset.set(0, 0);
    updateCamera();
}

function setMirroredView(mirrored) {
    app.mirrored = Boolean(mirrored);
    displayRoot.scale.x = app.mirrored ? -1 : 1;
    const button = $('#mirror-view');
    button.classList.toggle('active', app.mirrored);
    button.setAttribute('aria-pressed', String(app.mirrored));
    const mirrorLabel = app.mirrored ? 'Show unmirrored display — calculation unchanged' : 'Mirror display — calculation unchanged';
    button.setAttribute('aria-label', mirrorLabel);
    button.dataset.tooltip = mirrorLabel;
    const regionName = regionDisplayName(app.metadata?.region);
    if (app.inDiagnosis) {
        setText('#viewer-title', app.mirrored ? 'Left display (mirrored right upper-limb calculation)' : 'Right upper limb');
        setText('#viewer-instructions', app.mirrored
            ? 'Visual mirror only · right upper-limb calculation · left-drag to rotate · right-drag to move · scroll to zoom at the pointer'
            : 'Left-drag to rotate · right-drag to move · scroll to zoom at the pointer');
    } else {
        setText('#viewer-title', app.mirrored ? `${regionName} · mirrored display` : regionName);
        setText('#viewer-instructions', 'Click a muscle to inspect · left-drag to rotate · right-drag to move · scroll to zoom');
    }
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

function handCoordinateGroup(coordinateName) {
    if (coordinateName === 'deviation_r' || coordinateName === 'flexion_r') return 'Wrist';
    if (/^(?:cmc_|mp_|ip_)/.test(coordinateName)) return 'Thumb';
    if (coordinateName.startsWith('2')) return 'Index finger';
    if (coordinateName.startsWith('3')) return 'Middle finger';
    if (coordinateName.startsWith('4')) return 'Ring finger';
    return 'Little finger';
}

function buildCoordinateControls() {
    const fragment = document.createDocumentFragment();
    const handGroups = new Map();
    if (app.regionId === 'right-hand') {
        for (const name of ['Wrist', 'Thumb', 'Index finger', 'Middle finger', 'Ring finger', 'Little finger']) {
            const details = document.createElement('details');
            details.className = 'coordinate-group';
            details.open = name === 'Wrist' || name === 'Thumb';
            const summary = document.createElement('summary');
            summary.textContent = name;
            const body = document.createElement('div');
            body.className = 'coordinate-group-body';
            details.append(summary, body);
            fragment.append(details);
            handGroups.set(name, body);
        }
    }
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
        const group = handGroups.get(handCoordinateGroup(coordinate.name));
        (group || fragment).append(wrapper);
        updateRangeProgress(input);
    }
    $('#coordinate-controls').replaceChildren(fragment);
}

function buildRegionPicker() {
    const select = $('#focus-region');
    const fragment = document.createDocumentFragment();
    for (const region of explorerRegionOptions()) {
        const option = document.createElement('option');
        option.value = region.id;
        option.textContent = REGION_OPTION_LABELS[region.id] || regionDisplayName(region);
        option.selected = region.id === app.regionId;
        fragment.append(option);
    }
    select.replaceChildren(fragment);
    select.disabled = !app.initialized;
    syncRegionControls();
}

function buildPresetLibrary() {
    const host = $('#pose-presets');
    const fragment = document.createDocumentFragment();
    let presetCount = 0;
    for (const [groupIndex, group] of app.metadata.presetGroups.entries()) {
        const section = document.createElement('section');
        section.className = 'preset-group';
        const heading = document.createElement('h4');
        const headingId = `preset-${app.regionId}-${group.id || groupIndex}`;
        heading.id = headingId;
        heading.textContent = group.label || 'Reference postures';
        section.setAttribute('aria-labelledby', headingId);
        const buttons = document.createElement('div');
        buttons.className = 'pose-presets';
        for (const preset of group.presets || []) {
            const id = preset.id || preset.name;
            if (!id) continue;
            presetCount += 1;
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.preset = id;
            button.setAttribute('aria-pressed', 'false');
            if (preset.description) button.title = preset.description;
            const canvas = document.createElement('canvas');
            canvas.className = 'preset-thumbnail';
            canvas.width = 104;
            canvas.height = 104;
            canvas.dataset.thumbnailRegion = app.regionId;
            canvas.dataset.thumbnailPreset = id;
            canvas.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.textContent = preset.label || id;
            button.append(canvas, label);
            buttons.append(button);
        }
        section.append(heading, buttons);
        fragment.append(section);
    }
    host.replaceChildren(fragment);
    setText('#preset-count', String(presetCount));
    setText('#preset-summary', `${presetCount} reference posture${presetCount === 1 ? '' : 's'}`);
}

function clearPresetSelection() {
    for (const button of document.querySelectorAll('[data-preset]')) {
        button.classList.remove('active');
        button.setAttribute('aria-pressed', 'false');
    }
}

function applyPosePreset(name) {
    const preset = app.metadata.presets.find((candidate) => (candidate.id || candidate.name) === name);
    if (!preset) return;
    const values = preset.coordinates || {};
    for (const coordinate of app.metadata.coordinates) {
        const value = values[coordinate.name] ?? coordinate.default;
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
            option.textContent = `${muscleDisplayName(muscle.name)} — ${muscleModelId(muscle.name)}`;
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
    app.pathView = view === 'one' ? 'one' : 'all';
    const details = app.pathView !== 'all';
    app.activationPanelVisible = !details && !compactViewer();
    app.musclePanelVisible = details;
    $('#view-all-muscles').classList.toggle('active', app.pathView === 'all');
    $('#view-one-muscle').classList.toggle('active', app.pathView === 'one');
    $('#view-all-muscles').setAttribute('aria-pressed', String(app.pathView === 'all'));
    $('#view-one-muscle').setAttribute('aria-pressed', String(app.pathView === 'one'));
    syncViewerDrawers();
    renderPaths();
    updateDetails();
}

function selectMuscle(name, view = 'one') {
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
    setText('#muscle-title', muscleDisplayName(muscle.name));
    setText('#muscle-model-id', `Model ID: ${muscle.name}`);
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
    const ranked = [...app.state.muscles]
        .filter((muscle) => muscleMatchesActivePresentation(muscle))
        .sort((left, right) => right.activation - left.activation);
    const visible = app.activationRankingExpanded ? ranked : ranked.slice(0, 12);
    for (const muscle of visible) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'activation-row';
        const displayName = muscleDisplayName(muscle.name);
        row.title = `${displayName} · ${muscle.name} · ${muscle.group}`;
        row.innerHTML = '<span class="rank-label"><span class="rank-name"></span><small class="rank-id"></small></span><span class="rank-track"><span class="rank-fill"></span></span><span class="rank-value"></span>';
        row.querySelector('.rank-name').textContent = displayName;
        row.querySelector('.rank-id').textContent = muscleModelId(muscle.name);
        row.querySelector('.rank-fill').style.width = `${THREE.MathUtils.clamp(muscle.activation, 0, 1) * 100}%`;
        row.querySelector('.rank-fill').style.background = `#${activationColor(muscle.activation).getHexString()}`;
        row.querySelector('.rank-value').textContent = muscle.activation.toFixed(3);
        row.setAttribute('aria-label', `${displayName}, model ID ${muscle.name}, ${muscle.group}, activation ${muscle.activation.toFixed(3)}`);
        row.addEventListener('click', () => selectMuscle(muscle.name, 'one'));
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
    if (state.regionId && state.regionId !== app.regionId) throw new Error('A result from a different body region was rejected.');
    if (app.metadata.regionDigest && state.regionDigest !== app.metadata.regionDigest) throw new Error('A result from a different region definition was rejected.');
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
    const regionId = app.regionId;
    const engine = app.engine;
    try {
        const state = await engine.pose(coordinates, selectedMuscle, regionId);
        if (generation !== app.poseGeneration || regionId !== app.regionId || engine !== app.engine) return null;
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
    const regionId = app.regionId;
    const engine = app.engine;
    $('#calculate-static').disabled = true;
    $('#calculate-static').textContent = 'Calculating…';
    setPositionStatus('static', 'Calculating activation…', 'Colors remain gray until every quality check passes.');
    try {
        const state = await engine.staticHold(coordinates, selectedMuscle, regionId);
        if (generation !== app.solveGeneration || regionId !== app.regionId || engine !== app.engine) return null;
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

async function ensureEngineProfile(profileId) {
    let profile = app.profiles.get(profileId);
    if (profile?.metadata && profile.geometry) return profile;
    if (!profile) {
        const definition = PROFILE_DEFINITIONS[profileId];
        if (!definition) throw new RangeError(`Unknown model profile: ${profileId}.`);
        const engine = createMsHumanEngine({
            workerUrl: definition.workerUrl,
            workerName: `ms-human-${profileId}-engine`,
            onFatalError: (error) => {
                if (app.profileId === profileId) handleFatalEngineError(error);
                else showError(`The ${profileId === 'hand' ? 'hand' : 'primary'} model profile stopped unexpectedly: ${error.message}`);
            }
        });
        profile = { ...definition, engine, metadata: null, geometry: null };
        app.profiles.set(profileId, profile);
    }
    if (profile.loading) return profile.loading;
    profile.loading = (async () => {
        const [metadata, geometryResponse] = await Promise.all([
            profile.engine.initialize(),
            fetch(profile.geometryUrl, { cache: 'force-cache' })
        ]);
        if (!geometryResponse.ok) throw new Error(`Model geometry request failed (${geometryResponse.status}).`);
        const geometryBuffer = await verifiedGeometryBuffer(geometryResponse, metadata.geometry.sha256);
        profile.metadata = metadata;
        profile.geometry = parseGeometry(geometryBuffer);
        return profile;
    })().finally(() => { profile.loading = null; });
    return profile.loading;
}

function activateEngineProfile(profileId, regionId) {
    const profile = app.profiles.get(profileId);
    if (!profile?.metadata || !profile.geometry) throw new Error(`The ${profileId} model profile is not ready.`);
    app.profileId = profileId;
    app.engine = profile.engine;
    app.engineMetadata = profile.metadata;
    disposeChildren(app.pathGroup);
    disposeChildren(app.selectedGroup);
    clearBodyMeshes();
    activateRegionMetadata(regionId || profile.metadata.defaultRegionId);
    buildBodyMeshes(profile.geometry);
    configureRegion(app.regionId);
    buildRegionPicker();
}

async function switchEngineProfile(profileId, regionId) {
    const generation = ++app.profileGeneration;
    const label = REGION_OPTION_LABELS[regionId] || 'model region';
    window.clearTimeout(app.poseTimer);
    window.clearTimeout(app.solveTimer);
    app.poseGeneration += 1;
    app.solveGeneration += 1;
    $('#focus-region').disabled = true;
    setLoading(`Loading ${label}…`);
    const profile = await ensureEngineProfile(profileId);
    if (generation !== app.profileGeneration) return;
    const region = profileRegions(profileId).find((candidate) => candidate.id === regionId);
    if (!region) throw new Error(`${label} is not available in this model profile.`);
    activateEngineProfile(profileId, region.id);
    const pose = await requestPose();
    if (!pose || generation !== app.profileGeneration) return;
    fitCameraToModel();
    try {
        await renderPoseThumbnails();
    } catch (error) {
        console.warn('Posture previews could not be rendered.', error);
    }
    if (generation !== app.profileGeneration) return;
    await requestStaticHold();
    if (generation === app.profileGeneration) {
        setLoading('', false);
        $('#focus-region').disabled = false;
    }
}

async function switchExplorerRegionSelection(regionId) {
    const profileId = regionId === 'right-hand' ? 'hand' : 'primary';
    if (app.profileId !== profileId) {
        await switchEngineProfile(profileId, regionId);
        return;
    }
    if (availableRegions().some((region) => region.id === regionId)) await switchExplorerRegion(regionId);
}

function configureRegion(regionId) {
    window.clearTimeout(app.poseTimer);
    window.clearTimeout(app.solveTimer);
    app.poseGeneration += 1;
    app.solveGeneration += 1;
    app.regionGeneration += 1;
    $('#focus-region').disabled = !app.initialized;
    app.state = null;
    app.activationRankingExpanded = false;
    app.showLongOrigins = false;
    app.presetLibraryVisible = false;
    activateRegionMetadata(regionId);
    app.musclePresentation = regionId === 'trunk' ? 'back' : 'overview';
    app.presentationMuscleNames = buildPresentationMuscleSet();
    app.regionView = regionId === 'trunk' ? 'back' : 'front';
    assignRegionGeometry();
    buildCoordinateControls();
    buildMuscleSelect();
    buildPresetLibrary();
    updateInventory();
    syncRegionControls();
    $('#toggle-long-origins').classList.remove('active');
    $('#toggle-long-origins').setAttribute('aria-pressed', 'false');
    syncPresetLibrary();
    syncRegionPresentationControls();
    setMirroredView(false);
    neutralizeDisplayedActivation();
}

async function switchExplorerRegion(regionId) {
    if (regionId === app.regionId && app.state) return;
    configureRegion(regionId);
    const generation = app.regionGeneration;
    setLoading(`Loading ${regionDisplayName(app.metadata.region)}…`);
    $('#focus-region').disabled = true;
    try {
        const pose = await requestPose();
        if (!pose || generation !== app.regionGeneration) return;
        fitCameraToModel();
        try {
            await renderPoseThumbnails();
        } catch (error) {
            console.warn('Posture previews could not be rendered.', error);
        }
        if (generation !== app.regionGeneration) return;
        await requestStaticHold();
    } finally {
        if (generation === app.regionGeneration) {
            setLoading('', false);
            $('#focus-region').disabled = false;
        }
    }
}

function updateInventory() {
    const region = app.metadata.region;
    const regionName = regionDisplayName(region);
    const activeIds = new Set(app.metadata.activeBodyIds);
    const activeMeshes = app.metadata.geometry.geoms.filter((geom) => activeIds.has(geom.bodyId)).length;
    setText('#count-region-name', regionName.toLowerCase());
    setText('#count-bodies', app.metadata.activeBodyIds.length);
    setText('#count-muscles', app.metadata.model.functionalMuscles);
    setText('#count-meshes', activeMeshes);
    setText('#active-region-legend', regionName);
    const shown = app.presentationMuscleNames?.size;
    const shownCopy = Number.isInteger(shown) ? ` · ${shown} shown` : '';
    setText('#region-scope', `${app.metadata.model.functionalMuscles} modeled muscles${shownCopy} · ${app.metadata.coordinates.length} posture controls`);
    const supportCopy = app.regionId.includes('lower-limb')
        ? 'Pelvis fixed · no foot contact · not stance or gait'
        : app.regionId === 'right-hand'
            ? 'Forearm fixed · unloaded finger posture · no grip force or contact'
        : app.regionId === 'trunk'
            ? 'Pelvis and all non-selected coordinates fixed'
            : app.regionId === 'head-neck'
                ? 'Model fixed below T1'
                : 'Rest of body fixed · no external load or contact';
    setText('#region-support-note', supportCopy);
    $('#region-support-note').title = region.semantics?.supportDescription || region.semantics?.fixedSupport || supportCopy;
    setText('#runtime-note', `${app.metadata.model.runtime}; ${regionName} static posture only.`);
    setText('#model-hash', 'Model files verified in this browser.');
    renderer.domElement.setAttribute(
        'aria-label',
        `Interactive ${regionName} rendering of MS-Human-700. Click a muscle to inspect it alone; use arrow keys to rotate, plus and minus to zoom, and Home to reset the view.`
    );
    const hasOptionalPaths = app.metadata.muscles.some((muscle) => muscle.visibleByDefault === false);
    const optionalPaths = $('#toggle-long-origins');
    optionalPaths.classList.toggle('hidden', app.regionId === 'trunk' || app.regionId === 'right-hand');
    optionalPaths.disabled = !hasOptionalPaths;
    optionalPaths.title = hasOptionalPaths ? 'Show additional regional muscle paths' : 'This region has no hidden muscle paths';
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
    cameraState.framingOffset.set(0, 0);
    updateCamera();
}

function viewerImageFilename({ transparent, scale, includeActivation }) {
    const region = app.mirrored ? `${app.regionId}-mirrored-view` : app.regionId;
    const background = transparent ? 'transparent' : 'background';
    return `waajacu-ms-human-${region}-static-${background}${includeActivation ? '-activation-table' : ''}-${scale}x.png`;
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
    const regionName = app.metadata.region.presentationName || app.metadata.region.label || app.regionId;
    context.fillText(app.mirrored ? `${regionName}; mirrored display` : `${regionName} calculation`, x + 8, y + 31);
    if (!visibleRows.length) {
        context.fillText('No activation result available.', x + 8, y + 49);
        context.restore();
        return;
    }
    visibleRows.forEach((muscle, index) => {
        const rowY = y + 49 + index * 12;
        context.fillStyle = '#17201d';
        context.font = '600 8px system-ui, sans-serif';
        context.fillText(muscleDisplayName(muscle.name), x + 8, rowY);
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
    updateCamera();
}

function pickMuscleAt(clientX, clientY) {
    if (!app.state?.muscles?.length) return false;
    const canvas = renderer.domElement;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return false;
    pointerNdc.set(
        ((clientX - bounds.left) / bounds.width) * 2 - 1,
        1 - ((clientY - bounds.top) / bounds.height) * 2
    );
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    muscleRaycaster.setFromCamera(pointerNdc, camera);

    const renderedMeshes = app.pathGroup.children.filter((child) => child.visible && child.userData.muscleName);
    const directHit = muscleRaycaster.intersectObjects(renderedMeshes, false)
        .find((intersection) => intersection.object.userData.muscleName);
    let muscleName = directHit?.object.userData.muscleName;

    if (!muscleName) {
        const worldPerPixel = 2 * cameraState.radius * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
            / Math.max(bounds.height, 1);
        const toleranceSquared = Math.pow(Math.max(0.0022, worldPerPixel * 9), 2);
        let bestDistanceSquared = toleranceSquared;
        let bestDepth = Number.POSITIVE_INFINITY;
        const showOnly = app.pathView === 'one';
        for (const muscle of app.state.muscles) {
            const selected = muscle.name === app.selectedMuscle;
            if ((!pathVisible(muscle) && !(showOnly && selected)) || (showOnly && !selected)) continue;
            for (const segment of muscle.segments ?? []) {
                pickStart.set(segment[0], segment[1], segment[2]);
                pickEnd.set(segment[3], segment[4], segment[5]);
                app.pathGroup.localToWorld(pickStart);
                app.pathGroup.localToWorld(pickEnd);
                const distanceSquared = muscleRaycaster.ray.distanceSqToSegment(
                    pickStart,
                    pickEnd,
                    pickRayPoint,
                    pickSegmentPoint
                );
                const depth = pickRayPoint.distanceToSquared(muscleRaycaster.ray.origin);
                if (distanceSquared < bestDistanceSquared
                        || (Math.abs(distanceSquared - bestDistanceSquared) < 1e-12 && depth < bestDepth)) {
                    bestDistanceSquared = distanceSquared;
                    bestDepth = depth;
                    muscleName = muscle.name;
                }
            }
        }
    }

    if (!muscleName) return false;
    selectMuscle(muscleName, 'one');
    renderer.domElement.focus({ preventScroll: true });
    return true;
}

function attachViewerInteraction() {
    const canvas = renderer.domElement;
    let dragMode = null;
    let lastX = 0;
    let lastY = 0;
    let pointerStartX = 0;
    let pointerStartY = 0;
    let pointerTravelSquared = 0;
    let activePointerId = null;
    canvas.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 && event.button !== 2) return;
        event.preventDefault();
        dragMode = event.button === 2 ? 'pan' : 'rotate';
        lastX = event.clientX;
        lastY = event.clientY;
        pointerStartX = event.clientX;
        pointerStartY = event.clientY;
        pointerTravelSquared = 0;
        activePointerId = event.pointerId;
        canvas.style.cursor = event.button === 2 ? 'move' : 'grabbing';
        canvas.focus({ preventScroll: true });
        canvas.setPointerCapture?.(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
        if (!dragMode) return;
        const deltaX = event.clientX - lastX;
        const deltaY = event.clientY - lastY;
        const travelX = event.clientX - pointerStartX;
        const travelY = event.clientY - pointerStartY;
        pointerTravelSquared = Math.max(pointerTravelSquared, travelX * travelX + travelY * travelY);
        if (dragMode === 'rotate') {
            cameraState.yaw -= deltaX * 0.008;
            cameraState.pitch = THREE.MathUtils.clamp(cameraState.pitch + deltaY * 0.006, -1.25, 1.25);
        } else {
            cameraState.framingOffset.x += 2 * deltaX / Math.max(canvas.clientWidth, 1);
            cameraState.framingOffset.y -= 2 * deltaY / Math.max(canvas.clientHeight, 1);
        }
        lastX = event.clientX;
        lastY = event.clientY;
        updateCamera();
    });
    const finish = (event, cancelled = false) => {
        const shouldPick = !cancelled
            && dragMode === 'rotate'
            && event.pointerId === activePointerId
            && pointerTravelSquared <= 36;
        dragMode = null;
        activePointerId = null;
        canvas.style.cursor = 'grab';
        if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture?.(event.pointerId);
        if (shouldPick) pickMuscleAt(event.clientX, event.clientY);
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', (event) => finish(event, true));
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('wheel', (event) => {
        event.preventDefault();
        const bounds = canvas.getBoundingClientRect();
        const pointerX = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1;
        const pointerY = 1 - ((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2;
        zoomAtNdc(Math.exp(event.deltaY * 0.0012), pointerX, pointerY);
    }, { passive: false });
    canvas.addEventListener('keydown', (event) => {
        const step = 0.12;
        if (event.key === 'ArrowLeft') cameraState.yaw += step;
        else if (event.key === 'ArrowRight') cameraState.yaw -= step;
        else if (event.key === 'ArrowUp') cameraState.pitch = THREE.MathUtils.clamp(cameraState.pitch - step, -1.25, 1.25);
        else if (event.key === 'ArrowDown') cameraState.pitch = THREE.MathUtils.clamp(cameraState.pitch + step, -1.25, 1.25);
        else if (event.key === '+' || event.key === '=') zoomAtNdc(1 / 1.12, 0, 0);
        else if (event.key === '-' || event.key === '_') zoomAtNdc(1.12, 0, 0);
        else if (event.key === 'Home') resetView();
        else return;
        event.preventDefault();
        if (!['+', '=', '-', '_', 'Home'].includes(event.key)) updateCamera();
    });
}

function zoomAtNdc(factor, pointerX, pointerY) {
    const oldRadius = cameraState.radius;
    const nextRadius = THREE.MathUtils.clamp(oldRadius * factor, MIN_CAMERA_RADIUS, MAX_CAMERA_RADIUS);
    if (nextRadius === oldRadius) return;
    const radiusRatio = nextRadius / oldRadius;
    cameraState.framingOffset.x = pointerX - (pointerX - cameraState.framingOffset.x) / radiusRatio;
    cameraState.framingOffset.y = pointerY - (pointerY - cameraState.framingOffset.y) / radiusRatio;
    cameraState.radius = nextRadius;
    updateCamera();
}

function zoomView(factor) {
    zoomAtNdc(factor, 0, 0);
}

function enterDiagnosisWorkspace() {
    const viewer = document.querySelector('.viewer-panel');
    const slot = $('#diagnosis-viewer-slot');
    if (!viewer || !slot || viewer.parentElement === slot) return;
    diagnosisViewerSnapshot = {
        profileId: app.profileId,
        regionId: app.regionId,
        coordinates: { ...app.coordinates },
        selectedMuscle: app.selectedMuscle,
        pathView: app.pathView,
        activationPanelVisible: app.activationPanelVisible,
        musclePanelVisible: app.musclePanelVisible,
        musclePresentation: app.musclePresentation,
        regionView: app.regionView,
        mirrored: app.mirrored
    };
    window.clearTimeout(app.poseTimer);
    window.clearTimeout(app.solveTimer);
    app.poseGeneration += 1;
    app.solveGeneration += 1;
    app.profileGeneration += 1;
    app.inDiagnosis = true;
    $('#focus-region').disabled = !app.initialized;
    if (app.profileId !== 'primary') activateEngineProfile('primary', DEFAULT_REGION_ID);
    else if (app.regionId !== DEFAULT_REGION_ID) configureRegion(DEFAULT_REGION_ID);
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
        app.inDiagnosis = false;
        const snapshot = diagnosisViewerSnapshot;
        if (app.profileId !== snapshot.profileId) activateEngineProfile(snapshot.profileId, snapshot.regionId);
        else if (app.regionId !== snapshot.regionId) configureRegion(snapshot.regionId);
        app.selectedMuscle = app.metadata.muscleNames.includes(snapshot.selectedMuscle)
            ? snapshot.selectedMuscle
            : app.selectedMuscle;
        $('#muscle-select').value = app.selectedMuscle;
        for (const coordinate of app.metadata.coordinates) {
            const value = snapshot.coordinates[coordinate.name] ?? coordinate.default;
            app.coordinates[coordinate.name] = value;
            const input = document.getElementById(`coordinate-${coordinate.name}`);
            if (input) {
                input.value = value;
                updateRangeProgress(input);
            }
            setText(`#coordinate-output-${coordinate.name}`, formatDegrees(value));
        }
        app.pathView = diagnosisViewerSnapshot.pathView;
        app.activationPanelVisible = diagnosisViewerSnapshot.activationPanelVisible;
        app.musclePanelVisible = diagnosisViewerSnapshot.musclePanelVisible;
        app.musclePresentation = snapshot.musclePresentation || app.musclePresentation;
        app.presentationMuscleNames = buildPresentationMuscleSet();
        app.regionView = snapshot.regionView || app.regionView;
        syncRegionPresentationControls();
        setMirroredView(diagnosisViewerSnapshot.mirrored);
        diagnosisViewerSnapshot = null;
    }
    $('#focus-region').disabled = !app.initialized;
    syncViewerDrawers();
    resizeRenderer();
    schedulePostureUpdate(0, 80);
}

function bindInterface() {
    $('#focus-region').addEventListener('change', async () => {
        if (!app.initialized) return;
        try {
            await switchExplorerRegionSelection($('#focus-region').value);
        } catch (error) {
            showError(`The selected body region could not be loaded: ${error.message}`);
            buildRegionPicker();
            setLoading('', false);
            $('#focus-region').disabled = false;
        }
    });
    $('#back-presentation-controls').addEventListener('click', (event) => {
        const button = event.target.closest('[data-region-view]');
        if (button) setRegionView(button.dataset.regionView);
    });
    $('#back-muscle-filter').addEventListener('change', () => setMusclePresentation($('#back-muscle-filter').value));
    $('#reset-view').addEventListener('click', resetView);
    $('#zoom-in').addEventListener('click', () => zoomView(1 / 1.18));
    $('#zoom-out').addEventListener('click', () => zoomView(1.18));
    $('#mirror-view').addEventListener('click', toggleMirroredView);
    $('#reset-pose').addEventListener('click', resetPose);
    $('#calculate-static').addEventListener('click', () => requestStaticHold());
    $('#toggle-preset-library').addEventListener('click', () => { app.presetLibraryVisible = !app.presetLibraryVisible; syncPresetLibrary(); });
    $('#render-anatomical-bodies').addEventListener('click', () => setMuscleRendering('anatomical'));
    $('#render-path-lines').addEventListener('click', () => setMuscleRendering('lines'));
    $('#view-all-muscles').addEventListener('click', () => setPathView('all'));
    $('#view-one-muscle').addEventListener('click', () => setPathView('one'));
    $('#muscle-select').addEventListener('change', () => selectMuscle($('#muscle-select').value, 'one'));
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
    $('#pose-presets').addEventListener('click', (event) => {
        const button = event.target.closest('[data-preset]');
        if (button) applyPosePreset(button.dataset.preset);
    });
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
            fetch(PROFILE_DEFINITIONS.primary.geometryUrl, { cache: 'force-cache' })
        ]);
        if (!geometryResponse.ok) throw new Error(`Model geometry request failed (${geometryResponse.status}).`);
        app.engineMetadata = metadata;
        activateRegionMetadata(metadata.defaultRegionId || DEFAULT_REGION_ID);
        app.model = {
            id: metadata.identity.modelId,
            modelDigest: metadata.identity.modelDigest,
            name: metadata.model.name,
            variant: metadata.model.variant,
            scope: metadata.model.variant,
            runtime: metadata.model.runtime,
            source: metadata.source,
            solverConfigurationId: metadata.solverConfig.id,
            regionId: metadata.defaultRegionId || DEFAULT_REGION_ID,
            regionDigest: metadata.regions?.find((region) => region.id === (metadata.defaultRegionId || DEFAULT_REGION_ID))?.digest,
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
        const primaryProfile = app.profiles.get('primary');
        primaryProfile.metadata = metadata;
        primaryProfile.geometry = geometry;
        buildRegionPicker();
        buildBodyMeshes(geometry);
        buildCoordinateControls();
        buildMuscleSelect();
        buildPresetLibrary();
        updateInventory();
        $('#server-status').className = 'server-status online';
        $('#server-status span:last-child').textContent = 'Model ready · runs locally';
        app.diagnosis = createDiagnosisWorkflow({
            pose: (coordinates, selected) => app.profiles.get('primary').engine.pose(coordinates, selected, DEFAULT_REGION_ID),
            staticHold: (coordinates, selected) => app.profiles.get('primary').engine.staticHold(coordinates, selected, DEFAULT_REGION_ID),
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
        if (!pose) {
            if (app.regionGeneration > 0) return;
            throw new Error('The initial posture could not be loaded.');
        }
        fitCameraToModel();
        setLoading('Preparing posture previews…');
        try {
            await renderPoseThumbnails();
        } catch (error) {
            console.warn('Pose previews could not be rendered.', error);
        }
        setLoading('', false);
        syncViewerDrawers();
        app.initialized = true;
        $('#focus-region').disabled = false;
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

window.addEventListener('beforeunload', () => {
    for (const profile of app.profiles.values()) profile.engine?.dispose();
});
initialize();
