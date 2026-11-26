// DRAFT legal copy. Not legal advice. Every item marked [LEGAL REVIEW] must be approved by a
// qualified Indian lawyer before public launch. Owner placeholders are in docs/OWNER_ACTIONS.md.
// Bump whenever notice text changes. v1.3.0 recorded 2026-11-19, so this must sort later.
export const NOTICE_VERSION = '2026-11-26';
export const SUPPORT_EMAIL = 'support@getkaamsetu.in';
export const PRIVACY_EMAIL = 'privacy@getkaamsetu.in';

export type LegalPage = { title: string; sections: { heading: string; body: string }[] };

export const legalPages: Record<'privacy' | 'terms' | 'support', LegalPage> = {
  privacy: { title: 'Privacy Notice (draft)', sections: [
    { heading: 'Who we are', body: 'KaamSetu is operated by Aarvya Global Ventures LLP ("we"). We connect job seekers with verified employers across India. [LEGAL REVIEW: registered address and data-fiduciary details]' },
    { heading: 'What we collect', body: 'Account details (name, email, mobile number), the profile information you add (skills, experience, education, salary expectations, locations), resumes you upload, your applications, interview and offer records, and technical data needed to keep the service secure.' },
    { heading: 'How employers see your data', body: 'When you apply to a job (or accept an invitation), that company can see your name, profile, match score and your resume once it has passed our security checks. Every resume and contact disclosure is logged and listed for you. If you switch on employer discovery, verified employers can see a masked profile (no name, email, phone or resume). Your email and phone are shared only after you are shortlisted and you have agreed to contact sharing. You can withdraw each choice at any time in Settings.' },
    { heading: 'Matching', body: 'Match scores are calculated by a fixed, rule-based formula (not artificial intelligence) that uses skills, location, work mode, salary, experience and job freshness. They never use name, photo, gender, religion, caste, age, marital status or disability. Scores help you decide; nothing is applied or rejected automatically.' },
    { heading: 'Your choices', body: 'In Settings you can download your data, request account deletion, withdraw consent, and control optional emails. Each consent is recorded with the notice version and date.' },
    { heading: 'Who processes your data', body: 'Supabase (database, sign-in and file storage), our email delivery provider (when connected), our resume virus-scanning provider (when connected), and our web host. [LEGAL REVIEW: processor list, locations and agreements]' },
    { heading: 'Retention', body: 'We keep data while your account is active. After a deletion request is processed we remove or anonymise your profile; consent and security records may be kept as required by law. [LEGAL REVIEW: retention periods]' },
    { heading: 'Contact', body: `Privacy requests and grievances: ${PRIVACY_EMAIL}. [LEGAL REVIEW: grievance officer name and response time]` },
  ] },
  terms: { title: 'Terms of Use (draft)', sections: [
    { heading: 'Using KaamSetu', body: 'You must provide accurate information. Employers must be verified before publishing jobs, must show a real salary range, and must never ask candidates for money.' },
    { heading: 'Prohibited conduct', body: 'No fake jobs, discrimination, harassment, scraping, or attempts to access other users\' data. We may suspend accounts that break these rules.' },
    { heading: 'No guarantee', body: 'KaamSetu is a marketplace. We do not guarantee interviews, offers or hiring outcomes. [LEGAL REVIEW: liability, governing law, dispute resolution]' },
  ] },
  support: { title: 'Support', sections: [
    { heading: 'Get help', body: `Email ${SUPPORT_EMAIL} and include the email or mobile number you registered with. Never send your password.` },
    { heading: 'Report a job', body: 'Open any job and choose "Report this job" if it asks for money, looks fake, or is discriminatory.' },
    { heading: 'Privacy requests', body: `Use Settings to download your data or request deletion. For anything else write to ${PRIVACY_EMAIL}.` },
    { heading: 'Location data', body: 'States, districts and PIN codes: Department of Posts, Government of India, "All India Pincode Directory", data.gov.in, used under the Government Open Data License – India.' },
  ] },
};
