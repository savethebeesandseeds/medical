# Third-party materials and license scope

The repository-level MIT license applies only to the original application code,
scripts, styles, and documentation whose copyright is held by this project's
contributors. It does not relicense third-party software, models, geometry, or
benchmark data.

## MoBL-ARMS model and data

`models/mobl_arms/MOBL_ARMS_41.osim`, the files under
`public/models/mobl_arms/Geometry/`, and
`models/mobl_arms/benchmark/CMC_results_states.sto` are part of the MoBL-ARMS
Dynamic Upper Limb package. They are restricted to non-commercial research,
academic, evaluation, and personal use. Commercial use requires a separate
license. Redistribution, attribution, citation, and disclaimer requirements are
contained in `models/mobl_arms/LICENSE.txt`; provenance is recorded in
`models/mobl_arms/SOURCE.md`.

## MS-Human-700 model and generated preview

The files under `models/ms_human_700/` are the MS-Human-700 package distributed
through Google DeepMind's MuJoCo Menagerie. The package names the LNS Group
repository as its source of truth and is licensed under Apache License 2.0. Its
license and exact source record are in `models/ms_human_700/LICENSE` and
`models/ms_human_700/SOURCE.md`.

The generated files under `public/models/ms_human_700/` are modified/compiled
forms of that model and retain the Apache-2.0 license. They are not relicensed
under the repository's MIT license. Preserve the Apache license, required
notices, attribution, and change notice when redistributing these materials.
This repository also corrects six lateral-coordinate signs across two
unambiguous bilateral source-path errors; the exact local modifications are
recorded in `models/ms_human_700/SOURCE.md` and inline in the affected XML
files. They are application-maintained changes, not upstream endorsements.

The public package contains no additional non-commercial restriction. As
commercial-release diligence, the model maintainers should nevertheless
confirm the provenance and licensing of parameters and meshes referenced or
incorporated during the model's creation.

## OpenSim and Simbody

The setup process downloads and builds OpenSim 4.6 and its Simbody dependency.
Both are licensed under Apache License 2.0. OpenSim's `LICENSE.txt` and `NOTICE`,
and the applicable Simbody notices, must accompany a distribution that includes
their binaries.

## MuJoCo

MuJoCo 3.10.0 is Apache-2.0 licensed. The right-arm prototype ships the official
single-threaded WebAssembly/ES-module build from the `@mujoco/mujoco` 3.10.0 npm
package and executes it locally in the browser. Its official license is bundled
at `public/vendor/MUJOCO_LICENSE.txt`. Preserve that license and any applicable
upstream notices in every distribution containing the runtime.

`tools/export_ms_human_arm.py` compiles a visual-free MJB with MuJoCo 3.10.0.
The generated `right-arm-runtime.mjb` remains a mechanically equivalent,
Apache-2.0-licensed compiled form of MS-Human-700; the separate arm mesh asset
likewise retains the model's Apache-2.0 terms.

## Three.js

The files in `public/vendor/` are Three.js 0.180.0, licensed under the MIT
License, copyright 2010-2025 Three.js Authors. The upstream license is available
at <https://github.com/mrdoob/three.js/blob/r180/LICENSE>.

## Other software dependencies

- ezc3d 1.5.19: MIT License
- spdlog 1.15.3 and fmt: MIT License
- OpenBLAS/LAPACK: BSD-style licenses
- Catch2 3.5.0: Boost Software License 1.0; build/test dependency
- Debian and its packages: each package retains its own license

When distributing a built container or binary bundle, include the complete
license and notice files supplied by every packaged runtime component. Merely
linking to this summary is not a substitute for those notices.
