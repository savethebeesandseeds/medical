[CmdletBinding()]
param([switch] $Render)

# Use an already-running environment. Lifecycle stays with C:\Work\documents\cv.ps1.
# The editable sources stay here; only a build snapshot enters container /tmp.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$paperDirectory = $PSScriptRoot
$containerName = 'documents-latex'
$outputDirectory = Join-Path $paperDirectory 'build'
$pdfName = 'metabolic-recovery-after-valve-replacement.pdf'

function Invoke-PaperDocker {
    param([Parameter(Mandatory = $true)][string[]] $Arguments)
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker $($Arguments[0]) failed with exit code $LASTEXITCODE"
    }
}

$inspectionText = & docker container inspect $containerName
if ($LASTEXITCODE -ne 0) {
    throw 'The existing documents-latex container is required; this helper never creates it.'
}
$inspection = @($inspectionText | ConvertFrom-Json)[0]
if ($inspection.State.Status -ne 'running' -or $inspection.State.Health.Status -ne 'healthy') {
    throw 'Start the existing environment with C:\Work\documents\cv.cmd start, then retry.'
}
if ($inspection.Config.Image -ne 'debian:12-slim' -or
    $inspection.Config.Labels.'org.local.documents-latex.managed' -ne 'true') {
    throw 'Unexpected documents-latex configuration; the container has been preserved.'
}
$containerId = $inspection.Id
$snapshotDirectory = '/tmp/metabolic-recovery-after-valve-replacement-' + [guid]::NewGuid().ToString('N')
Invoke-PaperDocker -Arguments @('exec', $containerId, 'mkdir', '-p', $snapshotDirectory)
foreach ($sourceName in @('metabolic-recovery-after-valve-replacement.tex', 'ieee-preamble.tex', 'references.bib', 'build.sh', 'vendor')) {
    Invoke-PaperDocker -Arguments @('cp', (Join-Path $paperDirectory $sourceName), "${containerId}:${snapshotDirectory}/")
}
Invoke-PaperDocker -Arguments @('exec', $containerId, '/bin/bash', "$snapshotDirectory/build.sh")
if ($Render) {
    Invoke-PaperDocker -Arguments @('exec', $containerId, 'mkdir', '-p', "$snapshotDirectory/build/preview")
    Invoke-PaperDocker -Arguments @('exec', $containerId, 'pdftoppm', '-r', '140', '-png', "$snapshotDirectory/build/$pdfName", "$snapshotDirectory/build/preview/page")
}
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
Invoke-PaperDocker -Arguments @('cp', "${containerId}:${snapshotDirectory}/build/.", $outputDirectory)
Copy-Item -LiteralPath (Join-Path $outputDirectory $pdfName) -Destination (Join-Path $paperDirectory $pdfName)
$buildRecord = @(
    "Built at (UTC): $([DateTime]::UtcNow.ToString('o'))"
    "Container: $containerName"
    "Immutable ID: $containerId"
    "Base image: $($inspection.Config.Image)"
    "Container image ID: $($inspection.Image)"
    "Build snapshot: $snapshotDirectory"
    'Original sources: this white-paper directory on Windows'
)
$buildRecord | Set-Content -LiteralPath (Join-Path $outputDirectory 'build-environment.txt') -Encoding utf8
Write-Output "PDF: $(Join-Path $paperDirectory $pdfName)"
Write-Output "Build snapshot retained: $snapshotDirectory"
