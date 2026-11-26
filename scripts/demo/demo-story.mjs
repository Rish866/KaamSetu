// The demo story, independent of how it is executed. Used by scripts/demo/seed-demo.mjs (local Supabase stack)
// and by tests/db/demo.test.mjs (in-process database), so the demo is checked on every CI run.
//   ctx.q(sql, params)            superuser query, returns rows
//   ctx.as(uid | null, sql, params) one statement as that signed-in user (null = service role), returns rows
//   ctx.createUser(email, name, kind) creates a sign-in-capable account, returns its id
const NOTICE = '2026-11-26.2';
const daysAgo = (n) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10);

export const accounts = {
  admin: { email: 'demo-admin@example.com', name: 'Demo Admin' },
  employer: { email: 'demo-employer@example.com', name: 'Priya Sharma (Demo Logistics)' },
  asha: { email: 'demo-asha@example.com', name: 'Asha Patil' },
  ravi: { email: 'demo-ravi@example.com', name: 'Ravi Kumar' },
  meena: { email: 'demo-meena@example.com', name: 'Meena Iyer' },
  kabir: { email: 'demo-kabir@example.com', name: 'Kabir Singh' },
};

export async function seedDemo({ q, as, createUser, log = console.log }) {
  const one = async (uid, sql, params) => (await as(uid, sql, params))[0];
  const loc = async (city) => (await q(`select id from public.locations where city = $1 and locality is null and kind not in ('state','pin')
    order by case kind when 'city' then 0 else 1 end limit 1`, [city]))[0]?.id;
  const skillIds = async (names) => (await q('select id from public.skills where name = any($1)', [names])).map((r) => r.id);
  if ((await q(`select 1 from auth.users where email = $1`, [accounts.employer.email])).length) {
    log(JSON.stringify({ demo: 'already seeded', hint: 'run `supabase db reset` for a fresh demo' }));
    return null;
  }
  const id = {};
  for (const [k, a] of Object.entries(accounts)) id[k] = await createUser(a.email, a.name, k === 'employer' ? 'employer' : 'candidate');
  await q(`insert into private.app_roles (user_id, role) values ($1, 'admin') on conflict do nothing`, [id.admin]);
  // Local demo only: fees on, so the hiring ledger shows an entry. Production keeps fees off.
  await as(id.admin, `select public.admin_set_hire_fee(true, 4999, 'retained_day_15', 'Local demo only: show the hiring ledger')`);

  // Company: GSTIN verification (fictional, format-valid number), approved by the admin, with a review commitment.
  const company = (await one(id.employer, `select public.create_employer_company('Demo Logistics Pvt Ltd', 'Demo Logistics', 'Navi Mumbai', 'https://demo-logistics.example') id`)).id;
  await as(id.employer, `select public.submit_company_verification($1, 'gstin', '27AABCD1234E1Z5')`, [company]);
  await as(id.admin, `select public.admin_review_company($1, 'approve', 'Demo: GSTIN checked on the GST portal')`, [company]);
  await as(id.employer, 'select public.set_review_commitment($1, 3)', [company]);

  async function job(title, city, mode, officeDays, skills, questions) {
    const j = (await one(id.employer, `insert into public.jobs (company_id, title, description, salary_min, salary_max, salary_period, experience_min_months,
        experience_max_months, location_id, work_mode, employment_type, office_days, created_by)
      values ($1, $2, $3, 480000, 660000, 'annual', 12, 60, $4, $5, 'full_time', $6, $7) returning id`,
      [company, title, `${title} at Demo Logistics. Work with customers and the operations team; training provided. Salary as listed, paid monthly.`,
        await loc(city), mode, officeDays, id.employer])).id;
    for (const s of await skillIds(skills)) await as(id.employer, 'insert into public.job_skills (job_id, skill_id) values ($1, $2)', [j, s]);
    if (questions) await as(id.employer, 'select public.set_job_questions($1, $2)', [j, JSON.stringify(questions)]);
    await as(id.employer, 'select public.submit_job_for_review($1)', [j]);
    await as(id.admin, `select public.admin_review_job($1, 'approve', 'Demo: salary and description are clear')`, [j]);
    return j;
  }
  const jobA = await job('Customer Success Executive', 'Navi Mumbai', 'hybrid', 3, ['CRM', 'Customer support'], [
    { kind: 'yes_no', prompt: 'Can you work alternate Saturdays?', required: true },
    { kind: 'short_text', prompt: 'What is your notice period?', required: false }]);
  const jobB = await job('Inside Sales Associate', 'Pune', 'onsite', null, ['CRM'], null);

  async function candidate(uid, o) {
    await as(uid, `update public.candidate_profiles set headline = $2, experience_months = $3, salary_min = $4, salary_period = 'annual',
        current_location_id = $5, relocation = $6, max_office_days = $7, commute_note = $8, notice_days = 30, updated_at = now() where user_id = $1`,
      [uid, o.headline, o.months, o.salary, await loc(o.city), o.relocation ?? 'no', o.officeDays ?? null, o.commute ?? null]);
    for (const s of await skillIds(o.skills ?? ['CRM', 'Customer support'])) await as(uid, 'insert into public.candidate_skills (candidate_id, skill_id, confirmed) values ($1, $2, true)', [uid, s]);
    for (const p of o.consents ?? []) await as(uid, `select public.set_consent($1, true, '${NOTICE}')`, [p]);
    if (o.alerts) await as(uid, 'select public.set_job_alerts(true)');
  }
  await candidate(id.asha, { headline: 'Customer support lead, 3 years in logistics', months: 36, salary: 560000, city: 'Navi Mumbai', relocation: 'within_state', officeDays: 3,
    commute: 'Up to 45 minutes by local train', consents: ['employer_discovery', 'contact_sharing', 'joining_verification'], alerts: true });
  await candidate(id.ravi, { headline: 'Customer care associate', months: 14, salary: 450000, city: 'Thane' });
  await candidate(id.meena, { headline: 'Support executive', months: 24, salary: 520000, city: 'Mumbai' });
  await candidate(id.kabir, { headline: 'CRM specialist open to moving', months: 30, salary: 540000, city: 'Bengaluru', relocation: 'anywhere_india', skills: ['CRM'], consents: ['employer_discovery'], alerts: true });

  const qs = await q('select id, kind from public.job_questions where job_id = $1 order by position', [jobA]);
  const apply = async (uid, notice) => (await one(uid, 'select public.apply_with_answers($1, null, $2) id', [jobA,
    JSON.stringify([{ question_id: qs[0].id, answer: true }, ...(notice ? [{ question_id: qs[1].id, answer: notice }] : [])])])).id;
  const move = (app, to, reason = null, details = null, tag = null) => as(id.employer, 'select public.transition_application($1, $2, $3, $4, $5)', [app, to, reason, details, tag]);

  // Asha: the full journey, from application to "still working at day 30", every step confirmed by both sides.
  const asha = await apply(id.asha, '30 days');
  await move(asha, 'viewed'); await move(asha, 'shortlisted');
  await as(id.employer, 'select * from public.get_applicant_contact($1)', [asha]);
  await as(id.employer, `select public.propose_interview($1, $2, 'video', 'Video call link shared by email')`, [asha, new Date(Date.now() + 86400e3).toISOString()]);
  const iv = (await q(`select id from public.interviews where application_id = $1`, [asha]))[0].id;
  await as(id.asha, `select public.respond_to_interview($1, 'confirm')`, [iv]);
  await move(asha, 'offer', null, 'CTC ₹6,00,000 a year, hybrid (3 office days), joining on the 1st');
  await as(id.asha, 'select public.respond_to_offer($1, true)', [asha]);
  const confirmPending = async () => { for (const m of await q(`select id from public.hiring_milestones where application_id = $1 and status = 'pending'`, [asha])) await as(id.asha, 'select public.confirm_hiring_milestone($1)', [m.id]); };
  await as(id.employer, `select public.report_hiring_milestone($1, 'joined_day_1', $2)`, [asha, daysAgo(31)]); await confirmPending();
  await as(id.employer, `select public.report_hiring_milestone($1, 'retained_day_15')`, [asha]); await confirmPending();
  await as(id.employer, `select public.report_hiring_milestone($1, 'retained_day_30')`, [asha]); await confirmPending();

  // Ravi: rejected with a neutral reason; Meena: withdrew with her own reason.
  const ravi = await apply(id.ravi);
  await move(ravi, 'viewed');
  await move(ravi, 'rejected', 'We need at least 2 years of CRM experience for this role', null, 'skills_or_experience_gap');
  const meena = await apply(id.meena, '60 days');
  await as(id.meena, `select public.withdraw_application($1, 'relocation_or_commute_change')`, [meena]);

  // Kabir: found through discovery because he is open to relocating anywhere in India, then invited.
  const found = await as(id.employer, 'select candidate_id from public.discover_candidates($1, null, $2)', [jobA, [await loc('Navi Mumbai')]]);
  if (found.some((r) => r.candidate_id === id.kabir)) await as(id.employer, `select public.invite_candidate($1, $2, 'Open to relocating? This role is in Navi Mumbai.')`, [jobA, id.kabir]);

  const alerts = (await one(null, 'select public.job_alerts_run() r')).r;
  const summary = { demo: 'seeded', company, jobs: [jobA, jobB], kabir_found_in_discovery: found.some((r) => r.candidate_id === id.kabir), alerts,
    accounts: Object.fromEntries(Object.entries(accounts).map(([k, a]) => [k, a.email])) };
  log(JSON.stringify(summary));
  return { ...summary, id };
}
