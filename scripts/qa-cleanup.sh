#!/usr/bin/env bash
# Removes QA test data from a KaamSetu database through the product's own audited functions, exactly as the admin
# console and the users themselves would (no direct table edits). Used by the "Live journey" workflow after every run,
# so a failed journey can never leave a QA job published or QA accounts active.
#   DB_URL=... ADMIN_ID=<uuid of an administrator> scripts/qa-cleanup.sh
# QA data is recognised only by its fixed markers: profile email qa+...@getkaamsetu.in or phone +91 1000xxxxxx (unallocated);
# companies named "QA Test Co ..." or owned by such an account.
# The administrator running the clean-up is never touched. Prints ids and counts only.
set -euo pipefail
: "${DB_URL:?}" "${ADMIN_ID:?}"
q() { psql "$DB_URL" -At -v ON_ERROR_STOP=1 -c "$1"; }
# Run one product function as a given user (authenticated role + JWT subject), in its own session.
as() { psql "$DB_URL" -At -v ON_ERROR_STOP=1 -q -c "select set_config('request.jwt.claim.sub', '$1', false), set_config('request.jwt.claims', json_build_object('sub', '$1', 'role', 'authenticated')::text, false)" -c "set role authenticated" -c "$2" | tail -1; }
why="Automated QA clean-up after live journey run ${GITHUB_RUN_ID:-manual}"
qa_users="select p.id from public.profiles p where (p.email like 'qa+%@getkaamsetu.in' or ltrim(p.phone, '+') like '911000%') and p.status <> 'deleted' and p.id <> '$ADMIN_ID'"
qa_companies="select c.id from public.companies c where c.display_name like 'QA Test Co %' or c.legal_name like 'QA Test Co %' or exists (select 1 from public.company_members m join public.profiles p on p.id = m.user_id where m.company_id = c.id and m.role = 'owner' and (p.email like 'qa+%@getkaamsetu.in' or ltrim(p.phone, '+') like '911000%'))"

b_users=$(q "select count(*) from ($qa_users) x")
b_cos=$(q "select count(*) from public.companies where id in ($qa_companies) and verification_status in ('approved','pending')")
b_jobs=$(q "select count(*) from public.jobs where company_id in ($qa_companies) and status in ('published','paused','pending_review')")
echo "before: users $b_users, active companies $b_cos, open jobs $b_jobs"

for j in $(q "select id from public.jobs where company_id in ($qa_companies) and status in ('published','paused','pending_review')"); do
  as "$ADMIN_ID" "select public.admin_review_job('$j', 'remove', '$why')" >/dev/null && echo "job $j removed"
done
for c in $(q "select id from public.companies where id in ($qa_companies) and verification_status in ('approved','pending')"); do
  st=$(q "select verification_status from public.companies where id = '$c'")
  d=$([ "$st" = approved ] && echo suspend || echo reject)
  as "$ADMIN_ID" "select public.admin_review_company('$c', '$d', '$why')" >/dev/null && echo "company $c: $d"
done
for u in $(q "$qa_users"); do
  rid=$(as "$u" "select public.request_account_deletion()")
  as "$ADMIN_ID" "select public.admin_process_deletion('$rid', '$why')" >/dev/null && echo "user $u: deletion processed"
done

left_users=$(q "select count(*) from ($qa_users) x")
left_jobs=$(q "select count(*) from public.jobs where company_id in ($qa_companies) and status in ('published','paused','pending_review')")
left_cos=$(q "select count(*) from public.companies where id in ($qa_companies) and verification_status in ('approved','pending')")
echo "after: users $left_users, active companies $left_cos, open jobs $left_jobs"
[ "$left_users$left_jobs$left_cos" = 000 ] || { echo "::error::QA data left behind"; exit 1; }
echo "Auth identities of deleted QA users are soft-deleted by the privacy worker (Background workers, every 15 min)."
