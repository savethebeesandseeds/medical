# MoBL-ARMS model provenance

- Project: MoBL-ARMS Dynamic Upper Limb
- Official project page: https://simtk.org/projects/upexdyn
- Package: `MobL_ARMS_OpenSim41_unimanual_tutorial.zip`
- Release date shown by SimTK: February 22, 2021
- Selected model: `Model/4.1/MOBL_ARMS_41.osim`
- Model SHA-256: `8BF1C3F0DB841DEFAACA2B906DED154A2B1700531B96B491AAB3DBC9A7343289`
- Downloaded archive SHA-256: `7C61AFAC1F43B089F2659EAE7E5F7029FBB6BFFD6F09272B97A128A6D819F351`
- Reach8 states: `Benchmarking Simulations/4.1 Model with Millard-Schutte Matched Curves/CompareResults/Module_6_results/CMC_results_states.sto`
- Reach8 states SHA-256: `58AD4A51E10BE4956207799106E63B3CEC689D39D7702A2318C3AE0E50089004`

The free-torso OpenSim 4.1 model was selected, rather than the converted 3.3 or
fixed-torso variants. The 33 VTP files in
`public/models/mobl_arms/Geometry/` are the exact mesh files referenced by that
model and copied from the package's
`Benchmarking Simulations/4.1 Model with Millard-Schutte Matched Curves/Geometry`
directory.

The package authors state that the 4.1 wrist CoordinateLimitForce definitions
were converted to radians and that the 4.1 model is not backward compatible.
Their notes also document deliberate biceps and deltoid moving-point changes,
updated shoulder muscle paths and wrapping surfaces, expanded shoulder ranges,
Millard2012 muscles with curves matched to the original Schutte curves, and
superior, middle, and inferior glenohumeral plus coracohumeral ligaments. This
project does not alter those definitions.

OpenSim 4.6 loads this model by updating the in-memory object format from 40000.
At startup it warns that the model's massless thorax has nonzero inertia and
resets that inertia to zero. We retain the source model unchanged. Package
inventory and default-pose mesh/path checks pass on 4.6, but the supplied 4.1
benchmark simulations have not yet been revalidated on 4.6.

The web interface can display the package authors' stored Reach8 CMC coordinate
and activation states. The source file is retained unchanged and validated as
3,997 rows, 142 columns, 50 muscle activation states, and a 0.62-4.34 second
time span. The activation view is an author-supplied model example, not patient
data. It does not imply muscle force, pain, injury, fatigue, or a diagnosis.

See `LICENSE.txt` for the non-commercial license, required acknowledgements,
and full disclaimer.
