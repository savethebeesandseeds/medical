#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="/workspace"
WEB_ROOT="${PROJECT_ROOT}/public"
PORT="${PORT:-8080}"

stage() {
    printf '%s\n' "$1"
}

on_error() {
    status=$?
    printf 'FAILED (exit %s) - inspect the container logs\n' "${status}" >&2
    exit "${status}"
}
trap on_error ERR

if ! command -v python3 >/dev/null 2>&1; then
    stage "1/3 Installing the static web runtime"
    export DEBIAN_FRONTEND=noninteractive
    apt-get -o Acquire::Retries=5 update
    apt-get -o Acquire::Retries=5 install --yes --no-install-recommends \
        ca-certificates python3
    rm -rf /var/lib/apt/lists/*
else
    stage "1/3 Reusing the static web runtime"
fi

stage "2/3 Validating pinned browser assets"
required_assets=(
    "${WEB_ROOT}/index.html"
    "${WEB_ROOT}/styles.css"
    "${WEB_ROOT}/app-ms-human.js"
    "${WEB_ROOT}/ms-human-engine.js"
    "${WEB_ROOT}/ms-human-worker.js"
    "${WEB_ROOT}/ms-human-assessment-protocol.js"
    "${WEB_ROOT}/diagnosis.js"
    "${WEB_ROOT}/report-v5.js"
    "${WEB_ROOT}/waajacu_medical.png"
    "${WEB_ROOT}/LICENSE"
    "${WEB_ROOT}/THIRD_PARTY_NOTICES.md"
    "${WEB_ROOT}/models/ms_human_700/right-arm.json"
    "${WEB_ROOT}/models/ms_human_700/right-arm.meshbin"
    "${WEB_ROOT}/models/ms_human_700/right-arm-runtime.mjb"
    "${WEB_ROOT}/models/ms_human_700/LICENSE"
    "${WEB_ROOT}/models/ms_human_700/SOURCE.md"
    "${WEB_ROOT}/vendor/three.module.min.js"
    "${WEB_ROOT}/vendor/three.core.min.js"
    "${WEB_ROOT}/vendor/mujoco.js"
    "${WEB_ROOT}/vendor/mujoco.wasm"
    "${WEB_ROOT}/vendor/MUJOCO_LICENSE.txt"
    "${WEB_ROOT}/vendor/THREE_LICENSE.txt"
)
for asset in "${required_assets[@]}"; do
    if [[ ! -s "${asset}" ]]; then
        printf 'Required browser asset is missing: %s\n' "${asset}" >&2
        exit 1
    fi
done

printf '%s  %s\n' \
    "45e8e0e1617c19fbf7f00b36a6a72d1c0c980c0a4f38523e04f0641e8fbab7b9" \
    "${WEB_ROOT}/vendor/mujoco.js" | sha256sum --check --strict
printf '%s  %s\n' \
    "832597ae0a0e306c97ed43d2a9bbca033cf3e547eced410fb9011d87a68d4207" \
    "${WEB_ROOT}/vendor/mujoco.wasm" | sha256sum --check --strict
printf '%s  %s\n' \
    "852c06b9fe936cf8ebc2870c86370d1015c310b04de98cdfc07f4efaf6afd2af" \
    "${WEB_ROOT}/vendor/three.module.min.js" | sha256sum --check --strict
printf '%s  %s\n' \
    "4183cee05f0aa093682fdf551363a16bb20bd92b68e14f7576905f45c461ba82" \
    "${WEB_ROOT}/vendor/three.core.min.js" | sha256sum --check --strict
printf '%s  %s\n' \
    "bfe119ea4fd413f5f7ca3fcd63adb0c4a073ed39daa2fe7d3e6b769e21272601" \
    "${WEB_ROOT}/vendor/THREE_LICENSE.txt" | sha256sum --check --strict
printf '%s  %s\n' \
    "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30" \
    "${WEB_ROOT}/vendor/MUJOCO_LICENSE.txt" | sha256sum --check --strict
printf '%s  %s\n' \
    "998e3e4f0a5da1a1ff48d4994d5a40eae586104c6d4f71163c8f2b03b94b2e4a" \
    "${WEB_ROOT}/models/ms_human_700/right-arm.json" | sha256sum --check --strict
printf '%s  %s\n' \
    "a5dba6568c86165ab3aaf795d443f81f7713489b300c590bfd898503aab99f44" \
    "${WEB_ROOT}/models/ms_human_700/right-arm.meshbin" | sha256sum --check --strict
printf '%s  %s\n' \
    "13d2b0bed35db2b07f3b8076931abef4ec4e149ca8d89f326bde22b84f821ad3" \
    "${WEB_ROOT}/models/ms_human_700/right-arm-runtime.mjb" | sha256sum --check --strict

stage "3/3 READY - MS-Human-700 browser application at http://0.0.0.0:${PORT}"
exec python3 "${PROJECT_ROOT}/tools/serve_static.py" \
    --root "${WEB_ROOT}" --host 0.0.0.0 --port "${PORT}"
