param([ValidateSet('primary', 'secondary')][string]$Account = 'primary')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$leaf = if ($Account -eq 'secondary') { '.credentials-secondary.dpapi' } else { '.credentials.dpapi' }
$target = Join-Path -Path (Split-Path -Parent $MyInvocation.MyCommand.Path) -ChildPath $leaf
if (-not (Test-Path -LiteralPath $target)) { exit 2 }
$protected = [System.IO.File]::ReadAllBytes($target)
$bytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $protected,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::WriteLine([System.Text.Encoding]::UTF8.GetString($bytes))
