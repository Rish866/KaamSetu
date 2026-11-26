#!/usr/bin/env python3
"""Builds the two KaamSetu decks as PowerPoint (.pptx) and HTML (printed to PDF by the caller).
  python3 scripts/build-decks.py OUT_DIR
Facts come from the repository and production runs as of 2026-11-26. Numbers we do not have (team, pricing, funding ask,
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
  dict(kind='cover', title='KaamSetu', sub='Verified jobs across India, with hiring accountability built in', meta=f'Aarvya Global Ventures LLP · {DATE} · www.getkaamsetu.in'),
  dict(kind='cards', title='The problem: hiring in India runs on low trust', cards=[
    ('93%', 'of Indian job seekers have met suspicious or fraudulent job offers'),
    ('51%', 'are not confident they can tell a real recruiter from a scammer'),
    ('82%', 'now check whether a role is real before applying'),
  ], bullets=['Ghost jobs and hidden salaries waste weeks of interviews.', 'Candidates are asked for "registration" or "processing" fees.', 'Both sides ghost: employers stop replying, offers are rescinded, hires do not turn up.'],
    note='Sources: Indeed survey, reported by Storyboard18 (2026); LinkedIn analysis, reported by ET HRWorld (2026).'),
  dict(kind='bullets', title='Our solution: a job marketplace that measures trust', bullets=[
    '**Verified employers, visible salaries, zero candidate fees.** Every company is checked and every job reviewed before it goes live.',
    '**Public reliability scorecards.** Response time, offers honoured and hires who joined, calculated by KaamSetu from real hiring data. Employers cannot edit them.',
    '**Anti-ghosting milestones.** Offer → accepted → joined day 1 → still working at day 15 and day 30, confirmed by both sides.',
    '**No ghost listings.** Jobs must be re-confirmed every 30 days or they pause automatically.',
    '**Explainable matching, privacy by design.** Clear formula without protected attributes; contact details only with consent.',
  ]),
  dict(kind='image', title='The product is live, India-wide', image='store/screenshots/android-phone-1080x1920-1-home.png', image2='store/screenshots/android-phone-1080x1920-2-candidate-sign-in.png', bullets=[
    'Live at **www.getkaamsetu.in** on phone, tablet and desktop; Android and iPhone apps from the same code.',
    'Search anywhere in India: 36 states/UTs, 737 districts, 19,300 PIN codes, whole states, remote.',
    'Full journey tested on the live site, from sign-up to confirmed joining (26/26 automated checks).',
  ]),
  dict(kind='two', title='What each user gets', left=('Job seekers (always free)', [
    'Search by city, district, state, PIN code or remote', 'Match score with the reasons behind it', 'See each employer\'s reliability record before applying',
    'Accept offers and confirm joining in the app', 'Resume upload with virus scan', 'Consent controls, data download, account deletion']),
    right=('Employers', [
    'Free job posting after verification', 'Applicant pipeline through offer and joining', 'Find opted-in candidates by place across India',
    'A public record that rewards reliable employers', 'Pay only for confirmed hires (outcome-based)', 'Team roles and audit trail'])),
  dict(kind='table', title='The accountability engine', rows=[
    ['Mechanism', 'How it works', 'Why it matters'],
    ['Two-sided milestones', 'Offer, joining, day 15/30 reported by one side, confirmed by the other; disputes decided by KaamSetu', 'Hiring outcomes are evidence, not claims'],
    ['Reliability scorecard', 'Median response time, % offers honoured, % joined, % still working at day 30', 'Candidates choose reliable employers'],
    ['Honest small samples', '"New employer" until there is enough data', 'No fake or inflated statistics'],
    ['30-day re-confirmation', 'Reminder at 25 days, automatic pause at 30', 'No ghost jobs in search'],
    ['Outcome-based fees', 'Fee only when a confirmed milestone is reached', 'Employers pay for results, not leads'],
  ]),
  dict(kind='table', title='How we compare', rows=[
    ['', 'KaamSetu', 'Large job boards', 'WhatsApp / agents'],
    ['Employer verified before posting', 'Yes, every company', 'Varies', 'No'],
    ['Salary shown on every job', 'Required', 'Often hidden', 'Rarely'],
    ['Candidate fees', 'Banned', 'Paid add-ons exist', 'Common'],
    ['Public employer reliability data', 'Yes, from confirmed outcomes', 'Reviews, not outcomes', 'No'],
    ['Stale jobs removed automatically', 'Yes, every 30 days', 'Varies', 'No'],
    ['Employer pays for', 'Confirmed hires', 'Listings and database access', 'Commission, often from candidates'],
  ], note='Comparison is qualitative, based on publicly visible features; not a claim about any specific competitor.'),
  dict(kind='cards', title='Market', cards=[
    ('USD 13.8 bn', 'turnover of recruitment agencies in India, 2025 (Euromonitor)'),
    ('USD 86 m', 'India recruitment software market, 2026 (IMARC)'),
    ('[FILL IN]', 'job seekers and hiring businesses in our first target segment'),
  ], bullets=['National product from day one; go-to-market city by city where we can verify employers well.', 'Outcome-based fees compete with agency commissions, not with job-board subscriptions.'],
    note='Sources: Euromonitor, "Recruitment Agencies in India" (2025); IMARC Group, India recruitment software market (2026). Segment sizing to be added by the founders.'),
  dict(kind='bullets', title='Business model: pay for outcomes', bullets=[
    'Job posting free for verified employers. Candidates never pay; this is in our Terms and enforced in the product.',
    'Hiring fee per confirmed hire: [FILL IN amount] when the candidate [FILL IN: joins / is still working at day 15 / day 30].',
    'The fee ledger is built: fees become payable only after both sides confirm the milestone; no-shows and early leavers cost nothing.',
    'Fees are switched off today. Before switching on: GST and invoicing advice, approved employer terms.',
    'Running cost at pilot scale: about ₹0 per month on free tiers.',
  ], note='Pricing has not been tested with customers yet.'),
  dict(kind='cards', title='Built for India\'s privacy law', cards=[
    ('May 2027', 'core DPDP Act and Rules obligations apply (Rules notified 13 Nov 2025)'),
    ('Per purpose', 'separate, withdrawable consents, each recorded with the notice version'),
    ('Built in', 'data download, account deletion, audit trail, grievance mailbox'),
  ], bullets=['Competitors must retrofit consent, retention and erasure; KaamSetu was designed around them.', 'Legal review of our notice and terms is in progress.'],
    note='Source: Legal500, "DPDP Act Compliance For Startups And MSMEs" (2026); IBA, "The practicalities of implementing India\'s DPDP Act" (2026).'),
  dict(kind='table', title='Traction and status (honest)', rows=[
    ['Milestone', 'Status'],
    ['Product live on www.getkaamsetu.in, India-wide locations', 'Done'],
    ['Offer/joining milestones, scorecards, fee ledger', 'Done, production tested'],
    ['Email, support mailboxes, virus scanning, backups and restore test', 'Done'],
    ['Legal review of privacy notice and terms', 'In progress'],
    ['Pilot: 3–5 verified employers, 20–50 candidates', 'Next'],
    ['Hire fees switched on', 'After GST and legal sign-off'],
    ['Android and iPhone store listings', 'Planned'],
  ], note='No real users yet: the pilot starts after legal sign-off.'),
  dict(kind='bullets', title='Pilot plan and success metrics', bullets=[
    '3–5 verified employers and 20–50 candidates; recruited directly, verified with GSTIN/CIN.',
    'Targets: ≥60% complete profiles · company and job review within 1 working day · ≥70% applications viewed within 3 days · ≥80% employers respond within 7 days · at least 1 confirmed joining · 0 serious security or privacy incidents.',
    'Launch-ready when targets hold for 4 consecutive weeks.',
  ]),
  dict(kind='bullets', title='Roadmap', bullets=[
    '**Next 3 months:** pilot, legal sign-off, first paid hires, Play Store and App Store, Hindi/Marathi.',
    '**3–6 months:** payment collection and GST invoices, WhatsApp/SMS alerts, faster search at national scale.',
    '**6–12 months:** more cities and sectors, distance/commute search, verified skill badges, employer analytics.',
  ], note='Roadmap is indicative and depends on pilot results and funding.'),
  dict(kind='bullets', title='Team', bullets=['[FILL IN: founder names, roles and relevant experience]', '[FILL IN: advisors, if any]', 'Company: Aarvya Global Ventures LLP.']),
  dict(kind='bullets', title='The ask', bullets=['[FILL IN: amount being raised and instrument]', 'Use of funds: [FILL IN, e.g. employer sales and verification team, support, marketing, store launch]', '[FILL IN: milestones this money reaches, e.g. number of confirmed hires]']),
  dict(kind='closing', title='Thank you', sub='KaamSetu: the accountable bridge to work', meta='rishabh@getkaamsetu.in · www.getkaamsetu.in'),
])

TECH = ('KaamSetu-Technical-Deck', 'Product and technical deck', [
  dict(kind='cover', title='KaamSetu: product and technology', sub='Architecture, data model, accountability engine, security, privacy, testing and operations', meta=f'Aarvya Global Ventures LLP · {DATE} · facts as of 26 Nov 2026'),
  dict(kind='table', title='At a glance', rows=[
    ['Area', 'Choice'],
    ['App (web + Android + iPhone)', 'React Native 0.88 with Expo SDK 58, one TypeScript codebase; Expo Router'],
    ['Website hosting', 'Static export on GitHub Pages, custom domain, HTTPS (Let\'s Encrypt), auto-deploy and verification on every merge'],
    ['Backend', 'Supabase: PostgreSQL 17, Auth, Storage; business rules in SQL functions'],
    ['Data model', '37 tables, 94 user-callable functions, 15 versioned migrations'],
    ['Security model', 'Row-level security on every table; users call checked functions, not tables'],
    ['Background jobs', 'Node.js worker in GitHub Actions every 15 minutes (cron-job.org trigger)'],
    ['Virus scanning / email', 'ClamAV in Docker · Resend (app email), Zoho Mail (mailboxes)'],
    ['Monthly running cost (pilot)', 'About ₹0: free tiers throughout'],
  ]),
  dict(kind='two', title='System architecture', left=('User side', [
    'Browser → www.getkaamsetu.in (GitHub Pages, static files)', 'Android / iPhone apps (Expo builds)',
    'All talk directly to Supabase over HTTPS with a public key', 'No custom server to run or patch']),
    right=('Supabase + jobs', [
    'Auth: email or Indian mobile + password', 'PostgreSQL with RLS; private schema for settings, roles, audit, email queue',
    'Private storage buckets for resumes, photos, company documents', 'Worker: virus scan, resume reading, account clean-up, email, milestone auto-confirm, stale-job sweep',
    'Resend sends email; Zoho receives it'])),
  dict(kind='bullets', title='Frontend', bullets=[
    'One TypeScript codebase for web, Android and iPhone; screens for candidates, employers, admins and legal pages.',
    'Type-ahead location picker for any place in India (city, area, district, whole state, PIN code or PIN prefix).',
    'Shared components for hiring milestones, reliability scorecards and the fee ledger.',
    'Pre-rendered static HTML; maintenance screen appears automatically if the database is older than the app.',
    'Accessibility (axe) and responsive checks on phone, tablet and desktop; CSP, no secret keys in the bundle.',
  ]),
  dict(kind='table', title='Pan-India location model', rows=[
    ['Level', 'Data', 'Use'],
    ['State / UT', '36 (India Post, data.gov.in, GODL-India)', '"Entire state" filters and preferences'],
    ['District', '737', 'District-level matching (e.g. Navi Mumbai ~ Thane)'],
    ['City / area', 'Curated cities and localities', 'Type-ahead search, labels'],
    ['PIN code', '19,300 with post-office names', 'Exact PIN or PIN-prefix search'],
  ], note='Location score: area/PIN 100, city 85, district 75, entire-state preference 70, otherwise 0. Filters run before scoring so national search stays fast. Distance search deferred: official coordinates are unreliable.'),
  dict(kind='table', title='Matching engine (rule-based, explainable)', rows=[
    ['Factor', 'Weight', 'What it compares'],
    ['Skills', '35', 'Job skills the candidate has (confirmed only)'],
    ['Location', '25', 'Job place vs. home and up to 10 ranked preferences'],
    ['Salary', '20', 'Job range vs. expected salary'],
    ['Experience', '15', 'Required vs. candidate experience'],
    ['Freshness', '5', 'How recently the job was posted'],
  ], note='Weights are versioned and changed only by an admin with a written reason. A test proves the formula never reads name, photo, gender, religion, caste, age, marital status or disability.'),
  dict(kind='bullets', title='Hiring milestones (anti-ghosting)', bullets=[
    'Offer issued automatically on "Make offer"; only the candidate accepts (employers cannot mark a hire themselves).',
    'Joined day 1, no-show, still working at day 15 and day 30, left early: reported by one side, confirmed or disputed by the other.',
    'Unanswered reports auto-confirm after 7 days; disputes go to an admin queue and are decided with a written reason.',
    'Date rules enforced in the database (day 15/30 only after 15/30 days; no withdrawal after joining).',
    'Every step timestamped, attributed, notified and audited; history is immutable.',
  ]),
  dict(kind='bullets', title='Reliability scorecard and stale-job control', bullets=[
    'Computed live from the last 365 days: median response time, % answered within 7 days, % offers honoured, % joined, % still working at day 30.',
    'Thresholds (5 applications; 3 offers or outcomes) before any number is shown; below them "New employer".',
    'Only confirmed milestones count; withdrawn-before-answer applications are excluded from response time.',
    'Published jobs must be re-confirmed every 30 days: reminder at 25, automatic pause at 30 (system event, notified).',
  ]),
  dict(kind='bullets', title='Outcome-based hiring ledger', bullets=[
    'Fee terms (on/off, ₹ per hire, milestone) are admin settings with a reason; currently OFF and ₹0.',
    'Terms are copied onto each hire at offer acceptance; later changes never apply retroactively.',
    'pending_milestone → payable (milestone confirmed) → paid (admin records bank/UPI reference); void on no-show or early leaving; disputes by the company owner; waivers by admins.',
    'Immutable ledger history; candidates are never a party. Payment collection and GST invoices are not built yet.',
  ]),
  dict(kind='bullets', title='Security', bullets=[
    'Row-level security on every table; anonymous users cannot read private data or call protected functions (28 automated production checks after every release).',
    'Least privilege: the internal service role has only what the workers need; worker functions are not callable by users.',
    'Admin roles (admin, moderator, privacy, support) with "last admin" protection; every decision needs a reason and is audited.',
    'Resumes locked until ClamAV passes them; contact details and resumes released only by consent and application, every release logged.',
    'Secret scanning on every change; keys fetched at run time and masked in logs.',
  ]),
  dict(kind='bullets', title='Privacy (DPDP-oriented)', bullets=[
    'Separate consents per purpose (discovery, contact sharing, resume reading, joining verification, marketing), append-only and versioned with the notice.',
    'Joining verification is required to accept an offer and enforced for every joining record; withdrawing it stops new records and auto-confirmation.',
    'Download my data (now including hiring records) and admin-verified deletion that closes open reports and removes personal notes.',
    'Daily retention rules; notifications and logs carry no names, emails or phone numbers.',
    'Legal review pack v2 prepared for counsel (Word + PDF).',
  ]),
  dict(kind='table', title='Testing and quality', rows=[
    ['Test layer', 'Count', 'Runs'],
    ['Database, security and business rules (in-memory Postgres)', '113', 'Every change'],
    ['Same database suite on real Supabase Postgres', '113', 'Every change'],
    ['Upgrade rehearsal from the previous production schema', 'Full run', 'Every change'],
    ['Unit tests', '23', 'Every change'],
    ['Browser tests: pages, accessibility, responsive, maintenance', '57', 'Every change'],
    ['Real UI journeys on a local Supabase stack, incl. real ClamAV', '34', 'Every change'],
    ['Live journey on the production website', '26', 'After every release'],
  ], note='7 CI jobs must pass before any change is merged. Lint and type checks included.'),
  dict(kind='bullets', title='Delivery and operations', bullets=[
    'Every merge to main builds the website, publishes it and verifies the live site serves that exact build with every file.',
    'Database releases: drift check, dry run, encrypted backup, apply, production checks, then live journey. Five releases on 26 Nov 2026, all with backups.',
    'Restore drill into a fresh database passed (all row counts equal, security checks pass).',
    'Rollback: redeploy any earlier website build in one click; database fixes are forward-only migrations.',
    'Runbooks for operations, incidents, secret rotation and the pilot.',
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
    'Scorecards and match scores are computed on request: fine for a pilot, need caching/pre-computation at national scale.',
    'Background jobs every 15 minutes (not instant). No distance/commute search yet.',
    'Payment collection, GST invoices and fee terms are not built; fees stay off until they are.',
    'Free database plan: no point-in-time recovery (manual encrypted backups instead).',
    'Not yet done: external penetration test, error monitoring, store releases, Hindi/Marathi.',
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
