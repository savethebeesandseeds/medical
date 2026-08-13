#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="/workspace"
RUNTIME_DIR="${PROJECT_ROOT}/runtime"
OPENSIM_TAG="4.6"
OPENSIM_PREFIX="/opt/opensim"
OPENSIM_CMAKE_DIR="${OPENSIM_PREFIX}/cmake"
DEPS_PREFIX="/opt/opensim-dependencies"
SOURCE_DIR="/opt/src/opensim-core"
DEPS_BUILD_DIR="/opt/build/opensim-dependencies"
CORE_BUILD_DIR="/opt/build/opensim-core"
APP_BUILD_DIR="${PROJECT_ROOT}/build"
BUILD_JOBS="${OPENSIM_BUILD_JOBS:-2}"

mkdir -p "${RUNTIME_DIR}"
touch "${RUNTIME_DIR}/setup.log"
exec > >(tee -a "${RUNTIME_DIR}/setup.log") 2>&1

stage() {
    printf '%s\n' "$1" | tee "${RUNTIME_DIR}/setup-stage.txt"
}

on_error() {
    status=$?
    printf 'FAILED (exit %s) - inspect /workspace/runtime/setup.log\n' "${status}" \
        | tee "${RUNTIME_DIR}/setup-stage.txt"
    printf 'Setup failed; keeping the container alive for inspection.\n'
    exec tail -f /dev/null
}
trap on_error ERR

if ! command -v g++ >/dev/null 2>&1 || ! command -v ninja >/dev/null 2>&1 \
        || ! command -v cbc >/dev/null 2>&1 \
        || [[ ! -f /usr/include/GL/freeglut.h ]]; then
    stage "1/7 Installing Debian build dependencies"
    export DEBIAN_FRONTEND=noninteractive
    apt-get -o Acquire::Retries=5 update
    apt-get -o Acquire::Retries=5 install --fix-missing --yes --no-install-recommends \
        autoconf automake autotools-dev bison build-essential byacc ca-certificates \
        coinor-cbc \
        cmake curl freeglut3-dev gfortran git liblapack-dev libopenblas-dev \
        libpcre2-dev libpcre3-dev libssl-dev libtool libxi-dev libxmu-dev \
        lsb-release ninja-build patchelf pkg-config python3 wget
    rm -rf /var/lib/apt/lists/*
else
    stage "1/7 Reusing installed Debian build dependencies"
fi

# OpenSim 4.6 pins a Simbody revision that requires CMake >=3.21, while
# Debian 11 provides CMake 3.18. Use the same 3.23.3 line referenced by the
# official OpenSim Linux build script, installed as an immutable binary bundle.
CMAKE_BUNDLE_VERSION="3.23.3"
if ! cmake --version | head -n 1 | grep -Eq 'cmake version (3\.(2[1-9]|[3-9][0-9])|[4-9]\.)'; then
    stage "1/7 Installing CMake ${CMAKE_BUNDLE_VERSION} for OpenSim 4.6"
    if [[ ! -x "/opt/cmake-${CMAKE_BUNDLE_VERSION}/bin/cmake" ]]; then
        CMAKE_ARCHIVE="/tmp/cmake-${CMAKE_BUNDLE_VERSION}-linux-x86_64.tar.gz"
        curl --fail --location --retry 5 \
            "https://github.com/Kitware/CMake/releases/download/v${CMAKE_BUNDLE_VERSION}/cmake-${CMAKE_BUNDLE_VERSION}-linux-x86_64.tar.gz" \
            --output "${CMAKE_ARCHIVE}"
        rm -rf "/opt/cmake-${CMAKE_BUNDLE_VERSION}"
        mkdir -p "/opt/cmake-${CMAKE_BUNDLE_VERSION}"
        tar -xzf "${CMAKE_ARCHIVE}" --strip-components=1 -C "/opt/cmake-${CMAKE_BUNDLE_VERSION}"
    fi
    ln -sf "/opt/cmake-${CMAKE_BUNDLE_VERSION}/bin/cmake" /usr/local/bin/cmake
    ln -sf "/opt/cmake-${CMAKE_BUNDLE_VERSION}/bin/ctest" /usr/local/bin/ctest
    ln -sf "/opt/cmake-${CMAKE_BUNDLE_VERSION}/bin/cpack" /usr/local/bin/cpack
fi
cmake --version | head -n 1

stage "2/7 Fetching OpenSim ${OPENSIM_TAG} source"
mkdir -p "$(dirname "${SOURCE_DIR}")" /opt/build
if [[ ! -d "${SOURCE_DIR}/.git" ]]; then
    rm -rf "${SOURCE_DIR}"
    git clone --branch "${OPENSIM_TAG}" --depth 1 \
        https://github.com/opensim-org/opensim-core.git "${SOURCE_DIR}"
else
    git -C "${SOURCE_DIR}" fetch --depth 1 origin "refs/tags/${OPENSIM_TAG}:refs/tags/${OPENSIM_TAG}"
    git -C "${SOURCE_DIR}" checkout --detach "${OPENSIM_TAG}"
fi
git -C "${SOURCE_DIR}" rev-parse HEAD > "${RUNTIME_DIR}/opensim-commit.txt"

if [[ ! -f "${OPENSIM_CMAKE_DIR}/OpenSimConfig.cmake" ]]; then
    stage "3/7 Building OpenSim dependencies (first run can take 20-60 minutes)"
    cmake -S "${SOURCE_DIR}/dependencies" -B "${DEPS_BUILD_DIR}" -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX="${DEPS_PREFIX}" \
        -DOPENSIM_WITH_CASADI=OFF \
        -DSUPERBUILD_ezc3d=ON
    cmake --build "${DEPS_BUILD_DIR}" --parallel "${BUILD_JOBS}"

    stage "4/7 Building and installing OpenSim C++ libraries"
    cmake -S "${SOURCE_DIR}" -B "${CORE_BUILD_DIR}" -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX="${OPENSIM_PREFIX}" \
        -DOPENSIM_DEPENDENCIES_DIR="${DEPS_PREFIX}" \
        -DOPENSIM_INSTALL_UNIX_FHS=OFF \
        -DOPENSIM_WITH_CASADI=OFF \
        -DOPENSIM_C3D_PARSER=ezc3d \
        -DBUILD_JAVA_WRAPPING=OFF \
        -DBUILD_PYTHON_WRAPPING=OFF \
        -DBUILD_TESTING=OFF
    cmake --build "${CORE_BUILD_DIR}" --parallel "${BUILD_JOBS}"
    cmake --install "${CORE_BUILD_DIR}"
else
    stage "3-4/7 Reusing cached OpenSim ${OPENSIM_TAG} installation"
fi

stage "5/7 Configuring OpenSim shared libraries"
cat > /etc/ld.so.conf.d/opensim.conf <<EOF
${OPENSIM_PREFIX}/sdk/lib
${OPENSIM_PREFIX}/sdk/Simbody/lib
${DEPS_PREFIX}/simbody/lib
${DEPS_PREFIX}/ezc3d/lib
${DEPS_PREFIX}/spdlog/lib
EOF
ldconfig

stage "6/7 Validating MoBL-ARMS assets and building the C++ service"
MODEL_FILE="${PROJECT_ROOT}/models/mobl_arms/MOBL_ARMS_41.osim"
GEOMETRY_DIR="${PROJECT_ROOT}/public/models/mobl_arms/Geometry"
BENCHMARK_FILE="${PROJECT_ROOT}/models/mobl_arms/benchmark/CMC_results_states.sto"
BENCHMARK_SHA256="58ad4a51e10be4956207799106e63b3cec689d39d7702a2318c3ae0e50089004"
if [[ ! -s "${MODEL_FILE}" ]]; then
    printf 'Official MoBL-ARMS model is missing: %s\n' "${MODEL_FILE}" >&2
    exit 1
fi
if [[ ! -d "${GEOMETRY_DIR}" ]] \
        || [[ "$(find "${GEOMETRY_DIR}" -maxdepth 1 -type f -name '*.vtp' | wc -l)" -ne 33 ]]; then
    printf 'Expected exactly 33 authored MoBL-ARMS VTP meshes in %s\n' "${GEOMETRY_DIR}" >&2
    exit 1
fi
if [[ ! -s "${BENCHMARK_FILE}" ]]; then
    printf 'Author-supplied CMC benchmark is missing: %s\n' "${BENCHMARK_FILE}" >&2
    exit 1
fi
if [[ "$(sha256sum "${BENCHMARK_FILE}" | cut -d ' ' -f 1)" != "${BENCHMARK_SHA256}" ]]; then
    printf 'CMC benchmark checksum mismatch: %s\n' "${BENCHMARK_FILE}" >&2
    exit 1
fi

THREE_JS="${PROJECT_ROOT}/public/vendor/three.module.min.js"
THREE_CORE_JS="${PROJECT_ROOT}/public/vendor/three.core.min.js"
MUJOCO_WASM_VERSION="3.10.0"
MUJOCO_WASM_JS="${PROJECT_ROOT}/public/vendor/mujoco.js"
MUJOCO_WASM_BINARY="${PROJECT_ROOT}/public/vendor/mujoco.wasm"
MUJOCO_WASM_LICENSE="${PROJECT_ROOT}/public/vendor/MUJOCO_LICENSE.txt"
MUJOCO_WASM_ARCHIVE_SHA512="13593416215fd6f5513e466dab658a598d03ec3606277046400126ba9d87db45244c33968ff266c860ea7fd225b37450ad6c4210e1cc768f55b4405fca651df6"
MUJOCO_WASM_JS_SHA256="45e8e0e1617c19fbf7f00b36a6a72d1c0c980c0a4f38523e04f0641e8fbab7b9"
MUJOCO_WASM_BINARY_SHA256="832597ae0a0e306c97ed43d2a9bbca033cf3e547eced410fb9011d87a68d4207"
MUJOCO_WASM_LICENSE_SHA256="cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"
if [[ ! -s "${THREE_JS}" ]]; then
    curl --fail --location --retry 3 \
        https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.min.js \
        --output "${THREE_JS}"
fi
if [[ ! -s "${THREE_CORE_JS}" ]]; then
    curl --fail --location --retry 3 \
        https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.core.min.js \
        --output "${THREE_CORE_JS}"
fi
if [[ ! -s "${MUJOCO_WASM_JS}" || ! -s "${MUJOCO_WASM_BINARY}" ]]; then
    MUJOCO_WASM_ARCHIVE="/tmp/mujoco-${MUJOCO_WASM_VERSION}.tgz"
    MUJOCO_WASM_EXTRACT="$(mktemp -d)"
    curl --fail --location --retry 3 \
        "https://registry.npmjs.org/@mujoco/mujoco/-/mujoco-${MUJOCO_WASM_VERSION}.tgz" \
        --output "${MUJOCO_WASM_ARCHIVE}"
    printf '%s  %s\n' "${MUJOCO_WASM_ARCHIVE_SHA512}" "${MUJOCO_WASM_ARCHIVE}" \
        | sha512sum --check --strict
    tar -xzf "${MUJOCO_WASM_ARCHIVE}" -C "${MUJOCO_WASM_EXTRACT}" \
        package/mujoco.js package/mujoco.wasm
    install -m 0644 "${MUJOCO_WASM_EXTRACT}/package/mujoco.js" "${MUJOCO_WASM_JS}"
    install -m 0644 "${MUJOCO_WASM_EXTRACT}/package/mujoco.wasm" "${MUJOCO_WASM_BINARY}"
    rm -rf "${MUJOCO_WASM_EXTRACT}"
fi
printf '%s  %s\n' "${MUJOCO_WASM_JS_SHA256}" "${MUJOCO_WASM_JS}" \
    | sha256sum --check --strict
printf '%s  %s\n' "${MUJOCO_WASM_BINARY_SHA256}" "${MUJOCO_WASM_BINARY}" \
    | sha256sum --check --strict
if [[ ! -s "${MUJOCO_WASM_LICENSE}" ]]; then
    curl --fail --location --retry 3 \
        "https://raw.githubusercontent.com/google-deepmind/mujoco/${MUJOCO_WASM_VERSION}/LICENSE" \
        --output "${MUJOCO_WASM_LICENSE}"
fi
printf '%s  %s\n' "${MUJOCO_WASM_LICENSE_SHA256}" "${MUJOCO_WASM_LICENSE}" \
    | sha256sum --check --strict

for arm_asset in right-arm.json right-arm.meshbin right-arm-runtime.mjb; do
    if [[ ! -s "${PROJECT_ROOT}/public/models/ms_human_700/${arm_asset}" ]]; then
        printf 'Generated MS-Human right-arm asset is missing: %s\n' "${arm_asset}" >&2
        printf 'Regenerate it with tools/export_ms_human_arm.py and MuJoCo 3.10.0.\n' >&2
        exit 1
    fi
done

cmake -S "${PROJECT_ROOT}/app" -B "${APP_BUILD_DIR}" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DOpenSim_DIR="${OPENSIM_CMAKE_DIR}" \
    -DCMAKE_PREFIX_PATH="${OPENSIM_PREFIX};${DEPS_PREFIX};${DEPS_PREFIX}/simbody"
cmake --build "${APP_BUILD_DIR}" --parallel "${BUILD_JOBS}"

"${APP_BUILD_DIR}/muscle_web" --self-test --web-root "${PROJECT_ROOT}/public" \
    | tee "${RUNTIME_DIR}/self-test.json"

GPU_NAME="unavailable"
if command -v nvidia-smi >/dev/null 2>&1; then
    GPU_NAME="$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -n 1 || true)"
elif [[ -x /usr/lib/wsl/lib/nvidia-smi ]]; then
    GPU_NAME="$(/usr/lib/wsl/lib/nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -n 1 || true)"
fi
[[ -n "${GPU_NAME}" ]] || GPU_NAME="unavailable"
printf '%s\n' "${GPU_NAME}" > "${RUNTIME_DIR}/gpu.txt"

stage "7/7 READY - MoBL-ARMS explorer at http://0.0.0.0:8080"
export MUSCLES_GPU="${GPU_NAME}"
export LD_LIBRARY_PATH="${OPENSIM_PREFIX}/sdk/lib:${OPENSIM_PREFIX}/sdk/Simbody/lib:${DEPS_PREFIX}/simbody/lib:${DEPS_PREFIX}/ezc3d/lib:${LD_LIBRARY_PATH:-}"
exec "${APP_BUILD_DIR}/muscle_web" --port 8080 --web-root "${PROJECT_ROOT}/public"
