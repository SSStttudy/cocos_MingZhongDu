param(
    [string]$BuildRoot = "build/wechatgame",
    [string]$RemoteServer = "https://nyasd.net/mingzhongdu-wechat/"
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$root = (Resolve-Path -LiteralPath $BuildRoot).Path
$settingsFiles = @(Get-ChildItem -LiteralPath (Join-Path $root "src") -File -Filter "settings*.json")
if ($settingsFiles.Count -ne 1) {
    throw "Expected exactly one Cocos settings JSON file, found $($settingsFiles.Count)."
}
$settingsPath = $settingsFiles[0].FullName
$sourceBundle = Join-Path $root "assets/resources"
$remoteRoot = Join-Path $root "remote"
$targetBundle = Join-Path $remoteRoot "resources"

if (-not (Test-Path -LiteralPath (Join-Path $root "game.json"))) {
    throw "The selected folder is not a Cocos WeChat Mini Game build: $root"
}
if (-not (Test-Path -LiteralPath $settingsPath)) {
    throw "Missing Cocos settings file: $settingsPath"
}

foreach ($path in @($settingsPath, $sourceBundle, $remoteRoot)) {
    $full = [System.IO.Path]::GetFullPath($path)
    if (-not $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe path outside the WeChat build: $full"
    }
}

if (Test-Path -LiteralPath $sourceBundle) {
    New-Item -ItemType Directory -Path $remoteRoot -Force | Out-Null
    if (Test-Path -LiteralPath $targetBundle) {
        Remove-Item -LiteralPath $targetBundle -Recurse -Force
    }
    Move-Item -LiteralPath $sourceBundle -Destination $targetBundle
} elseif (-not (Test-Path -LiteralPath $targetBundle)) {
    throw "Could not find the resources bundle in assets/ or remote/."
}

# WeChat Mini Games cannot execute JavaScript downloaded from a remote server.
# Keep the resources bundle registration script inside the local main package.
$resourceBundleScriptDir = Join-Path $root "src/bundle-scripts/resources"
$resourceBundleIndexes = @(Get-ChildItem -LiteralPath $targetBundle -File -Filter "index*.js")
if ($resourceBundleIndexes.Count -ne 1) {
    throw "Expected exactly one resources bundle index script, found $($resourceBundleIndexes.Count)."
}
New-Item -ItemType Directory -Path $resourceBundleScriptDir -Force | Out-Null
Get-ChildItem -LiteralPath $resourceBundleScriptDir -File -Filter "index*.js" -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
Copy-Item -LiteralPath $resourceBundleIndexes[0].FullName -Destination $resourceBundleScriptDir -Force

$settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
$serverBase = $RemoteServer.TrimEnd('/')
if ($serverBase.EndsWith('/remote', [System.StringComparison]::OrdinalIgnoreCase)) {
    $serverBase = $serverBase.Substring(0, $serverBase.Length - '/remote'.Length)
}
$settings.assets.server = $serverBase.TrimEnd('/') + '/'
$remoteBundles = @($settings.assets.remoteBundles)
if ($remoteBundles -notcontains "resources") {
    $settings.assets.remoteBundles = @($remoteBundles + "resources")
}
[System.IO.File]::WriteAllText(
    $settingsPath,
    ($settings | ConvertTo-Json -Depth 100 -Compress),
    $utf8NoBom
)

$mainBytes = (Get-ChildItem -LiteralPath $root -Recurse -File |
    Where-Object { $_.FullName -notlike "$remoteRoot*" } |
    Measure-Object -Property Length -Sum).Sum
$remoteBytes = (Get-ChildItem -LiteralPath $remoteRoot -Recurse -File |
    Measure-Object -Property Length -Sum).Sum

[PSCustomObject]@{
    BuildRoot = $root
    MainPackageMiB = [math]::Round($mainBytes / 1MB, 2)
    RemoteAssetsMiB = [math]::Round($remoteBytes / 1MB, 2)
    RemoteServer = $settings.assets.server
    RemoteBundles = ($settings.assets.remoteBundles -join ", ")
}
