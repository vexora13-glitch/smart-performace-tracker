// Builds a small, valid text PDF (one page per entry, one line per string) for synthetic test fixtures.
const escape = (text) => text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

export function pdf(pages) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (const lines of pages) {
    const stream = `BT /F1 11 Tf 14 TL 56 760 Td ${lines.map((line) => `(${escape(line)}) Tj T*`).join(' ')} ET`;
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    const content = objects.length;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    kids.push(`${objects.length} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

/** Synthetic stand-in for the “pike point.pdf” acceptance check. Invented content, clearly labelled. */
export const PIKE_POINT = [
  [
    'Pike Point Coastal Walkway - project summary (synthetic test document)',
    'Pike Point is a proposed 2.4 km coastal walkway linking the marina to the northern headland.',
    'The walkway includes three lookout platforms, a boardwalk across the wetland and new signage.',
    'The approved budget is NZD 480,000, with construction planned to start in March.',
  ],
  [
    'Risks and next steps',
    'The main risk is the wetland consent, which is expected within six weeks.',
    'Next step: the client confirms the signage wording by the end of the month.',
  ],
];
