-- Website Assistant: website chat widget
--
-- widget_settings   How the chat widget looks on each client's website.
-- widget-logos      Public storage bucket for widget logos. Only the server
--                   writes to it; files have random names that reveal nothing.
--
-- Safe to run in the Supabase SQL Editor or with `supabase db push`.

-- ---------------------------------------------------------------------------
-- Defaults
-- ---------------------------------------------------------------------------

create or replace function public.default_quick_replies(p_industry text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case p_industry
    when 'dentist' then '["Book an appointment", "Clinic timings", "Treatments we offer", "Contact the clinic"]'::jsonb
    when 'pharmacy' then '["Opening hours", "Check medicine availability", "Home delivery", "Contact the pharmacy"]'::jsonb
    else '["Opening hours", "Services we offer", "Contact us"]'::jsonb
  end;
$$;

-- Up to 6 quick replies, each a string of 1 to 40 characters.
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
      where jsonb_typeof(reply) <> 'string'
        or char_length(btrim(reply #>> '{}')) not between 1 and 40
    );
$$;

-- ---------------------------------------------------------------------------
-- Widget settings
-- ---------------------------------------------------------------------------

create table if not exists public.widget_settings (
  client_id uuid primary key references public.clients (id) on delete cascade,
  assistant_name text not null,
  brand_color text not null default '#2952e3',
  position text not null default 'right',
  welcome_message text not null,
  quick_replies jsonb not null default '[]'::jsonb,
  -- Object name in the widget-logos bucket, set only by the server.
  logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint widget_settings_assistant_name_length check (char_length(btrim(assistant_name)) between 1 and 60),
  constraint widget_settings_brand_color_format check (brand_color ~ '^#[0-9a-f]{6}$'),
  constraint widget_settings_position_valid check (position in ('right', 'left')),
  constraint widget_settings_welcome_message_length check (char_length(btrim(welcome_message)) between 1 and 500),
  constraint widget_settings_quick_replies_valid check (public.valid_quick_replies(quick_replies)),
  constraint widget_settings_logo_path_format check (
    logo_path is null or logo_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
  )
);

comment on table public.widget_settings is 'Appearance of the chat widget on each client''s website.';

drop trigger if exists widget_settings_set_updated_at on public.widget_settings;
create trigger widget_settings_set_updated_at
  before update on public.widget_settings
  for each row execute function public.set_updated_at();

revoke all on table public.widget_settings from anon, authenticated;
grant select on table public.widget_settings to authenticated;
grant update (assistant_name, brand_color, position, welcome_message, quick_replies)
  on table public.widget_settings to authenticated;

alter table public.widget_settings enable row level security;

drop policy if exists "Clients can view their own widget settings" on public.widget_settings;
create policy "Clients can view their own widget settings"
  on public.widget_settings for select
  to authenticated
  using (client_id in (select id from public.clients where user_id = (select auth.uid())));

drop policy if exists "Clients can update their own widget settings" on public.widget_settings;
create policy "Clients can update their own widget settings"
  on public.widget_settings for update
  to authenticated
  using (client_id in (select id from public.clients where user_id = (select auth.uid())))
  with check (client_id in (select id from public.clients where user_id = (select auth.uid())));

-- Every client gets widget settings based on its business and industry.
create or replace function public.set_up_widget()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.widget_settings (client_id, assistant_name, welcome_message, quick_replies)
  values (
    new.id,
    left(btrim(new.business_name), 60),
    'Hi! Welcome to ' || btrim(new.business_name) || '. How can I help you today?',
    public.default_quick_replies(new.industry)
  )
  on conflict (client_id) do nothing;
  return new;
end;
$$;

revoke all on function public.set_up_widget() from public, anon, authenticated;

drop trigger if exists clients_set_up_widget on public.clients;
create trigger clients_set_up_widget
  after insert on public.clients
  for each row execute function public.set_up_widget();

-- Existing clients.
insert into public.widget_settings (client_id, assistant_name, welcome_message, quick_replies)
select
  id,
  left(btrim(business_name), 60),
  'Hi! Welcome to ' || btrim(business_name) || '. How can I help you today?',
  public.default_quick_replies(industry)
from public.clients
on conflict (client_id) do nothing;

-- ---------------------------------------------------------------------------
-- Logo storage
--
-- Public so the widget can show the logo on any website. There are no
-- policies for signed-in users: the dashboard uploads through the server,
-- which checks the file and stores it under a random name.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('widget-logos', 'widget-logos', true, 524288, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
