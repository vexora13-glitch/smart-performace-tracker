import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Operations-only storage, encrypted for the current Windows user with DPAPI.
function run(name, command, input = '') {
  if (process.platform !== 'win32')
    throw new Error(
      'Local credential storage requires Windows DPAPI. Supply credentials through process environment on other platforms.',
    );
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid credential name.');
  mkdirSync('artifacts', { recursive: true });
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    {
      input,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, PORTAL_CREDENTIAL_PATH: resolve('artifacts', `${name}.dpapi.local`) },
    },
  );
  if (result.status !== 0) throw new Error('Local credential encryption/decryption failed.');
  return result.stdout;
}
export function saveCredential(name, value) {
  run(
    name,
    '$portalSecret=[Console]::In.ReadToEnd(); $portalSecure=ConvertTo-SecureString -String $portalSecret -AsPlainText -Force; $portalSecure | ConvertFrom-SecureString | Set-Content -LiteralPath $env:PORTAL_CREDENTIAL_PATH -Encoding utf8',
    JSON.stringify(value),
  );
}
export function loadCredential(name) {
  return JSON.parse(
    run(
      name,
      "$portalEncrypted=Get-Content -LiteralPath $env:PORTAL_CREDENTIAL_PATH -Raw; $portalSecure=$portalEncrypted.Trim() | ConvertTo-SecureString; $portalCredential=[System.Management.Automation.PSCredential]::new('portal',$portalSecure); [Console]::Out.Write($portalCredential.GetNetworkCredential().Password)",
    ),
  );
}
