# MoBL-ARMS posture identifiability pilot

> Generic-model muscle-demand study. Not patient data and not a diagnosis.

- Exact postures: 512
- Passed all solver quality gates: 438 (85.5%)
- Median solve time: 347 ms
- 95th-percentile solve time: 886 ms
- Activation components explaining 95% variance: 17

## Pilot panel results

- Noiseless greedy upper bound: 11 postures; complete=True
- One-error-distance greedy upper bound: 24 postures; complete=False
- Unresolved robust pair constraints: 1

These panels use model-demand signatures only. Functional `able / unable` inference requires separate muscle-capacity reduction and equilibrium re-solves.

## Targets with the fewest high-demand witnesses

- Pectoralis major: 1 high-demand witnesses; best sample `sobol__0000386`
- Biceps: 1 high-demand witnesses; best sample `sobol__0000016`
- Latissimus dorsi: 7 high-demand witnesses; best sample `sobol__0000470`
- Coracobrachialis: 9 high-demand witnesses; best sample `sobol__0000073`
- Supraspinatus: 11 high-demand witnesses; best sample `sobol__0000101`
- Subscapularis: 11 high-demand witnesses; best sample `sobol__0000257`
- Teres minor: 11 high-demand witnesses; best sample `sobol__0000165`
- Teres major: 12 high-demand witnesses; best sample `sobol__0000261`
- Posterior deltoid: 14 high-demand witnesses; best sample `sobol__0000393`
- Triceps: 14 high-demand witnesses; best sample `anchor__scaption_90`

See `identifiability_report.json` for full machine-readable results.
