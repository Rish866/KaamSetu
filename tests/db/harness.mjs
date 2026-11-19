// Test harness: boots an in-process PostgreSQL (PGlite), emulates the Supabase
// pieces KaamSetu depends on (roles, auth.uid(), storage), then applies every
// real migration in order. Nothing here touches production.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SUPABASE_STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
-- Mirrors the GoTrue constraints that matter for KaamSetu: one account per email and per phone.
create table auth.users (
  id uuid primary key default gen_random_uuid(), email text, phone text, encrypted_password text,
  raw_user_meta_data jsonb not null default '{}', email_confirmed_at timestamptz, phone_confirmed_at timestamptz,
  banned_until timestamptz, is_sso_user boolean not null default false);
create unique index users_email_partial_key on auth.users (email) where is_sso_user = false;
create unique index users_phone_key on auth.users (phone);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text,
  owner_id text, metadata jsonb, unique (bucket_id, name));
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
grant select, insert, update, delete on storage.objects to service_role;
-- Mimic Supabase defaults: new public tables/functions are open to all API roles, including service_role.
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
`;

/** Applies migrations whose file name sorts at or before `until` (all when omitted). */
export async function createDb({ until, seed = true } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  await db.exec('create extension if not exists pgcrypto;');
  const api = new Api(db);
  await api.applyMigrations({ until });
  if (seed) await db.exec(readFileSync(join(root, 'supabase', 'seed.sql'), 'utf8'));
  return api;
}

export function migrationFiles() {
  return readdirSync(join(root, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
}

export class Api {
  constructor(db) { this.db = db; this.n = 0; this.applied = []; }

  /** Applies not-yet-applied migrations in order, optionally stopping at `until` (inclusive prefix match). */
  async applyMigrations({ until } = {}) {
    for (const file of migrationFiles()) {
      if (this.applied.includes(file)) continue;
      if (until && file.slice(0, until.length) > until) break;
      try { await this.db.exec(readFileSync(join(root, 'supabase', 'migrations', file), 'utf8')); }
      catch (error) { throw new Error(`Migration ${file} failed: ${error.message}`); }
      this.applied.push(file);
    }
  }

  /** Create an auth user (the signup trigger builds profile + candidate row). */
  async signUp(kind, name, extra = {}) {
    const i = ++this.n;
    const email = extra.email ?? `${name.toLowerCase().replace(/\W+/g, '')}${i}@example.test`;
    const phone = extra.phone ?? `+9198${String(10000000 + i)}`;
    const confirmed = extra.confirmed ?? true;
    const { rows } = await this.db.query(
      `insert into auth.users (email, phone, raw_user_meta_data, email_confirmed_at)
       values ($1, $2, $3::jsonb, case when $4 then now() end) returning id`,
      [email, phone, JSON.stringify({ display_name: name, account_kind: kind, accepted_notice_version: '2026-11-20' }), confirmed]);
    return { id: rows[0].id, email, phone, name };
  }

  /** Run fn(sql) as the Supabase service_role (server-side workers), with no user identity. */
  async asService(fn) {
    await this.db.exec(`select set_config('request.jwt.claim.sub', '', false); set role service_role;`);
    try { return await fn((sql, params) => this.db.query(sql, params)); }
    finally { await this.db.exec('reset role;'); }
  }

  /** Run fn(sql) as a role/user inside one transaction-less session scope. */
  async as(user, fn) {
    const role = user === null ? 'anon' : 'authenticated';
    await this.db.exec(`select set_config('request.jwt.claim.sub', '${user ? user.id : ''}', false); set role ${role};`);
    try { return await fn((sql, params) => this.db.query(sql, params)); }
    finally { await this.db.exec('reset role; select set_config(\'request.jwt.claim.sub\', \'\', false);'); }
  }

  /** Superuser query for fixtures and assertions about stored state. */
  q(sql, params) { return this.db.query(sql, params); }

  async grantAdmin(user, role = 'admin') {
    await this.q('insert into private.app_roles (user_id, role) values ($1, $2) on conflict do nothing', [user.id, role]);
  }
}

/** Resolves to the error message, or null when the call succeeded. */
export async function failure(promise) {
  try { await promise; return null; } catch (e) { return e.message; }
}
