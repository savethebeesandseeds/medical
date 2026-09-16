#!/usr/bin/env bash
# Build the one-page paper with an existing LaTeX installation.
# Keep the IEEEtran font sizes and margins; shorten the text if it exceeds one page.
set -euo pipefail

paper_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$paper_dir"
stem=muscle-mechanics-for-aided-diagnosis
build_dir=${1:-"$paper_dir/../../.temp/docs-muscles/build"}
mkdir -p "$build_dir"
build_dir=$(CDPATH= cd -- "$build_dir" && pwd)

export TEXINPUTS="$paper_dir/vendor/IEEEtran//:${TEXINPUTS:-}"
export BSTINPUTS="$paper_dir/vendor/IEEEtran/bibtex//:${BSTINPUTS:-}"
latexmk -pdf -interaction=nonstopmode -halt-on-error -file-line-error \
  -outdir="$build_dir" "$stem.tex"

log_text=$(tr '\r\n' '  ' < "$build_dir/$stem.log")
one_page_pattern='Output written on .*\(1 page,'
if [[ ! "$log_text" =~ $one_page_pattern ]]; then
  printf 'The compiler did not confirm exactly one page. Shorten the content before release.\n' >&2
  exit 1
fi
if grep -Eq 'Overfull \\[hv]box|There were undefined references|Citation .* undefined|Reference .* undefined' "$build_dir/$stem.log"; then
  printf 'Resolve the layout or citation warnings before release.\n' >&2
  exit 1
fi
if command -v pdfinfo >/dev/null 2>&1; then
  pages=$(pdfinfo "$build_dir/$stem.pdf" | awk '/^Pages:/ {print $2}')
  [[ "$pages" == 1 ]] || { printf 'Expected one page; got %s\n' "$pages" >&2; exit 1; }
fi

printf 'Validated PDF: %s\n' "$build_dir/$stem.pdf"
