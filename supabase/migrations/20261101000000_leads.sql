-- Website Assistant: appointment requests and lead capture
--
-- leads                  Appointment and callback requests from website visitors.
-- notification_settings  Where each client receives lead alerts.
-- lead_notifications     Every alert for a lead, per channel and recipient,
--                        with its delivery result. New channels (such as
--                        WhatsApp) add rows here without changing leads.
-- widget_settings        Quick replies become {"text", "action"} objects, so a
--                        quick reply can open the appointment form.
--
-- Safe to run in the Supabase SQL Editor or with `supabase db push`.

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null,
  -- International format, for example +919845012345.
  mobile text not null,
  preferred_date date not null,
  preferred_time text not null,
  concern text,
  status text not null default 'new',
  notes text,
  -- The widget session the request came from; its messages are in conversations.
  conversation_id uuid,
  source_url text,
  -- Set when the client first opens the lead; unseen leads show a "New" badge.
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint leads_name_length check (char_length(btrim(name)) between 2 and 80),
  constraint leads_mobile_format check (mobile ~ '^\+[1-9][0-9]{7,14}$'),
  constraint leads_preferred_time_valid check (preferred_time in ('morning', 'afternoon', 'evening')),
  constraint leads_concern_length check (concern is null or char_length(concern) <= 500),
  constraint leads_status_valid check (status in ('new', 'contacted', 'booked', 'not_interested')),
  constraint leads_notes_length check (notes is null or char_length(notes) <= 5000),
  constraint leads_source_url_format check (
    source_url is null or (char_length(source_url) <= 2000 and source_url ~ '^https?://')
  )
);

comment on table public.leads is 'Appointment and callback requests from website visitors.';

create index if not exists leads_client_created_idx on public.leads (client_id, created_at desc);
create index if not exists leads_client_mobile_idx on public.leads (client_id, mobile, created_at desc);

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- Leads are created only by the server (see submit_lead). Clients can follow
-- them up: change the status, write notes and mark them as seen.
revoke all on table public.leads from anon, authenticated;
grant select on table public.leads to authenticated;
grant update (status, notes, seen_at) on table public.leads to authenticated;

alter table public.leads enable row level security;

drop policy if exists "Clients can view their own leads" on public.leads;
create policy "Clients can view their own leads"
  on public.leads for select
  to authenticated
  using (client_id in (select id from public.clients where user_id = (select auth.uid())));

drop policy if exists "Clients can update their own leads" on public.leads;
create policy "Clients can update their own leads"
  on public.leads for update
  to authenticated
  using (client_id in (select id from public.clients where user_id = (select auth.uid())))
  with check (client_id in (select id from public.clients where user_id = (select auth.uid())));

-- Saves a lead unless the same number already sent one to this client in the
-- last 10 minutes; returns the new lead's ID, or null for a duplicate. The
-- lock makes two quick submissions of the same number wait for each other,
-- so they cannot both pass the check.
create or replace function public.submit_lead(
  p_client_id uuid,
  p_name text,
  p_mobile text,
  p_preferred_date date,
  p_preferred_time text,
  p_concern text,
  p_conversation_id uuid,
  p_source_url text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_client_id::text || ':' || p_mobile, 0));

  if exists (
    select 1 from public.leads
    where client_id = p_client_id and mobile = p_mobile and created_at > now() - interval '10 minutes'
  ) then
    return null;
  end if;

  insert into public.leads (client_id, name, mobile, preferred_date, preferred_time, concern, conversation_id, source_url)
  values (p_client_id, btrim(p_name), p_mobile, p_preferred_date, p_preferred_time, nullif(btrim(p_concern), ''),
          p_conversation_id, p_source_url)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.submit_lead(uuid, text, text, date, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.submit_lead(uuid, text, text, date, text, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Notification settings
-- ---------------------------------------------------------------------------

create or replace function public.valid_alert_emails(p_emails text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cardinality(p_emails), 0) <= 5
    and not exists (
      select 1 from unnest(p_emails) as email
      where char_length(email) > 254 or email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    );
$$;

create table if not exists public.notification_settings (
  client_id uuid primary key references public.clients (id) on delete cascade,
  -- Empty: alerts go to the email address of the client's account.
  lead_alert_emails text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint notification_settings_lead_alert_emails_valid check (public.valid_alert_emails(lead_alert_emails))
);

comment on table public.notification_settings is 'Where each client receives lead alerts.';

drop trigger if exists notification_settings_set_updated_at on public.notification_settings;
create trigger notification_settings_set_updated_at
  before update on public.notification_settings
  for each row execute function public.set_updated_at();

revoke all on table public.notification_settings from anon, authenticated;
grant select on table public.notification_settings to authenticated;
grant update (lead_alert_emails) on table public.notification_settings to authenticated;

alter table public.notification_settings enable row level security;

drop policy if exists "Clients can view their own notification settings" on public.notification_settings;
create policy "Clients can view their own notification settings"
  on public.notification_settings for select
  to authenticated
  using (client_id in (select id from public.clients where user_id = (select auth.uid())));

drop policy if exists "Clients can update their own notification settings" on public.notification_settings;
create policy "Clients can update their own notification settings"
  on public.notification_settings for update
  to authenticated
  using (client_id in (select id from public.clients where user_id = (select auth.uid())))
  with check (client_id in (select id from public.clients where user_id = (select auth.uid())));

create or replace function public.set_up_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notification_settings (client_id) values (new.id) on conflict (client_id) do nothing;
  return new;
end;
$$;

revoke all on function public.set_up_notifications() from public, anon, authenticated;

drop trigger if exists clients_set_up_notifications on public.clients;
create trigger clients_set_up_notifications
  after insert on public.clients
  for each row execute function public.set_up_notifications();

insert into public.notification_settings (client_id)
select id from public.clients
on conflict (client_id) do nothing;

-- ---------------------------------------------------------------------------
-- Lead notifications (written by the server)
-- ---------------------------------------------------------------------------

create table if not exists public.lead_notifications (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  channel text not null,
  recipient text not null,
  status text not null,
  -- The provider's message ID, for tracing a delivery.
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),

  constraint lead_notifications_channel_valid check (channel in ('email', 'whatsapp')),
  constraint lead_notifications_status_valid check (status in ('sent', 'failed', 'skipped')),
  constraint lead_notifications_error_length check (error is null or char_length(error) <= 500)
);

comment on table public.lead_notifications is 'Alerts sent for each lead, per channel and recipient.';

create index if not exists lead_notifications_lead_idx on public.lead_notifications (lead_id);

revoke all on table public.lead_notifications from anon, authenticated;
grant select (lead_id, channel, recipient, status, error, created_at) on table public.lead_notifications to authenticated;

alter table public.lead_notifications enable row level security;

drop policy if exists "Clients can view their own lead notifications" on public.lead_notifications;
create policy "Clients can view their own lead notifications"
  on public.lead_notifications for select
  to authenticated
  using (client_id in (select id from public.clients where user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Quick replies: {"text": "...", "action": "message" | "appointment_form"}
-- ---------------------------------------------------------------------------

alter table public.widget_settings drop constraint if exists widget_settings_quick_replies_valid;

-- Earlier quick replies were plain strings; "Book an appointment" now opens the form.
update public.widget_settings
set quick_replies = (
  select coalesce(
    jsonb_agg(
      case
        when jsonb_typeof(reply) = 'string' then jsonb_build_object(
          'text', reply #>> '{}',
          'action', case when lower(reply #>> '{}') = 'book an appointment' then 'appointment_form' else 'message' end
        )
        else reply
      end
      order by position
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(quick_replies) with ordinality as item (reply, position)
)
where exists (select 1 from jsonb_array_elements(quick_replies) as reply where jsonb_typeof(reply) = 'string');

-- Up to 6 quick replies, each {"text": 1 to 40 characters, "action": "message" or "appointment_form"}.
create or replace function public.valid_quick_replies(p_replies jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_replies) = 'array'
    and jsonb_array_length(p_replies) <= 6
    and not exists (
      select 1 from jsonb_array_elements(p_replies) as reply
      where jsonb_typeof(reply) <> 'object'
        or jsonb_typeof(reply -> 'text') is distinct from 'string'
        or char_length(btrim(reply ->> 'text')) not between 1 and 40
        or coalesce(reply ->> 'action', '') not in ('message', 'appointment_form')
        or (select count(*) from jsonb_object_keys(reply)) <> 2
    );
$$;

create or replace function public.default_quick_replies(p_industry text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case p_industry
    when 'dentist' then '[
      {"text": "Book an appointment", "action": "appointment_form"},
      {"text": "Clinic timings", "action": "message"},
      {"text": "Treatments we offer", "action": "message"},
      {"text": "Contact the clinic", "action": "message"}
    ]'::jsonb
    when 'pharmacy' then '[
      {"text": "Opening hours", "action": "message"},
      {"text": "Check medicine availability", "action": "message"},
      {"text": "Home delivery", "action": "message"},
      {"text": "Request a callback", "action": "appointment_form"}
    ]'::jsonb
    else '[
      {"text": "Opening hours", "action": "message"},
      {"text": "Services we offer", "action": "message"},
      {"text": "Request a callback", "action": "appointment_form"}
    ]'::jsonb
  end;
$$;

alter table public.widget_settings
  add constraint widget_settings_quick_replies_valid check (public.valid_quick_replies(quick_replies));
