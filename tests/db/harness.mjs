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
create table auth.users (
  id uuid primary key default gen_random_uuid(), email text, phone text, encrypted_password text,
  raw_user_meta_data jsonb not null default '{}', email_confirmed_at timestamptz, phone_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text,
  owner_id text, metadata jsonb, unique (bucket_id, name));
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema auth, storage to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
-- Mimic Supabase defaults: new public tables/functions are open to API roles.
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated;
`;

export async function createDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  await db.exec('create extension if not exists pgcrypto;');
  const dir = join(root, 'supabase', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await db.exec(readFileSync(join(dir, file), 'utf8'));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${error.message}`);
    }
  }
  await db.exec(readFileSync(join(root, 'supabase', 'seed.sql'), 'utf8'));
  return new Api(db);
}

export class Api {
  constructor(db) { this.db = db; this.n = 0; }

  /** Create an auth user (the signup trigger builds profile + candidate row). */
  async signUp(kind, name, extra = {}) {
    const i = ++this.n;
    const email = extra.email ?? `${name.toLowerCase().replace(/\W+/g, '')}${i}@example.test`;
    const phone = extra.phone ?? `+9198${String(10000000 + i)}`;
    const { rows } = await this.db.query(
      `insert into auth.users (email, phone, raw_user_meta_data, email_confirmed_at)
       values ($1, $2, $3::jsonb, now()) returning id`,
      [email, phone, JSON.stringify({ display_name: name, account_kind: kind, accepted_notice_version: '2026-11-18' })]);
    return { id: rows[0].id, email, phone, name };
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
