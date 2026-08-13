param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8080
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceRoot = Join-Path $ProjectRoot 'models\ms_human_700'
$PreviewRoot = Join-Path $ProjectRoot 'public\models\ms_human_700'
$ModelPath = Join-Path $SourceRoot 'MS-Human-700.xml'
$LicensePath = Join-Path $SourceRoot 'LICENSE'
$MetadataPath = Join-Path $PreviewRoot 'default-pose.json'
$GeometryPath = Join-Path $PreviewRoot 'default-pose.meshbin'
$ArmMetadataPath = Join-Path $PreviewRoot 'right-arm.json'
$ArmGeometryPath = Join-Path $PreviewRoot 'right-arm.meshbin'
$ArmRuntimePath = Join-Path $PreviewRoot 'right-arm-runtime.mjb'
$MujocoJsPath = Join-Path $ProjectRoot 'public\vendor\mujoco.js'
$MujocoWasmPath = Join-Path $ProjectRoot 'public\vendor\mujoco.wasm'
$MujocoLicensePath = Join-Path $ProjectRoot 'public\vendor\MUJOCO_LICENSE.txt'
$ExpectedSourceTreeHash = '38815FED122D1BEB61155F0AFD85E72A52093111FCAE183BBB273F2483291971'
$ExpectedMetadataHash = '0871CFC4B32ACFD3C701DCF21013DF33D27316C075AE8DDE13610C799E234FA2'
$ExpectedGeometryHash = 'CC3A85DD8002ED5A19DD98FAEEF613AC153340A755CBBC0D3233DFEC45307A3C'
$ExpectedArmMetadataHash = '998E3E4F0A5DA1A1FF48D4994D5A40EAE586104C6D4F71163C8F2B03B94B2E4A'
$ExpectedArmGeometryHash = 'A5DBA6568C86165AB3AAF795D443F81F7713489B300C590BFD898503AAB99F44'
$ExpectedArmRuntimeHash = '13D2B0BED35DB2B07F3B8076931ABEF4EC4E149CA8D89F326BDE22B84F821AD3'

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -ne $Expected) {
        throw "$Message (expected '$Expected', found '$Actual')"
    }
}

Assert-Equal `
    (Get-FileHash -Algorithm SHA256 -LiteralPath $ModelPath).Hash `
    'D524F32FB22D18773674E5E5768B3272347A77F82CB507DAC19589D59D016CC5' `
    'MS-Human-700 source model checksum mismatch'
Assert-Equal `
    (Get-FileHash -Algorithm SHA256 -LiteralPath $LicensePath).Hash `
    '1EB85FC97224598DAD1852B5D6483BBCF0AA8608790DCC657A5A2A761AE9C8C6' `
    'MS-Human-700 license checksum mismatch'

# Hash the complete vendored upstream subtree, not only the entry-point XML.
# SOURCE.md is our local provenance note and is deliberately excluded.
$SourceHasher = [System.Security.Cryptography.IncrementalHash]::CreateHash(
    [System.Security.Cryptography.HashAlgorithmName]::SHA256
)
[string[]]$SourceFiles = Get-ChildItem -LiteralPath $SourceRoot -Recurse -File |
    Where-Object { $_.Name -ne 'SOURCE.md' } |
    ForEach-Object { $_.FullName.Substring($SourceRoot.Length + 1).Replace('\', '/') }
[System.Array]::Sort($SourceFiles, [System.StringComparer]::Ordinal)
foreach ($RelativePath in $SourceFiles) {
    $SourceHasher.AppendData([System.Text.Encoding]::UTF8.GetBytes($RelativePath + [char]0))
    $AbsolutePath = Join-Path $SourceRoot $RelativePath.Replace('/', '\')
    $SourceHasher.AppendData([System.IO.File]::ReadAllBytes($AbsolutePath))
    $SourceHasher.AppendData([byte[]]@(0))
}
$SourceTreeHash = ([System.BitConverter]::ToString($SourceHasher.GetHashAndReset())).Replace('-', '')
Assert-Equal $SourceFiles.Count 251 'Unexpected MS-Human-700 source file count'
Assert-Equal $SourceTreeHash $ExpectedSourceTreeHash 'MS-Human-700 source-tree checksum mismatch'
Assert-Equal `
    (Get-FileHash -Algorithm SHA256 -LiteralPath $MetadataPath).Hash `
    $ExpectedMetadataHash `
    'Generated metadata checksum mismatch; regenerate and consciously update this verifier'
Assert-Equal `
    (Get-FileHash -Algorithm SHA256 -LiteralPath $GeometryPath).Hash `
    $ExpectedGeometryHash `
    'Generated geometry checksum mismatch; regenerate and consciously update this verifier'
Assert-Equal `
    (Get-FileHash -Algorithm SHA256 -LiteralPath $ArmMetadataPath).Hash `
    $ExpectedArmMetadataHash `
    'Right-arm metadata checksum mismatch; regenerate and consciously update this verifier'
Assert-Equal `
    (Get-FileHash -Algorithm SHA256 -LiteralPath $ArmGeometryPath).Hash `
    $ExpectedArmGeometryHash `
    'Right-arm geometry checksum mismatch; regenerate and consciously update this verifier'
Assert-Equal `
    (Get-FileHash -Algorithm SHA256 -LiteralPath $ArmRuntimePath).Hash `
    $ExpectedArmRuntimeHash `
    'Right-arm MuJoCo runtime-model checksum mismatch'
Assert-Equal `
    (Get-FileHash -Algorithm SHA256 -LiteralPath $MujocoJsPath).Hash `
    '45E8E0E1617C19FBF7F00B36A6A72D1C0C980C0A4F38523E04F0641E8FBAB7B9' `
    'Pinned MuJoCo JavaScript checksum mismatch'
Assert-Equal `
    (Get-FileHash -Algorithm SHA256 -LiteralPath $MujocoWasmPath).Hash `
    '832597AE0A0E306C97ED43D2A9BBCA033CF3E547ECED410FB9011D87A68D4207' `
    'Pinned MuJoCo WebAssembly checksum mismatch'
Assert-Equal `
    (Get-FileHash -Algorithm SHA256 -LiteralPath $MujocoLicensePath).Hash `
    'CFC7749B96F63BD31C3C42B5C471BF756814053E847C10F3EB003417BC523D30' `
    'Pinned MuJoCo license checksum mismatch'

$Metadata = Get-Content -LiteralPath $MetadataPath -Raw | ConvertFrom-Json
Assert-Equal $Metadata.schemaVersion 2 'Unexpected preview schema version'
Assert-Equal $Metadata.model.muscles 700 'Unexpected muscle count'
Assert-Equal $Metadata.model.tendons 700 'Unexpected tendon count'
Assert-Equal $Metadata.model.joints 85 'Unexpected joint count'
Assert-Equal $Metadata.model.degreesOfFreedom 85 'Unexpected degree-of-freedom count'
Assert-Equal $Metadata.model.bodies 81 'Unexpected body count'
Assert-Equal $Metadata.paths.points 2948 'Unexpected compiled path-point count'
Assert-Equal $Metadata.paths.segments 2248 'Unexpected compiled path-segment count'
Assert-Equal $Metadata.paths.nativeVisualizerSegments 2248 'Native visualizer segment count mismatch'
Assert-Equal $Metadata.paths.wrapPoints 372 'Unexpected wrapping-point count'
Assert-Equal $Metadata.source.license 'Apache-2.0' 'Unexpected model license metadata'
Assert-Equal $Metadata.source.sourceTreeSha256 ($ExpectedSourceTreeHash.ToLowerInvariant()) 'Source-tree metadata mismatch'
Assert-Equal $Metadata.source.sourceFileCount 251 'Source file-count metadata mismatch'
Assert-Equal $Metadata.source.localCorrections.Count 2 'Local correction metadata mismatch'
Assert-Equal $Metadata.muscles.Count 700 'Unexpected exported muscle inventory'

$CorrectedTorsoPath = $Metadata.muscles | Where-Object { $_.name -eq 'LTpT_T12_l' }
$CorrectedArmPath = $Metadata.muscles | Where-Object { $_.name -eq 'EDCL_l' }
Assert-Equal $CorrectedTorsoPath.points.Count 5 'Corrected LTpT_T12_l point count mismatch'
$ExpectedTorsoLateral = @(-0.034986, -0.050766, -0.035279, -0.025671, -0.010198)
for ($Index = 0; $Index -lt $ExpectedTorsoLateral.Count; $Index++) {
    if ([math]::Abs([double]$CorrectedTorsoPath.points[$Index][2] - $ExpectedTorsoLateral[$Index]) -gt 0.0000001) {
        throw "LTpT_T12_l bilateral correction mismatch at point $Index"
    }
}
if ([math]::Abs([double]$CorrectedArmPath.points[0][2] - -0.1891697) -gt 0.0000001) {
    throw 'EDCL_l-P1 bilateral correction mismatch'
}

$CheckedPoints = 0
$CheckedSegments = 0
$CheckedZeroLengthSegments = 0
foreach ($Muscle in $Metadata.muscles) {
    $Points = @($Muscle.points)
    $Kinds = @($Muscle.pointKinds)
    $Segments = @($Muscle.segments)
    $InsideWrap = @($Muscle.segmentInsideWrap)
    if ($Points.Count -lt 2) {
        throw "Muscle path has fewer than two points: $($Muscle.name)"
    }
    Assert-Equal $Kinds.Count $Points.Count "Point-kind count mismatch: $($Muscle.name)"
    Assert-Equal $Segments.Count ($Points.Count - 1) "Path continuity mismatch: $($Muscle.name)"
    Assert-Equal $InsideWrap.Count $Segments.Count "Segment wrap-state mismatch: $($Muscle.name)"

    for ($Index = 0; $Index -lt $Segments.Count; $Index++) {
        $Segment = @($Segments[$Index])
        $Start = @($Points[$Index])
        $End = @($Points[$Index + 1])
        Assert-Equal $Segment.Count 6 "Malformed segment: $($Muscle.name)"
        for ($Axis = 0; $Axis -lt 3; $Axis++) {
            if ([math]::Abs([double]$Segment[$Axis] - [double]$Start[$Axis]) -gt 0.0000001 -or
                    [math]::Abs([double]$Segment[$Axis + 3] - [double]$End[$Axis]) -gt 0.0000001) {
                throw "Segment does not join consecutive points: $($Muscle.name), segment $Index"
            }
        }
        $LengthSquared = 0.0
        for ($Axis = 0; $Axis -lt 3; $Axis++) {
            $Delta = [double]$End[$Axis] - [double]$Start[$Axis]
            $LengthSquared += $Delta * $Delta
        }
        if ($LengthSquared -lt 0.00000000000001) { $CheckedZeroLengthSegments++ }
    }
    $CheckedPoints += $Points.Count
    $CheckedSegments += $Segments.Count
}
Assert-Equal $CheckedPoints $Metadata.paths.points 'Compiled point total mismatch'
Assert-Equal $CheckedSegments $Metadata.paths.segments 'Compiled segment total mismatch'
Assert-Equal $CheckedZeroLengthSegments 12 'Unexpected duplicate compiled point/zero-length segment count'

$Geometry = [System.IO.File]::ReadAllBytes($GeometryPath)
Assert-Equal ([System.Text.Encoding]::ASCII.GetString($Geometry, 0, 8)) 'MSH700B1' 'Unexpected geometry format'
$VertexCount = [BitConverter]::ToUInt32($Geometry, 8)
$IndexCount = [BitConverter]::ToUInt32($Geometry, 12)
$ExpectedBytes = 16 + (24 * [int64]$VertexCount) + (4 * [int64]$IndexCount)
Assert-Equal $Geometry.Length $ExpectedBytes 'Geometry byte length does not match its header'
Assert-Equal $VertexCount $Metadata.geometry.vertices 'Geometry vertex count mismatch'
Assert-Equal ($IndexCount / 3) $Metadata.geometry.triangles 'Geometry triangle count mismatch'

$ArmMetadata = Get-Content -LiteralPath $ArmMetadataPath -Raw | ConvertFrom-Json
Assert-Equal $ArmMetadata.schemaVersion 1 'Unexpected right-arm schema version'
Assert-Equal $ArmMetadata.model.totalMuscles 700 'Unexpected right-arm runtime muscle count'
Assert-Equal $ArmMetadata.model.functionalMuscles 88 'Unexpected right-arm functional muscle count'
Assert-Equal $ArmMetadata.model.armBodies 11 'Unexpected right-arm body count'
Assert-Equal $ArmMetadata.model.independentCoordinates 7 'Unexpected right-arm control count'
Assert-Equal $ArmMetadata.coordinates.Count 7 'Unexpected right-arm coordinate inventory'
Assert-Equal $ArmMetadata.muscles.Count 88 'Unexpected right-arm muscle inventory'
Assert-Equal ($ArmMetadata.muscles | Where-Object { $_.group -eq 'Arm' }).Count 47 'Unexpected local arm muscle count'
Assert-Equal ($ArmMetadata.muscles | Where-Object { $_.group -eq 'Shoulder stabilizer' }).Count 27 'Unexpected shoulder stabilizer count'
Assert-Equal ($ArmMetadata.muscles | Where-Object { $_.group -eq 'Long torso origin' }).Count 14 'Unexpected long-origin latissimus count'
Assert-Equal ($ArmMetadata.geometry.geoms | Where-Object { $_.role -eq 'arm' }).Count 32 'Unexpected articulated arm mesh count'
Assert-Equal ($ArmMetadata.geometry.geoms | Where-Object { $_.role -eq 'context' }).Count 32 'Unexpected context mesh count'
Assert-Equal $ArmMetadata.geometry.vertices 51642 'Unexpected right-arm vertex count'
Assert-Equal $ArmMetadata.geometry.triangles 103536 'Unexpected right-arm triangle count'
Assert-Equal $ArmMetadata.source.sourceTreeSha256 ($ExpectedSourceTreeHash.ToLowerInvariant()) 'Right-arm source-tree metadata mismatch'
Assert-Equal $ArmMetadata.source.mujocoVersion '3.10.0' 'Unexpected right-arm MuJoCo version'
Assert-Equal $ArmMetadata.source.modelLicense 'Apache-2.0' 'Unexpected right-arm model license'
Assert-Equal $ArmMetadata.source.runtimeLicense 'Apache-2.0' 'Unexpected right-arm runtime license'
Assert-Equal $ArmMetadata.validation.maximumDefaultTendonLengthErrorM 0 'Runtime tendon parity check failed'
Assert-Equal $ArmMetadata.validation.maximumDefaultBiasForceError 0 'Runtime bias-force parity check failed'
Assert-Equal $ArmMetadata.validation.maximumDefaultPassiveForceError 0 'Runtime passive-force parity check failed'

$ExpectedCoordinates = @(
    'elv_angle_r', 'shoulder_elv_r', 'shoulder_rot_r', 'elbow_flexion_r',
    'pro_sup_r', 'deviation_r', 'flexion_r'
)
for ($Index = 0; $Index -lt $ExpectedCoordinates.Count; $Index++) {
    Assert-Equal $ArmMetadata.coordinates[$Index].name $ExpectedCoordinates[$Index] "Right-arm coordinate order mismatch at $Index"
}

$ArmGeometry = [System.IO.File]::ReadAllBytes($ArmGeometryPath)
Assert-Equal ([System.Text.Encoding]::ASCII.GetString($ArmGeometry, 0, 8)) 'MSHARM01' 'Unexpected right-arm geometry format'
$ArmVertexCount = [BitConverter]::ToUInt32($ArmGeometry, 8)
$ArmIndexCount = [BitConverter]::ToUInt32($ArmGeometry, 12)
$ExpectedArmBytes = 16 + (12 * [int64]$ArmVertexCount) + (4 * [int64]$ArmIndexCount)
Assert-Equal $ArmGeometry.Length $ExpectedArmBytes 'Right-arm geometry byte length does not match its header'
Assert-Equal $ArmVertexCount $ArmMetadata.geometry.vertices 'Right-arm geometry vertex count mismatch'
Assert-Equal ($ArmIndexCount / 3) $ArmMetadata.geometry.triangles 'Right-arm geometry triangle count mismatch'

$ExpectedVertexStart = 0
$ExpectedIndexStart = 0
foreach ($Geom in $ArmMetadata.geometry.geoms) {
    Assert-Equal $Geom.vertexStart $ExpectedVertexStart "Non-contiguous right-arm vertex range: $($Geom.name)"
    Assert-Equal $Geom.indexStart $ExpectedIndexStart "Non-contiguous right-arm index range: $($Geom.name)"
    $ExpectedVertexStart += $Geom.vertexCount
    $ExpectedIndexStart += $Geom.indexCount
}
Assert-Equal $ExpectedVertexStart $ArmVertexCount 'Right-arm geom vertex ranges do not cover the asset'
Assert-Equal $ExpectedIndexStart $ArmIndexCount 'Right-arm geom index ranges do not cover the asset'

$BaseUrl = "http://localhost:$Port"
$Routes = @(
    @{ Path = '/full-body.html'; Type = 'text/html' },
    @{ Path = '/full-body.js'; Type = 'text/javascript' },
    @{ Path = '/full-body.css'; Type = 'text/css' },
    @{ Path = '/models/ms_human_700/default-pose.json'; Type = 'application/json' },
    @{ Path = '/models/ms_human_700/default-pose.meshbin'; Type = 'application/octet-stream' },
    @{ Path = '/models/ms_human_700/right-arm.json'; Type = 'application/json' },
    @{ Path = '/models/ms_human_700/right-arm.meshbin'; Type = 'application/octet-stream' },
    @{ Path = '/models/ms_human_700/right-arm-runtime.mjb'; Type = 'application/octet-stream' },
    @{ Path = '/vendor/mujoco.js'; Type = 'text/javascript' },
    @{ Path = '/vendor/mujoco.wasm'; Type = 'application/wasm' },
    @{ Path = '/vendor/MUJOCO_LICENSE.txt'; Type = 'text/plain' },
    @{ Path = '/models/ms_human_700/LICENSE'; Type = 'text/plain' }
)
foreach ($Route in $Routes) {
    $Response = Invoke-WebRequest -UseBasicParsing -Uri ($BaseUrl + $Route.Path) -TimeoutSec 30
    Assert-Equal $Response.StatusCode 200 "Route failed: $($Route.Path)"
    if (-not $Response.Headers['Content-Type'].StartsWith($Route.Type)) {
        throw "Unexpected content type for $($Route.Path): $($Response.Headers['Content-Type'])"
    }
}

$PrototypeResponse = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/full-body.html" -TimeoutSec 30
if (-not $PrototypeResponse.Content.Contains('Research prototype &middot; Not a medical device') -or
        -not $PrototypeResponse.Content.Contains('gravity-only static estimates') -or
        -not $PrototypeResponse.Content.Contains('colors are shown only when all values are finite')) {
    throw 'Right-arm prototype is missing required use and solver disclosures'
}
$PrototypeCsp = $PrototypeResponse.Headers['Content-Security-Policy']
if (-not $PrototypeCsp.Contains("'unsafe-eval'") -or -not $PrototypeCsp.Contains("'wasm-unsafe-eval'")) {
    throw 'Right-arm page CSP does not permit the pinned Emscripten runtime'
}
$RootResponse = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/" -TimeoutSec 30
if ($RootResponse.Headers['Content-Security-Policy'].Contains("'unsafe-eval'")) {
    throw 'MuJoCo CSP exception leaked onto the established upper-limb application'
}

[pscustomobject]@{
    Status = 'ok'
    Model = $Metadata.model.name
    Bodies = $Metadata.model.bodies
    Joints = $Metadata.model.joints
    Muscles = $Metadata.model.muscles
    PathPoints = $Metadata.paths.points
    PathSegments = $Metadata.paths.segments
    WrapPoints = $Metadata.paths.wrapPoints
    SourceFiles = $SourceFiles.Count
    SourceTreeSha256 = $SourceTreeHash
    Vertices = $VertexCount
    Triangles = $IndexCount / 3
    RightArmMuscles = $ArmMetadata.model.functionalMuscles
    RightArmGeoms = ($ArmMetadata.geometry.geoms | Where-Object { $_.role -eq 'arm' }).Count
    RightArmTriangles = $ArmIndexCount / 3
    MuJoCo = $ArmMetadata.source.mujocoVersion
    License = $Metadata.source.license
    Url = "$BaseUrl/full-body.html"
} | ConvertTo-Json
