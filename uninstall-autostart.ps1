# Removes the Startup entries and stops the running processes.
$ErrorActionPreference = 'Continue'
$startup = [Environment]::GetFolderPath('Startup')

foreach ($n in 'OnceHumanTimer-Server', 'OnceHumanTimer-DiscordPoll') {
  $lnk = Join-Path $startup "$n.lnk"
  if (Test-Path $lnk) { Remove-Item $lnk; Write-Host "removed Startup\$n.lnk" }
}

# stop the loop wrappers + their node children
Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" |
  Where-Object { $_.CommandLine -match 'run-server\.cmd|run-poll-loop\.cmd' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'once human web claude\\server\\src\\index\.js|once human web claude\\bot\\src\\poll\.js' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host 'done.'
