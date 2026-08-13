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
    "${WEB_ROOT}/models/ms_human_700/body-regions.json"
    "${WEB_ROOT}/models/ms_human_700/hand-region.json"
    "${WEB_ROOT}/models/ms_human_700/right-arm.json"
    "${WEB_ROOT}/models/ms_human_700/right-arm.meshbin"
    "${WEB_ROOT}/models/ms_human_700/right-arm-runtime.mjb"
    "${WEB_ROOT}/models/ms_human_700/right-hand.json"
    "${WEB_ROOT}/models/ms_human_700/right-hand.meshbin"
    "${WEB_ROOT}/models/ms_human_700/right-hand-runtime.mjb"
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
    "485e389aebe640687974a719ed7adf176c637617afc0800387b4fa5860c0da4e" \
    "${WEB_ROOT}/models/ms_human_700/body-regions.json" | sha256sum --check --strict
printf '%s  %s\n' \
    "f6406c25bbb82593c96a639efa020bea758abae77d385f00ab6d16e7c6ce8005" \
    "${WEB_ROOT}/models/ms_human_700/hand-region.json" | sha256sum --check --strict
printf '%s  %s\n' \
    "4278ffe5171328047dd240711386ac2ea84ba7bcc54e1740df359f263956414e" \
    "${WEB_ROOT}/models/ms_human_700/right-arm.json" | sha256sum --check --strict
printf '%s  %s\n' \
    "5cbdf2aebd44da09dbd9b546cca35abc7b3b2f64e927f879c0d03595e087f68c" \
    "${WEB_ROOT}/models/ms_human_700/right-arm.meshbin" | sha256sum --check --strict
printf '%s  %s\n' \
    "13d2b0bed35db2b07f3b8076931abef4ec4e149ca8d89f326bde22b84f821ad3" \
    "${WEB_ROOT}/models/ms_human_700/right-arm-runtime.mjb" | sha256sum --check --strict
printf '%s  %s\n' \
    "e6d169bdc2edeed3e846d7ccbe03d7ef68968fb2f715c61f4b892bfa85307a46" \
    "${WEB_ROOT}/models/ms_human_700/right-hand.json" | sha256sum --check --strict
printf '%s  %s\n' \
    "5054f8ff61ca45db638bd36729f1ed71100fd889c58a60d219c673a3162f03ea" \
    "${WEB_ROOT}/models/ms_human_700/right-hand.meshbin" | sha256sum --check --strict
printf '%s  %s\n' \
    "40b75b5583aeb5f20cbda668c4b7e035109dab97175ce30b368551a204e98e1d" \
    "${WEB_ROOT}/models/ms_human_700/right-hand-runtime.mjb" | sha256sum --check --strict

stage "3/3 READY - MS-Human-700 browser application at http://0.0.0.0:${PORT}"
exec python3 "${PROJECT_ROOT}/tools/serve_static.py" \
    --root "${WEB_ROOT}" --host 0.0.0.0 --port "${PORT}"
