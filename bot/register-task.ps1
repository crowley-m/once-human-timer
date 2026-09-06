# Registers a Windows scheduled task that polls the Discord channel every 5 minutes.
# Run once, from this folder:  powershell -ExecutionPolicy Bypass -File register-task.ps1
$ErrorActionPreference = 'Stop'

$botDir   = $PSScriptRoot
$taskName = 'OnceHumanTimer-DiscordPoll'
$wrapper  = Join-Path $botDir 'run-poll.cmd'
$envFile  = Join-Path $botDir '.env'

if (-not (Test-Path $envFile)) {
  Write-Error "No .env found. Copy .env.example to .env and fill in DISCORD_TOKEN and WATCH_CHANNEL_ID first."
}
$envText = Get-Content $envFile -Raw
if ($envText -notmatch '(?m)^\s*DISCORD_TOKEN\s*=\s*\S' -or $envText -notmatch '(?m)^\s*WATCH_CHANNEL_ID\s*=\s*\S') {
  Write-Error "DISCORD_TOKEN and WATCH_CHANNEL_ID must be set in .env before registering the task."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "node is not on PATH."
}

$action  = New-ScheduledTaskAction -Execute $wrapper -WorkingDirectory $botDir
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
             -RepetitionInterval (New-TimeSpan -Minutes 5) `
             -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
              -MultipleInstances IgnoreNew `
              -ExecutionTimeLimit (New-TimeSpan -Minutes 4)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Polls the clan Discord reset-log channel and updates the Once Human timer board.' -Force | Out-Null

Write-Host "Registered '$taskName' - first run in ~1 min, then every 5 minutes."
Write-Host "Output: $botDir\poll.log"
Write-Host "Run now:      Start-ScheduledTask -TaskName $taskName"
Write-Host "Remove later: powershell -ExecutionPolicy Bypass -File unregister-task.ps1"
