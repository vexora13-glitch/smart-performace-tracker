// Upload validation and text extraction for Vexbot. Files are untrusted: the declared type must match the
// file name and the bytes, sizes are bounded, archives are inflated with output limits, and nothing here
// executes or renders content. Extracted text is only ever a draft for staff review.
import { inflateRawSync } from 'node:zlib';
import { HttpError } from '../validation.mjs';

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_EXTRACT_BYTES = 20 * 1024 * 1024;
const MAX_TEXT = 200_000;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** Supported types, their file extensions, and whether text can be extracted for knowledge. */
export const UPLOAD_TYPES = {
  'application/pdf': { ext: ['pdf'], text: true, kind: 'document' },
  [DOCX]: { ext: ['docx'], text: true, kind: 'document' },
  [XLSX]: { ext: ['xlsx'], text: true, kind: 'document' },
  [PPTX]: { ext: ['pptx'], text: true, kind: 'document' },
  'text/plain': { ext: ['txt'], text: true, kind: 'document' },
  'text/markdown': { ext: ['md', 'markdown'], text: true, kind: 'document' },
  'image/jpeg': { ext: ['jpg', 'jpeg'], text: false, kind: 'image' },
  'image/png': { ext: ['png'], text: false, kind: 'image' },
  'video/mp4': { ext: ['mp4'], text: false, kind: 'video' },
  'video/webm': { ext: ['webm'], text: false, kind: 'video' },
};

/** Validates what the browser declares before any bytes are accepted. */
export function declaredFile(input) {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 240) : '';
  const type = UPLOAD_TYPES[input.mime];
  const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (!name || !type) throw new HttpError(400, 'Choose a PDF, Word, Excel, PowerPoint, text, JPEG, PNG, MP4 or WebM file.');
  if (!type.ext.includes(extension)) throw new HttpError(400, 'The file name does not match its type.');
  const limit = input.mime === 'video/mp4' ? 2 * MAX_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
  if (!Number.isInteger(input.size) || input.size <= 0 || input.size > limit)
    throw new HttpError(400, `Files must be between 1 byte and ${limit / (1024 * 1024)} MB.`);
  return { name, mime: input.mime, size: input.size, safeName: name.replace(/[^a-zA-Z0-9._-]/g, '_') };
}

const startsWith = (bytes, signature, at = 0) =>
  bytes.length >= at + signature.length && signature.every((value, index) => bytes[at + index] === value);

/** Minimal ZIP central-directory reader with bounded inflation. Returns name -> () => Buffer. */
export function zipEntries(bytes) {
  const entries = new Map();
  const floor = Math.max(0, bytes.length - 65557);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= floor; offset--)
    if (bytes.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  if (end < 0) throw new Error('Invalid archive');
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  if (count > 5000) throw new Error('Archive has too many entries');
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid archive');
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    entries.set(name, () => {
      if (flags & 1) throw new Error('Encrypted archives are not supported');
      if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid archive');
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      if (start + compressed > bytes.length) throw new Error('Invalid archive');
      const data = bytes.subarray(start, start + compressed);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data, { maxOutputLength: 8 * 1024 * 1024 });
      throw new Error('Unsupported archive compression');
    });
    offset += 46 + nameLength + extra + comment;
  }
  return entries;
}

/** Checks the bytes are really the declared type. Returns null when they are, or a reason when not. */
export function sniff(bytes, mime) {
  if (!bytes.length) return 'The file is empty.';
  switch (mime) {
    case 'application/pdf':
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) ? null : 'Not a PDF file.';
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? null : 'Not a PNG image.';
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]) ? null : 'Not a JPEG image.';
    case 'video/mp4':
      return startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4) ? null : 'Not an MP4 video.';
    case 'video/webm':
      return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]) ? null : 'Not a WebM video.';
    case 'text/plain':
    case 'text/markdown':
      if (bytes.includes(0)) return 'Text files cannot contain binary data.';
      try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return null; } catch { return 'Text files must be UTF-8.'; }
    case DOCX:
    case XLSX:
    case PPTX: {
      if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'Not an Office document.';
      try {
        const names = [...zipEntries(bytes).keys()];
        const marker = mime === DOCX ? 'word/document.xml' : mime === XLSX ? 'xl/workbook.xml' : 'ppt/presentation.xml';
        if (!names.includes(marker)) return 'The Office document does not match its type.';
        if (names.some((name) => /vbaProject\.bin$/i.test(name))) return 'Documents with macros are not accepted.';
        return null;
      } catch { return 'The Office document is damaged.'; }
    }
    default:
      return 'Unsupported file type.';
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (text) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
  if (code[0] === '#') { const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10); return Number.isFinite(value) && value < 0x110000 ? String.fromCodePoint(value) : ''; }
  return ENTITIES[code.toLowerCase()] ?? match;
});
const xmlText = (xml, paragraph, run) => decodeXml(xml.split(paragraph).map((part) => [...part.matchAll(run)].map((m) => m[1]).join('')).filter(Boolean).join('\n'));

let pdfjs;
async function pdfText(bytes) {
  pdfjs ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, verbosity: 0 });
  const document = await task.promise;
  const pageCount = document.numPages;
  const pages = [];
  try {
    for (let number = 1; number <= Math.min(document.numPages, 300); number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const text = content.items.map((item) => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim();
      pages.push(text ? `[Page ${number}]\n${text}` : '');
      if (pages.join('\n\n').length > MAX_TEXT) break;
    }
  } finally {
    await task.destroy();
  }
  return pages.join('\n\n') + (pages.length < pageCount ? '\n\n[The file continues beyond this point.]' : '');
}

/** A draft of the file's text for staff to review. Images and video need text written by staff. */
export async function extractText(bytes, mime) {
  if (!UPLOAD_TYPES[mime]?.text) return { text: '', note: 'Images and video need a written description before they can be published.' };
  if (bytes.length > MAX_EXTRACT_BYTES) return { text: '', note: 'This file is too large for automatic text extraction. Paste the reviewed text instead.' };
  let text = '';
  if (mime === 'text/plain' || mime === 'text/markdown') text = new TextDecoder('utf-8').decode(bytes);
  else if (mime === 'application/pdf') text = await pdfText(bytes);
  else {
    const entries = zipEntries(bytes);
    if (mime === DOCX) text = xmlText(entries.get('word/document.xml')().toString('utf8'), /<\/w:p>/, /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g);
    else if (mime === PPTX) {
      const slides = [...entries.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
      text = slides.map((name) => xmlText(entries.get(name)().toString('utf8'), /<\/a:p>/, /<a:t>([^<]*)<\/a:t>/g)).join('\n\n');
    } else if (mime === XLSX) {
      const shared = entries.get('xl/sharedStrings.xml');
      text = shared ? xmlText(shared().toString('utf8'), /<\/si>/, /<t(?:\s[^>]*)?>([^<]*)<\/t>/g) : '';
    }
  }
  // Drop control characters other than tab and newline.
  const printable = (char) => { const code = char.charCodeAt(0); return code === 9 || code === 10 || (code >= 32 && code !== 127); };
  text = [...text.replace(/\r\n?/g, '\n')].filter(printable).join('').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length > MAX_TEXT) return { text: text.slice(0, MAX_TEXT), note: 'The text was truncated to 200,000 characters.' };
  return { text, note: text ? '' : 'No text could be extracted. Paste the reviewed text instead.' };
}

/** Splits reviewed text into searchable passages of at most ~1,200 characters on paragraph boundaries. */
export function chunk(text) {
  const chunks = [];
  let current = '';
  for (const paragraph of text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)) {
    const pieces = paragraph.length > 1200 ? paragraph.match(/[\s\S]{1,1200}/g) : [paragraph];
    for (const piece of pieces) {
      if (current && current.length + piece.length + 2 > 1200) { chunks.push(current); current = ''; }
      current = current ? `${current}\n\n${piece.trim()}` : piece.trim();
    }
  }
  if (current) chunks.push(current);
  return chunks.map((content) => content.slice(0, 4000));
}

/** Preserve the PDF page on every passage, including passages starting midway down a long page. */
export function pageChunks(text) {
  return text.split(/(?=\[Page \d+\])/).flatMap(section => {
    const page = /^\[Page \d+\]/.exec(section)?.[0];
    return chunk(section).map(passage => page && !passage.startsWith(page) ? `${page}\n${passage}` : passage);
  });
}
