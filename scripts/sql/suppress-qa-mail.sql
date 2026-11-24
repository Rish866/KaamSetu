-- Marks pending mail to QA test identities as suppressed, so it is never sent. QA accounts use
-- qa+...@getkaamsetu.in (no such mailboxes) or +91 1000xxxxxx (unallocated numbers). Sending to them would
-- hard-bounce and damage the sender reputation of send.getkaamsetu.in. Prints the number of rows changed.
with qa as (
  select o.id from private.email_outbox o left join public.profiles p on p.id = o.recipient_id
   where o.status = 'pending'
     and (coalesce(o.address, p.email) like 'qa+%@getkaamsetu.in' or ltrim(coalesce(p.phone, ''), '+') like '911000%')
)
update private.email_outbox o set status = 'suppressed', last_error = 'qa_test_identity'
  from qa where o.id = qa.id;
