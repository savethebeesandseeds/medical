[CmdletBinding()]
param(
    [switch] $Render,
    [string] $Container = 'naturalehia-fostering-cellular-agriculture'
)

# Reuse the verified, running LaTeX environment. This helper never manages lifecycle.
# Sources and build output stay in a unique /tmp snapshot, outside mounted projects.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$paperDirectory = $PSScriptRoot
$workspaceDirectory = Split-Path -Parent (Split-Path -Parent $paperDirectory)
$outputDirectory = Join-Path $workspaceDirectory '.temp/docs-muscles/build'
$expectedImage = 'emscripten/emsdk:6.0.5@sha256:76a44fff907397784decc435115d07fcb9587a4f1504977f39f3745e538e3a1e'
$managedLabel = 'org.naturalehia.fostering-cellular-agriculture.managed'
$stem = 'muscle-mechanics-for-aided-diagnosis'
$pdfName = "$stem.pdf"
$sourceNames = @("$stem.tex", 'ieee-preamble.tex', 'references.bib', 'build.sh', 'vendor')

function Invoke-PaperDocker {
    param([Parameter(Mandatory = $true)][string[]] $Arguments)
    & docker --context desktop-linux @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker $($Arguments[0]) failed ($LASTEXITCODE)." }
}

foreach ($sourceName in $sourceNames) {
    if (-not (Test-Path -LiteralPath (Join-Path $paperDirectory $sourceName))) {
        throw "Required paper source is missing: $sourceName"
    }
}
if ($Render) {
    $renderer = Get-Command pdftoppm -ErrorAction Stop
}

$inspectionText = & docker --context desktop-linux container inspect $Container
if ($LASTEXITCODE -ne 0) {
    throw 'The specified existing container is required; this helper never creates or starts one.'
}
$inspection = @($inspectionText | ConvertFrom-Json)[0]
$labelProperty = $null
if ($null -ne $inspection.Config.Labels) {
    $labelProperty = $inspection.Config.Labels.PSObject.Properties[$managedLabel]
}
if ($inspection.Config.Image -ne $expectedImage -or
    $null -eq $labelProperty -or $labelProperty.Value -ne 'true' -or
    $inspection.Config.User -ne '1000:1000') {
    throw 'Unexpected container image, managed label, or user; the container has been preserved.'
}
if ($inspection.State.Status -ne 'running') {
    throw 'The specified existing container must already be running; this helper does not change its lifecycle.'
}
$containerId = $inspection.Id
$snapshotDirectory = '/tmp/medical-muscle-mechanics-for-aided-diagnosis-' + [guid]::NewGuid().ToString('N')
$containerBuild = "$snapshotDirectory-build"
Invoke-PaperDocker -Arguments @('exec', $containerId, 'mkdir', '-p', $snapshotDirectory)
foreach ($sourceName in $sourceNames) {
    Invoke-PaperDocker -Arguments @('cp', (Join-Path $paperDirectory $sourceName), "${containerId}:${snapshotDirectory}/")
}
Invoke-PaperDocker -Arguments @('exec', $containerId, '/bin/bash', "$snapshotDirectory/build.sh", $containerBuild)
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
Invoke-PaperDocker -Arguments @('cp', "${containerId}:${containerBuild}/.", $outputDirectory)

$logText = Get-Content -LiteralPath (Join-Path $outputDirectory "$stem.log") -Raw
if ($logText -notmatch 'Output written on [\s\S]+?\(1 page,') {
    throw 'The compiler did not confirm exactly one page. Shorten the content before release.'
}
if ($logText -match 'Overfull \\[hv]box|There were undefined references|Citation .+ undefined|Reference .+ undefined') {
    throw 'Resolve the layout or citation warnings before release.'
}
$pdfInfo = Get-Command pdfinfo -ErrorAction SilentlyContinue
if ($pdfInfo) {
    $info = & $pdfInfo.Source (Join-Path $outputDirectory $pdfName)
    if ($LASTEXITCODE -ne 0 -or ($info -join "`n") -notmatch '(?m)^Pages:\s+1\s*$') {
        throw 'PDF validation did not confirm exactly one page.'
    }
}
if ($Render) {
    $previewDirectory = Join-Path $outputDirectory 'preview'
    New-Item -ItemType Directory -Path $previewDirectory -Force | Out-Null
    & $renderer.Source -singlefile -r 150 -png (Join-Path $outputDirectory $pdfName) (Join-Path $previewDirectory 'page')
    if ($LASTEXITCODE -ne 0) { throw 'PDF rendering failed.' }
}
Copy-Item -LiteralPath (Join-Path $outputDirectory $pdfName) -Destination (Join-Path $paperDirectory $pdfName)
@(
    "Built at (UTC): $([DateTime]::UtcNow.ToString('o'))"
    "Requested container: $Container"
    "Immutable ID: $containerId"
    "Base image: $($inspection.Config.Image)"
    "Container image ID: $($inspection.Image)"
    "Container user: $($inspection.Config.User)"
    "Source snapshot: $snapshotDirectory"
    "Build directory: $containerBuild"
    'Format: IEEEtran conference; US Letter; two columns; normal 10-point body.'
) | Set-Content -LiteralPath (Join-Path $outputDirectory 'build-environment.txt') -Encoding utf8
Write-Output "PDF: $(Join-Path $paperDirectory $pdfName)"
