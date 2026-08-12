# Posture-search results

Run date: 2026-08-12

> This is a generic-model engineering study. It is not patient data, a
> diagnostic test, or evidence that a muscle is painful or injured.

## Exact activation atlas

- 4,096 deterministic seven-angle Sobol candidates.
- 3,466 postures (84.6%) passed every exact solver quality gate.
- Median solve time: 467 ms; 95th percentile: 1,201 ms.
- Eighteen activation-space components were needed to explain 95% of variance.
- CBC certified a seven-posture minimum for noiseless demand signatures and a
  sixteen-posture minimum when three pairwise demand witnesses were required.

These are activation-demand panels only. They do not predict whether weakening
a muscle makes a posture impossible.

Primary artifacts:

- `runs/atlas-4096/report/identifiability_report.json`
- `runs/atlas-4096/minimum-noiseless/minimum_panel.json`
- `runs/atlas-4096/minimum-one-error/minimum_panel.json`

## Capacity-reduction study

The offline solver was extended so selected anatomical targets can be assigned
a remaining capacity from zero to one. The deliberately weakened target uses a
nested feasible force interval from zero to its reduced maximum; this avoids
the model's authored 1% control floor making partial weakness appear harder
than complete removal.

The study evaluated:

- 960 cases on the activation-selected sixteen-posture panel.
- 6,840 cases across 114 high-demand/high-selectivity postures.
- 5,280 exact zero-capacity cases in ±2° and ±5° neighborhoods of undercovered
  functional witnesses.

All numerical failures remained ambiguous and never counted as inability.

## Honest functional resolution

Under hand/arm weight and no external load:

- Twelve target groups developed individually distinguishable capacity-loss
  signatures.
- Brachialis, brachioradialis, and teres major retained an all-able binary
  signature across the combined 466-posture library. They are indistinguishable
  from each other and from the `no modeled capacity loss` hypothesis under this
  protocol, not one anatomical structure.
- The resulting resolution is twelve individually distinguishable capacity-loss
  hypotheses plus one all-able ambiguity class.
- With at most one posture from each independent movement family, CBC certified
  a seven-posture noiseless minimum.
- A one-error-correcting functional panel is infeasible under the same
  independence rule. An apparent eighteen-posture solution was correctly
  rejected because it counted small angle variants of the same base movement
  as independent evidence.

Primary artifacts:

- `runs/capacity-targeted-114/report/capacity_report.json`
- `runs/capacity-refinement-352/report/combined_capacity_report.json`
- `runs/capacity-refinement-352/output/baseline_atlas.csv`
- `runs/capacity-refinement-352/minimum-baseline-valid-noiseless-equivalence/minimum_capacity_panel.json`
- `runs/capacity-refinement-352/minimum-independent-noiseless-equivalence/minimum_capacity_panel.json`
- `runs/capacity-refinement-352/minimum-independent-one-error-equivalence/minimum_capacity_panel.json`

## Moderate posture follow-up

A separate structured library tested 39 recognizable positions limited to 75°
shoulder elevation, 40° shoulder rotation, 90° elbow flexion, 45° forearm
rotation, and a neutral wrist. All 39 intact-model solutions passed the exact
equilibrium and reserve gates. Across 585 complete target-capacity-loss cases,
no target loss made a moderate posture mechanically infeasible; 565 cases
remained feasible and 20 numerical failures remained ambiguous. Therefore the
moderate set is useful for recording pain, weakness, and movement-angle
sensitivity, but it has no honest binary muscle-isolation signature under the
current gravity-only protocol. The interface retains the original seven
maximum-separation positions as a separately labeled advanced research set.

Artifacts:

- `runs/capacity-moderate/postures.json`
- `runs/capacity-moderate/baseline_atlas.csv`
- `runs/capacity-moderate/report/capacity_report.json`
- `runs/capacity-moderate/minimum-noiseless/minimum_capacity_panel.json`

## GPU decision

The RTX A2000 is visible inside Docker, but the exact OpenSim/Simbody/IPOPT
pipeline is CPU-only and the container has no CUDA numerical toolkit. Eight
isolated CPU workers completed the exact studies efficiently. A GPU surrogate
was not installed because the functional study found a protocol-information
limit before candidate-scoring throughput became the limiting factor.

GPU-guided expansion becomes worthwhile after adding independently informative
mechanical conditions, such as clinician-reviewed, measured load directions.
Every surrogate-selected posture must still be confirmed by the exact solver.

## Consequence

The current results must not be added to the patient-facing Diagnosis tab as a
muscle diagnosis matrix. The next study should add a small number of safe,
measured external-load directions and repeat the capacity search. Until then,
the defensible output is an ambiguity set of compatible model-demand patterns.
