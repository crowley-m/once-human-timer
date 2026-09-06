# Sets up the timer API (and, if bot\.env is ready, the Discord poll) to start
# hidden at every logon - no admin needed. Also starts them right now.
#   powershell -ExecutionPolicy Bypass -File install-autostart.ps1
$ErrorActionPreference = 'Stop'

$root    = $PSScriptRoot
$vbs     = Join-Path $root 'hidden-run.vbs'
$startup = [Environment]::GetFolderPath('Startup')
$wsh     = New-Object -ComObject WScript.Shell

function Add-Autostart($name, $cmd) {
  $lnk = $wsh.CreateShortcut((Join-Path $startup "$name.lnk"))
  $lnk.TargetPath       = "$env:SystemRoot\System32\wscript.exe"
  $lnk.Arguments        = "`"$vbs`" `"$cmd`""
  $lnk.WorkingDirectory = Split-Path $cmd
  $lnk.WindowStyle      = 7
  $lnk.Description       = "Once Human rift timer - $name"
  $lnk.Save()
  Start-Process wscript.exe -ArgumentList "`"$vbs`" `"$cmd`""   # start now too
  Write-Host "  + $name  (Startup\$name.lnk, started now)"
}

Write-Host 'Installing autostart entries:'
Add-Autostart 'OnceHumanTimer-Server' (Join-Path $root 'server\run-server.cmd')

$botEnv = Join-Path $root 'bot\.env'
if ((Test-Path $botEnv) -and ((Get-Content $botEnv -Raw) -match '(?m)^\s*DISCORD_TOKEN\s*=\s*\S')) {
  Add-Autostart 'OnceHumanTimer-DiscordPoll' (Join-Path $root 'bot\run-poll-loop.cmd')
} else {
  Write-Host '  - Discord poll skipped: bot\.env has no DISCORD_TOKEN yet.'
  Write-Host '    Fill it in, then re-run this script (or run install-autostart.ps1 again).'
}

Write-Host ''
Write-Host 'Done. Logs: server\server.log  and  bot\poll.log'
Write-Host 'App: http://localhost:3002'
Write-Host 'Undo: powershell -ExecutionPolicy Bypass -File uninstall-autostart.ps1'
