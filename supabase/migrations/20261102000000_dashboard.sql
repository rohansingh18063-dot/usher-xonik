-- Website Assistant: client dashboard
--
-- conversations.page_url         The page a visitor was on when they sent a message.
-- widget_settings.installed_at   When the widget first loaded on one of the
--                                client's allowed websites (setup checklist).
-- knowledge_gaps                 Questions about the business the assistant could
--                                not answer from the client's data, grouped by topic.
-- knowledge_gap_questions        Each time a visitor asked one of them.
-- conversation_list()            Website conversations (one per chat session),
--                                with search and filters.
-- dashboard_daily()              Conversations, visitor messages and leads per day.
--
-- Both functions run with the caller's permissions, so Row Level Security
-- limits them to the signed-in client's own data.
--
-- Safe to run in the Supabase SQL Editor or with `supabase db push`.

-- ---------------------------------------------------------------------------
-- Where conversations happen, and whether the widget is installed
-- ---------------------------------------------------------------------------

alter table public.conversations add column if not exists page_url text;

alter table public.conversations drop constraint if exists conversations_page_url_format;
alter table public.conversations
  add constraint conversations_page_url_format
  check (page_url is null or (char_length(page_url) <= 2000 and page_url ~ '^https?://'));

alter table public.widget_settings
  add column if not exists installed_at timestamptz,
  add column if not exists installed_origin text;

alter table public.widget_settings drop constraint if exists widget_settings_installed_origin_length;
alter table public.widget_settings
  add constraint widget_settings_installed_origin_length
  check (installed_origin is null or char_length(installed_origin) <= 255);

-- ---------------------------------------------------------------------------
-- Knowledge gaps
-- ---------------------------------------------------------------------------

create table if not exists public.knowledge_gaps (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  category text not null,
  -- A short English name for what was missing, such as "Teeth whitening price".
  topic text not null,
  -- Embedding of the category and topic, used to group similar questions.
  embedding extensions.vector(1024),
  status text not null default 'open',
  question_count integer not null default 0,
  first_asked_at timestamptz not null default now(),
  last_asked_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),

  constraint knowledge_gaps_category_valid check (
    category in ('fees', 'timings', 'doctors', 'services', 'offers', 'contact', 'location', 'payments', 'other')
  ),
  constraint knowledge_gaps_topic_length check (char_length(btrim(topic)) between 1 and 80),
  constraint knowledge_gaps_status_valid check (status in ('open', 'resolved'))
);

comment on table public.knowledge_gaps is 'Business questions the assistant could not answer, grouped by topic.';

create index if not exists knowledge_gaps_client_idx on public.knowledge_gaps (client_id, status, last_asked_at desc);

create table if not exists public.knowledge_gap_questions (
  id uuid primary key default gen_random_uuid(),
  gap_id uuid not null references public.knowledge_gaps (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  question text not null,
  session_id uuid,
  created_at timestamptz not null default now(),

  constraint knowledge_gap_questions_length check (char_length(question) between 1 and 1000)
);

comment on table public.knowledge_gap_questions is 'Each visitor question that belongs to a knowledge gap.';

create index if not exists knowledge_gap_questions_gap_idx on public.knowledge_gap_questions (gap_id, created_at desc);

-- Gaps are recorded only by the server. Clients can read them and mark them
-- as resolved (or open again).
revoke all on table public.knowledge_gaps from anon, authenticated;
grant select (id, client_id, category, topic, status, question_count, first_asked_at, last_asked_at, resolved_at, created_at)
  on table public.knowledge_gaps to authenticated;
grant update (status, resolved_at) on table public.knowledge_gaps to authenticated;

revoke all on table public.knowledge_gap_questions from anon, authenticated;
grant select on table public.knowledge_gap_questions to authenticated;

alter table public.knowledge_gaps enable row level security;
alter table public.knowledge_gap_questions enable row level security;

drop policy if exists "Clients can view their own knowledge gaps" on public.knowledge_gaps;
create policy "Clients can view their own knowledge gaps"
  on public.knowledge_gaps for select
  to authenticated
  using (client_id in (select id from public.clients where user_id = (select auth.uid())));

drop policy if exists "Clients can resolve their own knowledge gaps" on public.knowledge_gaps;
create policy "Clients can resolve their own knowledge gaps"
  on public.knowledge_gaps for update
  to authenticated
  using (client_id in (select id from public.clients where user_id = (select auth.uid())))
  with check (client_id in (select id from public.clients where user_id = (select auth.uid())));

drop policy if exists "Clients can view their own knowledge gap questions" on public.knowledge_gap_questions;
create policy "Clients can view their own knowledge gap questions"
  on public.knowledge_gap_questions for select
  to authenticated
  using (client_id in (select id from public.clients where user_id = (select auth.uid())));

-- Adds a visitor question to the most similar gap of the same category (or
-- the same topic, when there is no embedding), or starts a new gap. A
-- resolved gap that is asked about again opens again: the assistant still
-- could not answer it. One client at a time, so two similar questions
-- arriving together cannot start two separate gaps.
create or replace function public.record_knowledge_gap(
  p_client_id uuid,
  p_category text,
  p_topic text,
  p_question text,
  p_session_id uuid,
  p_embedding extensions.vector(1024),
  p_min_similarity double precision default 0.85
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_gap uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('knowledge-gap:' || p_client_id::text, 0));

  if p_embedding is not null then
    select g.id into v_gap
    from public.knowledge_gaps g
    where g.client_id = p_client_id
      and g.category = p_category
      and g.embedding is not null
      and 1 - (g.embedding operator(extensions.<=>) p_embedding) >= p_min_similarity
    order by g.embedding operator(extensions.<=>) p_embedding
    limit 1;
  end if;

  if v_gap is null then
    select g.id into v_gap
    from public.knowledge_gaps g
    where g.client_id = p_client_id and g.category = p_category and lower(g.topic) = lower(btrim(p_topic))
    limit 1;
  end if;

  if v_gap is null then
    insert into public.knowledge_gaps (client_id, category, topic, embedding)
    values (p_client_id, p_category, btrim(p_topic), p_embedding)
    returning id into v_gap;
  end if;

  insert into public.knowledge_gap_questions (gap_id, client_id, question, session_id)
  values (v_gap, p_client_id, left(p_question, 1000), p_session_id);

  update public.knowledge_gaps
  set question_count = question_count + 1, last_asked_at = now(), status = 'open', resolved_at = null
  where id = v_gap;

  return v_gap;
end;
$$;

revoke all on function public.record_knowledge_gap(uuid, text, text, text, uuid, extensions.vector, double precision)
  from public, anon, authenticated;
grant execute on function public.record_knowledge_gap(uuid, text, text, text, uuid, extensions.vector, double precision)
  to service_role;

-- ---------------------------------------------------------------------------
-- Conversations list
-- ---------------------------------------------------------------------------

create or replace function public.conversation_list(
  p_query text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_has_lead boolean default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  session_id uuid,
  started_at timestamptz,
  last_message_at timestamptz,
  message_count integer,
  first_message text,
  page_url text,
  lead_id uuid,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with sessions as (
    select
      c.client_id,
      c.session_id,
      min(c.created_at) as started_at,
      max(c.created_at) as last_message_at,
      count(*)::integer as message_count,
      (array_agg(c.visitor_message order by c.created_at))[1] as first_message,
      (array_agg(c.page_url order by c.created_at) filter (where c.page_url is not null))[1] as page_url
    from public.conversations c
    where c.channel = 'website'
    group by c.client_id, c.session_id
  ),
  matched as (
    select
      s.*,
      (
        select l.id from public.leads l
        where l.client_id = s.client_id and l.conversation_id = s.session_id
        order by l.created_at
        limit 1
      ) as lead_id
    from sessions s
    where (p_from is null or s.started_at >= p_from)
      and (p_to is null or s.started_at < p_to)
      and (
        nullif(btrim(p_query), '') is null
        or exists (
          select 1 from public.conversations m
          where m.client_id = s.client_id
            and m.session_id = s.session_id
            and (
              m.visitor_message ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
              or m.assistant_reply ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
            )
        )
      )
  )
  select
    m.session_id, m.started_at, m.last_message_at, m.message_count, m.first_message, m.page_url, m.lead_id,
    count(*) over () as total_count
  from matched m
  where p_has_lead is null or (m.lead_id is not null) = p_has_lead
  order by m.started_at desc
  limit least(greatest(p_limit, 1), 5000)
  offset greatest(p_offset, 0);
$$;

revoke all on function public.conversation_list(text, timestamptz, timestamptz, boolean, integer, integer) from public, anon;
grant execute on function public.conversation_list(text, timestamptz, timestamptz, boolean, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Daily numbers for the overview
--
-- A conversation counts on the day it started; visitor messages and leads on
-- the day they arrived. Days are calendar days in the given time zone.
-- ---------------------------------------------------------------------------

create or replace function public.dashboard_daily(p_from date, p_to date, p_time_zone text)
returns table (day date, conversations integer, messages integer, leads integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as day
  ),
  started as (
    select (min(c.created_at) at time zone p_time_zone)::date as day
    from public.conversations c
    where c.channel = 'website'
    group by c.client_id, c.session_id
  ),
  conversation_days as (
    select s.day, count(*)::integer as total from started s group by s.day
  ),
  message_days as (
    select (c.created_at at time zone p_time_zone)::date as day, count(*)::integer as total
    from public.conversations c
    where c.channel = 'website' and c.created_at >= (p_from::timestamp at time zone p_time_zone)
    group by 1
  ),
  lead_days as (
    select (l.created_at at time zone p_time_zone)::date as day, count(*)::integer as total
    from public.leads l
    where l.created_at >= (p_from::timestamp at time zone p_time_zone)
    group by 1
  )
  select
    d.day,
    coalesce(cd.total, 0) as conversations,
    coalesce(md.total, 0) as messages,
    coalesce(ld.total, 0) as leads
  from days d
  left join conversation_days cd on cd.day = d.day
  left join message_days md on md.day = d.day
  left join lead_days ld on ld.day = d.day
  order by d.day;
$$;

revoke all on function public.dashboard_daily(date, date, text) from public, anon;
grant execute on function public.dashboard_daily(date, date, text) to authenticated;
