#Requires -Version 5.1
<#
.SYNOPSIS
  Pack Soul Lens and mount it over the installed Deadlock build.

.DESCRIPTION
  The mod is one Panorama VPK that replaces the game's own shop item hover layout
  and adds the Soul Lens strip to it. It installs beside the game's addons, not
  inside another mod's folder, and it is mounted by one SearchPaths line:

      game   citadel/addons/soul_lens

  This script compiles `panorama/` with the family's CSDK resource compiler, packs
  it with Source2Viewer CLI into `dist/soul_lens/pak01_dir.vpk` (retail Panorama
  loads only compiled `.vxml_c`/`.vjs_c`/`.vcss_c` assets), copies it to
  `game/citadel/addons/soul_lens/pak01_dir.vpk`, and adds that line to
  `game/citadel/gameinfo.gi` when it is absent. It backs the file up once as
  `gameinfo.gi.soul-lens-bak`, and refuses rather than guessing when the file's
  SearchPaths block does not look like the build it was written for.

  The game reads gameinfo.gi at launch, so close Deadlock before installing. The
  script never starts or stops the game.

.PARAMETER DeadlockRoot
  The Deadlock install folder (the one containing `game\citadel`). Defaults to
  $env:DEADLOCK_GAME, then to the Steam library path this project measured.

.PARAMETER DryRun
  Pack and report, but write nothing into the game folder.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1
  powershell -ExecutionPolicy Bypass -File install.ps1 -DeadlockRoot 'D:\SteamLibrary\steamapps\common\Deadlock'
#>
[CmdletBinding()]
param(
    [string]$DeadlockRoot = '',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $DeadlockRoot) { $DeadlockRoot = $env:DEADLOCK_GAME }
if (-not $DeadlockRoot) { $DeadlockRoot = 'D:\SteamLibrary\steamapps\common\Deadlock' }

$citadel = Join-Path $DeadlockRoot 'game\citadel'
$gameinfo = Join-Path $citadel 'gameinfo.gi'
if (-not (Test-Path $gameinfo)) { throw "refused: $gameinfo is not a Deadlock install" }

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { throw 'refused: python is not on PATH' }

$out = Join-Path $here 'dist\soul_lens\pak01_dir.vpk'
# Stamp the build this mount is for. Panorama cannot read steam.inf, so the
# installer is where the strip learns which build's terms it may draw; a build
# with no terms snapshot installs, and the strip withholds the weapon terms.
$steamInf = Join-Path $citadel 'steam.inf'
& $python (Join-Path $here 'tools\stamp_build.py') --steam-inf $steamInf
$stampExit = $LASTEXITCODE
if ($stampExit -eq 1) { throw 'refused: no installed build could be read from steam.inf' }
if ($stampExit -eq 3) { Write-Warning 'installed build has no terms snapshot: the strip will withhold weapon terms until tools/ingest.py runs for it' }
elseif ($stampExit -ne 0) { throw "refused: stamp_build.py exited $stampExit" }
# Both halves matter: the CSDK compiler turns the layout/scripts/css into the
# compiled assets retail Panorama loads, and S2V writes the archive with the
# `panorama/` prefix the mount expects. Set $env:CSDK13 and
# $env:SOURCE2VIEWER_CLI to override the paths this project measured.
& $python (Join-Path $here 'tools\build_addon.py') --out $out
if ($LASTEXITCODE -ne 0) { throw "refused: build_addon.py exited $LASTEXITCODE" }

$targetDir = Join-Path $citadel 'addons\soul_lens'
$target = Join-Path $targetDir 'pak01_dir.vpk'
$line = 'game			citadel/addons/soul_lens'
$text = Get-Content -LiteralPath $gameinfo -Raw

$mounted = $text -match '(?m)^\s*game\s+citadel/addons/soul_lens\s*$'
if ($mounted) {
    Write-Host "search path already present in $gameinfo"
} elseif ($text -notmatch '(?m)^\s*game\s+citadel/addons\s*$') {
    throw "refused: $gameinfo has no 'game citadel/addons' SearchPaths line to anchor the new one"
} else {
    if ($DryRun) {
        Write-Host "would add: $line"
    } else {
        $backup = "$gameinfo.soul-lens-bak"
        if (-not (Test-Path $backup)) { Copy-Item -LiteralPath $gameinfo -Destination $backup }
        $text = $text -replace '(?m)^(\s*game\s+citadel/addons\s*)$', ('$1' + "`r`n`t`t`t" + $line)
        Set-Content -LiteralPath $gameinfo -Value $text -NoNewline
        Write-Host "added search path: $line"
    }
}

if ($DryRun) {
    Write-Host "dry run: packed $out, wrote nothing into $citadel"
    exit 0
}

New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
Copy-Item -LiteralPath $out -Destination $target -Force
$size = (Get-Item -LiteralPath $target).Length
Write-Host "installed $target ($size bytes)"
Write-Host 'Launch Deadlock, open the shop, hover an item: the strip is under the card.'
Write-Host 'To remove: delete the pak01_dir.vpk above and the one SearchPaths line the script added.'
