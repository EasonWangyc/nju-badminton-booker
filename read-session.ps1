param([ValidateSet('primary', 'secondary')][string]$Account = 'primary')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$leaf = if ($Account -eq 'secondary') { '.session-secondary.dpapi' } else { '.session.dpapi' }
$target = Join-Path -Path (Split-Path -Parent $MyInvocation.MyCommand.Path) -ChildPath $leaf
if (-not (Test-Path -LiteralPath $target)) { exit 2 }
$encrypted = [IO.File]::ReadAllBytes($target)
$plain = [Security.Cryptography.ProtectedData]::Unprotect(
    $encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))
