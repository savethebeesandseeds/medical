param([int]$Port = 8080)

$ErrorActionPreference = 'Stop'
$ContainerName = 'opensim-muscles'

Write-Host 'Container:'
docker ps --filter "name=^/$ContainerName$" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}'

Write-Host "`nOpenSim C++ self-test:"
docker exec $ContainerName /workspace/build/muscle_web --self-test --web-root /workspace/public

Write-Host "`nGPU from inside container:"
docker exec $ContainerName bash -lc 'if command -v nvidia-smi >/dev/null; then nvidia-smi -L; else /usr/lib/wsl/lib/nvidia-smi -L; fi'

Write-Host "`nHTTP health:"
Invoke-RestMethod "http://localhost:$Port/api/health" | ConvertTo-Json -Depth 8

Write-Host "`nOfficial model inventory:"
$model = Invoke-RestMethod "http://localhost:$Port/api/model"
[pscustomobject]@{
    model = $model.id
    scope = $model.scope
    bodies = $model.counts.bodies
    coordinates = $model.counts.coordinates
    muscles = $model.counts.muscles
    ligaments = $model.counts.ligaments
    meshes = $model.counts.meshes
    modelSha256 = $model.source.modelSha256
} | Format-List

Write-Host "`nOpenSim pose sample:"
$pose = Invoke-RestMethod "http://localhost:$Port/api/pose?elbow_flexion=60&muscle=BIClong"
$biceps = $pose.muscles | Where-Object name -eq 'BIClong'
[pscustomobject]@{
    selectedMuscle = $pose.selectedMuscle
    elbowFlexionDeg = $pose.coordinates.elbow_flexion
    musclePathPoints = $biceps.points.Count
    muscleLengthM = $biceps.lengthM
    elbowMomentArmM = $biceps.momentArms.elbow_flexion
    interpretation = $pose.interpretation
} | Format-List

Write-Host "`nAuthor-supplied CMC benchmark:"
$benchmark = Invoke-RestMethod "http://localhost:$Port/api/benchmark"
$frame = Invoke-RestMethod "http://localhost:$Port/api/benchmark/frame?t=2.5&muscle=BIClong"
$activationCount = @($frame.muscles | Where-Object { $null -ne $_.activation }).Count
$selected = $frame.muscles | Where-Object name -eq 'BIClong'
[pscustomobject]@{
    benchmark = $benchmark.name
    sourceModelVersion = $benchmark.modelVersion
    frames = $benchmark.frames
    timeRangeS = "$($benchmark.timeStart)-$($benchmark.timeEnd)"
    frameTimeS = $frame.benchmark.time
    activationValues = $activationCount
    selectedActivation = $selected.activation
    interpretation = $frame.interpretation
    benchmarkSha256 = $benchmark.source.sha256
} | Format-List

Write-Host "`nReach8 angle matching:"
$nearest = Invoke-RestMethod "http://localhost:$Port/api/benchmark/nearest?elbow_flexion=60&t=0.62&muscle=BIClong"
$nearestSelected = $nearest.muscles | Where-Object name -eq 'BIClong'
[pscustomobject]@{
    method = $nearest.match.method
    requestedElbowDeg = $nearest.match.requested.elbow_flexion
    matchedElbowDeg = $nearest.match.actual.elbow_flexion
    matchErrorDeg = $nearest.match.maxErrorDegrees
    matchedTimeS = $nearest.match.time
    activationValues = @($nearest.muscles | Where-Object { $null -ne $_.activation }).Count
    selectedActivation = $nearestSelected.activation
} | Format-List
