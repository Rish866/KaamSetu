// The mandatory 19-step end-to-end journey, executed against the real migrations
// through the same RPCs and table writes the app uses, under real RLS roles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb, failure } from './harness.mjs';
import { loc, skill } from './fixtures.mjs';

test('mandatory journey: register -> profile -> resume -> company -> verify -> job -> match -> apply -> pipeline -> offer -> export -> deletion -> isolation', async (t) => {
  const api = await createDb();
  const admin = await api.signUp('candidate', 'Owner Admin'); await api.grantAdmin(admin, 'admin');
  const as = (u, sql, p) => api.as(u, async (s) => (await s(sql, p)).rows);
  let cand, emp, companyId, jobId, appId, ivId;

  await t.test('1. candidate registers', async () => {
    cand = await api.signUp('candidate', 'Journey Candidate');
    const a = (await as(cand, 'select * from public.current_user_access()'))[0];
    assert.deepEqual([a.account_kind, a.is_admin, a.status], ['candidate', false, 'active']);
    assert.ok((await as(cand, `select 1 from public.consent_records where purpose='account'`)).length === 1, 'privacy notice acceptance recorded');
  });
  await t.test('2. candidate completes profile', async () => {
    await api.as(cand, async (s) => {
      await s(`update public.candidate_profiles set headline='Customer support specialist', experience_months=36, salary_min=550000, salary_period='annual', current_location_id=$2, employment_status='employed', notice_days=30 where user_id=$1`, [cand.id, await loc(api, 'Thane')]);
      for (const n of ['CRM', 'Customer support', 'English']) await s('insert into public.candidate_skills (candidate_id, skill_id, confirmed) values ($1,$2,true)', [cand.id, await skill(api, n)]);
      await s(`insert into public.candidate_education (candidate_id, institution, qualification, start_year, end_year) values ($1,'Mumbai University','B.Com',2016,2019)`, [cand.id]);
      await s(`select public.set_consent('contact_sharing', true, '2026-11-18')`); await s(`select public.set_consent('resume_parsing', true, '2026-11-18')`);
    });
  });
  await t.test('3. candidate uploads and confirms resume information', async () => {
    await api.q(`insert into storage.objects (bucket_id,name,owner_id,metadata) values ('resumes',$1,$2,'{"size":"2048"}')`, [`${cand.id}/r.pdf`, cand.id]);
    const rid = (await as(cand, `select public.register_resume($1,'cv.pdf','application/pdf',2048,$2) id`, [`${cand.id}/r.pdf`, 'ab'.repeat(32)]))[0].id;
    await api.q(`insert into public.resume_extractions (resume_id, candidate_id, data) values ($1,$2,'{"skills":["Microsoft Excel"]}')`, [rid, cand.id]);
    await as(cand, `select public.accept_resume_extraction($1,'{"Microsoft Excel"}')`, [rid]);
    const p = (await as(cand, 'select public.my_profile_completion() p'))[0].p; assert.equal(p.percent, 100, JSON.stringify(p));
  });
  await t.test('4. employer registers', async () => { emp = await api.signUp('employer', 'Journey Recruiter'); });
  await t.test('5. employer creates company and submits verification', async () => {
    companyId = (await as(emp, `select public.create_employer_company('Journey Logistics Pvt Ltd','Journey Logistics','Thane','https://journey.example') id`))[0].id;
    await as(emp, `select public.submit_company_verification($1,'cin','U63000MH2021PTC123456')`, [companyId]);
  });
  await t.test('6. admin verifies company', async () => {
    assert.ok((await as(admin, 'select * from public.admin_company_queue()')).some((r) => r.company_id === companyId));
    await as(admin, `select public.admin_review_company($1,'approve','CIN verified on MCA portal')`, [companyId]);
  });
  await t.test('7. employer creates job', async () => {
    jobId = (await as(emp, `insert into public.jobs (company_id,title,description,salary_min,salary_max,salary_period,experience_min_months,experience_max_months,location_id,work_mode,employment_type,created_by)
      values ($1,'Customer Support Lead','Lead a team of five support agents handling inbound customer queries for a logistics firm.',600000,800000,'annual',24,72,$2,'hybrid','full_time',$3) returning id`, [companyId, await loc(api, 'Thane'), emp.id]))[0].id;
    for (const n of ['CRM', 'Customer support']) await as(emp, 'insert into public.job_skills (job_id, skill_id) values ($1,$2)', [jobId, await skill(api, n)]);
    await as(emp, 'select public.submit_job_for_review($1)', [jobId]);
    assert.equal((await as(cand, 'select * from public.job_feed()')).length, 0, 'unapproved job is invisible');
  });
  await t.test('8. admin approves job', async () => { await as(admin, `select public.admin_review_job($1,'approve','Salary and description are clear')`, [jobId]); });
  await t.test('9. candidate receives a real match score', async () => {
    const f = await as(cand, 'select * from public.job_feed()');
    assert.equal(f.length, 1); assert.ok(f[0].eligible); assert.ok(Number(f[0].score) >= 90, `score ${f[0].score}`);
    assert.match(f[0].match.components.skills.explanation, /Matches 2 of 2/);
  });
  await t.test('10. candidate applies', async () => { appId = (await as(cand, `select public.apply_to_job($1,'Available to join in 30 days') id`, [jobId]))[0].id; });
  await t.test('11. employer views the application', async () => {
    const list = await as(emp, 'select * from public.list_job_applicants($1)', [jobId]);
    assert.equal(list[0].display_name, 'Journey Candidate'); assert.ok(!('email' in list[0]));
    await as(emp, `select public.transition_application($1,'viewed')`, [appId]);
  });
  await t.test('12. employer shortlists the candidate', async () => {
    await as(emp, `select public.transition_application($1,'shortlisted')`, [appId]);
    const c = (await as(emp, 'select * from public.get_applicant_contact($1)', [appId]))[0]; assert.equal(c.email, cand.email);
  });
  await t.test('13. employer proposes an interview', async () => { ivId = (await as(emp, `select public.propose_interview($1,$2,'video','Link will be emailed') id`, [appId, new Date(Date.now() + 2 * 86400e3).toISOString()]))[0].id; });
  await t.test('14. candidate requests rescheduling, then confirms', async () => {
    await as(cand, `select public.respond_to_interview($1,'reschedule','Evening please')`, [ivId]);
    const iv2 = (await as(emp, `select public.propose_interview($1,$2,'video') id`, [appId, new Date(Date.now() + 3 * 86400e3).toISOString()]))[0].id;
    await as(cand, `select public.respond_to_interview($1,'confirm')`, [iv2]);
  });
  await t.test('15. employer moves the candidate to offer', async () => { await as(emp, `select public.transition_application($1,'offer',null,'CTC 7.2 LPA, joining 2 Jan 2027')`, [appId]); });
  await t.test('16. candidate sees every status update', async () => {
    const a = (await as(cand, 'select public.my_applications() a'))[0].a[0];
    assert.deepEqual(a.timeline.map((x) => x.stage), ['applied', 'viewed', 'shortlisted', 'interview', 'offer']);
    assert.equal(a.timeline.at(-1).details, 'CTC 7.2 LPA, joining 2 Jan 2027');
    const kinds = (await as(cand, 'select kind from public.notifications')).map((n) => n.kind);
    for (const k of ['application.viewed', 'application.shortlisted', 'interview.proposed', 'interview.changed', 'application.offer']) assert.ok(kinds.includes(k), k);
  });
  await t.test('17. candidate downloads their personal-data export', async () => {
    const d = (await as(cand, 'select public.request_data_export() d'))[0].d;
    assert.equal(d.applications[0].stage, 'offer'); assert.equal(d.contact_disclosures.length, 1); assert.equal(d.resumes.length, 1);
  });
  await t.test('18. candidate requests account deletion; privacy admin processes it', async () => {
    const r = (await as(cand, 'select public.request_account_deletion() id'))[0].id;
    await as(admin, 'select public.admin_process_deletion($1,$2)', [r, 'Identity confirmed by email reply']);
    assert.equal((await api.q('select status from public.profiles where id=$1', [cand.id])).rows[0].status, 'deleted');
  });
  await t.test('19. unauthorised cross-user and cross-company access attempts fail', async () => {
    const other = await api.signUp('candidate', 'Snoop'); const rival = await api.signUp('employer', 'Rival');
    await as(rival, `select public.create_employer_company('Rival Pvt Ltd','Rival')`);
    assert.equal((await as(other, 'select * from public.applications where id=$1', [appId])).length, 0);
    assert.equal((await as(other, 'select * from public.interviews')).length, 0);
    assert.match(await failure(as(rival, 'select * from public.list_job_applicants($1)', [jobId])) ?? '', /not found/i);
    assert.match(await failure(as(rival, 'select * from public.get_applicant_contact($1)', [appId])) ?? '', /not found/i);
    assert.match(await failure(as(other, `select public.admin_review_job($1,'pause','x x x x x')`, [jobId])) ?? '', /Not authorised/);
    assert.match(await failure(as(cand, 'select * from public.job_feed()')) ?? '', /not active/, 'deleted account is locked out');
  });
});
