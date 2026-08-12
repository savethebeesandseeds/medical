# MoBL-ARMS posture identifiability pilot

> Generic-model muscle-demand study. Not patient data and not a diagnosis.

- Exact postures: 4096
- Passed all solver quality gates: 3466 (84.6%)
- Median solve time: 467 ms
- 95th-percentile solve time: 1201 ms
- Activation components explaining 95% variance: 18

## Pilot panel results

- Noiseless greedy upper bound: 9 postures; complete=True
- One-error-distance greedy upper bound: 21 postures; complete=True
- Unresolved robust pair constraints: 0

These panels use model-demand signatures only. Functional `able / unable` inference requires separate muscle-capacity reduction and equilibrium re-solves.

## Targets with the fewest high-demand witnesses

- Pectoralis major: 6 high-demand witnesses; best sample `sobol__0002818`
- Biceps: 10 high-demand witnesses; best sample `sobol__0002554`
- Latissimus dorsi: 58 high-demand witnesses; best sample `sobol__0002186`
- Coracobrachialis: 65 high-demand witnesses; best sample `sobol__0000073`
- Triceps: 65 high-demand witnesses; best sample `sobol__0001180`
- Teres major: 76 high-demand witnesses; best sample `sobol__0000234`
- Subscapularis: 78 high-demand witnesses; best sample `sobol__0000257`
- Supraspinatus: 83 high-demand witnesses; best sample `sobol__0001889`
- Teres minor: 87 high-demand witnesses; best sample `sobol__0000297`
- Posterior deltoid: 90 high-demand witnesses; best sample `sobol__0000393`

See `identifiability_report.json` for full machine-readable results.
