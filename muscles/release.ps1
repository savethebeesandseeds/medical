[CmdletBinding()]
param(
    [switch]$Package,
    [switch]$SkipGitCleanCheck,
    [string]$NodePath
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot
$GitSafeRoot = $ProjectRoot.Replace('\', '/')
$PublicRoot = Join-Path $ProjectRoot 'public'
$BuildRoot = Join-Path $ProjectRoot 'build'
$StagingRoot = Join-Path $BuildRoot 'waajacu-medical-static'
$ArchivePath = Join-Path $BuildRoot 'waajacu-medical-static.zip'
$ArchiveHashPath = "$ArchivePath.sha256"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$StrictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)

function Write-Stage {
    param([string]$Message)
    Write-Host ("`n==> {0}" -f $Message)
}

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Resolve-Executable {
    param(
        [string]$ExplicitPath,
        [string[]]$CommandNames,
        [string[]]$FallbackPaths,
        [string]$Label
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        if (-not (Test-Path -LiteralPath $ExplicitPath -PathType Leaf)) {
            throw "$Label was not found at the supplied path: $ExplicitPath"
        }
        return (Resolve-Path -LiteralPath $ExplicitPath).Path
    }

    foreach ($Name in $CommandNames) {
        $Command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -ne $Command) { return $Command.Source }
    }

    foreach ($Candidate in $FallbackPaths) {
        if (-not [string]::IsNullOrWhiteSpace($Candidate) -and
            (Test-Path -LiteralPath $Candidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $Candidate).Path
        }
    }

    throw "$Label is required. Install it, add it to PATH, or pass its exact path."
}

function Invoke-Node {
    param([string[]]$Arguments)
    & $script:NodeExe @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Node.js failed with exit code ${LASTEXITCODE}: $($Arguments -join ' ')"
    }
}

function Get-FreeTcpPort {
    $Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try {
        $Listener.Start()
        return ([System.Net.IPEndPoint]$Listener.LocalEndpoint).Port
    }
    finally {
        $Listener.Stop()
    }
}

function Get-RelativeDeployPath {
    param([string]$AbsolutePath)
    return $AbsolutePath.Substring($PublicRoot.Length + 1).Replace('\', '/')
}

function Get-Sha256Lower {
    param([string]$Path)
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Get-StringSha1 {
    param([string]$Value)
    $Hasher = [System.Security.Cryptography.SHA1]::Create()
    try {
        return ([BitConverter]::ToString($Hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $Hasher.Dispose()
    }
}

function Get-PackageVerificationCode {
    param([object[]]$Files)
    $Hashes = @($Files | Sort-Object relative | ForEach-Object {
        (Get-FileHash -Algorithm SHA1 -LiteralPath $_.absolute).Hash.ToLowerInvariant()
    })
    return Get-StringSha1 ($Hashes -join '')
}

function Assert-SafeBuildTarget {
    param([string]$Path)
    $ResolvedBuild = [IO.Path]::GetFullPath($BuildRoot).TrimEnd('\')
    $ResolvedTarget = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    Assert-True ($ResolvedTarget.StartsWith($ResolvedBuild + '\', [StringComparison]::OrdinalIgnoreCase)) "Unsafe build target: $ResolvedTarget"
    Assert-True ($ResolvedTarget -ne $ResolvedBuild) "Refusing to replace the complete build directory."
}

$UserProfileRoot = $env:USERPROFILE
if ([string]::IsNullOrWhiteSpace($UserProfileRoot)) {
    $UserProfileRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
}
$BundledDependencyRoot = if ([string]::IsNullOrWhiteSpace($UserProfileRoot)) {
    $null
} else {
    Join-Path $UserProfileRoot '.cache\codex-runtimes\codex-primary-runtime\dependencies'
}

$NodeFallbacks = @()
$PythonFallbacks = @()
$GitFallbacks = @()
if ($null -ne $BundledDependencyRoot) {
    $NodeFallbacks += Join-Path $BundledDependencyRoot 'node\bin\node.exe'
    $PythonFallbacks += Join-Path $BundledDependencyRoot 'python\python.exe'
    $GitFallbacks += Join-Path $BundledDependencyRoot 'native\git\cmd\git.exe'
}

$script:NodeExe = Resolve-Executable -ExplicitPath $NodePath -CommandNames @('node.exe', 'node') -FallbackPaths $NodeFallbacks -Label 'Node.js'
$PythonExe = Resolve-Executable -CommandNames @('python.exe', 'python3.exe', 'python', 'python3') -FallbackPaths $PythonFallbacks -Label 'Python 3'
$GitExe = Resolve-Executable -CommandNames @('git.exe', 'git') -FallbackPaths $GitFallbacks -Label 'Git'

# This is the complete deploy boundary. Adding a public file requires a
# deliberate review and an update here; unlisted files make the gate fail.
$DeployAllowlist = @(
    'app-ms-human.js',
    'diagnosis.js',
    'index.html',
    'LICENSE',
    'models/ms_human_700/LICENSE',
    'models/ms_human_700/README.md',
    'models/ms_human_700/right-arm.json',
    'models/ms_human_700/right-arm.meshbin',
    'models/ms_human_700/right-arm-runtime.mjb',
    'models/ms_human_700/SOURCE.md',
    'ms-human-assessment-protocol.js',
    'ms-human-engine.js',
    'ms-human-worker.js',
    'report-v5.js',
    'styles.css',
    'THIRD_PARTY_NOTICES.md',
    'vendor/mujoco.js',
    'vendor/mujoco.wasm',
    'vendor/MUJOCO_LICENSE.txt',
    'vendor/three.core.min.js',
    'vendor/three.module.min.js',
    'vendor/THREE_LICENSE.txt',
    'waajacu_medical.png'
)

Write-Stage 'Checking the exact deploy boundary'
$ActualDeployFiles = @(Get-ChildItem -LiteralPath $PublicRoot -Recurse -File | ForEach-Object {
    Get-RelativeDeployPath $_.FullName
} | Sort-Object)
$ExpectedDeployFiles = @($DeployAllowlist | Sort-Object)
Assert-True (($ActualDeployFiles -join "`n") -ceq ($ExpectedDeployFiles -join "`n")) (
    "The public deploy tree differs from the reviewed allowlist.`nExpected:`n  {0}`nActual:`n  {1}" -f
    ($ExpectedDeployFiles -join "`n  "), ($ActualDeployFiles -join "`n  ")
)

$PublicEntries = @(Get-ChildItem -LiteralPath $PublicRoot -Recurse -Force)
$ReparseEntries = @($PublicEntries | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 })
Assert-True ($ReparseEntries.Count -eq 0) 'The public deploy tree must not contain symlinks or other reparse points.'

$RetiredPaths = @(
    'full-body.html', 'app.js', 'movement-reference.js',
    'models/mobl_arms', 'models/mobl-arms', 'models/reach8'
)
foreach ($RetiredPath in $RetiredPaths) {
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $PublicRoot $RetiredPath))) "Retired deploy content remains: $RetiredPath"
}

Write-Stage 'Checking the documented hosting contract'
$IndexSource = [IO.File]::ReadAllText((Join-Path $PublicRoot 'index.html'), [Text.Encoding]::UTF8)
$ReadmeSource = [IO.File]::ReadAllText((Join-Path $ProjectRoot 'README.md'), [Text.Encoding]::UTF8)
Assert-True $IndexSource.Contains('src="./app-ms-human.js"') 'The reviewed relative-URL hosting contract changed; review deployment paths and the release documentation.'
Assert-True (-not $IndexSource.Contains('src="/app-ms-human.js"')) 'The entry module unexpectedly requires origin-root hosting.'
Assert-True ($ReadmeSource.Contains('module- and document-relative URLs') -and $ReadmeSource.Contains('subpath')) 'README must describe the reviewed root/subpath hosting behavior.'
$HostingSources = $IndexSource
foreach ($JavaScriptPath in @($DeployAllowlist | Where-Object { $_.EndsWith('.js', [StringComparison]::OrdinalIgnoreCase) })) {
    $HostingSources += "`n" + [IO.File]::ReadAllText((Join-Path $PublicRoot $JavaScriptPath.Replace('/', '\')), [Text.Encoding]::UTF8)
}
foreach ($RootAbsoluteSignature in @(
    'from ''/', 'from "/', 'import ''/', 'import "/',
    'new URL(''/', 'new URL("/', 'src="/', 'href="/'
)) {
    Assert-True (-not $HostingSources.Contains($RootAbsoluteSignature)) "Subpath-hosting regression: found $RootAbsoluteSignature in browser source."
}

Write-Stage 'Checking UTF-8 text and common mojibake signatures'
$TextExtensions = @('.css', '.html', '.js', '.json', '.md', '.txt')
$MojibakeCharacters = @([char]0xFFFD, [char]0x00C2, [char]0x00C3)
$TextFilesToCheck = @()
foreach ($RelativePath in $DeployAllowlist) {
    $AbsolutePath = Join-Path $PublicRoot $RelativePath.Replace('/', '\')
    $Extension = [IO.Path]::GetExtension($AbsolutePath).ToLowerInvariant()
    $IsText = $TextExtensions -contains $Extension -or $RelativePath -eq 'LICENSE'
    if (-not $IsText) { continue }
    $TextFilesToCheck += [pscustomobject]@{ label = "public/$RelativePath"; absolute = $AbsolutePath }
}
foreach ($RepositoryTextPath in @('README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'setup.sh')) {
    $TextFilesToCheck += [pscustomobject]@{
        label = $RepositoryTextPath
        absolute = Join-Path $ProjectRoot $RepositoryTextPath
    }
}
foreach ($TextFile in $TextFilesToCheck) {
    try {
        $Text = $StrictUtf8.GetString([IO.File]::ReadAllBytes($TextFile.absolute))
    }
    catch {
        throw "Project text is not valid UTF-8: $($TextFile.label)"
    }
    foreach ($BadCharacter in $MojibakeCharacters) {
        Assert-True (-not $Text.Contains([string]$BadCharacter)) "Possible mojibake in $($TextFile.label) (U+$('{0:X4}' -f [int]$BadCharacter))."
    }
}

Write-Stage 'Checking browser JavaScript syntax'
foreach ($RelativePath in @($DeployAllowlist | Where-Object { $_.EndsWith('.js', [StringComparison]::OrdinalIgnoreCase) })) {
    $AbsolutePath = Join-Path $PublicRoot $RelativePath.Replace('/', '\')
    Get-Content -LiteralPath $AbsolutePath -Raw -Encoding UTF8 | & $script:NodeExe --input-type=module --check
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed: $RelativePath" }
}

Write-Stage 'Validating the versioned MS-Human assessment protocol'
Invoke-Node @((Join-Path $ProjectRoot 'tools\validate-ms-human-assessment-protocol.mjs'))

Write-Stage 'Running report, privacy, and migration tests'
Invoke-Node @((Join-Path $ProjectRoot 'tools\verify-diagnosis-report.mjs'))

Write-Stage 'Starting an isolated local server for required HTTP checks'
$Port = Get-FreeTcpPort
$ServerScript = Join-Path $ProjectRoot 'tools\serve_static.py'
$ServerArguments = @($ServerScript, '--root', $PublicRoot, '--host', '127.0.0.1', '--port', [string]$Port)
$ServerProcess = Start-Process -FilePath $PythonExe -ArgumentList $ServerArguments -PassThru -WindowStyle Hidden
try {
    $Ready = $false
    for ($Attempt = 0; $Attempt -lt 100; $Attempt++) {
        if ($ServerProcess.HasExited) {
            throw "The temporary static server exited before becoming ready (exit $($ServerProcess.ExitCode))."
        }
        try {
            $Response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" -TimeoutSec 2
            if ($Response.StatusCode -eq 200) { $Ready = $true; break }
        }
        catch { }
        Start-Sleep -Milliseconds 100
    }
    Assert-True $Ready "The temporary static server did not become ready on port $Port."
    & (Join-Path $ProjectRoot 'verify-ms-human.ps1') -Port $Port
}
finally {
    if ($null -ne $ServerProcess -and -not $ServerProcess.HasExited) {
        Stop-Process -Id $ServerProcess.Id -Force
        $ServerProcess.WaitForExit()
    }
}

Write-Stage 'Checking repository baseline'
if ($SkipGitCleanCheck) {
    Write-Warning 'Git cleanliness check was explicitly skipped. Do not publish this as a frozen release baseline.'
}
else {
    Push-Location $ProjectRoot
    try {
        $GitStatus = @(& $GitExe -c "safe.directory=$GitSafeRoot" status --porcelain=v1 --untracked-files=all)
        if ($LASTEXITCODE -ne 0) { throw 'Git could not inspect the release tree.' }
    }
    finally {
        Pop-Location
    }
    Assert-True ($GitStatus.Count -eq 0) (
        "The repository is not a frozen clean baseline. Commit or otherwise preserve the reviewed state first.`n{0}" -f
        ($GitStatus -join "`n")
    )
}

if ($Package) {
    Write-Stage 'Building the allowlisted static release archive'
    Assert-SafeBuildTarget $StagingRoot
    Assert-SafeBuildTarget $ArchivePath
    Assert-SafeBuildTarget $ArchiveHashPath
    if (Test-Path -LiteralPath $StagingRoot) { Remove-Item -LiteralPath $StagingRoot -Recurse -Force }
    if (Test-Path -LiteralPath $ArchivePath) { Remove-Item -LiteralPath $ArchivePath -Force }
    if (Test-Path -LiteralPath $ArchiveHashPath) { Remove-Item -LiteralPath $ArchiveHashPath -Force }
    New-Item -ItemType Directory -Path $StagingRoot -Force | Out-Null

    $PayloadFiles = @()
    foreach ($RelativePath in $DeployAllowlist) {
        $Source = Join-Path $PublicRoot $RelativePath.Replace('/', '\')
        $Destination = Join-Path $StagingRoot $RelativePath.Replace('/', '\')
        $DestinationDirectory = Split-Path -Parent $Destination
        if (-not (Test-Path -LiteralPath $DestinationDirectory)) {
            New-Item -ItemType Directory -Path $DestinationDirectory -Force | Out-Null
        }
        Copy-Item -LiteralPath $Source -Destination $Destination
        $PayloadFiles += [pscustomobject]@{
            relative = $RelativePath
            absolute = $Destination
            sha256 = Get-Sha256Lower $Destination
        }
    }
    $PayloadFiles = @($PayloadFiles | Sort-Object relative)
    $PayloadDigest = Get-StringSha1 (($PayloadFiles | ForEach-Object { "$($_.sha256)  $($_.relative)" }) -join "`n")

    $Groups = [ordered]@{
        App = @($PayloadFiles | Where-Object { $_.relative -notlike 'models/ms_human_700/*' -and $_.relative -notlike 'vendor/mujoco*' -and $_.relative -notlike 'vendor/MUJOCO_*' -and $_.relative -notlike 'vendor/three*' -and $_.relative -notlike 'vendor/THREE_*' })
        Model = @($PayloadFiles | Where-Object { $_.relative -like 'models/ms_human_700/*' })
        Mujoco = @($PayloadFiles | Where-Object { $_.relative -like 'vendor/mujoco*' -or $_.relative -like 'vendor/MUJOCO_*' })
        Three = @($PayloadFiles | Where-Object { $_.relative -like 'vendor/three*' -or $_.relative -like 'vendor/THREE_*' })
    }
    Assert-True ((@($Groups.Values | ForEach-Object { $_ }).Count) -eq $PayloadFiles.Count) 'SBOM grouping did not cover the complete payload exactly once.'

    $Packages = @(
        [ordered]@{ name = "Waajacu's Medical"; SPDXID = 'SPDXRef-Package-App'; downloadLocation = 'NOASSERTION'; filesAnalyzed = $true; packageVerificationCode = [ordered]@{ packageVerificationCodeValue = Get-PackageVerificationCode $Groups.App }; licenseConcluded = 'MIT'; licenseDeclared = 'MIT'; copyrightText = 'Copyright (c) 2026 Waajacu''s Medical contributors'; primaryPackagePurpose = 'APPLICATION' },
        [ordered]@{ name = 'MS-Human-700 browser model assets'; SPDXID = 'SPDXRef-Package-MSHuman700'; downloadLocation = 'https://github.com/google-deepmind/mujoco_menagerie/tree/da76818e269b82289eba39808e2fb91d679d6994/ms_human_700'; filesAnalyzed = $true; packageVerificationCode = [ordered]@{ packageVerificationCodeValue = Get-PackageVerificationCode $Groups.Model }; licenseConcluded = 'Apache-2.0'; licenseDeclared = 'Apache-2.0'; copyrightText = 'NOASSERTION'; primaryPackagePurpose = 'DATA'; sourceInfo = 'Modified/compiled browser assets; see models/ms_human_700/SOURCE.md.' },
        [ordered]@{ name = 'MuJoCo WebAssembly runtime'; SPDXID = 'SPDXRef-Package-MuJoCo'; versionInfo = '3.10.0'; downloadLocation = 'https://www.npmjs.com/package/@mujoco/mujoco/v/3.10.0'; filesAnalyzed = $true; packageVerificationCode = [ordered]@{ packageVerificationCodeValue = Get-PackageVerificationCode $Groups.Mujoco }; licenseConcluded = 'Apache-2.0'; licenseDeclared = 'Apache-2.0'; copyrightText = 'NOASSERTION'; primaryPackagePurpose = 'LIBRARY' },
        [ordered]@{ name = 'Three.js'; SPDXID = 'SPDXRef-Package-Three'; versionInfo = '0.180.0'; downloadLocation = 'https://www.npmjs.com/package/three/v/0.180.0'; filesAnalyzed = $true; packageVerificationCode = [ordered]@{ packageVerificationCodeValue = Get-PackageVerificationCode $Groups.Three }; licenseConcluded = 'MIT'; licenseDeclared = 'MIT'; copyrightText = 'Copyright 2010-2025 Three.js Authors'; primaryPackagePurpose = 'LIBRARY' }
    )

    $SpdxFiles = @()
    $Relationships = @(
        [ordered]@{ spdxElementId = 'SPDXRef-DOCUMENT'; relationshipType = 'DESCRIBES'; relatedSpdxElement = 'SPDXRef-Package-App' },
        [ordered]@{ spdxElementId = 'SPDXRef-Package-App'; relationshipType = 'DEPENDS_ON'; relatedSpdxElement = 'SPDXRef-Package-MSHuman700' },
        [ordered]@{ spdxElementId = 'SPDXRef-Package-App'; relationshipType = 'DEPENDS_ON'; relatedSpdxElement = 'SPDXRef-Package-MuJoCo' },
        [ordered]@{ spdxElementId = 'SPDXRef-Package-App'; relationshipType = 'DEPENDS_ON'; relatedSpdxElement = 'SPDXRef-Package-Three' }
    )
    $PackageByPath = @{}
    foreach ($File in $Groups.App) { $PackageByPath[$File.relative] = 'SPDXRef-Package-App' }
    foreach ($File in $Groups.Model) { $PackageByPath[$File.relative] = 'SPDXRef-Package-MSHuman700' }
    foreach ($File in $Groups.Mujoco) { $PackageByPath[$File.relative] = 'SPDXRef-Package-MuJoCo' }
    foreach ($File in $Groups.Three) { $PackageByPath[$File.relative] = 'SPDXRef-Package-Three' }
    foreach ($File in $PayloadFiles) {
        $FileId = 'SPDXRef-File-' + ($File.relative -replace '[^A-Za-z0-9.-]', '-')
        $License = switch -Wildcard ($File.relative) {
            'models/ms_human_700/*' { 'Apache-2.0'; break }
            'vendor/mujoco*' { 'Apache-2.0'; break }
            'vendor/MUJOCO_*' { 'Apache-2.0'; break }
            'vendor/three*' { 'MIT'; break }
            'vendor/THREE_*' { 'MIT'; break }
            default { 'MIT' }
        }
        $SpdxFiles += [ordered]@{
            fileName = './' + $File.relative
            SPDXID = $FileId
            checksums = @([ordered]@{ algorithm = 'SHA256'; checksumValue = $File.sha256 })
            licenseConcluded = $License
            licenseInfoInFiles = @('NOASSERTION')
            copyrightText = 'NOASSERTION'
        }
        $Relationships += [ordered]@{ spdxElementId = $PackageByPath[$File.relative]; relationshipType = 'CONTAINS'; relatedSpdxElement = $FileId }
    }

    $EpochText = $env:SOURCE_DATE_EPOCH
    if ([string]::IsNullOrWhiteSpace($EpochText)) {
        Push-Location $ProjectRoot
        try {
            $EpochOutput = @(& $GitExe -c "safe.directory=$GitSafeRoot" log -1 --format=%ct)
            if ($LASTEXITCODE -ne 0) { throw 'Git could not determine the source revision time.' }
            $EpochText = ($EpochOutput -join '').Trim()
        }
        finally {
            Pop-Location
        }
    }
    $EpochSeconds = 0L
    Assert-True ([long]::TryParse($EpochText, [ref]$EpochSeconds)) 'SOURCE_DATE_EPOCH or the Git revision time must be an integer number of seconds.'
    $Created = [DateTimeOffset]::FromUnixTimeSeconds($EpochSeconds).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ssZ')
    $Sbom = [ordered]@{
        spdxVersion = 'SPDX-2.3'
        dataLicense = 'CC0-1.0'
        SPDXID = 'SPDXRef-DOCUMENT'
        name = "Waajacu's Medical static release"
        documentNamespace = "urn:waajacu-medical:spdx:$PayloadDigest"
        creationInfo = [ordered]@{ created = $Created; creators = @('Tool: release.ps1') }
        packages = $Packages
        files = $SpdxFiles
        relationships = $Relationships
    }
    $SbomPath = Join-Path $StagingRoot 'SBOM.spdx.json'
    [IO.File]::WriteAllText($SbomPath, (($Sbom | ConvertTo-Json -Depth 12) + "`n"), $Utf8NoBom)

    $ManifestEntries = @($PayloadFiles | ForEach-Object { "$($_.sha256)  $($_.relative)" })
    $ManifestEntries += "$(Get-Sha256Lower $SbomPath)  SBOM.spdx.json"
    $ManifestPath = Join-Path $StagingRoot 'MANIFEST.sha256'
    [IO.File]::WriteAllText($ManifestPath, (($ManifestEntries | Sort-Object) -join "`n") + "`n", $Utf8NoBom)

    foreach ($ManifestLine in (Get-Content -LiteralPath $ManifestPath)) {
        Assert-True ($ManifestLine -match '^([0-9a-f]{64})  (.+)$') "Invalid checksum manifest line: $ManifestLine"
        $ExpectedHash = $Matches[1]
        $ManifestRelativePath = $Matches[2]
        $ManifestAbsolutePath = Join-Path $StagingRoot $ManifestRelativePath.Replace('/', '\')
        Assert-True ((Get-Sha256Lower $ManifestAbsolutePath) -eq $ExpectedHash) "Generated checksum does not verify: $ManifestRelativePath"
    }

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $ArchiveStream = [IO.File]::Open($ArchivePath, [IO.FileMode]::CreateNew)
    try {
        $Archive = New-Object IO.Compression.ZipArchive($ArchiveStream, [IO.Compression.ZipArchiveMode]::Create, $false)
        try {
            $FilesToArchive = @(Get-ChildItem -LiteralPath $StagingRoot -Recurse -File | Sort-Object { $_.FullName.Substring($StagingRoot.Length + 1).Replace('\', '/') })
            foreach ($File in $FilesToArchive) {
                $EntryName = $File.FullName.Substring($StagingRoot.Length + 1).Replace('\', '/')
                $Entry = $Archive.CreateEntry($EntryName, [IO.Compression.CompressionLevel]::Optimal)
                $Entry.LastWriteTime = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
                $InputStream = $File.OpenRead()
                $OutputStream = $Entry.Open()
                try { $InputStream.CopyTo($OutputStream) }
                finally { $OutputStream.Dispose(); $InputStream.Dispose() }
            }
        }
        finally { $Archive.Dispose() }
    }
    finally { $ArchiveStream.Dispose() }

    $ExpectedArchiveEntries = @(($DeployAllowlist + @('MANIFEST.sha256', 'SBOM.spdx.json')) | Sort-Object)
    $ArchiveForInspection = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        $ActualArchiveEntries = @($ArchiveForInspection.Entries | ForEach-Object FullName | Sort-Object)
        Assert-True (($ActualArchiveEntries -join "`n") -ceq ($ExpectedArchiveEntries -join "`n")) 'The release archive differs from the reviewed entry allowlist.'
        Assert-True (@($ActualArchiveEntries | Where-Object { $_.StartsWith('/') -or $_.Contains('../') -or $_.Contains('\') }).Count -eq 0) 'The release archive contains an unsafe entry path.'
    }
    finally {
        $ArchiveForInspection.Dispose()
    }

    $ArchiveHash = Get-Sha256Lower $ArchivePath
    [IO.File]::WriteAllText($ArchiveHashPath, "$ArchiveHash  $([IO.Path]::GetFileName($ArchivePath))`n", $Utf8NoBom)
    Write-Host "Archive: $ArchivePath"
    Write-Host "SHA-256: $ArchiveHash"
}

Write-Host "`nRELEASE GATE PASSED"
Write-Host "Node: $(& $script:NodeExe --version)"
Write-Host "Deploy files: $($DeployAllowlist.Count)"
if (-not $Package) { Write-Host 'Packaging: not requested (add -Package)' }
