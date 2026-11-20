// Pure resume logic shared by the resume-processor Edge Function and local tests.
// No network or runtime-specific imports: archive and PDF readers are passed in.
//
// IMPORTANT: inspectResume() is a structural content check (file signature, active content, archive bombs).
// It is NOT antivirus scanning and never marks a file "clean" on its own.

export type Inspection = { ok: true } | { ok: false; reason: string };
export type ZipEntryInfo = { name: string; originalSize: number };
/** Returns the archive's entry list, inflating only the names in `want`. */
export type Unzip = (bytes: Uint8Array, want: (name: string) => boolean) => { entries: ZipEntryInfo[]; files: Record<string, Uint8Array> };

export const PDF = 'application/pdf';
export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_UNCOMPRESSED = 50 * 1024 * 1024;
const latin1 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };

export function inspectResume(bytes: Uint8Array, mime: string, unzip: Unzip): Inspection {
  if (bytes.length === 0) return { ok: false, reason: 'empty_file' };
  if (mime === PDF) {
    if (latin1(bytes.subarray(0, 5)) !== '%PDF-') return { ok: false, reason: 'not_a_pdf' };
    const body = latin1(bytes);
    if (!body.slice(-2048).includes('%%EOF')) return { ok: false, reason: 'truncated_pdf' };
    for (const [marker, reason] of [['/JavaScript', 'pdf_javascript'], ['/JS ', 'pdf_javascript'], ['/JS(', 'pdf_javascript'], ['/Launch', 'pdf_launch_action'],
      ['/EmbeddedFile', 'pdf_embedded_file'], ['/RichMedia', 'pdf_rich_media'], ['/XFA', 'pdf_xfa_form']] as const)
      if (body.includes(marker)) return { ok: false, reason };
    return { ok: true };
  }
  if (mime === DOCX) {
    if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) return { ok: false, reason: 'not_a_docx' };
    let listing: ReturnType<Unzip>;
    try { listing = unzip(bytes, () => false); } catch { return { ok: false, reason: 'corrupt_archive' }; }
    const names = listing.entries.map((e) => e.name);
    if (!names.includes('[Content_Types].xml') || !names.includes('word/document.xml')) return { ok: false, reason: 'not_a_docx' };
    if (listing.entries.reduce((n, e) => n + e.originalSize, 0) > MAX_UNCOMPRESSED) return { ok: false, reason: 'archive_too_large' };
    if (names.some((n) => /vbaProject\.bin$/i.test(n))) return { ok: false, reason: 'docx_macros' };
    if (names.some((n) => /^word\/embeddings\//i.test(n) || /activeX/i.test(n))) return { ok: false, reason: 'docx_embedded_object' };
    if (names.some((n) => /\.(exe|dll|js|vbs|bat|cmd|ps1|scr|jar|com|msi)$/i.test(n))) return { ok: false, reason: 'docx_executable_entry' };
    if (names.some((n) => n.includes('..') || n.startsWith('/'))) return { ok: false, reason: 'docx_path_traversal' };
    return { ok: true };
  }
  return { ok: false, reason: 'unsupported_type' };
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function docxText(documentXml: string): string {
  return documentXml
    .replace(/<w:tab\/>/g, ' ').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => entities[e]).replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t]+/g, ' ').trim();
}

export function extractDocxText(bytes: Uint8Array, unzip: Unzip): string {
  const { files } = unzip(bytes, (n) => n === 'word/document.xml');
  const xml = files['word/document.xml'];
  if (!xml) throw new Error('document.xml missing');
  return docxText(new TextDecoder().decode(xml));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Deterministic skill suggestions: whole-word, case-insensitive matches against the KaamSetu skill taxonomy. */
export function suggestSkills(text: string, taxonomy: string[]): string[] {
  const hay = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  return taxonomy.filter((skill) => new RegExp(`(^|[^a-z0-9])${escapeRe(skill.toLowerCase())}([^a-z0-9]|$)`).test(hay)).sort();
}
