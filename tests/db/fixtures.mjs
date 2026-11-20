import { createDb } from './harness.mjs';

export const loc = async (api, city, locality = null) =>
  (await api.q('select id from public.locations where city = $1 and locality is not distinct from $2', [city, locality])).rows[0].id;
export const skill = async (api, name) =>
  (await api.q('select id from public.skills where name = $1', [name])).rows[0].id;

/** Build a company owned by a fresh employer; optionally approved by an admin. */
export async function makeCompany(api, admin, name, { approve = true } = {}) {
  const owner = await api.signUp('employer', `${name} Owner`);
  const companyId = await api.as(owner, async (sql) =>
    (await sql('select public.create_employer_company($1,$2,$3,$4) as id', [`${name} Pvt Ltd`, name, 'Mumbai', 'https://example.test'])).rows[0].id);
  if (approve) {
    await api.as(owner, (sql) => sql(`select public.submit_company_verification($1,'domain','example.test')`, [companyId]));
    await api.as(admin, (sql) => sql(`select public.admin_review_company($1,'approve','Documents checked')`, [companyId]));
  }
  return { owner, companyId };
}

/** Create, submit and approve a job. Returns its id. */
export async function makeJob(api, admin, company, o = {}) {
  const d = {
    title: 'Customer Success Executive', salary_min: 500000, salary_max: 700000, salary_period: 'annual',
    exp_min: 12, exp_max: 48, work_mode: 'hybrid', employment_type: 'full_time', city: 'Navi Mumbai', locality: null,
    skills: ['CRM', 'Customer support'], publish: true, ...o };
  const locationId = d.work_mode === 'remote' && !d.city ? null : await loc(api, d.city, d.locality);
  const jobId = await api.as(company.owner, async (sql) => {
    const r = await sql(
      `insert into public.jobs (company_id, title, description, salary_min, salary_max, salary_period,
         experience_min_months, experience_max_months, location_id, work_mode, employment_type, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [company.companyId, d.title, 'A real role description that is comfortably longer than fifty characters.',
        d.salary_min, d.salary_max, d.salary_period, d.exp_min, d.exp_max, locationId, d.work_mode, d.employment_type, company.owner.id]);
    for (const s of d.skills) await sql('insert into public.job_skills (job_id, skill_id) values ($1,$2)', [r.rows[0].id, await skill(api, s)]);
    return r.rows[0].id;
  });
  if (d.publish) {
    await api.as(company.owner, (sql) => sql('select public.submit_job_for_review($1)', [jobId]));
    await api.as(admin, (sql) => sql(`select public.admin_review_job($1,'approve','Content is acceptable')`, [jobId]));
  }
  return jobId;
}

/** Candidate with a populated profile. */
export async function makeCandidate(api, name, o = {}) {
  const c = await api.signUp('candidate', name);
  const d = { city: 'Navi Mumbai', months: 30, salary: 600000, skills: ['CRM', 'Customer support'], discovery: false, ...o };
  await api.as(c, async (sql) => {
    await sql(
      `update public.candidate_profiles set headline=$2, experience_months=$3, salary_min=$4, salary_period='annual',
         current_location_id=$5, updated_at=now() where user_id=$1`,
      [c.id, d.headline ?? 'Customer success professional', d.months, d.salary, await loc(api, d.city, d.locality ?? null)]);
    for (const s of d.skills)
      await sql('insert into public.candidate_skills (candidate_id, skill_id, confirmed) values ($1,$2,true)', [c.id, await skill(api, s)]);
    if (d.discovery) await sql(`select public.set_consent('employer_discovery', true, '2026-11-18')`);
  });
  return c;
}

export async function world() {
  const api = await createDb();
  const admin = await api.signUp('candidate', 'Platform Admin');
  await api.grantAdmin(admin, 'admin');
  return { api, admin };
}
