# Muscle Mechanics for Aided Diagnosis

One-page IEEE-format project overview explaining what Waajacu Medical Muscles
implements, how its browser-based muscle calculation works, and how guided
observations and reports relate to the model. Prepared on 16 September 2026.

Author: Santiago Restrepo Ruiz. Publisher: Waajacu Open Source Foundation.
Correspondence: Santiago.Restrepo.Ruiz@gmail.com.

Application: <https://medical.waajacu.com/>.

## Read and edit

- `muscle-mechanics-for-aided-diagnosis.pdf`: one-page reading copy with a clickable application link.
- `muscle-mechanics-for-aided-diagnosis.tex`: editable manuscript.
- `ieee-preamble.tex`: unchanged formatting from the supplied reference.
- `references.bib`: sources for the upstream model and MuJoCo.
- `vendor/IEEEtran/`: complete, unmodified IEEEtran distribution and notices.
- `vendor/PROVENANCE.md`: formatting provenance and hashes.
- `build.ps1` and `build.sh`: compilation and validation helpers.
- `../../.temp/docs-muscles/build/`: ignored compilation records and page preview.

The folder follows
`C:\Work\Naturalehia\projects\fostering-cellular-agriculture\docs\presentation`.
The format is IEEEtran 1.8b conference, US Letter, two columns, standard margins
and normal 10-point body text, with the IEEEtran bibliography style. No font or
margin reduction is used. This independent overview is not an IEEE publication
or endorsement.

## Content and evidence

The manuscript describes the implementation under `../../projects/muscles/`:

- `README.md`: architecture, region coverage, intended use and static assumptions.
- `public/ms-human-worker.js`: bounded static optimization, replay and quality gates.
- `public/assessment-protocol-registry.js` and generated regional protocols:
  protocol identity and regional coverage.
- `tools/ms-human-assessment-atlas-384.json` and recorded protocol evidence:
  right-arm posture selection.
- `tools/verify-diagnosis-report.mjs`: report, privacy and migration checks.
- `public/models/ms_human_700/SOURCE.md`: pinned upstream model provenance and
  the two local bilateral-coordinate corrections.

Nine protocol definitions and 20 report tests were checked while preparing this
document. The project's release verification also passed after the folder
reorganization, with its Git cleanliness check skipped for the uncommitted
moves. These are software and mechanical consistency checks, not clinical
validation. The mathematical expression summarizes the actual solver; its
reserve penalty uses inverse squared newton-metres to keep the objective dimensionless.

The model paper and MuJoCo documentation are cited for upstream work; this
project's browser integration and observation workflow are described separately.
The application URL was supplied by the user and is included as a clickable
link; this document does not claim a live-site functionality audit.

OpenAI Codex assisted with project-source review, drafting, formatting and
layout verification. Authorship remains with the named author.

## Build

With LaTeX tools available in a Linux environment:

```sh
bash docs/muscles/build.sh
```

This uses the vendored IEEEtran files and writes generated output under
`.temp/docs-muscles/build/`. Required tools are latexmk, pdfLaTeX and BibTeX,
with the packages used by `ieee-preamble.tex`.

For the existing Windows reference environment, from this directory:

```powershell
.\build.ps1 -Render
```

The PowerShell helper uses the already-running
`naturalehia-fostering-cellular-agriculture` container, whose installed LaTeX
toolchain built the supplied reference. It verifies the expected image and
management label, compiles only a unique `/tmp/medical-muscle-mechanics-for-aided-diagnosis-*`
source snapshot, and retrieves the output. It does not edit the reference
project's mounted files or manage container lifecycle, mounts, images, volumes
or dependencies. Snapshots are preserved.

The build rejects multiple pages, overfull boxes and unresolved citations.
`-Render` uses local Poppler to create a page preview. Inspect that preview
after future edits before distributing the reading copy.
