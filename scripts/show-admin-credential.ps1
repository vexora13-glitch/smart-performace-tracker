param([switch]$Show)
if (-not $Show) { Write-Output 'Run with -Show to reveal the local administrator credential for this Windows user.'; exit }
$portalCredentialPath = Join-Path $PSScriptRoot '../artifacts/portal-admin.dpapi.local'
$portalEncryptedValue = Get-Content -LiteralPath $portalCredentialPath -Raw
$portalSecureValue = $portalEncryptedValue.Trim() | ConvertTo-SecureString
$portalLocalCredential = [System.Management.Automation.PSCredential]::new('portal', $portalSecureValue)
$portalAccount = $portalLocalCredential.GetNetworkCredential().Password | ConvertFrom-Json
Write-Output "Email: $($portalAccount.email)"
Write-Output "Password: $($portalAccount.password)"
