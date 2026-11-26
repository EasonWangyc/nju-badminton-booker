$ErrorActionPreference = 'Stop'

$taskName = 'NJU-Badminton-Booking'
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodeExe = if ($nodeCommand) { $nodeCommand.Source } else { $null }
$runner = Join-Path -Path $projectDir -ChildPath 'scheduled.js'
if (-not $nodeExe -or -not (Test-Path -LiteralPath $nodeExe)) { throw '找不到 Node.js；请先安装并加入 PATH' }
if (-not (Test-Path -LiteralPath $runner)) { throw '找不到 scheduled.js' }

$action = New-ScheduledTaskAction -Execute $nodeExe -Argument ('"' + $runner + '"') -WorkingDirectory $projectDir
$trigger = New-ScheduledTaskTrigger -Daily -At '07:55'
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

$targetPath = Join-Path -Path $projectDir -ChildPath 'target.json'
$targetDate = if (Test-Path -LiteralPath $targetPath) {
    (Get-Content -LiteralPath $targetPath -Encoding UTF8 | ConvertFrom-Json).date
} else { $null }
$task = Get-ScheduledTask -TaskName $taskName
$info = Get-ScheduledTaskInfo -TaskName $taskName
[pscustomobject]@{
    TaskName = $task.TaskName
    State = $task.State
    RunAs = $userId
    NextRunTime = $info.NextRunTime
    TargetDate = $targetDate
} | Format-List
