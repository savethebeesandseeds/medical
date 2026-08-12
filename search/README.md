# Offline posture search

This directory contains the reproducible, quality-gated posture-search pilot.
It does not alter the live viewer or expose search results as clinical claims.

The exact stage uses the same OpenSim static-equilibrium implementation as the
web application, but runs through `muscle_web --batch-search` and writes only
coordinates, quality fields, activations, and active-actuator force estimates.
Independent Docker processes own independent OpenSim models.

Run a pilot from PowerShell:

```powershell
.\search\run_pilot.ps1 -Count 512 -Workers 4 -RunId pilot-512
```

Outputs are written below `search/runs/<run-id>/`:

- `input/`: deterministic Sobol candidate shards and manifest.
- `output/`: exact OpenSim result shards and worker logs.
- `report/`: identifiability summary and preliminary greedy panels.

The selected panels are model-demand experiments, not diagnoses. Before a
patient-facing battery can be proposed, the next stage must simulate reduced
muscle capacity, re-solve equilibrium, test angle/model perturbations, perform
exact minimum-panel optimization, and undergo clinical review and validation.

After certifying a panel, run the functional-capacity sensitivity study:

```powershell
.\search\run_capacity.ps1 `
  -Postures .\search\runs\atlas-4096\minimum-one-error\minimum_panel.csv `
  -Workers 8 `
  -RunId capacity-robust-16
```
