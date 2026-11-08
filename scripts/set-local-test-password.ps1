$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
$pointer = [IntPtr]::Zero
$previousOutputEncoding = $OutputEncoding
try {
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $secret = Read-Host 'New password for the LOCAL Test account (12+ characters, upper/lowercase and digit)' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    # Pass only through stdin: never command arguments, environment, files or output.
    $plain | & node (Join-Path $PSScriptRoot 'set-local-test-password.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Local password setup did not complete.' }
} finally {
    $plain = $null
    $OutputEncoding = $previousOutputEncoding
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($secret) { $secret.Dispose() }
    Pop-Location
}
