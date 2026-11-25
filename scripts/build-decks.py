#!/usr/bin/env python3
"""Builds the two KaamSetu decks as PowerPoint (.pptx) and HTML (printed to PDF by the caller).
  python3 scripts/build-decks.py OUT_DIR
Facts come from the repository and production runs as of 2026-11-25. Numbers we do not have (team, pricing, funding ask,
market sizing for our cities) are left as clearly marked [FILL IN] placeholders. Never replace them with invented figures.
"""
import html, sys
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE

OUT = sys.argv[1]
NAVY, INDIGO, SAFFRON, INK, SOFT, PALE, WHITE, LINE = '12172F', '5B5CE2', 'F6B84A', '11152A', '667085', 'EEEDFF', 'FFFFFF', 'E7E9F2'
DATE = 'November 2026'

# Slide kinds: cover, bullets, cards, table, two, image, closing.  'note' = source line at the bottom.
INVESTOR = ('KaamSetu-Investor-Deck', 'Investor deck', [
  dict(kind='cover', title='KaamSetu', sub='Verified jobs with visible salaries for Mumbai, Thane, Navi Mumbai and Pune', meta=f'Aarvya Global Ventures LLP · {DATE} · www.getkaamsetu.in'),
  dict(kind='cards', title='The problem: job seekers cannot trust what they see', cards=[
    ('93%', 'of Indian job seekers have met suspicious or fraudulent job offers'),
    ('51%', 'are not confident they can tell a real recruiter from a scammer'),
    ('82%', 'now check whether a role is real before applying'),
  ], bullets=['Hidden salaries waste weeks of interviews on jobs that never paid enough.', 'Fake recruiters ask candidates for "registration" or "processing" fees.', 'Phone numbers and resumes are shared widely, then misused.'],
    note='Sources: Indeed survey, reported by Storyboard18 (2026); LinkedIn analysis, reported by ET HRWorld (2026).'),
  dict(kind='bullets', title='Our solution: a job marketplace built on trust', bullets=[
    '**Verified employers only.** KaamSetu checks every company before it can publish a job, and reviews every job before it goes live.',
    '**Salary always visible.** Every job must show a real salary range.',
    '**Candidates never pay.** Asking for money is banned; every job has a "Report" button.',
    '**Contact details stay private.** An employer sees your phone and email only after shortlisting you, and only if you agree.',
    '**Match scores that explain themselves.** A clear formula, shown in plain language. Never uses name, gender, religion, caste, age or photo.',
  ]),
  dict(kind='image', title='The product is live', image='store/screenshots/android-phone-1080x1920-1-home.png', image2='store/screenshots/android-phone-1080x1920-2-candidate-sign-in.png', bullets=[
    'Website live at **www.getkaamsetu.in** (secure HTTPS).',
    'Works on phone, tablet and desktop; Android and iPhone apps from the same code.',
    'Full journey tested on the live site: sign-up → profile → apply → shortlist → interview → offer (24/24 checks passed).',
  ]),
  dict(kind='two', title='What each user gets', left=('Job seekers', [
    'Search and filter jobs, saved jobs', 'Match score with the reasons behind it', 'One-tap apply and live application status',
    'Interview scheduling, offers', 'Resume upload with virus scan', 'Download my data, delete my account']),
    right=('Employers', [
    'Company verification and team roles', 'Post jobs (reviewed before publishing)', 'Applicant pipeline: viewed, shortlisted, interview, offer, hired',
    'Find candidates who opted in (masked profiles)', 'Resume and contact access, logged and consent-based', 'Dashboard of hiring numbers'])),
  dict(kind='bullets', title='Trust and safety is the product, not an add-on', bullets=[
    'Admin console: company verification, job moderation, abuse reports, user suspension, privacy requests.',
    'Every sensitive action needs a written reason and is recorded in an audit log.',
    'Resumes are locked until an antivirus scan passes; infected files are blocked automatically.',
    'Consent is recorded for each choice (discovery, contact sharing, resume reading, marketing) and can be withdrawn in one tap.',
    'Built around India\'s Digital Personal Data Protection Act; legal review of the texts is in progress.',
  ]),
  dict(kind='table', title='How we compare', rows=[
    ['', 'KaamSetu', 'Large job boards', 'WhatsApp / agents'],
    ['Employer verified before posting', 'Yes, every company', 'Varies', 'No'],
    ['Salary shown on every job', 'Required', 'Often hidden', 'Rarely'],
    ['Candidate fees', 'Banned', 'Paid add-ons exist', 'Common'],
    ['Phone shared only with consent', 'Yes', 'Varies', 'No'],
    ['Explainable match score', 'Yes', 'Opaque ranking', 'No'],
    ['Local focus (MMR + Pune)', 'Yes', 'National', 'Local'],
  ], note='Comparison is qualitative, based on publicly visible features; not a claim about any specific competitor.'),
  dict(kind='cards', title='Market', cards=[
    ('USD 13.8 bn', 'turnover of recruitment agencies in India, 2025 (Euromonitor)'),
    ('USD 86 m', 'India recruitment software market, 2026 (IMARC)'),
    ('[FILL IN]', 'job seekers and hiring businesses in Mumbai, Thane, Navi Mumbai and Pune (our first market)'),
  ], bullets=['Start: one region where we can verify employers personally.', 'Expand city by city once verification and moderation run smoothly.'],
    note='Sources: Euromonitor, "Recruitment Agencies in India" (2025); IMARC Group, India recruitment software market (2026). Regional sizing to be added by the founders.'),
  dict(kind='bullets', title='Business model (proposed, to be validated in the pilot)', bullets=[
    'Candidates always free. This is a promise in our Terms.',
    'Employers: [FILL IN, e.g. free first job post, then paid job posts or a monthly plan].',
    'Paid extras for employers: [FILL IN, e.g. more candidate searches, featured jobs, extra team seats].',
    'Today the platform runs on free tiers: hosting, email, database and virus scanning cost about ₹0 per month at pilot scale.',
  ], note='Pricing has not been tested with customers yet.'),
  dict(kind='table', title='Traction and status (honest)', rows=[
    ['Milestone', 'Status'],
    ['Product built and live on www.getkaamsetu.in', 'Done'],
    ['End-to-end hiring journey tested on the live site', 'Done (24/24)'],
    ['Email, password reset, support mailboxes', 'Done'],
    ['Resume virus scanning, backups and restore test', 'Done'],
    ['Legal review of privacy notice and terms', 'In progress'],
    ['Pilot: 3–5 verified employers, 20–50 candidates', 'Next'],
    ['Android and iPhone store listings', 'Planned'],
  ], note='No real users yet: the pilot starts after legal sign-off.'),
  dict(kind='bullets', title='Pilot plan and success metrics', bullets=[
    '3–5 verified employers and 20–50 candidates in Mumbai, Navi Mumbai, Thane and Pune.',
    'Targets: ≥60% complete profiles · company and job review within 1 working day · ≥70% applications viewed within 3 days · ≥80% employers respond within 7 days · at least 1 hire · 0 serious security or privacy incidents.',
    'Launch-ready when targets hold for 4 consecutive weeks.',
  ]),
  dict(kind='bullets', title='Roadmap', bullets=[
    '**Next 3 months:** pilot, legal sign-off, Play Store and App Store listings, Hindi/Marathi language.',
    '**3–6 months:** employer pricing live, WhatsApp/SMS alerts, faster search for larger job volumes.',
    '**6–12 months:** more cities, employer analytics, verified skill badges.',
  ], note='Roadmap is indicative and depends on pilot results and funding.'),
  dict(kind='bullets', title='Team', bullets=['[FILL IN: founder names, roles and relevant experience]', '[FILL IN: advisors, if any]', 'Company: Aarvya Global Ventures LLP.']),
  dict(kind='bullets', title='The ask', bullets=['[FILL IN: amount being raised and instrument]', 'Use of funds: [FILL IN, e.g. employer sales in MMR and Pune, verification and support staff, marketing, store launch]', '[FILL IN: milestones this money reaches]']),
  dict(kind='closing', title='Thank you', sub='KaamSetu: the safe bridge to work', meta='rishabh@getkaamsetu.in · www.getkaamsetu.in'),
])

TECH = ('KaamSetu-Technical-Deck', 'Product and technical deck', [
  dict(kind='cover', title='KaamSetu: product and technology', sub='Architecture, frontend, backend, security, testing and operations', meta=f'Aarvya Global Ventures LLP · {DATE} · facts as of 25 Nov 2026'),
  dict(kind='table', title='At a glance', rows=[
    ['Area', 'Choice'],
    ['App (web + Android + iPhone)', 'React Native 0.88 with Expo SDK 58, one codebase; Expo Router for screens'],
    ['Website hosting', 'Static export on GitHub Pages, custom domain, HTTPS (Let\'s Encrypt)'],
    ['Backend', 'Supabase: PostgreSQL 17, Auth, Storage; business logic in SQL functions'],
    ['Security model', 'Row-level security on every table; users call checked functions, not tables'],
    ['Background jobs', 'Node.js worker in GitHub Actions every 15 minutes (cron-job.org trigger)'],
    ['Virus scanning', 'ClamAV (open source) in Docker'],
    ['Email', 'Resend (app email), Zoho Mail (support and privacy mailboxes)'],
    ['Monthly running cost (pilot)', 'About ₹0: free tiers throughout'],
  ]),
  dict(kind='two', title='System architecture', left=('User side', [
    'Browser → www.getkaamsetu.in (GitHub Pages, static files)', 'Android / iPhone apps (Expo builds)',
    'All three talk directly to Supabase over HTTPS using a public key', 'No custom server to run or patch']),
    right=('Supabase + jobs', [
    'Auth: email or Indian mobile + password', 'PostgreSQL: 32 tables, 75 user-callable functions', 'Storage: private buckets for resumes, photos, company documents',
    'GitHub Actions worker: virus scan, resume reading, account clean-up, email', 'Resend sends email; Zoho receives it'])),
  dict(kind='bullets', title='Frontend', bullets=[
    'One TypeScript codebase for web, Android and iPhone (~3,200 lines of app code).',
    'Screens: landing, sign-in/sign-up, password reset; candidate (jobs, job detail, applications, profile, notifications, settings); employer (dashboard, jobs, applicants, discover, team, settings); admin console; legal pages.',
    'Website is pre-rendered to static HTML (fast first load, works on any static host).',
    'Maintenance screen appears automatically if the database is older than the app (safe upgrades).',
    'Accessibility (axe) and responsive layout checked on phone, tablet and desktop in automated tests.',
    'Security headers: Content-Security-Policy; no secret keys in the app (checked on every build).',
  ]),
  dict(kind='bullets', title='Backend and data model', bullets=[
    'PostgreSQL 17 on Supabase; schema built by 10 versioned migrations (never edited after release).',
    'Core data: profiles, candidate profiles (skills, experience, education, languages, locations), companies and members, jobs, applications with full event history, interviews, offers, invitations, notifications, consents, audit log.',
    'Users never write tables directly: each action is a SQL function that checks role, ownership and state (e.g. a job can only move published → paused → closed).',
    'Separate private schema for settings, roles, email queue and audit events; not reachable through the public API.',
    'Typed database client generated from the migrations.',
  ]),
  dict(kind='table', title='Matching engine (rule-based, explainable)', rows=[
    ['Factor', 'Weight', 'What it compares'],
    ['Skills', '35', 'Job skills the candidate has'],
    ['Location', '25', 'Job city vs. candidate\'s preferred locations'],
    ['Salary', '20', 'Job range vs. expected salary'],
    ['Experience', '15', 'Required vs. candidate experience'],
    ['Freshness', '5', 'How recently the job was posted'],
  ], note='Weights are versioned and changed only by an admin with a written reason (audited). A test scans the formula to prove it never reads name, photo, gender, religion, caste, age, marital status or disability.'),
  dict(kind='bullets', title='Resume pipeline', bullets=[
    'Upload → file stays locked ("quarantined"): nobody, not even the owner, can open it.',
    'Within 15 minutes the worker checks the file structure (real PDF/DOCX, size, no zip bombs) and scans it with ClamAV.',
    'Clean → owner and the companies the candidate applied to can open it through 60-second links; every access is logged.',
    'Infected or fake → blocked forever; the candidate sees the reason. Not scanned within 24 hours → fails visibly.',
    'Resume reading (skill suggestions) only with separate consent, and nothing is added to the profile without the candidate\'s review.',
    'Production test 25 Nov 2026: clean PDF accepted, antivirus test file blocked, disguised .exe rejected (9/9 checks).',
  ]),
  dict(kind='bullets', title='Security', bullets=[
    'Row-level security on every table; anonymous users cannot read private tables or call protected functions (28 automated production checks).',
    'Least privilege: even the internal service role has only the permissions the workers need.',
    'Admin roles (admin, moderator, privacy) with "last admin" protection; every admin decision needs a reason and is audited.',
    'Contact details and resumes released only by consent and application; every release logged.',
    'Secrets never in code: secret scanning on every change; keys fetched at run time and masked in logs.',
    'Independent code review found 3 blockers and 7 high issues; all fixed with tests before release.',
  ]),
  dict(kind='bullets', title='Privacy (DPDP-oriented)', bullets=[
    'Consent records are append-only, versioned with the notice text, and withdrawable in one tap.',
    'Download my data (instant export) and account deletion (admin-verified; personal data removed or anonymised, sign-in removed).',
    'Data minimisation: notifications never contain names, emails or phone numbers; logs contain only IDs and counts.',
    'Retention rules run daily (e.g. read notifications 180 days, email records 90 days).',
    'Legal review of notice and terms in progress (review pack prepared: Word + PDF).',
  ]),
  dict(kind='table', title='Testing and quality', rows=[
    ['Test layer', 'Count', 'Runs'],
    ['Database and security rules (in-memory Postgres)', '84', 'Every change'],
    ['Same database suite on real Supabase Postgres', '84', 'Every change'],
    ['Upgrade rehearsal from the previous production schema', '1 full run', 'Every change'],
    ['Unit tests (files, email, matching helpers)', '22', 'Every change'],
    ['Browser tests: pages, accessibility, responsive, maintenance', '57', 'Every change'],
    ['Real UI journeys on a local Supabase stack, incl. real ClamAV', '30+', 'Every change'],
    ['Live journey on the production website', '24', 'On demand'],
  ], note='7 CI jobs must pass before any change is merged. Lint and type checks included.'),
  dict(kind='bullets', title='Delivery and operations', bullets=[
    'Every merge to main builds the website, publishes it and verifies the live site serves that exact build with every file.',
    'Database changes go through a guarded workflow: dry run, drift check, encrypted backup, apply, then production checks.',
    'Encrypted backups (AES-256); restore drill into a fresh database passed (all row counts equal, security checks pass).',
    'Rollback: redeploy any earlier website build in one click; database fixes are forward-only migrations.',
    'Operations handbook, incident process, secret rotation and pilot runbook are documented.',
  ]),
  dict(kind='table', title='Infrastructure and cost', rows=[
    ['Service', 'Used for', 'Plan'],
    ['Supabase', 'Database, auth, file storage', 'Free'],
    ['GitHub (Pages, Actions)', 'Website hosting, CI, workers, backups', 'Free (public repository)'],
    ['Resend', 'App email (3,000/month, 100/day)', 'Free'],
    ['Zoho Mail', 'support@ and privacy@ mailboxes', 'Free'],
    ['cron-job.org', '15-minute job trigger', 'Free'],
    ['GoDaddy', 'Domain getkaamsetu.in', 'Paid (domain only)'],
  ], note='Recommended before scale: Supabase Pro with point-in-time recovery; Resend paid plan when email volume grows.'),
  dict(kind='bullets', title='Known limits and next technical steps', bullets=[
    'Background jobs run every 15 minutes (not instant); fine for a pilot.',
    'Search scores every job per request: fine at pilot size, needs pre-filtering for large volumes.',
    'Free database plan: no point-in-time recovery yet (manual encrypted backups instead).',
    'Not yet done: external penetration test, error monitoring (Sentry), store releases, Hindi/Marathi.',
    'Mobile: test Android build exists; Play Store and App Store submissions pending developer accounts.',
  ]),
  dict(kind='closing', title='Questions?', sub='Code, tests and runbooks are in the KaamSetu repository', meta='rishabh@getkaamsetu.in · www.getkaamsetu.in'),
])

# ---------------------------------------------------------------- PowerPoint
def rgb(h): return RGBColor.from_string(h)

def text_runs(par, s, size, color, bold=False):
    import re
    for i, part in enumerate(re.split(r'(\*\*[^*]+\*\*|\[FILL IN[^\]]*\])', s)):
        if not part: continue
        r = par.add_run()
        if part.startswith('**'): r.text = part[2:-2]; r.font.bold = True
        else: r.text = part; r.font.bold = bold
        r.font.size = Pt(size); r.font.color.rgb = rgb('B04A00' if part.startswith('[FILL') else color)
        if part.startswith('[FILL'): r.font.bold = True

def box(slide, x, y, w, h, fill=None, line=None, shape=MSO_SHAPE.RECTANGLE):
    s = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    if fill: s.fill.solid(); s.fill.fore_color.rgb = rgb(fill)
    else: s.fill.background()
    if line: s.line.color.rgb = rgb(line)
    else: s.line.fill.background()
    s.shadow.inherit = False
    return s

def textbox(slide, x, y, w, h, lines, size=16, color=INK, bullet=False, bold=False, align=None, gap=6):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h)); tf = tb.text_frame; tf.word_wrap = True
    for i, l in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        if align: p.alignment = align
        p.space_after = Pt(gap)
        text_runs(p, ('•  ' if bullet else '') + l, size, color, bold)
    return tb

def header(slide, title, n, total, deck):
    box(slide, 0, 0, 13.333, 1.05, fill=NAVY)
    box(slide, 0, 1.05, 13.333, 0.06, fill=SAFFRON)
    textbox(slide, 0.6, 0.2, 12, 0.7, [title], size=26, color=WHITE, bold=True)
    textbox(slide, 0.6, 7.05, 9, 0.35, [f'KaamSetu · {deck}'], size=10, color=SOFT)
    textbox(slide, 11.4, 7.05, 1.4, 0.35, [f'{n} / {total}'], size=10, color=SOFT, align=PP_ALIGN.RIGHT)

def build_pptx(spec):
    name, deck, slides = spec
    prs = Presentation(); prs.slide_width = Inches(13.333); prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]
    for n, s in enumerate(slides, 1):
        sl = prs.slides.add_slide(blank); k = s['kind']
        if k in ('cover', 'closing'):
            box(sl, 0, 0, 13.333, 7.5, fill=NAVY); box(sl, 0.8, 3.55, 1.6, 0.08, fill=SAFFRON)
            textbox(sl, 0.8, 2.0, 11.5, 1.4, [s['title']], size=48 if k == 'cover' else 40, color=WHITE, bold=True)
            textbox(sl, 0.8, 3.85, 11.5, 1.2, [s['sub']], size=22, color='C9CCF5')
            textbox(sl, 0.8, 6.3, 11.5, 0.6, [s['meta']], size=14, color='9AA0C8')
            continue
        header(sl, s['title'], n, len(slides), deck); top = 1.45
        if k == 'bullets':
            textbox(sl, 0.7, top, 12, 5.3, s['bullets'], size=18, bullet=True, gap=12)
        elif k == 'cards':
            cw = 3.85
            for i, (big, small) in enumerate(s['cards']):
                x = 0.7 + i * (cw + 0.25); box(sl, x, top, cw, 1.9, fill=PALE, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
                textbox(sl, x + 0.25, top + 0.15, cw - 0.5, 0.8, [big], size=30, color=INDIGO, bold=True)
                textbox(sl, x + 0.25, top + 0.95, cw - 0.5, 0.95, [small], size=13, color=INK)
            textbox(sl, 0.7, top + 2.2, 12, 2.6, s.get('bullets', []), size=17, bullet=True, gap=10)
        elif k == 'two':
            for i, (h, items) in enumerate([s['left'], s['right']]):
                x = 0.7 + i * 6.1; box(sl, x, top, 5.8, 5.2, fill=PALE if i == 0 else 'FFF5DF', shape=MSO_SHAPE.ROUNDED_RECTANGLE)
                textbox(sl, x + 0.3, top + 0.2, 5.2, 0.6, [h], size=20, color=INDIGO if i == 0 else 'A0620A', bold=True)
                textbox(sl, x + 0.3, top + 0.85, 5.2, 4.2, items, size=15, bullet=True, gap=8)
        elif k == 'table':
            rows = s['rows']; cols = len(rows[0])
            tbl = sl.shapes.add_table(len(rows), cols, Inches(0.7), Inches(top), Inches(11.9), Inches(0.45 * len(rows))).table
            for r, row in enumerate(rows):
                for c, val in enumerate(row):
                    cell = tbl.cell(r, c); cell.text = ''
                    text_runs(cell.text_frame.paragraphs[0], val, 13, WHITE if r == 0 else INK, bold=(r == 0 or c == 0))
                    cell.fill.solid(); cell.fill.fore_color.rgb = rgb(INDIGO if r == 0 else (WHITE if r % 2 else 'F6F7FB'))
        elif k == 'image':
            for i, img in enumerate([s['image'], s.get('image2')]):
                if img: sl.shapes.add_picture(img, Inches(0.8 + i * 2.75), Inches(top), height=Inches(5.3))
            textbox(sl, 6.6, top + 0.3, 6.1, 5, s['bullets'], size=18, bullet=True, gap=14)
        if s.get('note'): textbox(sl, 0.7, 6.55, 12, 0.5, [s['note']], size=10, color=SOFT)
    prs.save(f'{OUT}/{name}.pptx')

# ---------------------------------------------------------------- HTML (one 16:9 page per slide)
import re, base64
def h(s):
    e = html.escape(s)
    e = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', e)
    return re.sub(r'(\[FILL IN[^\]]*\])', r'<span class="fill">\1</span>', e)

def build_html(spec):
    name, deck, slides = spec; out = []
    for n, s in enumerate(slides, 1):
        k = s['kind']
        if k in ('cover', 'closing'):
            out.append(f'<section class="cover"><h1>{h(s["title"])}</h1><div class="bar"></div><p class="sub">{h(s["sub"])}</p><p class="meta">{h(s["meta"])}</p></section>'); continue
        body = ''
        if k == 'bullets': body = '<ul class="big">' + ''.join(f'<li>{h(b)}</li>' for b in s['bullets']) + '</ul>'
        elif k == 'cards':
            body = '<div class="cards">' + ''.join(f'<div class="card"><div class="num">{h(a)}</div><div>{h(b)}</div></div>' for a, b in s['cards']) + '</div>'
            body += '<ul>' + ''.join(f'<li>{h(b)}</li>' for b in s.get('bullets', [])) + '</ul>'
        elif k == 'two':
            body = '<div class="two">' + ''.join(f'<div class="col c{i}"><h3>{h(t)}</h3><ul>' + ''.join(f'<li>{h(x)}</li>' for x in items) + '</ul></div>' for i, (t, items) in enumerate([s['left'], s['right']])) + '</div>'
        elif k == 'table':
            r = s['rows']; body = '<table><tr>' + ''.join(f'<th>{h(c)}</th>' for c in r[0]) + '</tr>' + ''.join('<tr>' + ''.join(f'<td>{h(c)}</td>' for c in row) + '</tr>' for row in r[1:]) + '</table>'
        elif k == 'image':
            imgs = ''.join(f'<img src="data:image/png;base64,{base64.b64encode(open(p,"rb").read()).decode()}">' for p in [s['image'], s.get('image2')] if p)
            body = f'<div class="imgrow"><div class="imgs">{imgs}</div><ul class="big">' + ''.join(f'<li>{h(b)}</li>' for b in s['bullets']) + '</ul></div>'
        note = f'<p class="note">{h(s["note"])}</p>' if s.get('note') else ''
        out.append(f'<section><header><h2>{h(s["title"])}</h2></header><div class="body">{body}</div>{note}<footer><span>KaamSetu · {deck}</span><span>{n} / {len(slides)}</span></footer></section>')
    css = f'''@page{{size:13.333in 7.5in;margin:0}} body{{margin:0;font-family:'Noto Sans',Arial,sans-serif;color:#{INK}}}
section{{width:13.333in;height:7.5in;position:relative;page-break-after:always;overflow:hidden;background:#fff}}
header{{background:#{NAVY};height:1.05in;border-bottom:.06in solid #{SAFFRON};display:flex;align-items:center;padding:0 .6in}}
header h2{{color:#fff;font-size:26pt;margin:0}} .body{{padding:.35in .7in 0}}
ul{{margin:.1in 0;padding-left:.3in;font-size:15pt;line-height:1.4}} ul.big{{font-size:17pt}} li{{margin-bottom:.12in}}
.cards{{display:flex;gap:.25in}} .card{{flex:1;background:#{PALE};border-radius:.18in;padding:.2in .25in;font-size:12.5pt}} .num{{font-size:28pt;font-weight:800;color:#{INDIGO};margin-bottom:.06in}}
.two{{display:flex;gap:.3in}} .col{{flex:1;border-radius:.18in;padding:.2in .3in;background:#{PALE};min-height:5in}} .col.c1{{background:#FFF5DF}} .col h3{{margin:0 0 .1in;font-size:19pt;color:#{INDIGO}}} .col.c1 h3{{color:#A0620A}} .col ul{{font-size:14pt}}
table{{width:100%;border-collapse:collapse;font-size:13pt}} th{{background:#{INDIGO};color:#fff;text-align:left;padding:.08in .12in}} td{{padding:.08in .12in;border-bottom:1px solid #{LINE}}} tr:nth-child(odd) td{{background:#F6F7FB}} td:first-child{{font-weight:700}}
.imgrow{{display:flex;gap:.4in;align-items:flex-start}} .imgs{{display:flex;gap:.15in}} .imgs img{{height:5.2in;border-radius:.12in;border:1px solid #{LINE}}}
.note{{position:absolute;left:.7in;right:.7in;bottom:.5in;font-size:10pt;color:#{SOFT};margin:0}}
footer{{position:absolute;left:.6in;right:.6in;bottom:.15in;display:flex;justify-content:space-between;font-size:10pt;color:#{SOFT}}}
.fill{{color:#B04A00;font-weight:700}}
.cover{{background:#{NAVY};color:#fff;padding:2in .8in 0}} .cover h1{{font-size:46pt;margin:0}} .cover .bar{{width:1.6in;height:.08in;background:#{SAFFRON};margin:.3in 0}}
.cover .sub{{font-size:22pt;color:#C9CCF5;margin:0}} .cover .meta{{position:absolute;bottom:.6in;font-size:14pt;color:#9AA0C8}}'''
    open(f'{OUT}/{name}.html', 'w').write(f'<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head><body>{"".join(out)}</body></html>'.replace('→', '&rsaquo;'))

for spec in (INVESTOR, TECH):
    build_pptx(spec); build_html(spec); print('built', spec[0], len(spec[2]), 'slides')
