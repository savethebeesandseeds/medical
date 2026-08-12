param([int]$Port = 8080)

$ErrorActionPreference = 'Stop'
$ContainerName = 'opensim-muscles'

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "Verification failed: $Message" }
}

function Get-MatchUrl($Coordinates, [double]$AnchorTime) {
    $names = @(
        'elv_angle', 'shoulder_elv', 'shoulder_rot', 'elbow_flexion',
        'pro_sup', 'deviation', 'flexion'
    )
    $pairs = foreach ($name in $names) {
        $value = [Convert]::ToString(
            [double]$Coordinates.$name,
            [Globalization.CultureInfo]::InvariantCulture
        )
        "$name=$([uri]::EscapeDataString($value))"
    }
    $anchor = [Convert]::ToString(
        $AnchorTime,
        [Globalization.CultureInfo]::InvariantCulture
    )
    return "http://localhost:$Port/api/benchmark/nearest?" +
        ($pairs -join '&') + "&t=$anchor&muscle=BIClong"
}

function Get-StaticUrl($Coordinates) {
    $names = @(
        'elv_angle', 'shoulder_elv', 'shoulder_rot', 'elbow_flexion',
        'pro_sup', 'deviation', 'flexion'
    )
    $pairs = foreach ($name in $names) {
        $value = [Convert]::ToString(
            [double]$Coordinates.$name,
            [Globalization.CultureInfo]::InvariantCulture
        )
        "$name=$([uri]::EscapeDataString($value))"
    }
    return "http://localhost:$Port/api/static-hold?" +
        ($pairs -join '&') + '&muscle=BIClong'
}

Write-Host 'Container:'
docker ps --filter "name=^/$ContainerName$" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}'

Write-Host "`nOpenSim C++ self-test:"
docker exec $ContainerName /workspace/build/muscle_web --self-test --web-root /workspace/public

Write-Host "`nGPU from inside container:"
docker exec $ContainerName bash -lc 'if command -v nvidia-smi >/dev/null; then nvidia-smi -L; else /usr/lib/wsl/lib/nvidia-smi -L; fi'

Write-Host "`nHTTP health:"
$health = Invoke-RestMethod "http://localhost:$Port/api/health"
$health | ConvertTo-Json -Depth 8
Assert-True ($health.status -eq 'ok') 'health endpoint did not return ok'
Assert-True ($health.openSimLinked -eq $true) 'OpenSim C++ is not linked'

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
Assert-True ($model.id -eq 'MOBL_ARMS_41') 'unexpected model id'
Assert-True ($model.counts.muscles -eq 50) 'expected 50 muscles'
Assert-True ($model.counts.meshes -eq 33) 'expected 33 authored meshes'

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

Write-Host "`nOn-demand static posture equilibrium:"
$staticCoordinates = [pscustomobject]@{
    elv_angle = 90; shoulder_elv = 30; shoulder_rot = 0
    elbow_flexion = 0; pro_sup = 0; deviation = 0; flexion = 0
}
$static = Invoke-RestMethod (Get-StaticUrl $staticCoordinates)
$staticActivationCount = @(
    $static.muscles | Where-Object { $null -ne $_.activation }
).Count
$staticActiveForceCount = @(
    $static.muscles | Where-Object { $null -ne $_.activeActuatorForceN }
).Count
[pscustomobject]@{
    mode = $static.mode
    usable = $static.staticHolding.quality.usable
    solver = $static.staticHolding.solver.algorithm
    solverTimeMs = $static.staticHolding.solver.durationMs
    constraintMultipliers = $static.staticHolding.solver.constraintMultipliers
    activationValues = $staticActivationCount
    activeActuatorForceValues = $staticActiveForceCount
    equilibriumResidual = $static.staticHolding.quality.maxGeneralizedForceEquilibriumResidual
    equilibriumLimit = $static.staticHolding.quality.equilibriumResidualLimit
    maximumReserveNm = $static.staticHolding.quality.maxReserveTorqueNm
    reserveLimitNm = $static.staticHolding.quality.reserveTorqueLimitNm
    upperControlSaturations = $static.staticHolding.quality.musclesAtUpperControlLimit
} | Format-List
Assert-True ($static.mode -eq 'static') 'static endpoint returned the wrong mode'
Assert-True ($static.staticHolding.solver.converged -eq $true) 'static optimizer did not converge'
Assert-True ($static.staticHolding.quality.usable -eq $true) 'default static posture was withheld'
Assert-True ($staticActivationCount -eq 50) 'static posture did not return 50 activations'
Assert-True ($staticActiveForceCount -eq 50) 'usable static posture did not return 50 active actuator force estimates'
Assert-True ($static.staticHolding.activeActuatorForce.units -eq 'N') 'active actuator force metadata has unexpected units'
Assert-True ($static.staticHolding.activeActuatorForce.measuredPatientForce -eq $false) 'active actuator force was mislabeled as measured patient force'
Assert-True ($static.staticHolding.activeActuatorForce.passiveMuscleFiberForceIncluded -eq $false) 'active actuator force unexpectedly includes passive fiber force'
Assert-True ($static.staticHolding.activeActuatorForce.externalLoadIncluded -eq $false) 'active actuator force unexpectedly includes an external load'
Assert-True (
    [double]$static.staticHolding.quality.maxGeneralizedForceEquilibriumResidual -le
    [double]$static.staticHolding.quality.equilibriumResidualLimit
) 'static posture failed the independently replayed equilibrium gate'
Assert-True (
    [double]$static.staticHolding.quality.maxReserveTorqueNm -le
    [double]$static.staticHolding.quality.reserveTorqueLimitNm
) 'static posture exceeded the reserve-torque gate'
foreach ($muscle in $static.muscles) {
    $activation = [double]$muscle.activation
    Assert-True (
        -not [double]::IsNaN($activation) -and
        -not [double]::IsInfinity($activation) -and
        $activation -ge 0 -and $activation -le 1
    ) "static activation is invalid for $($muscle.name)"
    $activeForce = [double]$muscle.activeActuatorForceN
    Assert-True (
        -not [double]::IsNaN($activeForce) -and
        -not [double]::IsInfinity($activeForce) -and
        $activeForce -ge 0
    ) "static active actuator force is invalid for $($muscle.name)"
}

$staticRepeat = Invoke-RestMethod (Get-StaticUrl $staticCoordinates)
$largestStaticRepeatDifference = 0.0
foreach ($muscle in $static.muscles) {
    $other = $staticRepeat.muscles | Where-Object name -eq $muscle.name
    $difference = [math]::Abs(
        [double]$muscle.activation - [double]$other.activation
    )
    $largestStaticRepeatDifference = [math]::Max(
        $largestStaticRepeatDifference, $difference
    )
}
Assert-True ($largestStaticRepeatDifference -lt 0.001) 'repeating one static posture changed activation materially'

$missingPoseRejected = $false
try {
    Invoke-RestMethod "http://localhost:$Port/api/static-hold?elv_angle=90" | Out-Null
} catch {
    $missingPoseRejected = [int]$_.Exception.Response.StatusCode -eq 400
}
Assert-True ($missingPoseRejected) 'incomplete static pose was not rejected with HTTP 400'

$invalidPoseRejected = $false
try {
    Invoke-RestMethod "http://localhost:$Port/api/static-hold?elv_angle=bad&shoulder_elv=30&shoulder_rot=0&elbow_flexion=0&pro_sup=0&deviation=0&flexion=0" | Out-Null
} catch {
    $invalidPoseRejected = [int]$_.Exception.Response.StatusCode -eq 400
}
Assert-True ($invalidPoseRejected) 'non-numeric static pose was not rejected with HTTP 400'

Write-Host "`nAuthor-supplied CMC benchmark:"
$benchmark = Invoke-RestMethod "http://localhost:$Port/api/benchmark"
$supportedPoses = Invoke-RestMethod "http://localhost:$Port/api/benchmark/poses"
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
    listedSupportedPoses = @($supportedPoses.poses).Count
    selectedActivation = $selected.activation
    interpretation = $frame.interpretation
    benchmarkSha256 = $benchmark.source.sha256
} | Format-List
Assert-True ($activationCount -eq 50) 'Reach8 frame did not return 50 activations'
Assert-True (@($supportedPoses.poses).Count -eq 3997) 'supported-pose list did not return all 3997 authored frames'
Assert-True (@($supportedPoses.coordinateNames).Count -eq 7) 'supported-pose list did not return all seven coordinates'
Assert-True ([math]::Abs([double]$supportedPoses.poses[0].time - [double]$benchmark.timeStart) -lt 0.000001) 'supported-pose list has the wrong first frame'
Assert-True ([math]::Abs([double]$supportedPoses.poses[-1].time - [double]$benchmark.timeEnd) -lt 0.000001) 'supported-pose list has the wrong final frame'
$selectedActivationValue = [double]$selected.activation
Assert-True (-not [double]::IsNaN($selectedActivationValue) -and
    -not [double]::IsInfinity($selectedActivationValue)) 'selected activation is not finite'

Write-Host "`nReach8 continuous projection and coverage gates:"
$nearest = Invoke-RestMethod (Get-MatchUrl $frame.coordinates $frame.benchmark.time)
$nearestSelected = $nearest.muscles | Where-Object name -eq 'BIClong'
[pscustomobject]@{
    method = $nearest.match.method
    coverage = $nearest.match.coverage.status
    usable = $nearest.match.coverage.usable
    rmsErrorDeg = $nearest.match.rmsErrorDegrees
    maximumErrorDeg = $nearest.match.maxErrorDegrees
    projectedTimeS = $nearest.match.time
    activationValues = @($nearest.muscles | Where-Object { $null -ne $_.activation }).Count
    selectedActivation = $nearestSelected.activation
} | Format-List
Assert-True ($nearest.match.coverage.status -eq 'high') 'an exact Reach8 frame was not high coverage'
Assert-True ($nearest.match.coverage.usable -eq $true) 'an exact Reach8 frame was rejected'
Assert-True (@($nearest.muscles | Where-Object { $null -ne $_.activation }).Count -eq 50) 'accepted projection did not return 50 activations'

$nearCoordinates = [pscustomobject]@{
    elv_angle = $frame.coordinates.elv_angle
    shoulder_elv = $frame.coordinates.shoulder_elv
    shoulder_rot = $frame.coordinates.shoulder_rot
    elbow_flexion = [double]$frame.coordinates.elbow_flexion + 0.5
    pro_sup = $frame.coordinates.pro_sup
    deviation = $frame.coordinates.deviation
    flexion = $frame.coordinates.flexion
}
$near = Invoke-RestMethod (Get-MatchUrl $nearCoordinates $nearest.match.time)
Assert-True ($near.match.coverage.usable -eq $true) 'a 0.5 degree perturbation near Reach8 was rejected'
$largestActivationChange = 0.0
foreach ($muscle in $nearest.muscles) {
    $other = $near.muscles | Where-Object name -eq $muscle.name
    $change = [math]::Abs([double]$muscle.activation - [double]$other.activation)
    $largestActivationChange = [math]::Max($largestActivationChange, $change)
}
Assert-True ($largestActivationChange -lt 0.05) 'a 0.5 degree supported change caused a discontinuous activation jump'

$outsideCoordinates = [pscustomobject]@{
    elv_angle = -14; shoulder_elv = 87.5; shoulder_rot = 0
    elbow_flexion = 94; pro_sup = 0; deviation = 8; flexion = -11
}
$outside = Invoke-RestMethod (Get-MatchUrl $outsideCoordinates 3.68)
$outsideCoordinates2 = [pscustomobject]@{
    elv_angle = -14; shoulder_elv = 87.5; shoulder_rot = 0
    elbow_flexion = 94; pro_sup = 0; deviation = 8.5; flexion = -11
}
$outside2 = Invoke-RestMethod (Get-MatchUrl $outsideCoordinates2 3.68)
[pscustomobject]@{
    rejectedCase = 'screenshot pose'
    coverage = $outside.match.coverage.status
    usable = $outside.match.coverage.usable
    rmsErrorDeg = $outside.match.rmsErrorDegrees
    maximumErrorDeg = $outside.match.maxErrorDegrees
    activationValues = @($outside.muscles | Where-Object { $null -ne $_.activation }).Count
    supportedHalfDegreeMaxActivationChange = $largestActivationChange
} | Format-List
Assert-True ($outside.match.coverage.status -eq 'outside') 'the known unsupported screenshot pose was not rejected'
Assert-True ($outside.match.coverage.usable -eq $false) 'the known unsupported screenshot pose was marked usable'
Assert-True (@($outside.muscles | Where-Object { $null -ne $_.activation }).Count -eq 0) 'a rejected pose leaked activation values'
Assert-True ([math]::Abs([double]$outside.coordinates.shoulder_elv - 87.5) -lt 0.0001) 'rejected match did not retain exact requested geometry'
Assert-True ($outside2.match.coverage.status -eq 'outside') 'the second unsupported screenshot pose was not rejected'
Assert-True (@($outside2.muscles | Where-Object { $null -ne $_.activation }).Count -eq 0) 'the second rejected screenshot pose leaked activation values'

$partial = Invoke-RestMethod "http://localhost:$Port/api/benchmark/nearest?elbow_flexion=60&t=0.62&muscle=BIClong"
Assert-True ($partial.match.coverage.status -eq 'incomplete') 'a partial pose query was not marked incomplete'
Assert-True ($partial.match.coverage.usable -eq $false) 'a partial pose query was marked usable'

Write-Host "`nDiagnosis workflow asset:"
$diagnosisScript = Invoke-RestMethod "http://localhost:$Port/diagnosis.js"
Assert-True ($diagnosisScript -match 'movement-reference.js') 'diagnosis workflow does not load the packaged movement reference'
$movementReference = Invoke-RestMethod "http://localhost:$Port/movement-reference.js"
Assert-True ($movementReference -match 'MOBL_ARMS_41') 'movement reference asset has unexpected model provenance'
Assert-True ($movementReference -match '"D7"') 'movement reference asset does not contain all discrimination positions'
Assert-True ($diagnosisScript -match 'DIAGNOSIS_TESTS') 'diagnosis workflow script did not include its test definitions'
Assert-True ($diagnosisScript -match 'Biomechanical hypothesis generator') 'diagnosis workflow safety framing is missing'

Write-Host "`nAll verification assertions passed."
