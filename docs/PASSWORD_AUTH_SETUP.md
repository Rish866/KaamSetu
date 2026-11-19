# Password authentication production setup

The application supports candidate and employer sign-up with either a unique email address or a unique Indian mobile number plus a password. Administrator accounts are login-only and must be granted by the platform owner.

## Apply the database migration

Apply `supabase/migrations/202611190001_password_auth.sql` after the three existing production migrations. It adds immutable account type and identity fields, unique email and phone indexes, consent logging, the `current_user_access` RPC, and employer-role enforcement.

## Supabase Auth settings

In Supabase Dashboard open Authentication, Providers:

1. Enable Email and Password.
2. Enable Phone and Password only if mobile-number accounts will be offered.
3. To launch without OTP, turn off Confirm Email and Confirm Phone. This permits immediate password sign-in but means contact ownership is not verified.
4. Keep anonymous sign-in disabled.
5. Keep manual identity linking disabled until a reviewed account-linking flow exists.
6. Set the minimum password length to at least 8 and enable leaked-password protection if the project plan supports it.
7. Configure attack protection and review Auth audit logs for repeated signup and login attempts.

For stronger production identity assurance, prefer email confirmation and restore a DLT-compliant SMS provider for phone confirmation and recovery.

## URL configuration

Set the Auth Site URL to `https://www.getkaamsetu.in` and add these allowed redirect URLs:

- `https://www.getkaamsetu.in/reset-password`
- `https://getkaamsetu.in/reset-password`
- the development URL used for local testing

Email users can request a password reset from the sign-in screen. Phone-only users cannot safely recover a forgotten password while SMS is disabled; support should encourage an email-based account until compliant SMS recovery is available.

## Create the first administrator

Do not expose administrator sign-up. First create a normal account through the application or Supabase Dashboard, then grant the role in the SQL Editor after verifying the user id:

```sql
insert into private.app_roles (user_id, role, granted_by)
values ('ADMIN_USER_UUID', 'admin', 'OWNER_USER_UUID')
on conflict (user_id, role) do nothing;
```

If this is the first administrator and no separate owner profile exists, set `granted_by` to null. Recheck `/admin` after signing out and back in.

## Required acceptance tests

- A candidate can register with email and password and reach only `/candidate`.
- An employer can register with email and password and reach only `/employer` and `/post-job`.
- A phone/password account can register only when Phone provider is enabled and phone confirmation is disabled.
- Re-registering the same normalized email or phone does not create a second user.
- A wrong password cannot sign in.
- Candidate and employer accounts cannot open `/admin`.
- A non-admin selecting Admin is signed out with an access error.
- An owner-granted admin can open `/admin`.
- Suspended accounts cannot enter any protected portal.
- Email password reset works only through an allow-listed redirect URL.
- Signing out removes the session and returns to `/login`.
