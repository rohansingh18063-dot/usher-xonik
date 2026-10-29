-- Website Assistant: client-specific knowledge
--
-- business_profiles  Structured clinic details (address, hours, fees, ...),
--                    always included in the assistant's context.
-- documents          Files a client uploaded, with their processing status.
-- document_chunks    Searchable pieces of each document, with embeddings.
--
-- Safe to run in the Supabase SQL Editor or with `supabase db push`.

-- ---------------------------------------------------------------------------
-- Business profiles (one per client)
-- ---------------------------------------------------------------------------

create table if not exists public.business_profiles (
  client_id uuid primary key references public.clients (id) on delete cascade,
  address text,
  phone text,
  whatsapp text,
  email text,
  -- {"monday": "9:00 AM - 1:00 PM, 5:00 PM - 8:00 PM", "sunday": "Closed", ...}
  opening_hours jsonb not null default '{}'::jsonb,
  -- [{"name": "...", "qualifications": "..."}]
  doctors jsonb not null default '[]'::jsonb,
  -- ["Teeth cleaning", "Root canal treatment", ...]
  services jsonb not null default '[]'::jsonb,
  -- [{"service": "...", "price": "..."}]
  fees jsonb not null default '[]'::jsonb,
  offers text,
  -- ["English", "Hindi", ...]
  languages jsonb not null default '[]'::jsonb,
  maps_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint business_profiles_text_lengths check (
    coalesce(char_length(address), 0) <= 500
    and coalesce(char_length(phone), 0) <= 40
    and coalesce(char_length(whatsapp), 0) <= 40
    and coalesce(char_length(email), 0) <= 254
    and coalesce(char_length(offers), 0) <= 2000
    and coalesce(char_length(maps_url), 0) <= 500
  ),
  constraint business_profiles_json_shapes check (
    jsonb_typeof(opening_hours) = 'object'
    and jsonb_typeof(doctors) = 'array'
    and jsonb_typeof(services) = 'array'
    and jsonb_typeof(fees) = 'array'
    and jsonb_typeof(languages) = 'array'
  ),
  constraint business_profiles_json_sizes check (
    pg_column_size(opening_hours) + pg_column_size(doctors) + pg_column_size(services)
      + pg_column_size(fees) + pg_column_size(languages) <= 65536
  ),
  constraint business_profiles_maps_url_format check (maps_url is null or maps_url ~ '^https://')
);

comment on table public.business_profiles is 'Structured clinic details, always given to the assistant.';

drop trigger if exists business_profiles_set_updated_at on public.business_profiles;
create trigger business_profiles_set_updated_at
  before update on public.business_profiles
  for each row execute function public.set_updated_at();

revoke all on table public.business_profiles from anon, authenticated;
grant select on table public.business_profiles to authenticated;
grant insert (client_id, address, phone, whatsapp, email, opening_hours, doctors, services, fees, offers, languages, maps_url)
  on table public.business_profiles to authenticated;
grant update (address, phone, whatsapp, email, opening_hours, doctors, services, fees, offers, languages, maps_url)
  on table public.business_profiles to authenticated;

alter table public.business_profiles enable row level security;

drop policy if exists "Clients can view their own business profile" on public.business_profiles;
create policy "Clients can view their own business profile"
  on public.business_profiles for select
  to authenticated
  using (client_id in (select id from public.clients where user_id = (select auth.uid())));

drop policy if exists "Clients can create their own business profile" on public.business_profiles;
create policy "Clients can create their own business profile"
  on public.business_profiles for insert
  to authenticated
  with check (client_id in (select id from public.clients where user_id = (select auth.uid())));

drop policy if exists "Clients can update their own business profile" on public.business_profiles;
create policy "Clients can update their own business profile"
  on public.business_profiles for update
  to authenticated
  using (client_id in (select id from public.clients where user_id = (select auth.uid())))
  with check (client_id in (select id from public.clients where user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  file_name text not null,
  file_type text not null,
  size_bytes integer not null,
  -- Original file in the private "documents" bucket: <client id>/<document id>/...
  storage_path text not null,
  -- Increases every time the file is replaced. Chunks from older revisions are
  -- never used, even if an old processing run finishes late.
  revision integer not null default 1,
  status text not null default 'processing',
  error_message text,
  chunk_count integer not null default 0,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint documents_id_client_unique unique (id, client_id),
  constraint documents_file_type_valid check (file_type in ('pdf', 'docx', 'txt')),
  constraint documents_size_valid check (size_bytes between 1 and 10485760),
  constraint documents_status_valid check (status in ('processing', 'ready', 'failed')),
  constraint documents_file_name_length check (char_length(file_name) between 1 and 255),
  constraint documents_storage_path_in_client_folder check (storage_path like client_id::text || '/%')
);

comment on table public.documents is 'Files uploaded by a client for its assistant, with processing status.';

create index if not exists documents_client_idx on public.documents (client_id, created_at desc);

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

-- Uploads, replacements, deletions and processing run on the server, which
-- checks ownership first. Clients may read their own documents.
revoke all on table public.documents from anon, authenticated;
grant select on table public.documents to authenticated;

alter table public.documents enable row level security;

drop policy if exists "Clients can view their own documents" on public.documents;
create policy "Clients can view their own documents"
  on public.documents for select
  to authenticated
  using (client_id in (select id from public.clients where user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Document chunks
-- ---------------------------------------------------------------------------

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  document_id uuid not null,
  revision integer not null,
  chunk_index integer not null,
  content text not null,
  embedding extensions.vector(1024) not null,
  embedding_model text not null,
  created_at timestamptz not null default now(),

  -- A chunk always belongs to a document of the same client.
  constraint document_chunks_document_fk foreign key (document_id, client_id)
    references public.documents (id, client_id) on delete cascade,
  constraint document_chunks_content_present check (char_length(content) > 0)
);

comment on table public.document_chunks is 'Searchable pieces of client documents, with embeddings.';

create index if not exists document_chunks_client_idx on public.document_chunks (client_id);
create index if not exists document_chunks_document_idx on public.document_chunks (document_id, revision);

revoke all on table public.document_chunks from anon, authenticated;
grant select on table public.document_chunks to authenticated;

alter table public.document_chunks enable row level security;

drop policy if exists "Clients can view their own document chunks" on public.document_chunks;
create policy "Clients can view their own document chunks"
  on public.document_chunks for select
  to authenticated
  using (client_id in (select id from public.clients where user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Search
--
-- Returns the chunks of one client's ready documents most similar to the
-- query embedding. Only the server may call it, and it always filters by the
-- client it is given, so results never mix clients. The search is exact
-- (no approximate index), which is fast at the size of one client's
-- documents and never misses results because of filtering.
-- ---------------------------------------------------------------------------

create or replace function public.match_document_chunks(
  p_client_id uuid,
  p_query_embedding extensions.vector(1024),
  p_match_count integer default 6,
  p_min_similarity double precision default 0.3
)
returns table (chunk_id uuid, document_id uuid, file_name text, content text, similarity double precision)
language sql
stable
set search_path = ''
as $$
  select
    c.id,
    c.document_id,
    d.file_name,
    c.content,
    1 - (c.embedding operator(extensions.<=>) p_query_embedding) as similarity
  from public.document_chunks c
  join public.documents d
    on d.id = c.document_id
   and d.client_id = c.client_id
   and d.revision = c.revision
   and d.status = 'ready'
  where c.client_id = p_client_id
    and 1 - (c.embedding operator(extensions.<=>) p_query_embedding) >= p_min_similarity
  order by c.embedding operator(extensions.<=>) p_query_embedding
  limit least(greatest(p_match_count, 1), 20);
$$;

revoke all on function public.match_document_chunks(uuid, extensions.vector, integer, double precision)
  from public, anon, authenticated;
grant execute on function public.match_document_chunks(uuid, extensions.vector, integer, double precision)
  to service_role;

-- ---------------------------------------------------------------------------
-- Storage limits for the documents bucket (created in the foundation step)
-- ---------------------------------------------------------------------------

update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
where id = 'documents';
