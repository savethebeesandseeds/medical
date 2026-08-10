# Full-body model source

`Rajagopal_2015.osim` and the files in `Geometry/` are copied unchanged from
the OpenSense example bundled with OpenSim Core 4.6:

`Bindings/Java/Matlab/OpenSenseExample/`

The pinned OpenSim source commit used by this project is recorded at runtime in
`runtime/opensim-commit.txt`. At the time this model was added, that commit was
`52094cc` (the OpenSim 4.6 tag).

The model credits Rajagopal, Dembia, DeMers, Delp, Hicks, and Delp and cites:

Rajagopal et al., “Full-Body Musculoskeletal Model for Muscle-Driven Simulation
of Human Gait,” IEEE Transactions on Biomedical Engineering, 2016.

OpenSim Core is distributed under the Apache License 2.0. See the upstream
repository’s `LICENSE.txt` and `NOTICE` for the license and third-party notices.

In this application the model supplies articulated full-body kinematics. This
OpenSense copy has torque-driven upper limbs and no upper-body muscle actuators.
The single biceps force shown by the application is calculated by the separate,
simplified demonstration muscle model in `app/main.cpp`.
