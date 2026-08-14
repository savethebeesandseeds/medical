# Waajacu's Medical musculoskeletal explorer

Waajacu's Medical is a browser-based, static-posture explorer for the
MS-Human-700 musculoskeletal model. It renders a complete skeleton as quiet
anatomical context around one selected arm, leg, back-and-trunk, head-and-neck,
or detailed right-hand region,
recompiles wrapping-aware muscle paths for every selected posture, and runs a
quality-gated static-hold estimate locally with MuJoCo WebAssembly.

The model and solver run entirely in the browser; a web server is needed only
to serve the static files with the correct MIME types and content-security
policy. No native model-computation backend is required.

The current build uses module- and document-relative URLs. It can be served at
an origin root such as `https://example.org/` or below a subpath such as
`https://example.org/medical/`, provided the host serves `index.html` from that
directory with the documented MIME types and content-security policy.

## Interface languages

The English source catalog is `public/locales/en.json`; Spanish, German,
Greek, Czech, and Simplified Chinese catalogs sit beside it. These translations
still require review by fluent medical/legal reviewers before clinical research
use. A small relative-URL
bootstrap selects and validates the route's catalog before importing the
application, so the browser never starts the assessment with missing or mixed interface copy.
Static HTML and dynamic labels, dialogs, accessibility text, model vocabulary,
and the on-screen report view all use stable catalog keys.

GitHub Pages publishes the same static browser application at `/en/`, `/es/`,
`/de/`, `/el/`, `/cs/`, and `/zh/` tool routes. The Pages build materializes each route's
catalog into its HTML, while the catalog remains the source for dynamic UI.
The header language selector moves between those routes. A query-string fallback
such as `?lang=es` supports local serving from `public/` without changing the
production route contract.

The integrity-pinned assessment protocol and the versioned JSON report remain
canonical data contracts. Their stored IDs and English evidence text are not
rewritten by localization; the interface presents them through catalog entries
mapped from stable position, comparison, status, and warning codes. Future
language builds can therefore use the same application and records without
changing model or protocol hashes.

## Start locally

```powershell
cd C:\Work\medical\muscles
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\run.ps1
```

The page is served at <http://localhost:8080> and bound to `127.0.0.1`.

## What the application shows

- An explicit region list for right arm, left arm, right leg, left leg,
  right foot and ankle, left foot and ankle, Back & trunk, Head & neck, and the
  detailed right hand. Arm, Leg, and Foot and ankle use true
  side-specific calculations; the visual mirror is never used as a substitute
  for a calculated side. Each region supplies only its own authored
  posture controls, muscle inventory, presets, support boundary, and camera focus.
- Body-local complete-skeleton geometry in a faint context layer, with the
  selected region visually emphasized.
- Current MuJoCo tendon paths with authored via sites, wrapping contacts, and
  pulley discontinuities preserved.
- Switchable muscle rendering: smoother procedural anatomical bodies and thin
  technical centerlines for inspecting the exact calculated paths. Body shape
  and thickness are illustrative; activation is encoded by color.
- Mechanically selected regional inventories: 88 muscles per upper limb, 50
  per lower limb, 11 extrinsic muscles per three-coordinate foot-and-ankle
  focus, 222 for the six-coordinate trunk, and 54 for head/neck. The primary
  model's foot focus has coarse talus, calcaneus, and toes bodies; it does not
  contain individual-toe articulation or intrinsic foot muscles.
- A separate MS-Human manipulation profile for the articulated right hand:
  23 wrist/finger coordinates, 44 extrinsic and intrinsic hand muscles, and
  eight unloaded hand-shape presets. It has no object contact or grip-force
  estimate. The manipulation source provides a detailed calculated right hand
  only, so the interface does not claim a calculated left hand.
- A bounded, minimum-squared-activation static estimate for the displayed
  posture, with explicit equilibrium, reserve, capacity, path, and finite-value
  quality gates.
- A versioned MS-Human-native observation panel, activation ranking, muscle
  inspector, moment arms, PNG export, responsive layout, safety screen, and
  report export.

Long latissimus origins participate in upper-limb solves but are hidden in the
default path layer for readability. Explorer uses true right- and left-side
model calculations. The separate guided Assessment remains pinned to its
versioned right upper-limb protocol; its optional left display is still an
explicit visual mirror of that right-side calculation.

## Static calculation boundary

The solver balances only the selected region's displayed coordinates. It resets
the complete model to the authored initial keyframe, applies those coordinates
and their equality dependents, and treats all remaining coordinates as
externally prescribed support. It assumes zero velocity and acceleration,
gravity and model self-weight, authored passive model forces, and no hand load,
contact, measured support, or other external force. Lower-limb estimates fix
the pelvis, and foot-and-ankle estimates additionally fix the tibia, knee, and
hip. Neither includes foot contact or ground reaction; they are not stance,
gait, balance, or weight-bearing analyses.

Activation colors are withheld unless the result has the region's exact unique finite muscle
values, valid compiled paths, replayed reduced-coordinate equilibrium residual
at or below 0.0001 newton-metres, reserve torque at or below 0.05
newton-metres, and no model-rule capacity failure. Reserve use means the
modeled actuator set did not balance
the posture under these assumptions; it does not prove physiological weakness.

The result is a generic model estimate, not measured effort, patient force,
tissue load, pain, injury, fatigue, diagnosis, treatment guidance, or a
patient-specific result. Dynamic motion may require materially different
activation.

The movement-observation panel is application-designed for MS-Human-700. Its
20 independent postures were selected from a deterministic 384-candidate atlas
for both joint-space variety and separation of the generic model's 88-actuator
activation patterns. The final five are supplemental, may be skipped, and were
retained only while they added material activation-matrix information; the
search stopped when another posture added less than one percent effective-rank
improvement and no new robust dimension. Every selected posture passes the same range, path,
equilibrium, reserve, and capacity gates used by the viewer. This is mechanical
and experiment-design screening only: the panel is not a clinically validated
examination, cannot prove that one anatomical muscle is isolated, and cannot
identify a painful tissue or diagnose a condition.

## One-command release gate

From Windows PowerShell, run the complete local gate with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\release.ps1
```

This checks the exact deploy allowlist, UTF-8 text, browser-module syntax, every
localization catalog and its key/placeholder parity, the versioned assessment protocol, report/privacy/migration behavior, pinned model
hashes, HTTP headers and routes, retired-route absence, and a clean Git
baseline. It locates Node.js and Python from `PATH` or from Codex's bundled
workspace runtime. HTTP verification is required: the command starts and stops
an isolated localhost server automatically, so the application does not need
to be running first.

To produce the reviewed static distribution after the gate passes:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\release.ps1 -Package
```

The package is `build/waajacu-medical-static.zip`. It contains only the active
browser application, model/runtime assets, provenance records, and licenses;
it excludes Git history, source tooling, caches, and retired files. The
archive includes `MANIFEST.sha256` and an SPDX 2.3 `SBOM.spdx.json`, with a
sidecar archive checksum. The Git revision time supplies the reproducible SBOM
timestamp; `SOURCE_DATE_EPOCH` can override it for formal reproducible-build
systems. `-SkipGitCleanCheck` exists only for
testing an unfinished worktree and must not be used to approve a release.
The same command runs on every push and pull request through
`.github/workflows/release-gate.yml`; it installs no project dependencies from
the network.

## Individual verification and regeneration

Run the verification suite while the application is running:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\verify-ms-human.ps1
```

The primary regional browser assets can be regenerated from the pinned complete
source tree with `tools/export_ms_human_arm.py`; the detailed hand profile is
generated by `tools/export_ms_human_hand.py`. Source and runtime parity checks
are implemented in `tools/validate_ms_human_arm.py`; isolated Python
dependencies are pinned in `tools/requirements-ms-human.txt`.

The assessment definition and its recorded browser-solver evidence are checked
by `tools/validate-ms-human-assessment-protocol.mjs`. Report identity,
migration, privacy, and comparison behavior are checked by
`tools/verify-diagnosis-report.mjs`. The articulated-hand hashes, schema,
inventory, presets, and geometry layout are checked by
`tools/validate-ms-human-hand.mjs`. Run these with a current Node.js runtime
after changing the posture panel or report schema.

## Licensing and provenance

Original application code is MIT-licensed; see `LICENSE`. MS-Human-700 and its
generated assets are Apache-2.0 licensed, MuJoCo is Apache-2.0 licensed, and
Three.js is MIT-licensed. See `THIRD_PARTY_NOTICES.md` and the bundled upstream
licenses for the exact boundaries and redistribution obligations.

The deployable application does not include or execute the retired MoBL or
OpenSim implementation. Historical commits may still contain retired files;
publish from a clean repository history if excluding those historical bytes is
a distribution requirement.

MS-Human-700 is vendored from the pinned MuJoCo Menagerie source record under
`models/ms_human_700/`. Two transparent bilateral path-coordinate corrections
are documented in its `SOURCE.md`. Because the model publication describes
earlier OpenSim models as parameter references, written provenance confirmation
from the maintainers remains prudent before commercial release.

## Medical boundary

This is research and educational software, not a medical device. Clinical or
patient-specific research would require validated subject data, uncertainty
reporting, clinical ground truth, clinician oversight, privacy and security
controls, and appropriate ethics and regulatory review.
