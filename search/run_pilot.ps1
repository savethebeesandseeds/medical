param(
    [ValidateRange(8, 1000000)]
    [int]$Count = 512,

    [ValidateRange(1, 16)]
    [int]$Workers = 4,

    [int]$Seed = 20260812,

    [string]$RunId = "pilot-$Count",

    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SearchRoot = (Resolve-Path $PSScriptRoot).Path
$RunRoot = Join-Path $SearchRoot "runs\$RunId"
$InputRoot = Join-Path $RunRoot "input"
$OutputRoot = Join-Path $RunRoot "output"
$ReportRoot = Join-Path $RunRoot "report"
$ConfigPath = Join-Path $SearchRoot "search_config.json"
$GeneratorPath = Join-Path $SearchRoot "generate_candidates.py"
$AnalyzerPath = Join-Path $SearchRoot "analyze_atlas.py"
$RunConfigPath = Join-Path $RunRoot "search_config.json"
$BundledPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if (-not (Test-Path -LiteralPath $BundledPython)) {
    $PythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($null -eq $PythonCommand) {
        throw "Python with NumPy is required for analysis."
    }
    $BundledPython = $PythonCommand.Source
}

New-Item -ItemType Directory -Force -Path $InputRoot, $OutputRoot, $ReportRoot | Out-Null
Copy-Item -LiteralPath $ConfigPath -Destination $RunConfigPath -Force

if (-not $SkipBuild) {
    docker exec opensim-muscles cmake --build /workspace/build --parallel 2
    if ($LASTEXITCODE -ne 0) { throw "OpenSim batch executable build failed." }
}

& $BundledPython $GeneratorPath --config $RunConfigPath --output-dir $InputRoot --count $Count --workers $Workers --seed $Seed
if ($LASTEXITCODE -ne 0) { throw "Candidate generation failed." }

$DockerCommand = (Get-Command docker -ErrorAction Stop).Source
$Processes = @()
for ($Index = 0; $Index -lt $Workers; $Index++) {
    $Shard = "{0:D2}" -f $Index
    $ContainerInput = "/workspace/search/runs/$RunId/input/candidates_$Shard.csv"
    $ContainerOutput = "/workspace/search/runs/$RunId/output/atlas_$Shard.csv"
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
    throw "$($Failed.Count) batch-search workers failed. Inspect $OutputRoot."
}

$AtlasGlob = Join-Path $OutputRoot "atlas_*.csv"
& $BundledPython $AnalyzerPath --config $RunConfigPath --input-glob $AtlasGlob --output-dir $ReportRoot
if ($LASTEXITCODE -ne 0) { throw "Atlas analysis failed." }

Write-Output "Search complete: $RunRoot"
