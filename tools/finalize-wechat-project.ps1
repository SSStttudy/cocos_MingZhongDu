param(
    # Always default to the real Cocos build output.  A validation build under
    # tmp/ can be stale and must only be selected explicitly with -BuildRoot.
    [string]$BuildRoot = "build/wechatgame",
    [string]$OutputRoot = "dist/wechatgame-upload",
    [string]$RemoteOutputRoot = "dist/wechatgame-remote",
    [string]$AppId = "",
    [string]$ProjectName = "ming-zhongdu",
    [string]$RemoteServer = "https://nyasd.net/mingzhongdu-wechat/",
    [switch]$ForUpload,
    [switch]$SkipNetworkCheck
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Utf8NoBom([string]$Path, [string]$Content) {
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Resolve-ProjectPath([string]$Path) {
    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $projectRoot $Path))
}

function Assert-ProjectChild([string]$Path, [string]$Label) {
    $full = [System.IO.Path]::GetFullPath($Path)
    $prefix = $projectRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label must stay inside the project folder: $full"
    }
    if ($full -eq $projectRoot) {
        throw "$Label cannot be the project root."
    }
}

function Reset-Directory([string]$Path) {
    Assert-ProjectChild $Path "Output directory"
    if (Test-Path -LiteralPath $Path) {
        # WeChat DevTools keeps the imported project directory open on Windows.
        # Replace its contents in place and preserve the tool's local-only settings.
        Get-ChildItem -LiteralPath $Path -Force |
            Where-Object { $_.Name -ne "project.private.config.json" } |
            ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
    } else {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Copy-DirectoryContents([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
        throw "Missing directory: $Source"
    }
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
    }
}

function New-PortableZip([string]$SourceDirectory, [string]$DestinationPath) {
    # Compress-Archive writes Windows directory entries with backslashes and
    # read-only directory permissions. When extracted on Linux those entries
    # can leave Nginx unable to traverse resources/native. Store files only,
    # with ZIP-standard forward slashes; unzip will create traversable folders.
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $source = [System.IO.Path]::GetFullPath($SourceDirectory).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $prefix = $source + [System.IO.Path]::DirectorySeparatorChar
    $archive = [System.IO.Compression.ZipFile]::Open(
        $DestinationPath,
        [System.IO.Compression.ZipArchiveMode]::Create
    )
    try {
        Get-ChildItem -LiteralPath $source -Recurse -File | Sort-Object FullName | ForEach-Object {
            $entryName = $_.FullName.Substring($prefix.Length).Replace('\', '/')
            $entry = $archive.CreateEntry(
                $entryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            )
            $input = [System.IO.File]::OpenRead($_.FullName)
            $outputStream = $entry.Open()
            try {
                $input.CopyTo($outputStream)
            } finally {
                $outputStream.Dispose()
                $input.Dispose()
            }
        }
    } finally {
        $archive.Dispose()
    }
}

$build = Resolve-ProjectPath $BuildRoot
$output = Resolve-ProjectPath $OutputRoot
$remoteOutput = Resolve-ProjectPath $RemoteOutputRoot
Assert-ProjectChild $build "Build root"
Assert-ProjectChild $output "Upload output"
Assert-ProjectChild $remoteOutput "Remote output"

foreach ($required in @("game.json", "project.config.json", "src")) {
    if (-not (Test-Path -LiteralPath (Join-Path $build $required))) {
        throw "Not a complete Cocos WeChat Mini Game build. Missing: $required"
    }
}

$remoteSource = Join-Path $build "remote"
if (-not (Test-Path -LiteralPath $remoteSource -PathType Container)) {
    throw "Missing remote Asset Bundles. Run tools/prepare-wechat-release.ps1 first."
}

Reset-Directory $output
Reset-Directory $remoteOutput

Get-ChildItem -LiteralPath $build -Force | Where-Object { $_.Name -ne "remote" } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $output -Recurse -Force
}
Copy-DirectoryContents $remoteSource $remoteOutput

$projectConfigPath = Join-Path $output "project.config.json"
$projectConfig = Get-Content -LiteralPath $projectConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$testAppIds = @("wx6ac3f5090a6b99c5", "touristappid")
if ($AppId) {
    if ($AppId -notmatch '^wx[0-9a-fA-F]{16}$') {
        throw "AppId must look like wx followed by 16 hexadecimal characters."
    }
    $projectConfig.appid = $AppId
}
if (-not $projectConfig.setting) {
    $projectConfig | Add-Member -NotePropertyName setting -NotePropertyValue ([PSCustomObject]@{})
}
$projectConfig.projectname = $ProjectName
$projectConfig.compileType = "game"
$projectConfig.miniprogramRoot = "./"
$projectConfig.setting.urlCheck = $true
$projectConfig.setting.minified = $true
$projectConfig.setting.enhance = $true
Write-Utf8NoBom $projectConfigPath ($projectConfig | ConvertTo-Json -Depth 100)

if ($ForUpload -and (($testAppIds -contains $projectConfig.appid) -or ($projectConfig.appid -notmatch '^wx[0-9a-fA-F]{16}$'))) {
    throw "ForUpload requires your team's real WeChat Mini Game AppId. Pass -AppId wx................"
}

$gameJsonPath = Join-Path $output "game.json"
$gameJson = Get-Content -LiteralPath $gameJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($gameJson.deviceOrientation -ne "landscape") {
    throw "game.json must use landscape orientation."
}
if ($gameJson.plugins -and $gameJson.plugins.cocos) {
    throw "The build still depends on the Cocos WeChat engine plugin. Rebuild with separateEngine=false to avoid account authorization failures."
}

$settingsFiles = @(Get-ChildItem -LiteralPath (Join-Path $output "src") -File -Filter "settings*.json")
if ($settingsFiles.Count -ne 1) {
    throw "Expected exactly one Cocos settings JSON, found $($settingsFiles.Count)."
}
$settingsPath = $settingsFiles[0].FullName
$settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
$serverBase = $RemoteServer.TrimEnd('/')
if ($serverBase.EndsWith('/remote', [System.StringComparison]::OrdinalIgnoreCase)) {
    $serverBase = $serverBase.Substring(0, $serverBase.Length - '/remote'.Length)
}
$settings.assets.server = $serverBase.TrimEnd('/') + '/'
$remoteAssetRoot = $settings.assets.server + 'remote/'
$remoteBundles = @($settings.assets.remoteBundles)
foreach ($bundleName in @("main", "resources")) {
    if ($remoteBundles -notcontains $bundleName) {
        $remoteBundles += $bundleName
    }
    $bundlePath = Join-Path $remoteOutput $bundleName
    if (-not (Test-Path -LiteralPath $bundlePath -PathType Container)) {
        throw "Remote bundle is missing: $bundleName"
    }
    if (@(Get-ChildItem -LiteralPath $bundlePath -File -Filter "config*.json").Count -lt 1) {
        throw "Remote bundle has no config JSON: $bundleName"
    }
    $bundleVersion = $settings.assets.bundleVers.PSObject.Properties[$bundleName].Value
    $localBundleScript = Join-Path $output "src/bundle-scripts/$bundleName/index.$bundleVersion.js"
    if (-not (Test-Path -LiteralPath $localBundleScript -PathType Leaf)) {
        throw "Remote bundle script must remain in the WeChat main package: $localBundleScript"
    }
}
$settings.assets.remoteBundles = @($remoteBundles)
Write-Utf8NoBom $settingsPath ($settings | ConvertTo-Json -Depth 100 -Compress)

$releaseId = @(
    $settings.assets.bundleVers.main,
    $settings.assets.bundleVers.resources,
    $settings.assets.bundleVers.'start-scene'
) -join '-'
$remoteMarker = [PSCustomObject]@{
    releaseId = $releaseId
    cocosVersion = $settings.CocosEngine
    bundleVersions = $settings.assets.bundleVers
    generatedAt = (Get-Date).ToString("o")
}
$remoteMarkerPath = Join-Path $remoteOutput "_release.json"
Write-Utf8NoBom $remoteMarkerPath ($remoteMarker | ConvertTo-Json -Depth 20)

$checklistPath = Join-Path $output "UPLOAD-CHECKLIST.txt"
$checklist = @"
明中都微信小游戏上传检查单

1. 本目录可直接导入微信开发者工具，项目类型必须为“小游戏”。
2. 当前 AppId：$($projectConfig.appid)
3. Cocos 服务器基址：$($settings.assets.server)
   实际远程资源目录：$remoteAssetRoot
4. 微信公众平台后台添加合法域名（只填域名，不填路径和端口）：
   - downloadFile 合法域名：https://nyasd.net
   - request 合法域名：https://nyasd.net
5. 上传前请确认备案、小游戏类目/资质、隐私与用户协议已经完成。
6. 真正上传时重新运行：
   powershell -ExecutionPolicy Bypass -File tools/finalize-wechat-project.ps1 -AppId wx你的正式AppId -ForUpload
7. 远程资源目录 dist/wechatgame-remote/ 需部署到：
   $remoteAssetRoot
"@
Write-Utf8NoBom $checklistPath $checklist

$mainBytes = (Get-ChildItem -LiteralPath $output -Recurse -File | Measure-Object -Property Length -Sum).Sum
$remoteBytes = (Get-ChildItem -LiteralPath $remoteOutput -Recurse -File | Measure-Object -Property Length -Sum).Sum
$limitBytes = 4MB
if ($mainBytes -gt $limitBytes) {
    throw "Main package is $([math]::Round($mainBytes / 1MB, 3)) MiB, above the 4 MiB safety limit."
}
$mainWarning = if ($mainBytes -gt 3.5MB) { "WARNING: main package has less than 0.5 MiB headroom." } else { "OK" }

if (-not $SkipNetworkCheck) {
    $probe = $remoteAssetRoot + "_release.json"
    try {
        $response = Invoke-WebRequest -Uri $probe -TimeoutSec 15 -UseBasicParsing
        $deployedMarker = $response.Content | ConvertFrom-Json
        if ($deployedMarker.releaseId -ne $releaseId) {
            throw "server release '$($deployedMarker.releaseId)' does not match local release '$releaseId'"
        }
    } catch {
        $message = "Remote assets are not synchronized: $probe ($($_.Exception.Message))"
        if ($ForUpload) {
            throw $message
        }
        Write-Warning $message
    }
}

$distRoot = Split-Path -Parent $output
$uploadZip = Join-Path $distRoot "mingzhongdu-wechat-project.zip"
$remoteZip = Join-Path $distRoot "mingzhongdu-wechat-remote.zip"
Remove-Item -LiteralPath $uploadZip,$remoteZip -Force -ErrorAction SilentlyContinue
New-PortableZip $output $uploadZip
New-PortableZip $remoteOutput $remoteZip

$manifest = [PSCustomObject]@{
    generatedAt = (Get-Date).ToString("o")
    appId = $projectConfig.appid
    uploadReady = [bool]($ForUpload)
    releaseId = $releaseId
    remoteServer = $settings.assets.server
    remoteAssetRoot = $remoteAssetRoot
    mainPackageBytes = [long]$mainBytes
    mainPackageMiB = [math]::Round($mainBytes / 1MB, 3)
    remoteAssetsBytes = [long]$remoteBytes
    remoteAssetsMiB = [math]::Round($remoteBytes / 1MB, 3)
    uploadZip = [System.IO.Path]::GetFileName($uploadZip)
    uploadZipSha256 = (Get-FileHash -LiteralPath $uploadZip -Algorithm SHA256).Hash
    remoteZip = [System.IO.Path]::GetFileName($remoteZip)
    remoteZipSha256 = (Get-FileHash -LiteralPath $remoteZip -Algorithm SHA256).Hash
}
$manifestPath = Join-Path $distRoot "wechat-release-manifest.json"
Write-Utf8NoBom $manifestPath ($manifest | ConvertTo-Json -Depth 10)

[PSCustomObject]@{
    UploadProject = $output
    RemoteAssets = $remoteOutput
    AppId = $projectConfig.appid
    UploadReady = [bool]$ForUpload
    MainPackageMiB = [math]::Round($mainBytes / 1MB, 3)
    MainPackageCheck = $mainWarning
    RemoteAssetsMiB = [math]::Round($remoteBytes / 1MB, 3)
    UploadZip = $uploadZip
    RemoteZip = $remoteZip
    Manifest = $manifestPath
}
