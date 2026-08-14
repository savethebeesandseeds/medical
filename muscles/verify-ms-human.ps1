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

function Get-StringSha256 {
    param([string]$Value)
    $Sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString(
            $Sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Value))
        )).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $Sha256.Dispose()
    }
}

$ModelPath = Join-Path $SourceRoot 'MS-Human-700.xml'
$LicensePath = Join-Path $SourceRoot 'LICENSE'
$MetadataPath = Join-Path $AssetRoot 'right-arm.json'
$RegionsPath = Join-Path $AssetRoot 'body-regions.json'
$GeometryPath = Join-Path $AssetRoot 'right-arm.meshbin'
$RuntimePath = Join-Path $AssetRoot 'right-arm-runtime.mjb'
$HandMetadataPath = Join-Path $AssetRoot 'right-hand.json'
$HandRegionsPath = Join-Path $AssetRoot 'hand-region.json'
$HandGeometryPath = Join-Path $AssetRoot 'right-hand.meshbin'
$HandRuntimePath = Join-Path $AssetRoot 'right-hand-runtime.mjb'
$MujocoJsPath = Join-Path $PublicRoot 'vendor\mujoco.js'
$MujocoWasmPath = Join-Path $PublicRoot 'vendor\mujoco.wasm'
$ThreeModulePath = Join-Path $PublicRoot 'vendor\three.module.min.js'
$ThreeCorePath = Join-Path $PublicRoot 'vendor\three.core.min.js'
$ThreeLicensePath = Join-Path $PublicRoot 'vendor\THREE_LICENSE.txt'
$MujocoLicensePath = Join-Path $PublicRoot 'vendor\MUJOCO_LICENSE.txt'
$ProtocolPath = Join-Path $PublicRoot 'ms-human-assessment-protocol.js'
$ProtocolEvidencePath = Join-Path $ProjectRoot 'tools\ms-human-assessment-protocol-solver-evidence.json'
$RegionEvidencePath = Join-Path $ProjectRoot 'tools\ms-human-region-evidence.json'

Assert-Hash $ModelPath 'D524F32FB22D18773674E5E5768B3272347A77F82CB507DAC19589D59D016CC5' 'MS-Human source model checksum mismatch'
Assert-Hash $LicensePath '1EB85FC97224598DAD1852B5D6483BBCF0AA8608790DCC657A5A2A761AE9C8C6' 'MS-Human license checksum mismatch'
Assert-Hash $RegionsPath '485E389AEBE640687974A719ED7ADF176C637617AFC0800387B4FA5860C0DA4E' 'Body-region manifest checksum mismatch'
Assert-Hash $MetadataPath '4278FFE5171328047DD240711386AC2EA84BA7BCC54E1740DF359F263956414E' 'Right-arm metadata checksum mismatch'
Assert-Hash $GeometryPath '5CBDF2AEBD44DA09DBD9B546CCA35ABC7B3B2F64E927F879C0D03595E087F68C' 'Complete-body context geometry checksum mismatch'
Assert-Hash $RuntimePath '13D2B0BED35DB2B07F3B8076931ABEF4EC4E149CA8D89F326BDE22B84F821AD3' 'Right-arm runtime checksum mismatch'
Assert-Hash $HandMetadataPath 'E6D169BDC2EDEED3E846D7CCBE03D7EF68968FB2F715C61F4B892BFA85307A46' 'Right-hand metadata checksum mismatch'
Assert-Hash $HandRegionsPath 'F6406C25BBB82593C96A639EFA020BEA758ABAE77D385F00AB6D16E7C6CE8005' 'Right-hand manifest checksum mismatch'
Assert-Hash $HandGeometryPath '5054F8FF61CA45DB638BD36729F1ED71100FD889C58A60D219C673A3162F03EA' 'Right-hand geometry checksum mismatch'
Assert-Hash $HandRuntimePath '40B75B5583AEB5F20CBDA668C4B7E035109DAB97175CE30B368551A204E98E1D' 'Right-hand runtime checksum mismatch'
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
$Regions = Get-Content -LiteralPath $RegionsPath -Raw | ConvertFrom-Json
$HandMetadata = Get-Content -LiteralPath $HandMetadataPath -Raw | ConvertFrom-Json
$HandRegions = Get-Content -LiteralPath $HandRegionsPath -Raw | ConvertFrom-Json

Assert-Equal $Regions.schemaVersion 1 'Unexpected body-region schema version'
Assert-Equal $Regions.manifestId 'MS_HUMAN_700_REGION_MANIFEST_V1' 'Unexpected body-region manifest ID'
Assert-Equal $Regions.defaultRegionId 'right-upper-limb' 'Unexpected default Explorer region'
Assert-True ($null -eq $Regions.generatedAt) 'Region manifest must remain deterministic and omit a generation timestamp'
Assert-Equal $Regions.sourceTreeSha256 $ExpectedSourceTreeHash.ToLowerInvariant() 'Region manifest source hash mismatch'
Assert-Equal $Regions.contractDigestSha256 '87f76588a6af99211537f4c2658a7a4cfd0e7eb7e68d6fd0acc1cafee2cd3e0e' 'Region contract digest changed'
Assert-Equal $Regions.contentDigestSha256 'caba1fc651c2eef253f04c008e2b27ea13eee17eff9d931c2c158b6816c9860d' 'Canonical region-manifest content digest changed'
Assert-Equal $HandRegions.contentDigestSha256 '3c2929b7c385dca29f8b3ae21d9834b482c2ad5bccaa303d6692111950fd39c4' 'Canonical hand-manifest content digest changed'
Assert-Equal $Regions.model.runtime.sha256 '13d2b0bed35db2b07f3b8076931abef4ec4e149ca8d89f326bde22b84f821ad3' 'Region manifest runtime pin changed'
Assert-Equal $Regions.model.geometry.sha256 '5cbdf2aebd44da09dbd9b546cca35abc7b3b2f64e927f879c0d03595e087f68c' 'Region manifest geometry pin changed'

$UpperPresetIds = 'arm-side,forward-reach,hand-to-mouth,cross-body-reach,hand-behind-head,high-forward-reach,flexion-90,abduction-90,scaption-90,external-side,internal-side,rotation-90-90,scaption-ir,elbow-90,elbow-120,elbow-supinated,forearm-pronated,wrist-extension-30,wrist-flexion-30,wrist-deviation-positive,wrist-deviation-negative'
$LowerPresetIds = 'neutral,early-flexion,deep-flexion,extended-reference,hip-flexion-45,hip-extension-15,hip-abduction-20,hip-adduction-20,hip-rotation-negative,hip-rotation-positive,knee-45,knee-90,ankle-negative-20,ankle-positive-20,subtalar-negative-10,subtalar-positive-10,mtp-positive-20'
$ExpectedRegions = @(
    [pscustomobject]@{
        Id = 'right-upper-limb'; Coordinates = 'elv_angle_r,shoulder_elv_r,shoulder_rot_r,elbow_flexion_r,pro_sup_r,deviation_r,flexion_r'
        BodyIds = '35,36,37,38,39,40,41,42,43,44,45'; CoordinateCount = 7; BodyCount = 11; MuscleCount = 88; PresetCount = 21
        MuscleIdentitySha256 = '4862642cfb37a93711d69ef0a4f883d489910144c3b00af24b1ed8ec2b6c2cd3'; PresetIds = $UpperPresetIds
        ContractDigest = 'f247de85853073e381a7aa95a80ecc5fe0cf7c2c71af8f7ec873265bd8a47e16'
    },
    [pscustomobject]@{
        Id = 'left-upper-limb'; Coordinates = 'elv_angle_l,shoulder_elv_l,shoulder_rot_l,elbow_flexion_l,pro_sup_l,deviation_l,flexion_l'
        BodyIds = '46,47,48,49,50,51,52,53,54,55,56'; CoordinateCount = 7; BodyCount = 11; MuscleCount = 88; PresetCount = 21
        MuscleIdentitySha256 = 'c71195d7fc40537f7dfc8fa9fdde593762589d45e16365520a488a8861e0f0b9'; PresetIds = $UpperPresetIds
        ContractDigest = 'bc2f98dcb73c91fb715e8acdb4e2277d39c6d37c315dcfc3b7d62b2afeec5561'
    },
    [pscustomobject]@{
        Id = 'right-lower-limb'; Coordinates = 'hip_flexion_r,hip_adduction_r,hip_rotation_r,knee_angle_r,ankle_angle_r,subtalar_angle_r,mtp_angle_r'
        BodyIds = '2,3,4,5,6,7'; CoordinateCount = 7; BodyCount = 6; MuscleCount = 50; PresetCount = 17
        MuscleIdentitySha256 = '146aafa35b350611ebf7bf1af939e378391c909960c14c0517c5d64bb23cf169'; PresetIds = $LowerPresetIds
        ContractDigest = '981b27620b0f097f8976f6ffb37204a137353f41a6a103b9199a698a6835613b'
    },
    [pscustomobject]@{
        Id = 'left-lower-limb'; Coordinates = 'hip_flexion_l,hip_adduction_l,hip_rotation_l,knee_angle_l,ankle_angle_l,subtalar_angle_l,mtp_angle_l'
        BodyIds = '8,9,10,11,12,13'; CoordinateCount = 7; BodyCount = 6; MuscleCount = 50; PresetCount = 17
        MuscleIdentitySha256 = 'a0b250aaab4278f5d88ad77f30dec6bee675c431d0f99c87232cf3464ca1ab99'; PresetIds = $LowerPresetIds
        ContractDigest = 'a8aa2381f220adf70897778f9f9b3d30d30eb49b8b018f48943df8ee6a6b3bbb'
    },
    [pscustomobject]@{
        Id = 'trunk'; Coordinates = 'L5_S1_FE,L5_S1_LB,L5_S1_AR,T12_L1_FE,T12_L1_LB,T12_L1_AR'
        BodyIds = '1,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,34,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80'
        CoordinateCount = 6; BodyCount = 45; MuscleCount = 222; PresetCount = 19
        MuscleIdentitySha256 = '654c7d2d78dd01a367b8da227a329beca952a59fa9f1cd5e942902a184649c8c'
        PresetIds = 'neutral,combined-flexion,combined-extension,combined-side-positive,combined-side-negative,combined-rotation-positive,combined-rotation-negative,lower-flexion,lower-extension,lower-side-positive,lower-side-negative,lower-rotation-positive,lower-rotation-negative,upper-flexion,upper-extension,upper-side-positive,upper-side-negative,upper-rotation-positive,upper-rotation-negative'
        ContractDigest = '0308c56ad974270fa34f2b3b42bfd714b8878e4363a587af60c1a5aab4c63114'
    },
    [pscustomobject]@{
        Id = 'head-neck'; Coordinates = 'T1_head_neck_FE,T1_head_neck_LB,T1_head_neck_AR'; BodyIds = '33'
        CoordinateCount = 3; BodyCount = 1; MuscleCount = 54; PresetCount = 7
        MuscleIdentitySha256 = 'e4ba97abc541c6259aace971f26df8382c5aadbc7077fcbe09b41ebc0047dbda'
        PresetIds = 'neutral,flexion,extension,side-positive,side-negative,rotation-positive,rotation-negative'
        ContractDigest = '9af4680cc29c84968d9eb38f2034cdd04ee8737dea22ecfc93764fd1804d75b6'
    }
)

Assert-Equal $Regions.regions.Count $ExpectedRegions.Count 'Unexpected body-region count'
Assert-Equal ((@($Regions.regions | ForEach-Object id)) -join ',') ((@($ExpectedRegions | ForEach-Object Id)) -join ',') 'Body-region order or IDs changed'
foreach ($ExpectedRegion in $ExpectedRegions) {
    $Region = @($Regions.regions | Where-Object id -eq $ExpectedRegion.Id)
    Assert-Equal $Region.Count 1 "Region inventory is missing or duplicated: $($ExpectedRegion.Id)"
    $Region = $Region[0]
    $PresetIds = @($Region.presetGroups | ForEach-Object { $_.presets } | ForEach-Object { $_.id })
    $MuscleIdentity = @($Region.candidateMuscles | ForEach-Object {
        "$($_.actuatorId)|$($_.name)|$($_.tendonId)|$($_.tendon)"
    }) -join "`n"

    Assert-Equal $Region.contractDigestSha256 $ExpectedRegion.ContractDigest "Mechanical contract digest changed for $($ExpectedRegion.Id)"
    Assert-Equal $Region.coordinates.Count $ExpectedRegion.CoordinateCount "Coordinate count changed for $($ExpectedRegion.Id)"
    Assert-Equal ((@($Region.coordinates | ForEach-Object name)) -join ',') $ExpectedRegion.Coordinates "Coordinate inventory changed for $($ExpectedRegion.Id)"
    Assert-Equal $Region.activeBodyIds.Count $ExpectedRegion.BodyCount "Active-body count changed for $($ExpectedRegion.Id)"
    Assert-Equal ((@($Region.activeBodyIds)) -join ',') $ExpectedRegion.BodyIds "Active-body inventory changed for $($ExpectedRegion.Id)"
    Assert-Equal $Region.candidateMuscles.Count $ExpectedRegion.MuscleCount "Candidate-muscle count changed for $($ExpectedRegion.Id)"
    Assert-Equal (Get-StringSha256 $MuscleIdentity) $ExpectedRegion.MuscleIdentitySha256 "Candidate-muscle identity inventory changed for $($ExpectedRegion.Id)"
    Assert-Equal $PresetIds.Count $ExpectedRegion.PresetCount "Preset count changed for $($ExpectedRegion.Id)"
    Assert-Equal ($PresetIds -join ',') $ExpectedRegion.PresetIds "Preset inventory changed for $($ExpectedRegion.Id)"
    Assert-Equal (@($Region.coordinates.name | Sort-Object -Unique).Count) $Region.coordinates.Count "Duplicate coordinate in $($ExpectedRegion.Id)"
    Assert-Equal (@($Region.activeBodyIds | Sort-Object -Unique).Count) $Region.activeBodyIds.Count "Duplicate active body in $($ExpectedRegion.Id)"
    Assert-Equal (@($Region.candidateMuscles.actuatorId | Sort-Object -Unique).Count) $Region.candidateMuscles.Count "Duplicate candidate actuator in $($ExpectedRegion.Id)"
    Assert-Equal (@($PresetIds | Sort-Object -Unique).Count) $PresetIds.Count "Duplicate preset in $($ExpectedRegion.Id)"
}

$AssessmentRegions = @($Regions.regions | Where-Object { $_.assessment.supported -eq $true })
Assert-Equal $AssessmentRegions.Count 1 'Assessment must remain isolated to exactly one Explorer region'
Assert-Equal $AssessmentRegions[0].id 'right-upper-limb' 'Assessment is no longer isolated to the right upper limb'
Assert-Equal $AssessmentRegions[0].assessment.protocolId 'MSH700-RIGHT-ARM-PAIRED-CONTRAST-V1' 'Assessment region protocol changed'
foreach ($Region in @($Regions.regions | Where-Object id -ne 'right-upper-limb')) {
    Assert-True ($Region.assessment.supported -eq $false -and $null -eq $Region.assessment.protocolId) "Unsupported region unexpectedly declares an assessment protocol: $($Region.id)"
}
foreach ($Region in @($Regions.regions | Where-Object { $_.id -in @('right-lower-limb', 'left-lower-limb') })) {
    Assert-Equal $Region.semantics.contact 'none' "Lower-limb contact semantics changed for $($Region.id)"
    Assert-True $Region.semantics.supportDescription.Contains('no foot contact or ground-reaction model') "Lower-limb no-contact disclosure is missing for $($Region.id)"
    Assert-True $Region.semantics.supportDescription.Contains('not stance, gait, balance, or weight-bearing analysis') "Lower-limb interpretation boundary is missing for $($Region.id)"
}

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
Assert-Equal ($Metadata.geometry.geoms | Where-Object role -eq 'context').Count 100 'Unexpected complete-body context geometry count'
Assert-Equal $Metadata.geometry.geoms.Count 132 'Unexpected complete skeleton geometry count'
$RequiredContextBodies = @(
    'head_neck', 'pelvis',
    'clavicle_l', 'humerus_l', 'ulna_l', 'radius_l', 'hand_l',
    'femur_l', 'tibia_l', 'calcn_l', 'toes_l',
    'femur_r', 'tibia_r', 'calcn_r', 'toes_r'
)
foreach ($BodyName in $RequiredContextBodies) {
    Assert-True (@($Metadata.geometry.geoms | Where-Object { $_.role -eq 'context' -and $_.body -eq $BodyName }).Count -gt 0) "Complete-body context is missing $BodyName"
}
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

Assert-Equal $HandRegions.manifestId 'MS_HUMAN_700_HAND_REGION_MANIFEST_V1' 'Unexpected articulated-hand manifest ID'
Assert-Equal $HandRegions.defaultRegionId 'right-hand' 'Unexpected articulated-hand default region'
Assert-Equal $HandRegions.regions.Count 1 'Articulated-hand profile must expose exactly one calculated region'
$HandRegion = $HandRegions.regions[0]
Assert-Equal $HandRegion.id 'right-hand' 'Unexpected articulated-hand region ID'
Assert-Equal $HandRegion.calculationSide 'right' 'Detailed hand must remain a true right-hand calculation'
Assert-True ($HandRegion.assessment.supported -eq $false) 'Detailed hand must not inherit the upper-limb assessment protocol'
Assert-Equal $HandRegion.semantics.contact 'none' 'Detailed hand unexpectedly enables contact'
Assert-True $HandRegion.semantics.interpretationBoundary.Contains('not grip force') 'Detailed-hand grip-force boundary is missing'
Assert-Equal $HandMetadata.schemaVersion 1 'Unexpected right-hand schema version'
Assert-Equal $HandMetadata.model.totalMuscles 81 'Unexpected manipulation-model actuator count'
Assert-Equal $HandMetadata.model.functionalMuscles 44 'Unexpected hand muscle count'
Assert-Equal $HandMetadata.model.independentCoordinates 23 'Unexpected wrist/finger coordinate count'
Assert-Equal $HandMetadata.coordinates.Count 23 'Unexpected hand coordinate metadata count'
Assert-Equal $HandMetadata.muscles.Count 44 'Unexpected hand muscle metadata count'
Assert-Equal ($HandMetadata.muscles | Where-Object group -eq 'Wrist and digit mover').Count 24 'Unexpected extrinsic hand-mover count'
Assert-Equal ($HandMetadata.muscles | Where-Object group -eq 'Intrinsic hand').Count 20 'Unexpected intrinsic hand-muscle count'
Assert-Equal $HandRegion.activeBodyIds.Count 25 'Unexpected articulated hand-body count'
$HandPresetIds = @($HandRegion.presetGroups | ForEach-Object { $_.presets } | ForEach-Object { $_.id })
Assert-Equal $HandPresetIds.Count 8 'Unexpected hand-preset count'
Assert-Equal ($HandPresetIds -join ',') 'authored,open,relaxed-curl,loose-fist,spread,point,opposition,pinch' 'Hand-preset inventory changed'
Assert-Equal (@($HandMetadata.muscles.actuatorId | Sort-Object -Unique).Count) 44 'Hand actuator IDs are not unique'
Assert-Equal (@($HandMetadata.coordinates.name | Sort-Object -Unique).Count) 23 'Hand coordinates are not unique'

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

$HandGeometry = [System.IO.File]::ReadAllBytes($HandGeometryPath)
Assert-Equal ([System.Text.Encoding]::ASCII.GetString($HandGeometry, 0, 8)) 'MSHARM01' 'Unexpected articulated-hand geometry format'
$HandVertexCount = [BitConverter]::ToUInt32($HandGeometry, 8)
$HandIndexCount = [BitConverter]::ToUInt32($HandGeometry, 12)
Assert-Equal $HandGeometry.Length (16 + 12 * [int64]$HandVertexCount + 4 * [int64]$HandIndexCount) 'Articulated-hand geometry byte length mismatch'
Assert-Equal $HandVertexCount $HandMetadata.geometry.vertices 'Articulated-hand vertex count mismatch'
Assert-Equal ($HandIndexCount / 3) $HandMetadata.geometry.triangles 'Articulated-hand triangle count mismatch'
Assert-Equal $HandMetadata.geometry.geoms.Count 132 'Unexpected articulated-hand geometry descriptor count'

$RequiredFiles = @(
    'index.html', 'styles.css', 'bootstrap.js', 'i18n.js', 'locales\en.json', 'locales\es.json',
    'locales\de.json', 'locales\zh-Hans.json', 'app-ms-human.js', 'ms-human-engine.js',
    'ms-human-worker.js', 'ms-human-assessment-protocol.js', 'diagnosis.js', 'report-v5.js', 'LICENSE',
    'THIRD_PARTY_NOTICES.md', 'waajacu_medical.png', 'vendor\MUJOCO_LICENSE.txt',
    'vendor\THREE_LICENSE.txt', 'models\ms_human_700\LICENSE',
    'models\ms_human_700\SOURCE.md', 'models\ms_human_700\body-regions.json',
    'models\ms_human_700\hand-region.json', 'models\ms_human_700\right-hand.json',
    'models\ms_human_700\right-hand.meshbin', 'models\ms_human_700\right-hand-runtime.mjb'
)
foreach ($Relative in $RequiredFiles) {
    Assert-True (Test-Path -LiteralPath (Join-Path $PublicRoot $Relative) -PathType Leaf) "Required deploy file is missing: $Relative"
}
Assert-True (-not (Test-Path -LiteralPath (Join-Path $PublicRoot 'full-body.html'))) 'Retired full-body compatibility page remains in the deploy tree'
Assert-True (Test-Path -LiteralPath $ProtocolEvidencePath -PathType Leaf) 'MS-Human assessment protocol solver evidence is missing'
Assert-True (Test-Path -LiteralPath $RegionEvidencePath -PathType Leaf) 'MS-Human region-generation evidence is missing'
Assert-Hash (Join-Path $PublicRoot 'LICENSE') (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $ProjectRoot 'LICENSE')).Hash 'Public project license differs from the repository license'
Assert-Hash (Join-Path $PublicRoot 'THIRD_PARTY_NOTICES.md') (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $ProjectRoot 'THIRD_PARTY_NOTICES.md')).Hash 'Public third-party notices differ from the repository notices'
Assert-Hash (Join-Path $AssetRoot 'LICENSE') (Get-FileHash -Algorithm SHA256 -LiteralPath $LicensePath).Hash 'Public MS-Human license differs from the source-tree license'
Assert-Hash (Join-Path $AssetRoot 'SOURCE.md') (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $SourceRoot 'SOURCE.md')).Hash 'Public MS-Human source record differs from the repository record'

$Index = Get-Content -LiteralPath (Join-Path $PublicRoot 'index.html') -Raw
$App = Get-Content -LiteralPath (Join-Path $PublicRoot 'app-ms-human.js') -Raw
$Diagnosis = Get-Content -LiteralPath (Join-Path $PublicRoot 'diagnosis.js') -Raw
$EnglishMessages = (Get-Content -LiteralPath (Join-Path $PublicRoot 'locales\en.json') -Raw | ConvertFrom-Json).messages
$Worker = Get-Content -LiteralPath (Join-Path $PublicRoot 'ms-human-worker.js') -Raw
$Protocol = Get-Content -LiteralPath $ProtocolPath -Raw
$ProtocolEvidence = Get-Content -LiteralPath $ProtocolEvidencePath -Raw | ConvertFrom-Json
Assert-True $Index.Contains('src="./bootstrap.js"') 'Root page does not load the relative localization bootstrap entry point'
Assert-True (-not $Index.Contains('src="/bootstrap.js"')) 'Root page unexpectedly requires origin-root hosting'
Assert-True (-not $Index.Contains('mode-benchmark')) 'Legacy movement mode remains in the root interface'
Assert-True (-not $Index.Contains('Reach8')) 'Legacy Reach8 content remains in the root interface'
Assert-True (-not $Index.Contains('MoBL-ARMS')) 'Legacy model disclosure remains in the root interface'
Assert-True $EnglishMessages.'model-info.limitations.quality-copy'.Contains('colors appear only when paths and values are valid') 'English static quality disclosure is missing'
Assert-Equal $EnglishMessages.'brand.intro' 'Explore regional posture and modeled muscle activation.' 'Regional Explorer description is missing'
Assert-True $EnglishMessages.'model-info.shows.posture-copy'.Contains('choose one body region at a time') 'Regional control-boundary disclosure is missing'
Assert-True $EnglishMessages.'model-info.limitations.assessment-copy'.Contains('guided sequence remains a separate right upper-limb workflow') 'Assessment isolation disclosure is missing'
Assert-True $Index.Contains('id="focus-region"') 'Explorer region selector is missing'
Assert-True (-not $Index.Contains('id="region-side-control"')) 'Redundant side selector remains beside the explicit region list'
Assert-True $Index.Contains('id="render-anatomical-bodies"') 'Procedural anatomical muscle-body rendering control is missing'
Assert-True (-not $Index.Contains('id="render-muscle-bodies"')) 'Removed simple muscle-body rendering control remains in the interface'
Assert-True $Index.Contains('id="render-path-lines"') 'Technical path-line rendering control is missing'
Assert-True $EnglishMessages.'model-info.shows.rendering-copy'.Contains('Body shape and thickness are illustrative') 'Illustrative muscle-body shape and thickness disclosure is missing'
Assert-True $EnglishMessages.'assessment.workspace.guided-positions'.Contains('15 guided positions') 'Current assessment position count is missing from the interface'
Assert-Equal $EnglishMessages.'assessment.privacy.intro' 'Everything you enter—including assessment answers and reports—is saved only in this browser on your device.' 'Device-storage behavior is not disclosed in the interface'
Assert-True (-not $Index.Contains('name="email"')) 'Unused email collection remains in the assessment'
Assert-True (-not $Index.Contains('name="city"')) 'Unused city collection remains in the assessment'
Assert-True $EnglishMessages.'legal.footer'.Contains('Waajacu™') 'Waajacu trademark footer is missing'
Assert-True $Index.Contains('DOI 10.1109/ICRA57147.2024.10610081') 'MS-Human academic citation is missing'
Assert-True $Worker.Contains("'./models/ms_human_700/body-regions.json'") 'Worker does not load the reviewed regional manifest'
Assert-True $Worker.Contains("'./models/ms_human_700/hand-region.json'") 'Worker does not load the reviewed articulated-hand manifest'
Assert-True $Worker.Contains('485e389aebe640687974a719ed7adf176c637617afc0800387b4fa5860c0da4e') 'Worker regional-manifest integrity pin changed'
Assert-True $Worker.Contains('f6406c25bbb82593c96a639efa020bea758abae77d385f00ab6d16e7c6ce8005') 'Worker hand-manifest integrity pin changed'
Assert-True $App.Contains("const DEFAULT_REGION_ID = 'right-upper-limb';") 'Application default region changed'
Assert-True $App.Contains("activateEngineProfile('primary', DEFAULT_REGION_ID)") 'Assessment no longer returns the viewer to the reviewed primary right-arm profile'
Assert-True $App.Contains("app.profiles.get('primary').engine.pose(coordinates, selected, DEFAULT_REGION_ID)") 'Assessment pose requests are not isolated to the primary default region'
Assert-True $App.Contains("app.profiles.get('primary').engine.staticHold(coordinates, selected, DEFAULT_REGION_ID)") 'Assessment static requests are not isolated to the primary default region'
foreach ($RegionLabel in @('Right arm', 'Left arm', 'Right leg', 'Left leg', 'Back & trunk', 'Head & neck', 'Right hand')) {
    Assert-True ($EnglishMessages.PSObject.Properties.Value -contains $RegionLabel) "Explicit Explorer region is missing: $RegionLabel"
}
Assert-True $App.Contains('function pickMuscleAt') 'Direct 3D muscle picking is missing'
Assert-True $App.Contains("selectMuscle(muscleName, 'one')") 'A directly picked muscle is not isolated in Inspect one'
Assert-True $App.Contains('mesh.userData.muscleName = muscle.name') 'Rendered muscle meshes are not tagged for direct picking'
Assert-True $App.Contains('function muscleDisplayName') 'Readable muscle-name presentation layer is missing'
Assert-True $Diagnosis.Contains("from './ms-human-assessment-protocol.js'") 'Diagnosis does not import the current relative MS-Human assessment protocol'
Assert-True $Diagnosis.Contains("storageMode: 'device'") 'Assessment device storage is no longer the reviewed default'
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
    @{ Path = '/bootstrap.js'; Type = 'text/javascript' },
    @{ Path = '/i18n.js'; Type = 'text/javascript' },
    @{ Path = '/locales/en.json'; Type = 'application/json' },
    @{ Path = '/locales/es.json'; Type = 'application/json' },
    @{ Path = '/locales/de.json'; Type = 'application/json' },
    @{ Path = '/locales/zh-Hans.json'; Type = 'application/json' },
    @{ Path = '/app-ms-human.js'; Type = 'text/javascript' },
    @{ Path = '/ms-human-engine.js'; Type = 'text/javascript' },
    @{ Path = '/ms-human-worker.js'; Type = 'text/javascript' },
    @{ Path = '/ms-human-assessment-protocol.js'; Type = 'text/javascript' },
    @{ Path = '/models/ms_human_700/body-regions.json'; Type = 'application/json' },
    @{ Path = '/models/ms_human_700/hand-region.json'; Type = 'application/json' },
    @{ Path = '/models/ms_human_700/right-arm.json'; Type = 'application/json' },
    @{ Path = '/models/ms_human_700/right-arm.meshbin'; Type = 'application/octet-stream' },
    @{ Path = '/models/ms_human_700/right-arm-runtime.mjb'; Type = 'application/octet-stream' },
    @{ Path = '/models/ms_human_700/right-hand.json'; Type = 'application/json' },
    @{ Path = '/models/ms_human_700/right-hand.meshbin'; Type = 'application/octet-stream' },
    @{ Path = '/models/ms_human_700/right-hand-runtime.mjb'; Type = 'application/octet-stream' },
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
    Regions = $Regions.regions.Count
    RegionManifestSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $RegionsPath).Hash
    RegionContentDigestSha256 = $Regions.contentDigestSha256
    Coordinates = $Metadata.coordinates.Count
    ArmGeometries = ($Metadata.geometry.geoms | Where-Object role -eq 'arm').Count
    ContextGeometries = ($Metadata.geometry.geoms | Where-Object role -eq 'context').Count
    Vertices = $VertexCount
    Triangles = $IndexCount / 3
    MuJoCo = $Metadata.source.mujocoVersion
    Url = "$BaseUrl/"
} | ConvertTo-Json
