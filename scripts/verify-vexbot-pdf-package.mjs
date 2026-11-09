// Local-only parser packaging check. No credentials, network calls or database writes.
// Optional: node scripts/verify-vexbot-pdf-package.mjs path/to/an-authorised.pdf
import { build } from 'vite';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pdf } from '../tests/helpers/pdf.mjs';
import assert from 'node:assert/strict';

const bytes = process.argv[2] ? await readFile(process.argv[2]) : pdf([['Package verification page one.'], ['Package verification final page.']]);
await build({
  configFile: false, logLevel: 'warn', ssr: { noExternal: ['pdfjs-dist'] },
  build: {
    ssr: 'server/vexbot/files.mjs', outDir: 'artifacts/pdf-package-verification', emptyOutDir: true, minify: false,
    rolldownOptions: { output: { entryFileNames: 'files.mjs', chunkFileNames: '[name]-[hash].mjs' } },
  },
});
const bundled = await import('../artifacts/pdf-package-verification/files.mjs');
const extracted = await bundled.extractText(bytes, 'application/pdf');
assert.ok(extracted.text.length > 0, 'The packaged parser extracts usable text.');
if (!process.argv[2]) assert.match(extracted.text, /\[Page 2\][\s\S]*final page/);
const result = { ok: true, bytes: bytes.length, characters: extracted.text.length, pages: (extracted.text.match(/\[Page /g) || []).length, note: extracted.note };
await mkdir('artifacts/pdf-diagnosis', { recursive: true });
await writeFile('artifacts/pdf-diagnosis/package-verification.json', JSON.stringify(result, null, 2));
console.log(result);
