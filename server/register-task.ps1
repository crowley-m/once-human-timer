# Keeps the timer API running: starts at logon and restarts if it stops.
#   powershell -ExecutionPolicy Bypass -File register-task.ps1
$ErrorActionPreference = 'Stop'

$dir      = $PSScriptRoot
$taskName = 'OnceHumanTimer-Server'
$wrapper  = Join-Path $dir 'run-server.cmd'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error 'node is not on PATH.' }

$action  = New-ScheduledTaskAction -Execute $wrapper -WorkingDirectory $dir
$atLogon = New-ScheduledTaskTrigger -AtLogOn
$now     = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(15)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
              -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
              -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($atLogon, $now) `
  -Settings $settings -Description 'Once Human rift timer API (Express + SQLite).' -Force | Out-Null

Write-Host "Registered '$taskName' - starts now (~15s) and at every logon."
Write-Host "Log: $dir\server.log    App: http://localhost:3002"
Write-Host "Remove: Unregister-ScheduledTask -TaskName $taskName -Confirm:`$false"
