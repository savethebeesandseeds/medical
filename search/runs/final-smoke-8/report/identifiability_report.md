# MoBL-ARMS posture identifiability pilot

> Generic-model muscle-demand study. Not patient data and not a diagnosis.

- Exact postures: 8
- Passed all solver quality gates: 7 (87.5%)
- Median solve time: 272 ms
- 95th-percentile solve time: 323 ms
- Activation components explaining 95% variance: 3

## Pilot panel results

- Noiseless greedy upper bound: 6 postures; complete=False
- One-error-distance greedy upper bound: 7 postures; complete=False
- Unresolved robust pair constraints: 83

These panels use model-demand signatures only. Functional `able / unable` inference requires separate muscle-capacity reduction and equilibrium re-solves.

## Targets with the fewest high-demand witnesses

- Posterior deltoid: 0 high-demand witnesses; best sample `anchor__scaption_90`
- Teres major: 0 high-demand witnesses; best sample `anchor__neutral`
- Latissimus dorsi: 0 high-demand witnesses; best sample `anchor__neutral`
- Coracobrachialis: 0 high-demand witnesses; best sample `anchor__elbow_90`
- Biceps: 0 high-demand witnesses; best sample `anchor__external_rotation`
- Brachioradialis: 0 high-demand witnesses; best sample `anchor__elbow_90`
- Supraspinatus: 1 high-demand witnesses; best sample `anchor__scaption_90`
- Teres minor: 1 high-demand witnesses; best sample `anchor__forward_90`
- Pectoralis major: 1 high-demand witnesses; best sample `anchor__elbow_90`
- Anterior deltoid: 2 high-demand witnesses; best sample `anchor__forward_90`

See `identifiability_report.json` for full machine-readable results.
