-- Minimal stand-in for the parts of a Supabase database that the migrations
-- rely on, so Row Level Security can be tested offline against real Postgres.
-- Mirrors Supabase's roles, default grants, auth.uid() and storage helpers.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create schema extensions;
create schema storage;

grant usage on schema public, auth, extensions, storage to anon, authenticated, service_role;

-- Supabase grants every privilege on new public tables to the API roles.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email text not null unique
);

create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid
$$;

create table storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets (id),
  name text not null,
  owner uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

create function storage.foldername(name text) returns text[]
language plpgsql
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;
