import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const checkout = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const instruction = 'Use the primary smart-performance-tracker checkout on branch portal.';

if (realpathSync(process.cwd()) !== checkout) {
  console.error(instruction);
  process.exit(1);
}

let gitInfo;
try {
  gitInfo = execFileSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--abbrev-ref', 'HEAD'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
  );
} catch {
  console.error('Could not verify the checkout with Git. ' + instruction);
  process.exit(1);
}

const [gitDir, commonDir, branch] = gitInfo.trim().split(/\r?\n/);
if (gitDir !== commonDir || branch !== 'portal') {
  console.error('Development blocked on ' + (branch || 'an unknown branch') + '. ' + instruction);
  process.exit(1);
}
