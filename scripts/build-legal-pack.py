#!/usr/bin/env python3
"""Builds the lawyer review pack (Word + HTML for PDF) from the live sources, so it never drifts from the site:
  src/content/legal.ts (text shown on the website), docs/PRIVACY.md, docs/store/PRIVACY_DISCLOSURES.md.
Usage: node --experimental-strip-types -e "..." > legal.json is done by the caller; see docs/legal-review/README.md.
  python3 scripts/build-legal-pack.py legal.json OUT_BASENAME
"""
import html, json, re, sys
from docx import Document
from docx.shared import Pt, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH

legal = json.load(open(sys.argv[1]))
out = sys.argv[2]
DATE = '25 November 2026'
privacy_md = open('docs/PRIVACY.md').read()
store_md = open('docs/store/PRIVACY_DISCLOSURES.md').read()

FACTS = [
    ('Operator', 'Aarvya Global Ventures LLP. Website: https://www.getkaamsetu.in (job marketplace for Mumbai, Navi Mumbai, Thane and Pune).'),
    ('Status', 'The website is live. Real users have not been invited yet; public launch waits for this review. All texts below are drafts written by the engineering team, not by a lawyer.'),
    ('Who uses it', 'Job seekers (18+, self-declared), employers (must be verified by KaamSetu before publishing jobs) and KaamSetu administrators.'),
    ('Data stored', 'Supabase (database, sign-in, file storage). Hosting region: to be confirmed by the owner in the Supabase dashboard.'),
    ('Website hosting', 'GitHub Pages (GitHub, Inc., USA). Only the public website files; no user data is stored there.'),
    ('Resume virus scan', 'Each uploaded resume is copied for a few seconds to a GitHub-hosted server, scanned with the open-source ClamAV antivirus, and deleted there. Until the scan passes, nobody can open the file.'),
    ('Backups', 'Encrypted (AES-256) database backups are kept for 30 days as GitHub workflow files.'),
    ('Email', 'Outgoing app email (password reset, notifications) via Resend, from no-reply@send.getkaamsetu.in. Support and privacy mailboxes via Zoho Mail (support@ and privacy@getkaamsetu.in).'),
    ('Scheduler', 'cron-job.org starts the background jobs every 15 minutes. It receives no personal data.'),
    ('Not used', 'No advertising, no tracking or analytics tools, no data sale, no AI. Match scores come from a fixed rule-based formula.'),
]
QUESTIONS = [
    'Is the Privacy Notice (Document 1) adequate under the DPDP Act 2023 and DPDP Rules? Please mark required changes.',
    'Is it acceptable that resumes are scanned for a few seconds on GitHub (USA) servers? What must the notice say about processors and cross-border transfer?',
    'What are our breach-reporting duties and timelines (Data Protection Board, CERT-In 6 hours)?',
    'Who should be named as Grievance Officer, with which postal address and response time?',
    'Are the retention periods acceptable (read notifications 180 days, email records 90 days, old invitations 365 days, completed privacy requests 1095 days)? What should happen to inactive accounts?',
    'Is consent the right legal basis for core processing, or should parts rely on "legitimate uses"?',
    'Is the 18+ self-declaration adequate? Do notices need Marathi or Hindi versions?',
    'Please review the Terms of Use, and advise on employer terms (verification, no fees from candidates, use of disclosed contact details).',
    'What may be kept after an account is deleted (consent records, audit logs, anonymised application history), and for how long?',
]

def strip_ts_tags(t):
    return t

# ---------- tiny markdown reader: headings, bullets, numbered lists, tables, paragraphs, **bold** and `code` ----------
def blocks(md):
    lines = md.splitlines(); i = 0; out = []
    while i < len(lines):
        l = lines[i]
        if not l.strip(): i += 1; continue
        if l.startswith('#'):
            n = len(l) - len(l.lstrip('#')); out.append(('h', n, l.lstrip('#').strip())); i += 1; continue
        if l.lstrip().startswith('|'):
            rows = []
            while i < len(lines) and lines[i].lstrip().startswith('|'):
                cells = [c.strip() for c in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r':?-+:?', c) for c in cells if c): rows.append(cells)
                i += 1
            out.append(('table', rows)); continue
        if re.match(r'\s*[*-] ', l):
            items = []
            while i < len(lines) and re.match(r'\s*[*-] ', lines[i]):
                items.append(re.sub(r'^\s*[*-] ', '', lines[i])); i += 1
            out.append(('ul', items)); continue
        if re.match(r'\s*\d+\. ', l):
            items = []
            while i < len(lines) and re.match(r'\s*\d+\. ', lines[i]):
                items.append(re.sub(r'^\s*\d+\. ', '', lines[i])); i += 1
            out.append(('ol', items)); continue
        para = [l]; i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r'\s*([#|]|[*-] |\d+\. )', lines[i]):
            para.append(lines[i]); i += 1
        out.append(('p', ' '.join(x.strip() for x in para)))
    return out

def runs(text):
    """Split into (text, bold, code) runs."""
    parts = re.split(r'(\*\*[^*]+\*\*|`[^`]+`)', text)
    for p in parts:
        if not p: continue
        if p.startswith('**'): yield p[2:-2], True, False
        elif p.startswith('`'): yield p[1:-1], False, True
        else: yield p, False, False

def md_html(text):
    o = ''
    for t, b, c in runs(text):
        e = html.escape(t)
        e = re.sub(r'\[(LEGAL[^\]]*|OWNER[^\]]*)\]', r'<mark>[\1]</mark>', e)
        o += f'<b>{e}</b>' if b else f'<code>{e}</code>' if c else e
    return o

# ---------- Word ----------
doc = Document()
st = doc.styles['Normal']; st.font.name = 'Calibri'; st.font.size = Pt(10.5)
for s in doc.sections: s.left_margin = s.right_margin = Cm(2); s.top_margin = s.bottom_margin = Cm(1.8)
YEL = RGBColor(0xB0, 0x4A, 0x00)

def add_runs(par, text, size=None):
    for t, b, c in runs(text):
        for piece in re.split(r'(\[(?:LEGAL|OWNER)[^\]]*\])', t):
            if not piece: continue
            r = par.add_run(piece); r.bold = b or piece.startswith('[LEGAL') or piece.startswith('[OWNER')
            if c: r.font.name = 'Consolas'
            if piece.startswith('[LEGAL') or piece.startswith('[OWNER'): r.font.color.rgb = YEL
            if size: r.font.size = Pt(size)

def word_md(md, skip_title=True):
    for b in blocks(md):
        if b[0] == 'h':
            if skip_title and b[1] == 1: continue
            doc.add_heading(b[2].replace('**', ''), level=min(b[1] + 1, 4))
        elif b[0] == 'p': add_runs(doc.add_paragraph(), b[1])
        elif b[0] in ('ul', 'ol'):
            for it in b[1]: add_runs(doc.add_paragraph(style='List Bullet' if b[0] == 'ul' else 'List Number'), it)
        elif b[0] == 'table':
            rows = b[1]; w = max(len(r) for r in rows)
            t = doc.add_table(rows=len(rows), cols=w); t.style = 'Table Grid'
            for ri, r in enumerate(rows):
                for ci in range(w):
                    cell = t.cell(ri, ci); cell.text = ''
                    add_runs(cell.paragraphs[0], (r[ci] if ci < len(r) else ''), size=9)
                    if ri == 0:
                        for run in cell.paragraphs[0].runs: run.bold = True
            doc.add_paragraph()

h = doc.add_heading('KaamSetu: documents for legal review', 0)
p = doc.add_paragraph(); add_runs(p, f'**Aarvya Global Ventures LLP** · prepared {DATE} · contact: rishabh@getkaamsetu.in')
p = doc.add_paragraph(); add_runs(p, '**Status: DRAFT.** Written by the engineering team, not reviewed by a lawyer. Items marked [LEGAL REVIEW] or [LEGAL] are open questions. Please mark changes directly in this Word file (Review → Track Changes).')
doc.add_heading('Contents', 1)
for x in ['A. How KaamSetu works today (facts)', 'B. Questions for the lawyer', 'Document 1: Privacy Notice, Terms of Use and Support (exact text on the website)', 'Document 2: Privacy and consent implementation', 'Document 3: App store privacy disclosures (drafts)']:
    doc.add_paragraph(x, style='List Bullet')

doc.add_page_break(); doc.add_heading('A. How KaamSetu works today (facts)', 1)
t = doc.add_table(rows=len(FACTS), cols=2); t.style = 'Table Grid'
for i, (k, v) in enumerate(FACTS):
    t.cell(i, 0).text = ''; r = t.cell(i, 0).paragraphs[0].add_run(k); r.bold = True
    t.cell(i, 1).text = v
doc.add_paragraph()
p = doc.add_paragraph(); add_runs(p, '**Note:** the website\'s Privacy Notice (Document 1, "Who processes your data") still describes the email and virus-scanning providers as "when connected". Both are now connected (Resend, ClamAV on GitHub). Please approve updated wording.')

doc.add_heading('B. Questions for the lawyer', 1)
for q in QUESTIONS: doc.add_paragraph(q, style='List Number')

doc.add_page_break(); doc.add_heading('Document 1: Privacy Notice, Terms of Use and Support', 1)
p = doc.add_paragraph(); add_runs(p, f'Exact text shown at https://www.getkaamsetu.in/privacy, /terms and /support. Notice version **{legal["version"]}**. Source file: `src/content/legal.ts`.')
for key in ['privacy', 'terms', 'support']:
    page = legal['pages'][key]; doc.add_heading(page['title'], 2)
    for sec in page['sections']:
        doc.add_heading(sec['heading'], 3); add_runs(doc.add_paragraph(), sec['body'])

doc.add_page_break(); doc.add_heading('Document 2: Privacy and consent implementation', 1)
p = doc.add_paragraph(); add_runs(p, 'What the software actually does, mapped to DPDP topics. Source: `docs/PRIVACY.md`.')
word_md(privacy_md)
doc.add_page_break(); doc.add_heading('Document 3: App store privacy disclosures (drafts)', 1)
p = doc.add_paragraph(); add_runs(p, 'Planned answers for Google Play "Data safety" and Apple "App Privacy". The apps are not published yet. Source: `docs/store/PRIVACY_DISCLOSURES.md`.')
word_md(store_md)
for s in doc.sections:
    fp = s.footer.paragraphs[0]; fp.text = f'KaamSetu legal review pack · DRAFT · {DATE}'; fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
doc.save(out + '.docx')

# ---------- HTML (printed to PDF) ----------
def html_md(md):
    o = ''
    for b in blocks(md):
        if b[0] == 'h':
            if b[1] == 1: continue
            o += f'<h{min(b[1]+1,4)}>{md_html(b[2])}</h{min(b[1]+1,4)}>'
        elif b[0] == 'p': o += f'<p>{md_html(b[1])}</p>'
        elif b[0] in ('ul', 'ol'): o += f'<{b[0]}>' + ''.join(f'<li>{md_html(x)}</li>' for x in b[1]) + f'</{b[0]}>'
        elif b[0] == 'table':
            rows = b[1]
            o += '<table><tr>' + ''.join(f'<th>{md_html(c)}</th>' for c in rows[0]) + '</tr>' + ''.join('<tr>' + ''.join(f'<td>{md_html(c)}</td>' for c in r) + '</tr>' for r in rows[1:]) + '</table>'
    return o

H = f'''<!doctype html><html><head><meta charset="utf-8"><style>
body{{font-family:'Noto Sans',Arial,sans-serif;font-size:10.5pt;line-height:1.45;color:#111;margin:0}}
h1{{font-size:20pt;margin:0 0 6pt}} h2{{font-size:15pt;margin:18pt 0 6pt;border-bottom:1px solid #ccc;padding-bottom:3pt}}
h3{{font-size:12pt;margin:12pt 0 4pt}} h4{{font-size:11pt;margin:10pt 0 3pt}}
table{{border-collapse:collapse;width:100%;margin:6pt 0 10pt;font-size:9pt}} th,td{{border:1px solid #999;padding:4pt;vertical-align:top;text-align:left}} th{{background:#eee}}
mark{{background:#fff0c2;color:#8a3b00;font-weight:bold}} code{{font-family:Consolas,monospace;font-size:9pt}}
.page{{page-break-before:always}} .muted{{color:#555}}
</style></head><body>
<h1>KaamSetu: documents for legal review</h1>
<p><b>Aarvya Global Ventures LLP</b> · prepared {DATE} · contact: rishabh@getkaamsetu.in</p>
<p><b>Status: DRAFT.</b> Written by the engineering team, not reviewed by a lawyer. Items marked <mark>[LEGAL REVIEW]</mark> or <mark>[LEGAL]</mark> are open questions. An editable Word version of this file is provided for tracked changes.</p>
<h2>Contents</h2><ul><li>A. How KaamSetu works today (facts)</li><li>B. Questions for the lawyer</li><li>Document 1: Privacy Notice, Terms of Use and Support (exact text on the website)</li><li>Document 2: Privacy and consent implementation</li><li>Document 3: App store privacy disclosures (drafts)</li></ul>
<div class="page"></div><h2>A. How KaamSetu works today (facts)</h2>
<table>{''.join(f'<tr><th style="width:24%">{html.escape(k)}</th><td>{html.escape(v)}</td></tr>' for k, v in FACTS)}</table>
<p><b>Note:</b> the website's Privacy Notice (Document 1, "Who processes your data") still describes the email and virus-scanning providers as "when connected". Both are now connected (Resend, ClamAV on GitHub). Please approve updated wording.</p>
<h2>B. Questions for the lawyer</h2><ol>{''.join(f'<li>{html.escape(q)}</li>' for q in QUESTIONS)}</ol>
<div class="page"></div><h2>Document 1: Privacy Notice, Terms of Use and Support</h2>
<p class="muted">Exact text shown at https://www.getkaamsetu.in/privacy, /terms and /support. Notice version <b>{legal["version"]}</b>. Source file: <code>src/content/legal.ts</code>.</p>
{''.join(f'<h3>{html.escape(legal["pages"][k]["title"])}</h3>' + ''.join(f'<h4>{html.escape(s["heading"])}</h4><p>{md_html(s["body"])}</p>' for s in legal["pages"][k]["sections"]) for k in ["privacy","terms","support"])}
<div class="page"></div><h2>Document 2: Privacy and consent implementation</h2><p class="muted">What the software actually does, mapped to DPDP topics. Source: <code>docs/PRIVACY.md</code>.</p>{html_md(privacy_md)}
<div class="page"></div><h2>Document 3: App store privacy disclosures (drafts)</h2><p class="muted">Planned answers for Google Play "Data safety" and Apple "App Privacy". The apps are not published yet. Source: <code>docs/store/PRIVACY_DISCLOSURES.md</code>.</p>{html_md(store_md)}
</body></html>'''
# The PDF font has no arrow glyph; use a plain character so nothing renders blank.
open(out + '.html', 'w').write(H.replace('→', '&gt;'))
print('wrote', out + '.docx', out + '.html')
