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

## OpenSim and Simbody

The setup process downloads and builds OpenSim 4.6 and its Simbody dependency.
Both are licensed under Apache License 2.0. OpenSim's `LICENSE.txt` and `NOTICE`,
and the applicable Simbody notices, must accompany a distribution that includes
their binaries.

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
