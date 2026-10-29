-- Website Assistant: industry knowledge packs and conversations
--
-- industry_packs holds the shared knowledge and behavior rules for each
-- industry. New industries or new versions are added as rows, without code
-- changes; the chat engine uses the highest published version.
--
-- conversations stores every exchange between a visitor and a client's
-- assistant. Rows are written by the server only; each client can read its
-- own conversations.
--
-- Safe to run in the Supabase SQL Editor or with `supabase db push`.

-- ---------------------------------------------------------------------------
-- Industry knowledge packs
-- ---------------------------------------------------------------------------

create table if not exists public.industry_packs (
  id uuid primary key default gen_random_uuid(),
  industry text not null,
  version integer not null,
  knowledge text not null,
  behavior_rules text not null,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint industry_packs_industry_format check (industry ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint industry_packs_version_positive check (version > 0),
  constraint industry_packs_knowledge_present check (char_length(btrim(knowledge)) > 0),
  constraint industry_packs_rules_present check (char_length(btrim(behavior_rules)) > 0),
  constraint industry_packs_industry_version_unique unique (industry, version)
);

comment on table public.industry_packs is
  'Shared knowledge and behavior rules per industry. The engine uses the highest published version.';

drop trigger if exists industry_packs_set_updated_at on public.industry_packs;
create trigger industry_packs_set_updated_at
  before update on public.industry_packs
  for each row execute function public.set_updated_at();

-- Packs are read by the server only. Clients and visitors have no direct
-- access, so behavior rules cannot be read or changed through the API.
revoke all on table public.industry_packs from anon, authenticated;
alter table public.industry_packs enable row level security;

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  session_id uuid not null,
  visitor_message text not null,
  assistant_reply text not null,
  created_at timestamptz not null default now(),

  constraint conversations_visitor_message_length
    check (char_length(visitor_message) between 1 and 4000)
);

comment on table public.conversations is
  'One row per visitor message and assistant reply, grouped by chat session.';

create index if not exists conversations_client_session_idx
  on public.conversations (client_id, session_id, created_at);

-- Written by the server only (it bypasses RLS with the secret key). Signed-in
-- clients may read, but never write, their own conversations.
revoke all on table public.conversations from anon, authenticated;
grant select on table public.conversations to authenticated;

alter table public.conversations enable row level security;

drop policy if exists "Clients can view their own conversations" on public.conversations;
create policy "Clients can view their own conversations"
  on public.conversations for select
  to authenticated
  using (
    client_id in (select id from public.clients where user_id = (select auth.uid()))
  );
