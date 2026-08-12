param(
    [Parameter(Mandatory = $true)]
    [string]$Postures,

    [ValidateRange(1, 16)]
    [int]$Workers = 8,

    [string]$Scales = "0.75,0.5,0.25,0",

    [string]$RunId = "capacity-sensitivity"
)

$ErrorActionPreference = "Stop"
$SearchRoot = (Resolve-Path $PSScriptRoot).Path
$RunRoot = Join-Path $SearchRoot "runs\$RunId"
$InputRoot = Join-Path $RunRoot "input"
$OutputRoot = Join-Path $RunRoot "output"
$ReportRoot = Join-Path $RunRoot "report"
$ConfigPath = Join-Path $SearchRoot "search_config.json"
$GeneratorPath = Join-Path $SearchRoot "generate_capacity_cases.py"
$AnalyzerPath = Join-Path $SearchRoot "analyze_capacity.py"
$RunConfigPath = Join-Path $RunRoot "search_config.json"
$ResolvedPostures = (Resolve-Path $Postures).Path
$BundledPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if (-not (Test-Path -LiteralPath $BundledPython)) {
    $PythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($null -eq $PythonCommand) { throw "Python is required." }
    $BundledPython = $PythonCommand.Source
}

New-Item -ItemType Directory -Force -Path $InputRoot, $OutputRoot, $ReportRoot | Out-Null
Copy-Item -LiteralPath $ConfigPath -Destination $RunConfigPath -Force
& $BundledPython $GeneratorPath --config $RunConfigPath --postures $ResolvedPostures --output-dir $InputRoot --workers $Workers --scales $Scales
if ($LASTEXITCODE -ne 0) { throw "Capacity-case generation failed." }

$DockerCommand = (Get-Command docker -ErrorAction Stop).Source
$Processes = @()
for ($Index = 0; $Index -lt $Workers; $Index++) {
    $Shard = "{0:D2}" -f $Index
    $ContainerInput = "/workspace/search/runs/$RunId/input/capacity_$Shard.csv"
    $ContainerOutput = "/workspace/search/runs/$RunId/output/capacity_atlas_$Shard.csv"
    $Stdout = Join-Path $OutputRoot "worker_$Shard.stdout.log"
    $Stderr = Join-Path $OutputRoot "worker_$Shard.stderr.log"
    $Arguments = @(
        "exec", "-e", "OPENBLAS_NUM_THREADS=1", "opensim-muscles",
        "/workspace/build/muscle_web",
        "--batch-search", $ContainerInput,
        "--batch-output", $ContainerOutput,
        "--batch-progress-every", "25"
    )
    $Processes += Start-Process -FilePath $DockerCommand -ArgumentList $Arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput $Stdout -RedirectStandardError $Stderr
}

$Processes | Wait-Process
$Failed = @($Processes | Where-Object { $_.ExitCode -ne 0 })
if ($Failed.Count -gt 0) {
    throw "$($Failed.Count) capacity workers failed. Inspect $OutputRoot."
}

$AtlasGlob = Join-Path $OutputRoot "capacity_atlas_*.csv"
$ReportPath = Join-Path $ReportRoot "capacity_report.json"
& $BundledPython $AnalyzerPath --input-glob $AtlasGlob --output $ReportPath
if ($LASTEXITCODE -ne 0) { throw "Capacity analysis failed." }

Write-Output "Capacity study complete: $RunRoot"
