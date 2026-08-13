# MS-Human-700 source record

The files in this directory began as a copy of the `ms_human_700` package from
Google DeepMind's MuJoCo Menagerie at commit
`da76818e269b82289eba39808e2fb91d679d6994` (2026-08-09). It was imported into
this repository on 2026-08-12.

Two narrow bilateral-coordinate corrections were made locally on 2026-08-12
after a full path audit. Both source XML files carry inline modification
notices, as required for transparent redistribution of a modified work:

- `assets/body_primary/Body_Torso_Simple.xml`: negated the lateral coordinate
  of all five `LTpT_T12_l` sites. Upstream had copied the complete right path
  onto the right side again under the left name.
- `assets/body_primary/Body_Arm_l.xml`: changed `EDCL_l-P1` from lateral
  coordinate `0.0187` to `-0.0187`. Its other authored points already mirror
  the right path.

No smaller bilateral asymmetries were changed; those require anatomical review
and may be intentional. The corrections above are application-maintained
modifications and are not represented as changes endorsed by the upstream
authors.

- Menagerie package: <https://github.com/google-deepmind/mujoco_menagerie/tree/main/ms_human_700>
- Model authors' repository and stated source of truth: <https://github.com/LNSGroup/MS-Human-700>
- Full-body entry point: `MS-Human-700.xml`
- Package license: Apache License 2.0; see `LICENSE` in this directory.
- Unmodified upstream subtree SHA-256 (stable path/content manifest):
  `64BE2983C806B5553200A1ABE4AB23E487EB802184852FEDAE7A54114B69CB21`
- `MS-Human-700.xml` SHA-256: `D524F32FB22D18773674E5E5768B3272347A77F82CB507DAC19589D59D016CC5`
- `LICENSE` SHA-256: `1EB85FC97224598DAD1852B5D6483BBCF0AA8608790DCC657A5A2A761AE9C8C6`

The generated files under `public/models/ms_human_700/` are browser-oriented
derivatives of the default compiled pose. Their source is the package in this
directory, and they remain subject to Apache-2.0. The project's own viewer code
is separately MIT-licensed.

The public package is explicitly released under Apache-2.0. Its associated
paper says that OpenSim models were used as references during parameterization.
Before a commercial release, obtain written confirmation from the model
maintainers that all incorporated model data and meshes are cleared for the
published Apache-2.0 terms. This is a provenance diligence recommendation, not
an additional restriction found in the distributed license.
