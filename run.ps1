param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8080,

    [ValidateRange(1, 128)]
    [int]$BuildJobs = 4
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = 'C:\Work\medical\muscles'
$ContainerName = 'opensim-muscles'
$CacheVolume = 'opensim-muscles-opt'

function Get-PublishedWebPort {
    param([int]$FallbackPort)

    $binding = docker port $ContainerName '8080/tcp' 2>$null | Select-Object -First 1
    if ($binding -match ':(\d+)$') {
        return [int]$Matches[1]
    }

    return $FallbackPort
}

function Test-OpenSimWeb {
    param([int]$WebPort)

    try {
        Invoke-WebRequest `
            -UseBasicParsing `
            -Uri "http://localhost:$WebPort/api/health" `
            -TimeoutSec 5 | Out-Null
        return $true
    }
    catch {
        return $false
    }
}

function Write-LaunchSummary {
    param(
        [string]$Status,
        [int]$WebPort,
        [bool]$Ready
    )

    $webAddress = "http://localhost:$WebPort"

    Write-Host ''
    Write-Host 'MoBL-ARMS Upper-Extremity Explorer'
    Write-Host ('  Status  {0}' -f $Status)
    if ($Ready) {
        Write-Host ('  Web     {0}' -f $webAddress)
    }
    else {
        Write-Host ('  Web     {0} (available after setup finishes)' -f $webAddress)
    }
    Write-Host ('  Logs    docker logs -f {0}' -f $ContainerName)
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'setup.sh'))) {
    throw "setup.sh was not found in $ProjectRoot"
}

$existing = docker ps -a --filter "name=^/$ContainerName$" --format '{{.Names}}'
if ($LASTEXITCODE -ne 0) {
    throw 'Docker could not query the local container engine. Make sure Docker Desktop is running.'
}

if ($existing -eq $ContainerName) {
    $running = docker ps --filter "name=^/$ContainerName$" --format '{{.Names}}'
    if ($LASTEXITCODE -ne 0) {
        throw "Docker could not inspect the '$ContainerName' container."
    }

    if ($running -ne $ContainerName) {
        docker start $ContainerName | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Docker could not start the '$ContainerName' container."
        }
    }

    $webPort = Get-PublishedWebPort -FallbackPort $Port
    $ready = Test-OpenSimWeb -WebPort $webPort
    $status = if ($ready) { 'ready' } else { 'starting' }
    Write-LaunchSummary -Status $status -WebPort $webPort -Ready $ready
    exit 0
}

docker volume create $CacheVolume | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Docker could not create the '$CacheVolume' cache volume."
}

$containerId = docker run --detach `
    --name $ContainerName `
    --hostname opensim-muscles `
    --gpus all `
    --restart unless-stopped `
    --publish "127.0.0.1:${Port}:8080" `
    --mount "type=bind,source=$ProjectRoot,target=/workspace" `
    --mount "type=volume,source=$CacheVolume,target=/opt" `
    --env "OPENSIM_BUILD_JOBS=$BuildJobs" `
    debian:11 `
    bash /workspace/setup.sh

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($containerId)) {
    throw "Docker could not create the '$ContainerName' container."
}

Write-LaunchSummary -Status 'starting' -WebPort $Port -Ready $false
