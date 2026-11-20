// Test harness. Two modes:
//  * default: in-process PostgreSQL (PGlite) with an EMULATION of the Supabase pieces KaamSetu depends on
//    (roles, auth.uid(), auth.users uniqueness, storage tables), then every real migration in order.
//  * KAAMSETU_PG_URL set: a REAL local Supabase Postgres (`supabase db start` / `db reset`), whose migrations and
//    seed were already applied by the Supabase CLI. Same tests, real Supabase auth/storage schemas and roles.
// Nothing here touches production.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

pg.types.setTypeParser(20, (v) => Number(v)); // int8 -> number, as PGlite does
export const REAL = Boolean(process.env.KAAMSETU_PG_URL);
// Identities must be unique across every Api instance (and, on a shared real database, across test processes).
let identitySeq = REAL ? Math.floor(Math.random() * 80_000_000) : 0;

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
-- Production carries a Supabase-managed event-trigger function in public owned by postgres (Actions run 44807025417).
create function public.rls_auto_enable() returns event_trigger language plpgsql as $$ begin end $$;
-- Mimic Supabase defaults: new public tables/functions are open to all API roles, including service_role.
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
`;

/** Applies migrations whose file name sorts at or before `until` (all when omitted). */
export async function createDb({ until, seed = true, resumeUploads = true } = {}) {
  if (REAL) {
    if (until) throw new Error('createDb({ until }) is PGlite-only; the real-Supabase upgrade path is rehearsed by CI (supabase-db job)');
    const pool = new pg.Pool({ connectionString: process.env.KAAMSETU_PG_URL, max: 8, allowExitOnIdle: true });
    const api = new Api(new RealDb(pool));
    api.applied = migrationFiles();
    if (seed) await api.db.exec(readFileSync(join(root, 'supabase', 'seed.sql'), 'utf8'));
    await api.setResumeUploads(resumeUploads);
    return api;
  }
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  await db.exec('create extension if not exists pgcrypto;');
  const api = new Api(db);
  await api.applyMigrations({ until });
  if (seed) await db.exec(readFileSync(join(root, 'supabase', 'seed.sql'), 'utf8'));
  if (!until) await api.setResumeUploads(resumeUploads);
  return api;
}

export function migrationFiles() {
  return readdirSync(join(root, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
}

/** pg adapter with PGlite's result shape ({ rows, affectedRows }). Each role-scoped call gets its own pooled connection. */
class RealDb {
  constructor(pool) { this.pool = pool; this.real = true; }
  shape(r) { const last = Array.isArray(r) ? r.at(-1) : r; return { rows: last.rows, affectedRows: last.rowCount ?? 0 }; }
  async query(sql, params) { return this.shape(await this.pool.query(sql, params)); }
  async exec(sql) { return this.shape(await this.pool.query(sql)); }
  async scoped(prelude, fn) {
    const c = await this.pool.connect();
    try {
      await c.query(prelude);
      return await fn(async (sql, params) => this.shape(await c.query(sql, params)));
    } finally {
      await c.query(`reset role; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false);`).catch(() => undefined);
      c.release();
    }
  }
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
    const i = ++identitySeq; this.n += 1;
    const email = extra.email ?? `${name.toLowerCase().replace(/\W+/g, '')}${i}@example.test`;
    const phone = extra.phone ?? `+9198${String(10000000 + i)}`;
    const confirmed = extra.confirmed ?? true;
    const { rows } = await this.db.query(
      `insert into auth.users (id, email, phone, raw_user_meta_data, email_confirmed_at)
       values (gen_random_uuid(), $1, $2, $3::jsonb, case when $4 then now() end) returning id`,
      [email, phone, JSON.stringify({ display_name: name, account_kind: kind, accepted_notice_version: '2026-11-20' }), confirmed]);
    return { id: rows[0].id, email, phone, name };
  }

  /** Run fn(sql) as the Supabase service_role (server-side workers), with no user identity. */
  async asService(fn) {
    if (this.db.real) return this.db.scoped(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '{"role":"service_role"}', false); set role service_role;`, fn);
    await this.db.exec(`select set_config('request.jwt.claim.sub', '', false); set role service_role;`);
    try { return await fn((sql, params) => this.db.query(sql, params)); }
    finally { await this.db.exec('reset role;'); }
  }

  /** Run fn(sql) as a role/user inside one transaction-less session scope. */
  async as(user, fn) {
    const role = user === null ? 'anon' : 'authenticated';
    if (this.db.real) {
      const claims = JSON.stringify(user ? { sub: user.id, role } : { role });
      return this.db.scoped(`select set_config('request.jwt.claim.sub', '${user ? user.id : ''}', false), set_config('request.jwt.claims', '${claims}', false); set role ${role};`, fn);
    }
    await this.db.exec(`select set_config('request.jwt.claim.sub', '${user ? user.id : ''}', false); set role ${role};`);
    try { return await fn((sql, params) => this.db.query(sql, params)); }
    finally { await this.db.exec('reset role; select set_config(\'request.jwt.claim.sub\', \'\', false);'); }
  }

  /** Superuser query for fixtures and assertions about stored state. */
  q(sql, params) { return this.db.query(sql, params); }

  /** Tests enable resume uploads by default (production starts with them OFF until a scanner is verified). */
  async setResumeUploads(on) {
    await this.q(`update private.settings set value = $1::jsonb where key = 'resume_uploads_enabled'`, [JSON.stringify(Boolean(on))]);
  }

  async grantAdmin(user, role = 'admin') {
    await this.q('insert into private.app_roles (user_id, role) values ($1, $2) on conflict do nothing', [user.id, role]);
  }
}

/** Resolves to the error message, or null when the call succeeded. */
export async function failure(promise) {
  try { await promise; return null; } catch (e) { return e.message; }
}
