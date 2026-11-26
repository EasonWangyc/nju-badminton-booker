param(
    [switch]$DependenciesOnly
)

$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectDir

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
$uvCommand = Get-Command uv.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand -or -not $npmCommand) {
    throw '找不到 Node.js/npm。请先安装 Node.js 22 或更新版本，并重新打开 PowerShell。'
}
if (-not $uvCommand) {
    throw '找不到 uv。请先运行 winget install --id=astral-sh.uv -e，然后重新打开 PowerShell。'
}
$nodeVersion = & $nodeCommand.Source --version
if ($LASTEXITCODE -ne 0) { throw '无法读取 Node.js 版本' }
$nodeMajor = [int]([regex]::Match($nodeVersion, '^v(\d+)').Groups[1].Value)
if ($nodeMajor -lt 22) { throw '需要 Node.js 22 或更新版本' }

Write-Host '安装 Node.js 依赖...'
& $npmCommand.Source ci --omit=dev
if ($LASTEXITCODE -ne 0) { throw 'npm ci 失败' }
Write-Host '根据 pyproject.toml 和 uv.lock 创建/更新 .venv...'
& $uvCommand.Source sync --locked
if ($LASTEXITCODE -ne 0) { throw 'uv sync 失败' }
$pythonExe = Join-Path $projectDir '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) { throw '.venv 中没有 Python 可执行文件' }
& $pythonExe -c 'import ddddocr, cv2, numpy, PIL, onnxruntime'
if ($LASTEXITCODE -ne 0) { throw 'OCR 依赖导入失败' }

if ($DependenciesOnly) {
    Write-Host 'Node.js 和 Python 依赖安装完成。'
    return
}

$configPath = Join-Path $projectDir 'config.local.json'
$newConfig = -not (Test-Path -LiteralPath $configPath)
if ($newConfig) {
    Copy-Item -LiteralPath (Join-Path $projectDir 'config.example.json') -Destination $configPath
    Write-Host '已创建本地配置 config.local.json。'
} else {
    Write-Host '已保留现有 config.local.json；请确认 OCR 指向本机 .venv。'
}
$targetPath = Join-Path $projectDir 'target.json'
if (-not (Test-Path -LiteralPath $targetPath)) {
    Copy-Item -LiteralPath (Join-Path $projectDir 'target.example.json') -Destination $targetPath
}

$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Host '需要配置的账号：1 双账号；2 仅账号1；3 仅账号2'
$choice = (Read-Host '选择 [1]').Trim()
if (-not $choice) { $choice = '1' }
$accounts = switch ($choice) {
    '1' { @('primary', 'secondary') }
    '2' { @('primary') }
    '3' { @('secondary') }
    default { throw '账号选项无效' }
}
foreach ($account in $accounts) {
    $label = if ($account -eq 'primary') { '账号1' } else { '账号2' }
    $buddy = [string]$config.accounts.$account.buddy
    if ([string]::IsNullOrWhiteSpace($buddy) -or $buddy -in @('同伴姓名', '第二账号的同伴姓名')) {
        $buddy = (Read-Host "$label 的同伴姓名").Trim()
        if ([string]::IsNullOrWhiteSpace($buddy)) { throw "$label 的同伴姓名不能为空" }
        $config.accounts.$account.buddy = $buddy
    }
}
$json = $config | ConvertTo-Json -Depth 5
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($configPath, $json + [Environment]::NewLine, $utf8)
foreach ($account in $accounts) {
    $credentialName = if ($account -eq 'primary') { '.credentials.dpapi' } else { '.credentials-secondary.dpapi' }
    if (-not (Test-Path -LiteralPath (Join-Path $projectDir $credentialName))) {
        & (Join-Path $projectDir 'save-credential.ps1') -Account $account
    }
}

$installTask = (Read-Host '安装每天 07:55 运行的计划任务？[Y/n]').Trim()
if ($installTask -notin @('', 'y', 'Y', 'n', 'N')) { throw '计划任务选项无效' }
if ($installTask -notin @('n', 'N')) {
    & (Join-Path $projectDir 'install-task.ps1')
}
Write-Host '安装完成。需要预约时运行 node configure.js 选择日期和条件。'
