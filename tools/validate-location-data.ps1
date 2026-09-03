param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$errors = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()
$checkedForegroundAssets = @{}

function Test-PointInPolygon {
    param($Point, [object[]]$Polygon)
    $inside = $false
    for ($i = 0; $i -lt $Polygon.Count; $i++) {
        $j = if ($i -eq 0) { $Polygon.Count - 1 } else { $i - 1 }
        $a = $Polygon[$i]
        $b = $Polygon[$j]
        if (([double]$a.y -gt [double]$Point.y) -ne ([double]$b.y -gt [double]$Point.y)) {
            $edgeX = ([double]$b.x - [double]$a.x) * ([double]$Point.y - [double]$a.y) /
                ([double]$b.y - [double]$a.y) + [double]$a.x
            if ([double]$Point.x -lt $edgeX) { $inside = -not $inside }
        }
    }
    return $inside
}

function Get-PolygonCenter {
    param([object[]]$Points)
    $x = 0.0
    $y = 0.0
    foreach ($point in $Points) {
        $x += [double]$point.x
        $y += [double]$point.y
    }
    return [pscustomobject]@{ x = $x / $Points.Count; y = $y / $Points.Count }
}

$locationRoot = Join-Path $ProjectRoot 'assets/resources/locations'
$documents = @{}
foreach ($file in Get-ChildItem -LiteralPath $locationRoot -Recurse -Filter 'regions.json') {
    $locationId = Split-Path -Leaf (Split-Path -Parent $file.FullName)
    $documents[$locationId] = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
}

foreach ($entry in $documents.GetEnumerator()) {
    $locationId = $entry.Key
    $document = $entry.Value
    $sceneNames = @($document.scenes.PSObject.Properties.Name)
    $locationPath = Join-Path $locationRoot $locationId
    $sceneRoot = Join-Path $locationPath 'scenes'
    if (-not (Test-Path -LiteralPath $sceneRoot)) { $sceneRoot = $locationPath }

    foreach ($sceneProperty in $document.scenes.PSObject.Properties) {
        $sceneId = $sceneProperty.Name
        $scene = $sceneProperty.Value
        $prefix = "$locationId/$sceneId"
        $background = @(
            Join-Path $sceneRoot "$sceneId.jpg"
            Join-Path $sceneRoot "$sceneId.png"
        ) | Where-Object { Test-Path -LiteralPath $_ }
        if ($background.Count -eq 0) { $errors.Add("$prefix missing background asset") }

        $regions = @($scene.regions | Where-Object { $_.enabled -ne $false })
        $ids = @{}
        foreach ($region in $regions) {
            if ($ids.ContainsKey([string]$region.id)) {
                $errors.Add("$prefix duplicate region id: $($region.id)")
            } else { $ids[[string]$region.id] = $true }
            $points = @($region.points)
            if ($points.Count -lt 3) { $errors.Add("$prefix/$($region.id) has fewer than 3 points") }
            foreach ($point in $points) {
                $x = [double]$point.x
                $y = [double]$point.y
                $invalid = [double]::IsNaN($x) -or [double]::IsInfinity($x) -or
                    [double]::IsNaN($y) -or [double]::IsInfinity($y)
                if ($invalid) {
                    $errors.Add("$prefix/$($region.id) contains non-finite coordinates")
                } elseif ($x -lt -0.1 -or $x -gt 1.1 -or $y -lt -0.1 -or $y -gt 1.1) {
                    $warnings.Add("$prefix/$($region.id) point outside canvas tolerance: $x,$y")
                }
            }
        }

        $walkAreas = @($regions | Where-Object { [int]$_.type -eq 0 })
        if ($walkAreas.Count -eq 0) { $errors.Add("$prefix has no walkable region") }
        foreach ($spawn in @($regions | Where-Object { [int]$_.type -eq 5 })) {
            $center = Get-PolygonCenter @($spawn.points)
            if (-not ($walkAreas | Where-Object { Test-PointInPolygon $center @($_.points) })) {
                $warnings.Add("$prefix/$($spawn.id) spawn center is outside walkable regions")
            }
        }

        foreach ($transition in @($regions | Where-Object { [int]$_.type -eq 3 })) {
            $targetSceneId = [string]$transition.targetSceneId
            if ($targetSceneId) {
                if ($targetSceneId -notin $sceneNames) {
                    $errors.Add("$prefix/$($transition.id) targets missing scene: $targetSceneId")
                    continue
                }
                $targetScene = $document.scenes.$targetSceneId
                $targetSpawnId = [string]$transition.targetSpawnId
                $targetSpawns = @($targetScene.regions | Where-Object {
                    $_.enabled -ne $false -and [int]$_.type -eq 5
                } | ForEach-Object { [string]$_.id })
                if (-not $targetSpawnId -or $targetSpawnId -notin $targetSpawns) {
                    $errors.Add("$prefix/$($transition.id) has invalid target spawn: $targetSceneId/$targetSpawnId")
                }
            } elseif (-not [string]$transition.overworldEntryId) {
                $errors.Add("$prefix/$($transition.id) has neither target scene nor overworld entry")
            }
        }

        foreach ($line in @($scene.occlusionLines | Where-Object {
            $null -ne $_ -and $_.enabled -ne $false
        })) {
            if (@($line.points).Count -lt 2) {
                $errors.Add("$prefix/$($line.id) occlusion line has fewer than 2 endpoints")
            }
            $asset = [string]$line.foregroundAsset
            $assetPath = Join-Path $sceneRoot "$asset.png"
            if (-not $asset -or -not (Test-Path -LiteralPath $assetPath)) {
                $errors.Add("$prefix/$($line.id) missing foreground asset: $asset")
                continue
            }
            if (-not $checkedForegroundAssets.ContainsKey($assetPath)) {
                $checkedForegroundAssets[$assetPath] = $true
                $pngBytes = [System.IO.File]::ReadAllBytes($assetPath)
                if ($pngBytes.Length -lt 26 -or $pngBytes[25] -notin @(4, 6)) {
                    $errors.Add("$prefix/$($line.id) foreground PNG has no alpha channel: $asset")
                }
            }
            $metaPath = "$assetPath.meta"
            if (Test-Path -LiteralPath $metaPath) {
                $meta = Get-Content -LiteralPath $metaPath -Raw -Encoding UTF8 | ConvertFrom-Json
                $spriteMeta = @($meta.subMetas.PSObject.Properties.Value | Where-Object {
                    $_.importer -eq 'sprite-frame'
                })[0]
                $data = $spriteMeta.userData
                if ($data -and [double]$data.rawWidth -gt 0) {
                    $opaqueMinX = [double]$data.trimX / [double]$data.rawWidth
                    $opaqueMaxX = ([double]$data.trimX + [double]$data.width) / [double]$data.rawWidth
                    $lineMinX = [math]::Min([double]$line.points[0].x, [double]$line.points[1].x)
                    $lineMaxX = [math]::Max([double]$line.points[0].x, [double]$line.points[1].x)
                    if ($lineMinX -lt $opaqueMinX - 0.06 -or $lineMaxX -gt $opaqueMaxX + 0.06) {
                        $warnings.Add(
                            "$prefix/$($line.id) horizontal range exceeds foreground alpha bounds"
                        )
                    }
                }
            }
        }
    }
}

Write-Host "Location data validation: $($documents.Count) locations"
foreach ($warning in $warnings) { Write-Warning $warning }
foreach ($problem in $errors) { Write-Error $problem }
if ($errors.Count -gt 0) { exit 1 }
Write-Host "OK: 0 errors, $($warnings.Count) warnings"
