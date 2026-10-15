param(
  [string]$Url = '',
  [string[]]$ProjectPaths = @(),
  [switch]$NoAutostart,
  [switch]$PairAgain
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$bundlePath = Join-Path $PSScriptRoot 'dist/codex-remote.mjs'
$nodePath = (Get-Command node.exe).Source
if (-not (Test-Path -LiteralPath $bundlePath)) {
  Push-Location $repoRoot
  try {
    & $nodePath 'scripts/build.mjs' remote
    if ($LASTEXITCODE -ne 0) { throw 'Build failed. Run npm install, then npm run build:remote.' }
  } finally { Pop-Location }
}
if (-not $Url) {
  $watcherConfig = 'C:/Users/Public/ai-limits/config.json'
  if (Test-Path -LiteralPath $watcherConfig) { $Url = (Get-Content -LiteralPath $watcherConfig -Raw -Encoding UTF8 | ConvertFrom-Json).url }
}
if (-not $Url) { $Url = Read-Host 'Tracker URL (https://...)' }
$relayUri = [Uri]$Url
if ($relayUri.Scheme -ne 'https' -and -not ($relayUri.Scheme -eq 'http' -and $relayUri.IsLoopback)) { throw 'HTTPS is required for remote access.' }
if (-not $ProjectPaths.Count) { $ProjectPaths = @($repoRoot) }
$projects = @($ProjectPaths | ForEach-Object {
  $projectDir = Get-Item -LiteralPath $_
  if (-not $projectDir.PSIsContainer) { throw 'Project must be a directory.' }
  @{ name = $projectDir.Name; path = $projectDir.FullName }
})
$installDir = Join-Path $env:LOCALAPPDATA 'AILimits/CodexRemote'
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
$userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $installDir /inheritance:r /grant:r ('*' + $userSid + ':(OI)(CI)F') /grant:r '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect the local installation directory.' }
$scriptPath = Join-Path $installDir 'codex-remote.mjs'
$configPath = Join-Path $installDir 'codex-remote.config.json'
$vbsPath = Join-Path $installDir 'start.vbs'
$runnerPath = Join-Path $installDir 'run.ps1'
Copy-Item -LiteralPath $bundlePath -Destination $scriptPath -Force
$codexHome = $env:CODEX_HOME
if (-not $codexHome) { $codexHome = [Environment]::GetEnvironmentVariable('CODEX_HOME', 'User') }
if (-not $codexHome) { $codexHome = Join-Path $env:USERPROFILE '.codex' }
$config = @{ url = $relayUri.GetLeftPart([System.UriPartial]::Authority); name = $env:COMPUTERNAME; codexHome = $codexHome; projects = $projects }
if (-not $PairAgain -and (Test-Path -LiteralPath $configPath)) {
  $old = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($old.url -eq $config.url -and $old.hostId -and $old.token) { $config.hostId = $old.hostId; $config.token = $old.token }
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 5), $utf8)
if (-not $config.token) {
  Write-Host 'Open Agents > Chat Codex in your tracker, unlock, and create a pairing code.'
  $pairingCode = Read-Host 'Pairing code (valid for 5 minutes)'
  $pairingCode | & $nodePath $scriptPath --config $configPath --pair
  $pairingCode = $null
  if ($LASTEXITCODE -ne 0) { throw 'Pairing failed. Update your tracker server and try a fresh code.' }
}
# Hidden supervisor restarts crashes; a revoked pairing or duplicate instance exits cleanly.
$runner = @'
$ErrorActionPreference = 'Stop'
do {
  & '__NODE__' '__SCRIPT__' --config '__CONFIG__'
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 10
} while ($true)
'@
$runner = $runner.Replace('__NODE__', $nodePath.Replace("'", "''")).Replace('__SCRIPT__', $scriptPath.Replace("'", "''")).Replace('__CONFIG__', $configPath.Replace("'", "''"))
# Windows PowerShell 5 needs a BOM when the generated paths contain non-ASCII names.
[System.IO.File]::WriteAllText($runnerPath, $runner, (New-Object System.Text.UTF8Encoding($true)))
$launchCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $runnerPath + '"'
$vbs = 'CreateObject("WScript.Shell").Run "' + $launchCommand.Replace('"', '""') + '", 0, False'
[System.IO.File]::WriteAllText($vbsPath, $vbs, [System.Text.Encoding]::Unicode)
if (-not $NoAutostart) {
  $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  New-Item -Path $runKey -Force | Out-Null
  New-ItemProperty -Path $runKey -Name 'AILimitsCodexRemote' -Value ('"' + (Join-Path $env:WINDIR 'System32/wscript.exe') + '" "' + $vbsPath + '"') -PropertyType String -Force | Out-Null
}
Start-Process -FilePath (Join-Path $env:WINDIR 'System32/wscript.exe') -ArgumentList ('"' + $vbsPath + '"') -WindowStyle Hidden
Write-Host ('Installed and started. Local config: ' + $configPath)
Write-Host 'Open Chat Codex on your phone. No hooks or prompt instructions are needed.'
