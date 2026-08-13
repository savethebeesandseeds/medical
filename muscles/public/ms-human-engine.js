const DEFAULT_WORKER_URL = new URL('./ms-human-worker.js', import.meta.url);

export const MS_HUMAN_ENGINE_CONTRACT_VERSION = 1;

export class StaleRequestError extends Error {
    constructor(message = 'The MS-Human request was superseded by a newer posture.') {
        super(message);
        this.name = 'StaleRequestError';
        this.code = 'STALE_REQUEST';
    }
}

export class MsHumanEngineDisposedError extends Error {
    constructor(message = 'The MS-Human engine has been disposed.') {
        super(message);
        this.name = 'MsHumanEngineDisposedError';
        this.code = 'ENGINE_DISPOSED';
    }
}

function deepFreeze(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const child of Object.values(value)) deepFreeze(child, seen);
    return Object.freeze(value);
}

function errorFromWorker(payload) {
    const error = new Error(payload?.message || 'The MS-Human worker failed.');
    error.name = payload?.name || 'MsHumanEngineError';
    if (payload?.code) error.code = payload.code;
    if (payload?.details !== undefined) error.details = payload.details;
    if (payload?.stack) error.workerStack = payload.stack;
    return error;
}

/**
 * Message-based facade for the MS-Human right-arm runtime.
 *
 * The worker exclusively owns MuJoCo, MjModel, and MjData. Calls that realize
 * or solve a posture supersede any older posture call immediately. The older
 * calculation may finish inside the worker, but its reply is ignored and its
 * facade promise is rejected with StaleRequestError.
 */
export class MsHumanEngine {
    constructor(options = {}) {
        this._workerUrl = options.workerUrl
            ? new URL(options.workerUrl, globalThis.location?.href || import.meta.url)
            : DEFAULT_WORKER_URL;
        this._workerOptions = {
            type: 'module',
            name: options.workerName || 'ms-human-right-arm-engine'
        };
        this._onFatalError = typeof options.onFatalError === 'function'
            ? options.onFatalError
            : null;
        this._worker = null;
        this._pending = new Map();
        this._nextRequestId = 1;
        this._analysisGeneration = 0;
        this._initializePromise = null;
        this._metadata = null;
        this._disposed = false;
        this._failed = false;
    }

    get metadata() {
        return this._metadata;
    }

    get initialized() {
        return this._metadata !== null && !this._disposed && !this._failed;
    }

    async initialize() {
        this._assertAvailable();
        if (this._metadata) return this._metadata;
        if (this._initializePromise) return this._initializePromise;

        this._ensureWorker();
        this._initializePromise = this._send('initialize', {})
            .then((metadata) => {
                if (metadata?.contractVersion !== MS_HUMAN_ENGINE_CONTRACT_VERSION) {
                    throw new Error(
                        `MS-Human contract mismatch: expected ${MS_HUMAN_ENGINE_CONTRACT_VERSION}, `
                        + `received ${metadata?.contractVersion ?? 'none'}.`
                    );
                }
                this._metadata = deepFreeze(metadata);
                return this._metadata;
            })
            .catch((error) => {
                this._initializePromise = null;
                throw error;
            });
        return this._initializePromise;
    }

    async pose(coordinates = {}, selectedMuscle = undefined) {
        await this.initialize();
        return this._sendAnalysis('pose', { coordinates, selectedMuscle });
    }

    async staticHold(coordinates = {}, selectedMuscle = undefined) {
        await this.initialize();
        return this._sendAnalysis('staticHold', { coordinates, selectedMuscle });
    }

    async dispose() {
        if (this._disposed) return;
        this._disposed = true;
        const error = new MsHumanEngineDisposedError();
        this._rejectAll(error);
        if (this._worker) {
            try {
                this._worker.postMessage({ action: 'dispose', requestId: 0 });
            } catch {
                // Terminating the worker below is the authoritative cleanup.
            }
            this._worker.terminate();
            this._worker = null;
        }
        this._initializePromise = null;
        this._metadata = null;
    }

    _assertAvailable() {
        if (this._disposed) throw new MsHumanEngineDisposedError();
        if (this._failed) {
            throw new Error('The MS-Human worker stopped after an unrecoverable error. Create a new engine instance.');
        }
    }

    _ensureWorker() {
        if (this._worker) return;
        this._assertAvailable();
        if (typeof Worker !== 'function') {
            throw new Error('This browser does not provide Web Worker support.');
        }
        this._worker = new Worker(this._workerUrl, this._workerOptions);
        this._worker.addEventListener('message', (event) => this._handleMessage(event));
        this._worker.addEventListener('messageerror', () => {
            this._fail(new Error('The MS-Human worker returned an unreadable message.'));
        });
        this._worker.addEventListener('error', (event) => {
            this._fail(new Error(event.message || 'The MS-Human worker stopped unexpectedly.'));
        });
    }

    _sendAnalysis(action, payload) {
        this._assertAvailable();
        this._analysisGeneration += 1;
        const generation = this._analysisGeneration;
        this._rejectPendingAnalyses(new StaleRequestError());
        return this._send(action, payload, { analysis: true, generation });
    }

    _send(action, payload, flags = {}) {
        this._assertAvailable();
        this._ensureWorker();
        const requestId = this._nextRequestId;
        this._nextRequestId += 1;
        return new Promise((resolve, reject) => {
            this._pending.set(requestId, { action, resolve, reject, ...flags });
            try {
                this._worker.postMessage({ action, requestId, ...payload });
            } catch (error) {
                this._pending.delete(requestId);
                reject(error);
            }
        });
    }

    _handleMessage(event) {
        const message = event.data;
        if (!message || message.type !== 'response') return;
        const pending = this._pending.get(message.requestId);
        if (!pending) return;
        this._pending.delete(message.requestId);

        if (pending.analysis && pending.generation !== this._analysisGeneration) {
            pending.reject(new StaleRequestError());
            return;
        }
        if (message.ok) pending.resolve(message.result);
        else pending.reject(errorFromWorker(message.error));
    }

    _rejectPendingAnalyses(error) {
        for (const [requestId, pending] of this._pending) {
            if (!pending.analysis) continue;
            this._pending.delete(requestId);
            pending.reject(error);
        }
    }

    _rejectAll(error) {
        for (const pending of this._pending.values()) pending.reject(error);
        this._pending.clear();
    }

    _fail(error) {
        if (this._disposed || this._failed) return;
        this._failed = true;
        this._rejectAll(error);
        if (this._worker) {
            this._worker.terminate();
            this._worker = null;
        }
        if (this._onFatalError) {
            try {
                this._onFatalError(error);
            } catch {
                // A consumer notification must not interfere with engine cleanup.
            }
        }
    }
}

export function createMsHumanEngine(options) {
    return new MsHumanEngine(options);
}

export default MsHumanEngine;
