# Third-party materials and license scope

The repository-level MIT license applies to original application code, scripts,
styles, and documentation whose copyright is held by this project's
contributors. It does not relicense third-party software, models, geometry, or
compiled model assets.

## MS-Human-700

The files under `models/ms_human_700/` are the MS-Human-700 package distributed
through Google DeepMind's MuJoCo Menagerie. The package identifies the LNS
Group repository as its source of truth and is licensed under Apache License
2.0. Its license and exact source record are bundled as
`models/ms_human_700/LICENSE` and `models/ms_human_700/SOURCE.md`.

The generated articulated assets under `public/models/ms_human_700/` are
modified or compiled forms of MS-Human-700 and retain the Apache-2.0 license.
They are not relicensed under the application's MIT license. Preserve the
Apache license, attribution, notices, and change record when redistributing
them.

This repository corrects six lateral-coordinate signs across two unambiguous
bilateral source-path defects. The exact changes are recorded in
`models/ms_human_700/SOURCE.md` and inline in the affected XML files. They are
application-maintained changes, not upstream endorsements.

The public package states no additional non-commercial restriction. As
commercial-release diligence, obtain written confirmation from the model
maintainers about the provenance and licensing of parameters and meshes
referenced or incorporated during the model's creation.

## MuJoCo

MuJoCo 3.10.0 is Apache-2.0 licensed. The application ships the official
single-threaded WebAssembly/ES-module build from the `@mujoco/mujoco` 3.10.0
npm package and executes it locally in a browser worker. Its license is bundled
at `public/vendor/MUJOCO_LICENSE.txt`.

`tools/export_ms_human_arm.py` compiles a visual-free MJB using MuJoCo 3.10.0.
`right-arm-runtime.mjb` remains a mechanically equivalent Apache-2.0-licensed
compiled form of MS-Human-700; the separate body-local arm mesh asset likewise
retains the model's Apache-2.0 terms.

## Three.js

`public/vendor/three.module.min.js` and `public/vendor/three.core.min.js` are
Three.js 0.180.0, licensed under the MIT License, copyright 2010-2025 Three.js
Authors. The complete upstream license is bundled at
`public/vendor/THREE_LICENSE.txt`.

When distributing a web build or container, include the complete license and
notice files supplied by every packaged component. This summary is not a
substitute for those notices.
