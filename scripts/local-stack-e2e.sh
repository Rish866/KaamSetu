#!/usr/bin/env bash
# Runs the live UI specs (e2e/live) against a LOCAL Supabase stack (GoTrue, PostgREST, Storage, Mailpit) and a local
# production build of the website. Nothing here touches production. Used by CI job `e2e-local-stack`.
set -euo pipefail
# Local-only auth settings (never committed): redirect to the local site and relax rate limits for the test run.
sed -i -e 's|^site_url = .*|site_url = "http://localhost:4173"|' \
       -e 's|^additional_redirect_urls = \[|additional_redirect_urls = [\n  "http://localhost:4173/reset-password",|' \
       -e 's|^sign_in_sign_ups = .*|sign_in_sign_ups = 1000|' -e 's|^email_sent = .*|email_sent = 1000|' supabase/config.toml
# Local Auth refuses phone sign-ups without an SMS provider even when confirmations are off. A dummy provider is set
# (no SMS is ever sent because confirmations are off). Production behaviour must be verified separately.
printf '\n[auth.sms.twilio]\nenabled = true\naccount_sid = "ACtest"\nmessage_service_sid = "MGtest"\nauth_token = "local-test-only"\n' >> supabase/config.toml
supabase start -x realtime,imgproxy,postgres-meta,studio,logflare,vector,supavisor
supabase status -o env | grep -E '^[A-Z_]+=' > .cache-local-stack.env
set -a; . ./.cache-local-stack.env; set +a
export LIVE_SUPABASE_URL="$API_URL" LIVE_SUPABASE_ANON_KEY="${PUBLISHABLE_KEY:-$ANON_KEY}" LIVE_DB_URL="$DB_URL"
export LIVE_MAILPIT_URL="${MAILPIT_URL:-${INBUCKET_URL:-}}" LIVE_QA_EMAIL_DOMAIN=example.com LIVE_BASE_URL=http://localhost:4173
export LIVE_ADMIN_EMAIL=qa-admin@example.com
LIVE_ADMIN_PASSWORD="Qa-$(openssl rand -hex 12)-A1"; export LIVE_ADMIN_PASSWORD; echo "::add-mask::$LIVE_ADMIN_PASSWORD"
# Test administrator: created through the Auth admin API, role granted the way the owner would (never via sign-up).
uid=$(curl -sSf -X POST "$API_URL/auth/v1/admin/users" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$LIVE_ADMIN_EMAIL\",\"password\":\"$LIVE_ADMIN_PASSWORD\",\"email_confirm\":true,\"user_metadata\":{\"display_name\":\"QA Admin\",\"account_kind\":\"candidate\"}}" | jq -r .id)
# Diagnostic only: what the local Auth server says about a phone sign-up (no secrets printed).
curl -s -X POST "$API_URL/auth/v1/signup" -H "apikey: $LIVE_SUPABASE_ANON_KEY" -H 'Content-Type: application/json' -d '{"phone":"+919000000001","password":"Diagnostic-Pass-1"}' | jq -c '{code, error_code, msg, user: (.user.id != null)}' || true
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "update private.settings set value = 'true'::jsonb where key = 'resume_uploads_enabled'"
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "insert into private.app_roles (user_id, role) values ('$uid', 'admin')"
EXPO_PUBLIC_SUPABASE_URL="$API_URL" EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$LIVE_SUPABASE_ANON_KEY" npm run build:web
npx expo serve --port 4173 > .cache-expo-serve.log 2>&1 &
for i in $(seq 1 60); do curl -sf http://localhost:4173 >/dev/null && break; sleep 1; done
status=0
npx playwright test --config e2e/live/playwright.live.config.ts || status=1
# Background workers (resume scanning with real ClamAV, parsing, privacy clean-up, email) against the same local stack.
SERVICE_ROLE_KEY="${SECRET_KEY:-$SERVICE_ROLE_KEY}" node --test --test-reporter=spec tests/workers/workers.test.mjs || status=1
# Demo story (local only: the seeder refuses non-localhost URLs) and a screenshot walkthrough, uploaded as an artifact.
DEMO_DB_URL="$DB_URL" DEMO_API_URL="$API_URL" DEMO_SERVICE_KEY="${SECRET_KEY:-$SERVICE_ROLE_KEY}" node scripts/demo/seed-demo.mjs || status=1
npx playwright test --config e2e/demo/playwright.demo.config.ts || status=1
exit $status
