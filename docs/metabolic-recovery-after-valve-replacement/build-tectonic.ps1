[CmdletBinding()]
param([Parameter(Mandatory = $true)][string] $TectonicPath)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$paperDirectory = $PSScriptRoot
$paperName = 'metabolic-recovery-after-valve-replacement'
$compiler = (Resolve-Path -LiteralPath $TectonicPath).Path
$outputDirectory = Join-Path $paperDirectory 'build'
$cacheDirectory = Join-Path $outputDirectory 'tectonic-cache'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $cacheDirectory -Force | Out-Null
$priorCache = [Environment]::GetEnvironmentVariable('TECTONIC_CACHE_DIR', 'Process')

try {
    $env:TECTONIC_CACHE_DIR = $cacheDirectory
    Push-Location -LiteralPath $paperDirectory
    try {
        $compilerArguments = @(
            '--keep-logs', '--keep-intermediates', '--outdir', $outputDirectory,
            '-Z', ('search-path=' + (Join-Path $paperDirectory 'vendor\IEEEtran')),
            '-Z', ('search-path=' + (Join-Path $paperDirectory 'vendor\IEEEtran\bibtex')),
            ($paperName + '.tex')
        )
        & $compiler @compilerArguments
        if ($LASTEXITCODE -ne 0) { throw 'Tectonic compilation failed.' }
    }
    finally { Pop-Location }
}
finally {
    [Environment]::SetEnvironmentVariable('TECTONIC_CACHE_DIR', $priorCache, 'Process')
}

$compiledPdf = Join-Path $outputDirectory ($paperName + '.pdf')
if (-not (Test-Path -LiteralPath $compiledPdf -PathType Leaf)) { throw 'The compiled PDF is missing.' }
Copy-Item -LiteralPath $compiledPdf -Destination (Join-Path $paperDirectory ($paperName + '.pdf'))
$compilerVersion = (& $compiler --version | Out-String).Trim()
@(
    "Built at (UTC): $([DateTime]::UtcNow.ToString('o'))"
    "Compiler: $compilerVersion"
    "Compiler SHA-256: $((Get-FileHash -LiteralPath $compiler -Algorithm SHA256).Hash)"
    'Manuscript: metabolic-recovery-after-valve-replacement.tex'
    'Template: unmodified vendored IEEEtran 1.8b and IEEEtran bibliography style 1.14'
    'Local compilation only; no document source sent to an external typesetting service.'
) | Set-Content -LiteralPath (Join-Path $outputDirectory 'build-environment.txt') -Encoding utf8
Write-Output "PDF: $compiledPdf"
