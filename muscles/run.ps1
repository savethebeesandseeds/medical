param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8080
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot
$ContainerName = 'ms-human-muscles'

function Test-Web {
    param([int]$WebPort)
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$WebPort/" -TimeoutSec 5
        return $response.StatusCode -eq 200 -and $response.Content -match 'bootstrap.js'
    }
    catch { return $false }
}

function Get-PublishedPort {
    param([string]$Name)
    $mapping = @(docker port $Name 8080/tcp)
    if ($LASTEXITCODE -ne 0) {
        throw "Docker could not inspect the published port for '$Name'."
    }
    $ports = @($mapping | ForEach-Object {
        if ($_ -match ':(\d+)$') { [int]$Matches[1] }
    } | Select-Object -Unique)
    if ($ports.Count -ne 1) {
        throw "The existing '$Name' container does not have one unambiguous host port for 8080/tcp."
    }
    return $ports[0]
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'setup.sh'))) {
    throw "setup.sh was not found in $ProjectRoot"
}

$existing = docker ps -a --filter "name=^/$ContainerName$" --format '{{.Names}}'
if ($LASTEXITCODE -ne 0) {
    throw 'Docker could not query the local container engine. Make sure Docker Desktop is running.'
}

if ($existing -eq $ContainerName) {
    $publishedPort = Get-PublishedPort -Name $ContainerName
    if ($publishedPort -ne $Port) {
        throw "The existing '$ContainerName' container is published on port $publishedPort, not $Port. Run with -Port $publishedPort, or remove the container before choosing a different port."
    }
    $running = docker ps --filter "name=^/$ContainerName$" --format '{{.Names}}'
    if ($running -ne $ContainerName) { docker start $ContainerName | Out-Null }
    $ready = Test-Web -WebPort $Port
    Write-Host ''
    Write-Host 'MS-Human-700 Upper-Limb Explorer'
    Write-Host ('  Status  {0}' -f $(if ($ready) { 'ready' } else { 'starting' }))
    Write-Host ('  Web     http://localhost:{0}' -f $Port)
    Write-Host ('  Logs    docker logs -f {0}' -f $ContainerName)
    exit 0
}

$containerId = docker run --detach `
    --name $ContainerName `
    --hostname ms-human-muscles `
    --restart unless-stopped `
    --publish "127.0.0.1:${Port}:8080" `
    --mount "type=bind,source=$ProjectRoot,target=/workspace" `
    debian:11 `
    bash /workspace/setup.sh

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($containerId)) {
    throw "Docker could not create the '$ContainerName' container."
}

Write-Host ''
Write-Host 'MS-Human-700 Upper-Limb Explorer'
Write-Host '  Status  starting'
Write-Host ('  Web     http://localhost:{0}' -f $Port)
Write-Host ('  Logs    docker logs -f {0}' -f $ContainerName)
