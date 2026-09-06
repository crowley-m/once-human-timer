# Removes the scheduled poll task.
$ErrorActionPreference = 'Stop'
$taskName = 'OnceHumanTimer-DiscordPoll'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "Removed '$taskName'."
} else {
  Write-Host "'$taskName' is not registered."
}
