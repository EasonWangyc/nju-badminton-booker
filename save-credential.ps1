param(
    [ValidateSet('primary', 'secondary')][string]$Account = 'primary',
    [switch]$FromStdin
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

if ($FromStdin) {
    $source = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $studentId = [string]$source.username
    $password = [string]$source.password
} else {
    $studentId = Read-Host '请输入学号'
    $securePassword = Read-Host '请输入南大统一认证密码（输入时不显示）' -AsSecureString
    $credential = New-Object System.Management.Automation.PSCredential($studentId, $securePassword)
    $password = $credential.GetNetworkCredential().Password
}
if ($studentId -notmatch '^\d+$' -or [string]::IsNullOrEmpty($password)) { throw '凭据格式不正确' }
$payload = [pscustomobject]@{
    username = $studentId
    password = $password
} | ConvertTo-Json -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
$protected = [System.Security.Cryptography.ProtectedData]::Protect(
    $bytes,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
$leaf = if ($Account -eq 'secondary') { '.credentials-secondary.dpapi' } else { '.credentials.dpapi' }
$target = Join-Path -Path (Split-Path -Parent $MyInvocation.MyCommand.Path) -ChildPath $leaf
[System.IO.File]::WriteAllBytes($target, $protected)
Write-Output '凭据已使用当前 Windows 账号的 DPAPI 加密保存。'