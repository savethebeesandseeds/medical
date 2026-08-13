# Waajacu's Medical musculoskeletal explorer

This is a local Debian 11 container running OpenSim 4.6 and a native C++ web
service. The established analysis renders the official MoBL-ARMS right
upper-extremity model and its OpenSim-computed muscle paths. A separate
MS-Human-700 right-arm laboratory prototypes the Apache-2.0-licensed whole-body
foundation with exact articulation, wrapped paths, and a static-hold estimate.
There is deliberately no Dockerfile: `run.ps1` starts a stock Debian container
and `setup.sh` provisions it.

## Start

```powershell
cd C:\Work\medical\muscles
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\run.ps1
```

The first OpenSim build can take 20-60 minutes. Subsequent starts reuse the
`opensim-muscles-opt` Docker volume. The page is served at
<http://localhost:8080> and is bound to `127.0.0.1`, so it is not exposed to the
local network.

The container is created with `--gpus all`. The page reports whether the GPU is
visible, but the current OpenSim pose and geometry calculations run on CPU.

## Verify

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\verify.ps1
```

The check verifies the linked OpenSim runtime, GPU visibility, official model
inventory, model and benchmark hashes, all 33 referenced meshes, all 50 default
muscle paths, the HTTP API, a biceps path/moment-arm sample, and a 50-muscle CMC
activation frame. It also checks an exact on-demand static posture, all 50
finite activation estimates, independently replayed force equilibrium, reserve
use, deterministic repeatability, invalid-input rejection, and the separate
Reach8 coverage gates.

## What the page shows

- The unchanged `MOBL_ARMS_41.osim` free-torso model.
- The 33 exact VTP meshes referenced by that model.
- Body transforms calculated by OpenSim for the assembled state.
- Wrapping-aware paths for all 50 muscles calculated by OpenSim.
- Model-derived musculotendon length and moment arms for the selected muscle.
- Seven independent upper-limb coordinate controls and example posture
  shortcuts that always set exact OpenSim geometry.
- On-demand static-posture optimization for those exact angles, using the
  model's segment weights and gravity with zero motion and no external hand
  load. All 50 paths are colored only after convergence, constrained
  generalized-force equilibrium, assembly, control-bound, and reserve checks
  pass.
- Playback of the authors' supplied Reach8 CMC states. All 50
  muscle centerlines are colored by their stored model-estimated activation,
  with an explicit 0-1 legend and a current-frame ranking.

The two activation sources are deliberately not mixed. In **Static posture
estimate**, the service minimizes squared muscle controls while balancing the
full inverse-dynamics mobility residual with the model's authored constraint
reactions. Seven weak coordinate reserves are feasibility slacks; a result is
withheld if any reserve exceeds 0.05 N m. It is also withheld as
capacity-limited when a muscle reaches 0.995 while nontrivial reserve torque is
still needed. MoBL-ARMS gives every muscle an authored minimum control of 0.01,
and this active-actuation formulation does not include passive muscle-fiber
force. It is therefore a generic recruitment estimate, not measured effort or
a unique physiological answer. In **Reach8 reference**, angles and activation
states are read directly from the supplied `CMC_results_states.sto` and are
never used to fill a static pose.

The page does not calculate muscle force, injury, pain source, fatigue, or a
diagnosis. It does not use the separate MS-Human prototype in any MoBL-ARMS
calculation. Rendered muscle tubes are centerline display glyphs, not
volumetric muscle anatomy.

## MS-Human right-arm prototype

Open <http://localhost:8080/full-body.html> to use the separate MS-Human-700
right-arm static-posture laboratory. It intentionally does not replace or share
state with the established MoBL-ARMS tool at `/`.

The prototype exposes the model's seven independent right-arm controls and
realizes its polynomial scapula, clavicle, shoulder, and wrist couplings in the
official MuJoCo 3.10.0 WebAssembly runtime. Thirty-two arm bone meshes remain in
body-local coordinates and every pose rebuilds current wrapping-aware muscle
paths. A faint sternum, spine, neck, and right rib context explains proximal
attachments without drawing the rest of the body.

The static-hold calculation includes 88 functionally relevant muscles: 61
right-arm-file actuators and 27 shoulder-girdle stabilizers from the torso file.
It minimizes squared activation while balancing gravity, model self-weight, and
authored passive forces at zero velocity/acceleration and with no external hand
load. Activations are withheld unless a fresh MuJoCo replay passes finite-value,
equilibrium, reserve-torque, and capacity checks. Some authored joint-range
postures are genuinely not balanceable under those assumptions and remain gray.

The pinned upstream MJCF package is vendored under `models/ms_human_700/` with
two documented bilateral-coordinate corrections; see its `SOURCE.md`. The
articulated browser assets under `public/models/ms_human_700/` can be regenerated
with `tools/export_ms_human_arm.py`; the original complete default-pose export
remains reproducible with `tools/export_ms_human.py`. Their isolated Python
dependencies are pinned in `tools/requirements-ms-human.txt`.

Run `verify-ms-human.ps1` while the application is running to check the source
hashes, both generated inventories, body-local geometry structure, pinned
MuJoCo runtime, mechanical parity metadata, licensing, route types, and scoped
content-security policy.

## Licensing

The original application code, scripts, styles, and documentation are licensed
under the MIT License; see `LICENSE`. This does not relicense any third-party
material. See `THIRD_PARTY_NOTICES.md` for the dependency and asset boundaries.

### Model provenance and license

See `models/mobl_arms/SOURCE.md` and `models/mobl_arms/LICENSE.txt`. MoBL-ARMS is
licensed for non-commercial research, academic, evaluation, and personal use;
commercial use requires a separate license and model use requires attribution.

MS-Human-700 is separately distributed under Apache License 2.0 and can be used
as the whole-body base under those terms. See `models/ms_human_700/LICENSE` and
`models/ms_human_700/SOURCE.md`. Because the associated publication describes
earlier OpenSim models as parameter references, written provenance confirmation
from the maintainers remains prudent before a commercial release.

The source package targets OpenSim 4.1. The package inventory and default-pose
geometry/path checks pass on OpenSim 4.6. OpenSim warns that the source model's
massless thorax has nonzero inertia and resets it to zero at runtime. The model
file is kept unchanged. The Reach8 states file is kept unchanged and checked by
SHA-256. Its stored 4.1 states are displayed through the 4.6 runtime, but the
authors' complete benchmark has not been independently re-run or revalidated
here.

## Medical boundary

This is research software, not a medical device, and must not be used to
diagnose or treat pain. A clinical research path would require patient-specific
scaling and measured motion, a documented inference method, uncertainty
estimates, labeled clinical ground truth, clinician oversight, privacy and
security controls, and ethics/regulatory review.

## Operations

```powershell
docker logs -f opensim-muscles
docker stop opensim-muscles
docker start opensim-muscles
docker exec -it opensim-muscles bash
```
