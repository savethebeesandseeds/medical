#!/usr/bin/env bash
# Compile only: installed Debian TeX tools and the locally supplied IEEEtran.
set -euo pipefail
paper_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$paper_dir"
build_dir=${1:-"$paper_dir/build"}
mkdir -p "$build_dir"
build_dir=$(CDPATH= cd -- "$build_dir" && pwd)
export TEXINPUTS="$paper_dir/vendor/IEEEtran//:${TEXINPUTS:-}"
export BSTINPUTS="$paper_dir/vendor/IEEEtran/bibtex//:${BSTINPUTS:-}"
latexmk -pdf -interaction=nonstopmode -halt-on-error -file-line-error \
  -outdir="$build_dir" metabolic-recovery-after-valve-replacement.tex
qpdf --check "$build_dir/metabolic-recovery-after-valve-replacement.pdf"
