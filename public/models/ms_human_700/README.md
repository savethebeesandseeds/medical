# Generated MS-Human-700 browser assets

`right-arm.json`, `right-arm.meshbin`, and `right-arm-runtime.mjb` are generated
together by `tools/export_ms_human_arm.py` with pinned MuJoCo 3.10.0.

- `right-arm.meshbin` stores 32 right-arm bone meshes and faint supporting
  thorax geometry in body-local coordinates for exact articulation.
- `right-arm-runtime.mjb` discards visual-only meshes but preserves the full
  model kinematics, passive forces, 700 actuators, and tendon wrapping needed
  to pose and solve the functionally selected 88 right-arm muscles.
- `right-arm.json` records the seven controls, 88-muscle inventory, geometry
  mapping, solver limits, source hash, and mechanical parity checks.

These generated files are modified/compiled forms of MS-Human-700 and remain
under Apache-2.0. The separately bundled MuJoCo WebAssembly runtime is also
Apache-2.0; see `public/vendor/MUJOCO_LICENSE.txt`.

The generated paths include the two transparent bilateral-coordinate
corrections recorded in `SOURCE.md`. They are local modifications of the
Apache-2.0 model, not upstream-endorsed changes. See `LICENSE` and `SOURCE.md`
in this directory for the redistributed license and exact provenance record.
