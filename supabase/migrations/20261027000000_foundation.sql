-- Website Assistant: foundation schema
--
-- Creates the multi-tenant "clients" table, locks it down with Row Level
-- Security, enables pgvector for the upcoming document embeddings, and prepares
-- a private storage bucket where each client can only reach its own folder.
--
-- Safe to run in the Supabase SQL Editor or with `supabase db push`.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Clients (one row per business / tenant)
-- ---------------------------------------------------------------------------

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  -- The account that owns this business. Always set from the session, never
  -- from user input (see column grants below).
  user_id uuid not null unique default auth.uid()
    references auth.users (id) on delete cascade,
  business_name text not null,
  industry text not null,
  website_domain text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint clients_business_name_length
    check (char_length(btrim(business_name)) between 2 and 120),
  constraint clients_industry_valid
    check (industry in ('dentist', 'pharmacy', 'other')),
  constraint clients_website_domain_format
    check (
      char_length(website_domain) <= 253
      and website_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$'
    )
);

comment on table public.clients is 'Businesses using Website Assistant. One row per tenant.';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges
--
-- Supabase grants every privilege on new tables to the API roles by default.
-- Narrow that down: anonymous visitors get nothing, and signed-in clients may
-- only write the business fields. user_id, id and the timestamps are always
-- set by the database.
-- ---------------------------------------------------------------------------

revoke all on table public.clients from anon, authenticated;
grant select on table public.clients to authenticated;
grant insert (business_name, industry, website_domain) on table public.clients to authenticated;
grant update (business_name, industry, website_domain) on table public.clients to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.clients enable row level security;

drop policy if exists "Clients can view their own business" on public.clients;
create policy "Clients can view their own business"
  on public.clients for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Clients can create their own business" on public.clients;
create policy "Clients can create their own business"
  on public.clients for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Clients can update their own business" on public.clients;
create policy "Clients can update their own business"
  on public.clients for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- No delete policy: a business is removed only when its account is deleted
-- (cascade from auth.users).

-- ---------------------------------------------------------------------------
-- File storage
--
-- Private bucket for the documents each client will upload. Objects must live
-- under a folder named after the client's id, e.g. "<client id>/handbook.pdf",
-- and a client can only read or write inside its own folder.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists "Clients can view their own documents" on storage.objects;
create policy "Clients can view their own documents"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (
      select id::text from public.clients where user_id = (select auth.uid())
    )
  );

drop policy if exists "Clients can upload their own documents" on storage.objects;
create policy "Clients can upload their own documents"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (
      select id::text from public.clients where user_id = (select auth.uid())
    )
  );

drop policy if exists "Clients can update their own documents" on storage.objects;
create policy "Clients can update their own documents"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (
      select id::text from public.clients where user_id = (select auth.uid())
    )
  )
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (
      select id::text from public.clients where user_id = (select auth.uid())
    )
  );

drop policy if exists "Clients can delete their own documents" on storage.objects;
create policy "Clients can delete their own documents"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (
      select id::text from public.clients where user_id = (select auth.uid())
    )
  );
