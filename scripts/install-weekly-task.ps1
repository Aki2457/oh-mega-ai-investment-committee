$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskName = 'OH MEGA Weekly Paper Committee'
$command = "cd /d `"$project`" && npm run committee:weekly >> committee-scheduler.log 2>&1"
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c $command"
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday -At '08:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Runs the OH MEGA Think Standard paper investment committee at 08:00 Singapore time each Saturday.' -Force | Out-Null
Write-Output "Installed scheduled task: $taskName"
