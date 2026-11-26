param([ValidateSet('primary', 'secondary')][string]$Account = 'primary')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$leaf = if ($Account -eq 'secondary') { '.session-secondary.dpapi' } else { '.session.dpapi' }
$target = Join-Path -Path (Split-Path -Parent $MyInvocation.MyCommand.Path) -ChildPath $leaf
$json = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($json)) { throw 'Empty session data' }
$plain = [Text.Encoding]::UTF8.GetBytes($json)
$encrypted = [Security.Cryptography.ProtectedData]::Protect(
    $plain, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[IO.File]::WriteAllBytes($target, $encrypted)
