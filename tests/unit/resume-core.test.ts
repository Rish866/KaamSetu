import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { extractText, getDocumentProxy } from 'unpdf';
import { DOCX, docxText, extractDocxText, inspectResume, PDF, suggestSkills, type Unzip } from '../../supabase/functions/_shared/resume-core.ts';

const unzip: Unzip = (bytes, want) => {
  const entries: { name: string; originalSize: number }[] = [];
  const files = unzipSync(bytes, { filter: (f) => { entries.push({ name: f.name, originalSize: f.originalSize }); return want(f.name); } });
  return { entries, files };
};
const docx = (body: string, extra: Record<string, Uint8Array> = {}) => zipSync({
  '[Content_Types].xml': strToU8('<Types/>'),
  'word/document.xml': strToU8(`<w:document><w:body><w:p><w:r><w:t>${body}</w:t></w:r></w:p></w:body></w:document>`), ...extra });
function pdf(text: string, extraObj = '') {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${44 + text.length} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  if (extraObj) objs.push(extraObj);
  let out = '%PDF-1.4\n'; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return strToU8(out, true);
}

test('structural inspection accepts real PDF and DOCX files', () => {
  assert.deepEqual(inspectResume(pdf('Hello'), PDF, unzip), { ok: true });
  assert.deepEqual(inspectResume(docx('Hello'), DOCX, unzip), { ok: true });
});
test('structural inspection rejects disguised and active-content files', () => {
  assert.deepEqual(inspectResume(strToU8('MZ\x90\x00 this is an exe'), PDF, unzip), { ok: false, reason: 'not_a_pdf' }, 'exe renamed to .pdf');
  assert.deepEqual(inspectResume(pdf('x', '<< /S /JavaScript /JS (app.alert(1)) >>'), PDF, unzip), { ok: false, reason: 'pdf_javascript' });
  assert.deepEqual(inspectResume(pdf('x', '<< /S /Launch /F (cmd.exe) >>'), PDF, unzip), { ok: false, reason: 'pdf_launch_action' });
  assert.deepEqual(inspectResume(pdf('x', '<< /Type /EmbeddedFile >>'), PDF, unzip), { ok: false, reason: 'pdf_embedded_file' });
  assert.deepEqual(inspectResume(strToU8('%PDF-1.4 truncated'), PDF, unzip), { ok: false, reason: 'truncated_pdf' });
  assert.deepEqual(inspectResume(docx('x', { 'word/vbaProject.bin': strToU8('macro') }), DOCX, unzip), { ok: false, reason: 'docx_macros' });
  assert.deepEqual(inspectResume(docx('x', { 'word/embeddings/oleObject1.bin': strToU8('ole') }), DOCX, unzip), { ok: false, reason: 'docx_embedded_object' });
  assert.deepEqual(inspectResume(docx('x', { 'payload.exe': strToU8('MZ') }), DOCX, unzip), { ok: false, reason: 'docx_executable_entry' });
  assert.deepEqual(inspectResume(zipSync({ 'a.txt': strToU8('x') }), DOCX, unzip), { ok: false, reason: 'not_a_docx' });
  assert.deepEqual(inspectResume(strToU8('PK\x03\x04garbage'), DOCX, unzip), { ok: false, reason: 'corrupt_archive' });
  assert.deepEqual(inspectResume(new Uint8Array(), PDF, unzip), { ok: false, reason: 'empty_file' });
  assert.deepEqual(inspectResume(pdf('x'), 'text/html', unzip), { ok: false, reason: 'unsupported_type' });
});
test('zip bombs are rejected from the entry listing without inflating them', () => {
  const bomb = docx('x', { 'word/media/big.bin': new Uint8Array(51 * 1024 * 1024) });
  assert.ok(bomb.length < 1024 * 1024, 'fixture is small on disk');
  assert.deepEqual(inspectResume(bomb, DOCX, unzip), { ok: false, reason: 'archive_too_large' });
});
test('DOCX text extraction decodes entities and paragraphs', () => {
  assert.equal(docxText('<w:p><w:r><w:t>CRM &amp; SQL</w:t></w:r></w:p><w:p><w:t>Pune</w:t></w:p>'), 'CRM & SQL\nPune');
  assert.match(extractDocxText(docx('Experienced in CRM and Customer support'), unzip), /CRM and Customer support/);
});
test('PDF text extraction (unpdf) reads a generated PDF', async () => {
  const doc = await getDocumentProxy(pdf('Skills: SQL, React, Microsoft Excel'));
  const { text } = await extractText(doc, { mergePages: true });
  assert.match(String(text), /SQL, React, Microsoft Excel/);
});
test('skill suggestions match whole words against the taxonomy only', () => {
  const tax = ['CRM', 'SQL', 'React', 'JavaScript', 'Microsoft Excel', 'English'];
  assert.deepEqual(suggestSkills('I used SQL, react and Microsoft  Excel daily. MySQLite is not SQL-free.', tax), ['Microsoft Excel', 'React', 'SQL']);
  assert.deepEqual(suggestSkills('Reactor maintenance, JavaScripting', tax), [], 'no partial-word matches');
  assert.deepEqual(suggestSkills('', tax), []);
});
