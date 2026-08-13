param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8080
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceRoot = Join-Path $ProjectRoot 'models\ms_human_700'
$PublicRoot = Join-Path $ProjectRoot 'public'
$AssetRoot = Join-Path $PublicRoot 'models\ms_human_700'
$ExpectedSourceTreeHash = '38815FED122D1BEB61155F0AFD85E72A52093111FCAE183BBB273F2483291971'

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -ne $Expected) {
        throw "$Message (expected '$Expected', found '$Actual')"
    }
}

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Assert-Hash {
    param([string]$Path, [string]$Expected, [string]$Message)
    Assert-Equal (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash $Expected $Message
}

$ModelPath = Join-Path $SourceRoot 'MS-Human-700.xml'
$LicensePath = Join-Path $SourceRoot 'LICENSE'
$MetadataPath = Join-Path $AssetRoot 'right-arm.json'
$GeometryPath = Join-Path $AssetRoot 'right-arm.meshbin'
$RuntimePath = Join-Path $AssetRoot 'right-arm-runtime.mjb'
$MujocoJsPath = Join-Path $PublicRoot 'vendor\mujoco.js'
$MujocoWasmPath = Join-Path $PublicRoot 'vendor\mujoco.wasm'
$ThreeModulePath = Join-Path $PublicRoot 'vendor\three.module.min.js'
$ThreeCorePath = Join-Path $PublicRoot 'vendor\three.core.min.js'
$ThreeLicensePath = Join-Path $PublicRoot 'vendor\THREE_LICENSE.txt'
$MujocoLicensePath = Join-Path $PublicRoot 'vendor\MUJOCO_LICENSE.txt'
$ProtocolPath = Join-Path $PublicRoot 'ms-human-assessment-protocol.js'
$ProtocolEvidencePath = Join-Path $ProjectRoot 'tools\ms-human-assessment-protocol-solver-evidence.json'

Assert-Hash $ModelPath 'D524F32FB22D18773674E5E5768B3272347A77F82CB507DAC19589D59D016CC5' 'MS-Human source model checksum mismatch'
Assert-Hash $LicensePath '1EB85FC97224598DAD1852B5D6483BBCF0AA8608790DCC657A5A2A761AE9C8C6' 'MS-Human license checksum mismatch'
Assert-Hash $MetadataPath '998E3E4F0A5DA1A1FF48D4994D5A40EAE586104C6D4F71163C8F2B03B94B2E4A' 'Right-arm metadata checksum mismatch'
Assert-Hash $GeometryPath 'A5DBA6568C86165AB3AAF795D443F81F7713489B300C590BFD898503AAB99F44' 'Right-arm geometry checksum mismatch'
Assert-Hash $RuntimePath '13D2B0BED35DB2B07F3B8076931ABEF4EC4E149CA8D89F326BDE22B84F821AD3' 'Right-arm runtime checksum mismatch'
Assert-Hash $MujocoJsPath '45E8E0E1617C19FBF7F00B36A6A72D1C0C980C0A4F38523E04F0641E8FBAB7B9' 'MuJoCo JavaScript checksum mismatch'
Assert-Hash $MujocoWasmPath '832597AE0A0E306C97ED43D2A9BBCA033CF3E547ECED410FB9011D87A68D4207' 'MuJoCo WebAssembly checksum mismatch'
Assert-Hash $ThreeModulePath '852C06B9FE936CF8EBC2870C86370D1015C310B04DE98CDFC07F4EFAF6AFD2AF' 'Three.js module checksum mismatch'
Assert-Hash $ThreeCorePath '4183CEE05F0AA093682FDF551363A16BB20BD92B68E14F7576905F45C461BA82' 'Three.js core checksum mismatch'
Assert-Hash $ThreeLicensePath 'BFE119EA4FD413F5F7CA3FCD63ADB0C4A073ED39DAA2FE7D3E6B769E21272601' 'Three.js license checksum mismatch'
Assert-Hash $MujocoLicensePath 'CFC7749B96F63BD31C3C42B5C471BF756814053E847C10F3EB003417BC523D30' 'MuJoCo license checksum mismatch'

# Hash the complete vendored source tree. SOURCE.md is the local provenance
# record and is deliberately excluded from the pinned upstream-derived hash.
$Hasher = [System.Security.Cryptography.IncrementalHash]::CreateHash(
    [System.Security.Cryptography.HashAlgorithmName]::SHA256
)
[string[]]$SourceFiles = Get-ChildItem -LiteralPath $SourceRoot -Recurse -File |
    Where-Object { $_.Name -ne 'SOURCE.md' } |
    ForEach-Object { $_.FullName.Substring($SourceRoot.Length + 1).Replace('\', '/') }
[System.Array]::Sort($SourceFiles, [System.StringComparer]::Ordinal)
foreach ($RelativePath in $SourceFiles) {
    $Hasher.AppendData([System.Text.Encoding]::UTF8.GetBytes($RelativePath + [char]0))
    $AbsolutePath = Join-Path $SourceRoot $RelativePath.Replace('/', '\')
    $Hasher.AppendData([System.IO.File]::ReadAllBytes($AbsolutePath))
    $Hasher.AppendData([byte[]]@(0))
}
$SourceTreeHash = ([System.BitConverter]::ToString($Hasher.GetHashAndReset())).Replace('-', '')
Assert-Equal $SourceFiles.Count 251 'Unexpected source file inventory'
Assert-Equal $SourceTreeHash $ExpectedSourceTreeHash 'MS-Human source-tree checksum mismatch'

$Metadata = Get-Content -LiteralPath $MetadataPath -Raw | ConvertFrom-Json
Assert-Equal $Metadata.schemaVersion 1 'Unexpected right-arm schema version'
Assert-Equal $Metadata.model.totalMuscles 700 'Unexpected complete model muscle count'
Assert-Equal $Metadata.model.functionalMuscles 88 'Unexpected solved muscle count'
Assert-Equal $Metadata.model.armBodies 11 'Unexpected articulated arm body count'
Assert-Equal $Metadata.coordinates.Count 7 'Unexpected independent-coordinate count'
Assert-Equal $Metadata.muscles.Count 88 'Unexpected muscle metadata count'
Assert-Equal ($Metadata.muscles | Where-Object group -eq 'Arm').Count 47 'Unexpected arm actuator count'
Assert-Equal ($Metadata.muscles | Where-Object group -eq 'Shoulder stabilizer').Count 27 'Unexpected shoulder stabilizer count'
Assert-Equal ($Metadata.muscles | Where-Object group -eq 'Long torso origin').Count 14 'Unexpected long-origin muscle count'
Assert-Equal ($Metadata.geometry.geoms | Where-Object role -eq 'arm').Count 32 'Unexpected arm geometry count'
Assert-Equal ($Metadata.geometry.geoms | Where-Object role -eq 'context').Count 32 'Unexpected context geometry count'
Assert-Equal $Metadata.source.sourceTreeSha256 $ExpectedSourceTreeHash.ToLowerInvariant() 'Metadata source hash mismatch'
Assert-Equal $Metadata.source.mujocoVersion '3.10.0' 'Unexpected MuJoCo version'
Assert-Equal $Metadata.source.modelLicense 'Apache-2.0' 'Unexpected model license'
Assert-Equal $Metadata.source.runtimeLicense 'Apache-2.0' 'Unexpected runtime license'
Assert-Equal $Metadata.source.localCorrections.Count 2 'Local correction record mismatch'
Assert-Equal $Metadata.validation.maximumDefaultTendonLengthErrorM 0 'Tendon parity validation failed'
Assert-Equal $Metadata.validation.maximumDefaultBiasForceError 0 'Bias-force parity validation failed'
Assert-Equal $Metadata.validation.maximumDefaultPassiveForceError 0 'Passive-force parity validation failed'

$ExpectedCoordinates = @(
    'elv_angle_r', 'shoulder_elv_r', 'shoulder_rot_r', 'elbow_flexion_r',
    'pro_sup_r', 'deviation_r', 'flexion_r'
)
for ($Index = 0; $Index -lt $ExpectedCoordinates.Count; $Index++) {
    Assert-Equal $Metadata.coordinates[$Index].name $ExpectedCoordinates[$Index] "Coordinate order mismatch at $Index"
    Assert-True ([double]$Metadata.coordinates[$Index].minimumDegrees -le [double]$Metadata.coordinates[$Index].defaultDegrees) "Coordinate default is below its range: $($ExpectedCoordinates[$Index])"
    Assert-True ([double]$Metadata.coordinates[$Index].defaultDegrees -le [double]$Metadata.coordinates[$Index].maximumDegrees) "Coordinate default is above its range: $($ExpectedCoordinates[$Index])"
}

$MuscleIds = @($Metadata.muscles | ForEach-Object actuatorId)
Assert-Equal ($MuscleIds | Sort-Object -Unique).Count 88 'Muscle actuator IDs are not unique'
Assert-Equal ($Metadata.muscles | Where-Object { $_.visibleByDefault -eq $false }).Count 14 'Unexpected default-hidden muscle count'

$Geometry = [System.IO.File]::ReadAllBytes($GeometryPath)
Assert-Equal ([System.Text.Encoding]::ASCII.GetString($Geometry, 0, 8)) 'MSHARM01' 'Unexpected geometry format'
$VertexCount = [BitConverter]::ToUInt32($Geometry, 8)
$IndexCount = [BitConverter]::ToUInt32($Geometry, 12)
Assert-Equal $Geometry.Length (16 + 12 * [int64]$VertexCount + 4 * [int64]$IndexCount) 'Geometry byte length mismatch'
Assert-Equal $VertexCount $Metadata.geometry.vertices 'Geometry vertex count mismatch'
Assert-Equal ($IndexCount / 3) $Metadata.geometry.triangles 'Geometry triangle count mismatch'
$VertexCursor = 0
$IndexCursor = 0
foreach ($Geom in $Metadata.geometry.geoms) {
    Assert-Equal $Geom.vertexStart $VertexCursor "Non-contiguous vertex range: $($Geom.name)"
    Assert-Equal $Geom.indexStart $IndexCursor "Non-contiguous index range: $($Geom.name)"
    $VertexCursor += $Geom.vertexCount
    $IndexCursor += $Geom.indexCount
}
Assert-Equal $VertexCursor $VertexCount 'Geometry descriptors do not cover all vertices'
Assert-Equal $IndexCursor $IndexCount 'Geometry descriptors do not cover all indices'

$RequiredFiles = @(
    'index.html', 'styles.css', 'app-ms-human.js', 'ms-human-engine.js',
    'ms-human-worker.js', 'ms-human-assessment-protocol.js', 'diagnosis.js', 'report-v5.js', 'LICENSE',
    'THIRD_PARTY_NOTICES.md', 'waajacu_medical.png', 'vendor\MUJOCO_LICENSE.txt',
    'vendor\THREE_LICENSE.txt', 'models\ms_human_700\LICENSE',
    'models\ms_human_700\SOURCE.md'
)
foreach ($Relative in $RequiredFiles) {
    Assert-True (Test-Path -LiteralPath (Join-Path $PublicRoot $Relative) -PathType Leaf) "Required deploy file is missing: $Relative"
}
Assert-True (-not (Test-Path -LiteralPath (Join-Path $PublicRoot 'full-body.html'))) 'Retired full-body compatibility page remains in the deploy tree'
Assert-True (Test-Path -LiteralPath $ProtocolEvidencePath -PathType Leaf) 'MS-Human assessment protocol solver evidence is missing'
Assert-Hash (Join-Path $PublicRoot 'LICENSE') (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $ProjectRoot 'LICENSE')).Hash 'Public project license differs from the repository license'
Assert-Hash (Join-Path $PublicRoot 'THIRD_PARTY_NOTICES.md') (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $ProjectRoot 'THIRD_PARTY_NOTICES.md')).Hash 'Public third-party notices differ from the repository notices'
Assert-Hash (Join-Path $AssetRoot 'LICENSE') (Get-FileHash -Algorithm SHA256 -LiteralPath $LicensePath).Hash 'Public MS-Human license differs from the source-tree license'
Assert-Hash (Join-Path $AssetRoot 'SOURCE.md') (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $SourceRoot 'SOURCE.md')).Hash 'Public MS-Human source record differs from the repository record'

$Index = Get-Content -LiteralPath (Join-Path $PublicRoot 'index.html') -Raw
$Diagnosis = Get-Content -LiteralPath (Join-Path $PublicRoot 'diagnosis.js') -Raw
$Protocol = Get-Content -LiteralPath $ProtocolPath -Raw
$ProtocolEvidence = Get-Content -LiteralPath $ProtocolEvidencePath -Raw | ConvertFrom-Json
Assert-True $Index.Contains('src="./app-ms-human.js"') 'Root page does not load the relative MS-Human application entry point'
Assert-True (-not $Index.Contains('src="/app-ms-human.js"')) 'Root page unexpectedly requires origin-root hosting'
Assert-True (-not $Index.Contains('mode-benchmark')) 'Legacy movement mode remains in the root interface'
Assert-True (-not $Index.Contains('Reach8')) 'Legacy Reach8 content remains in the root interface'
Assert-True (-not $Index.Contains('MoBL-ARMS')) 'Legacy model disclosure remains in the root interface'
Assert-True $Index.Contains('activation colors appear only') 'Root static quality disclosure is missing'
Assert-True $Index.Contains('right-arm calculation') 'Mirror calculation-side disclosure is missing'
Assert-True $Index.Contains('15 positions') 'Current assessment position count is missing from the interface'
Assert-True $Diagnosis.Contains("from './ms-human-assessment-protocol.js'") 'Diagnosis does not import the current relative MS-Human assessment protocol'
Assert-True (-not $Diagnosis.Contains('MODERATE_CAPACITY_POSITIONS')) 'Retired assessment posture panel remains in active diagnosis code'
Assert-True (-not $Diagnosis.Contains('DIAGNOSIS_TESTS')) 'Dormant standard-test workflow remains in active diagnosis code'
Assert-True (-not $Index.Contains('diagnosis-standard-only')) 'Dormant standard-test interface remains in the deploy tree'
Assert-True $Protocol.Contains("id: 'MSH700-RIGHT-ARM-PAIRED-CONTRAST-V1'") 'Unexpected MS-Human assessment protocol ID'
Assert-Equal $ProtocolEvidence.protocolId 'MSH700-RIGHT-ARM-PAIRED-CONTRAST-V1' 'Protocol evidence ID mismatch'
Assert-Equal $ProtocolEvidence.protocolVersion '1.0.0' 'Protocol evidence version mismatch'
Assert-Equal $ProtocolEvidence.summary.attempted 15 'Unexpected protocol posture count'
Assert-Equal $ProtocolEvidence.summary.passed 15 'Not every protocol posture passed the recorded solver gates'
Assert-Equal ($ProtocolEvidence.positions | Where-Object usable -eq $true).Count 15 'Protocol evidence contains an unusable posture'
Assert-Equal ($ProtocolEvidence.positions | ForEach-Object id | Sort-Object -Unique).Count 15 'Protocol posture IDs are not unique'
Assert-True ([double]$ProtocolEvidence.summary.maximumObservedResidualNm -le [double]$ProtocolEvidence.solverQualityLimits.maximumResidualNm) 'Protocol evidence exceeds the equilibrium-residual gate'
Assert-True ([double]$ProtocolEvidence.summary.maximumObservedReserveNm -le [double]$ProtocolEvidence.solverQualityLimits.maximumReserveNm) 'Protocol evidence exceeds the reserve-torque gate'

$BaseUrl = "http://localhost:$Port"
$Routes = @(
    @{ Path = '/'; Type = 'text/html' },
    @{ Path = '/app-ms-human.js'; Type = 'text/javascript' },
    @{ Path = '/ms-human-engine.js'; Type = 'text/javascript' },
    @{ Path = '/ms-human-worker.js'; Type = 'text/javascript' },
    @{ Path = '/ms-human-assessment-protocol.js'; Type = 'text/javascript' },
    @{ Path = '/models/ms_human_700/right-arm.json'; Type = 'application/json' },
    @{ Path = '/models/ms_human_700/right-arm.meshbin'; Type = 'application/octet-stream' },
    @{ Path = '/models/ms_human_700/right-arm-runtime.mjb'; Type = 'application/octet-stream' },
    @{ Path = '/vendor/mujoco.js'; Type = 'text/javascript' },
    @{ Path = '/vendor/mujoco.wasm'; Type = 'application/wasm' },
    @{ Path = '/vendor/MUJOCO_LICENSE.txt'; Type = 'text/plain' },
    @{ Path = '/vendor/THREE_LICENSE.txt'; Type = 'text/plain' },
    @{ Path = '/models/ms_human_700/LICENSE'; Type = 'application/octet-stream' }
)
foreach ($Route in $Routes) {
    $Response = Invoke-WebRequest -UseBasicParsing -Uri ($BaseUrl + $Route.Path) -TimeoutSec 60
    Assert-Equal $Response.StatusCode 200 "Route failed: $($Route.Path)"
    Assert-True $Response.Headers['Content-Type'].StartsWith($Route.Type) "Unexpected content type for $($Route.Path): $($Response.Headers['Content-Type'])"
}

$RootResponse = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/" -TimeoutSec 30
$Csp = $RootResponse.Headers['Content-Security-Policy']
Assert-True $Csp.Contains("'unsafe-eval'") 'Root CSP does not permit the pinned Emscripten runtime'
Assert-True $Csp.Contains("'wasm-unsafe-eval'") 'Root CSP does not permit WebAssembly compilation'
Assert-True $Csp.Contains("worker-src 'self'") 'Root CSP does not permit the local model worker'

$LegacyApiAvailable = $false
try {
    Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/api/health" -TimeoutSec 10 | Out-Null
    $LegacyApiAvailable = $true
} catch {
    if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
}
Assert-True (-not $LegacyApiAvailable) 'Legacy server-computation API is still available'

$RetiredRoutes = @(
    '/full-body.html',
    '/app.js',
    '/movement-reference.js',
    '/models/mobl_arms/Geometry/humerus.vtp'
)
foreach ($Route in $RetiredRoutes) {
    $Available = $false
    try {
        Invoke-WebRequest -UseBasicParsing -Uri ($BaseUrl + $Route) -TimeoutSec 10 | Out-Null
        $Available = $true
    } catch {
        if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
    }
    Assert-True (-not $Available) "Retired route is still available: $Route"
}

[pscustomobject]@{
    Status = 'ok'
    Model = $Metadata.model.name
    SourceFiles = $SourceFiles.Count
    SourceTreeSha256 = $SourceTreeHash
    FunctionalMuscles = $Metadata.model.functionalMuscles
    Coordinates = $Metadata.coordinates.Count
    ArmGeometries = ($Metadata.geometry.geoms | Where-Object role -eq 'arm').Count
    ContextGeometries = ($Metadata.geometry.geoms | Where-Object role -eq 'context').Count
    Vertices = $VertexCount
    Triangles = $IndexCount / 3
    MuJoCo = $Metadata.source.mujocoVersion
    Url = "$BaseUrl/"
} | ConvertTo-Json
