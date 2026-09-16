# Metabolic Recovery After Valve Replacement

Santiago Restrepo | contact@waajacu.com | https://waajacu.com/

Standalone, one-page research proposal, September 2026. The document describes a
hybrid metabolic and machine-learning model to investigate recovery after TAVR,
a public-data prototype, and the longitudinal validation required before clinical use.

## Files

- `metabolic-recovery-after-valve-replacement.tex`: editable manuscript and author block.
- `references.bib`: three cited sources.
- `ieee-preamble.tex`: shared IEEE conference formatting, copied unchanged from the reference.
- `vendor/IEEEtran/`: complete, unmodified IEEEtran distribution and license notices.
- `build.ps1`: Windows build helper using the existing `documents-latex` container.
- `build.sh`: standalone latexmk/pdfLaTeX build for the established Debian environment.
- `build-tectonic.ps1`: optional local build with a caller-supplied Tectonic executable.
- `metabolic-recovery-after-valve-replacement.pdf`: compiled reading copy.
- `build/`: generated files, logs, provenance and optional page previews.

The main source, bibliography, preamble, and `vendor` folder are sufficient to edit
and rebuild the document. No source depends on another project or webpage.
No Git repository is created. IEEEtran formatting does not imply IEEE endorsement.

## Build using the same environment as the reference

The existing environment is managed by `C:\Work\documents\cv.ps1`.
Start Docker Desktop if necessary, then use the existing launcher:

```powershell
& 'C:\Work\documents\cv.ps1' start
Set-Location 'C:\Work\medical\projects\metabolic-recovery-after-valve-replacement'
.\build.ps1 -Render
```

The build helper requires a running, healthy, managed `documents-latex` container
based on `debian:12-slim`. It creates a temporary source snapshot inside that
container, runs latexmk and qpdf, and copies the PDF and build files back here.
It never creates, replaces, starts, stops, or deletes containers or volumes.
The `-Render` option also produces PNG previews. Container lifecycle remains with
the existing documents launcher; this project adds no Docker configuration.

Within an existing Debian environment with the required tools installed:

```bash
bash build.sh
```

This compiles to `build/metabolic-recovery-after-valve-replacement.pdf`.
Dependencies are latexmk, pdfLaTeX, BibTeX, qpdf, and the LaTeX packages used by the
reference. The Windows helper copies that PDF to the project root.

## Optional local Tectonic build

Docker was unavailable during preparation, so the delivered PDF was compiled from
the actual LaTeX source using official portable Tectonic 0.17.0, with the bundled
IEEEtran class and bibliography style. The compiler is not part of the project.
Provide an existing executable explicitly:

```powershell
.\build-tectonic.ps1 -TectonicPath 'C:\path\to\tectonic.exe'
```

On its first run, Tectonic may download standard TeX resources. Its cache stays
under `build/tectonic-cache/`. The helper writes the PDF, intermediate files and
logs under `build/` and copies the compiled PDF to the project root.

## Verification and editing

The manuscript uses IEEEtran conference format, US Letter, two columns and normal
10-point body text. It retains the reference's centered title, author block,
abstract, index terms, numbered sections and IEEE bibliography.
After edits, check the compilation log for errors, unresolved citations and overfull
boxes; confirm that the PDF is still one page and visually inspect its layout.
Tectonic and pdfLaTeX can differ slightly in line breaks, so the one-page requirement
should be rechecked when switching engines.

The document proposes research, not a validated clinical predictor. Public donor
data provide hypotheses and priors, not measured individual metabolic fluxes.
Immediate simulated unloading is distinguished from longitudinal recovery.
Existing CARDIOKIN1 work is acknowledged; no first-ever modeling claim is made.
