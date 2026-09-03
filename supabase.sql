-- Запустите целиком в Supabase → SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  country text not null check (country in ('vietnam', 'thailand')),
  category text not null check (category in ('Заведения', 'Хайки', 'Города', 'Досуг')),
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '',
  photo_url text,
  photo_path text,
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  is_completed boolean not null default false,
  is_favorite boolean not null default false,
  priority smallint not null default 1 check (priority between 1 and 3),
  external_url text,
  planned_date date,
  created_by text not null check (created_by in ('neverlordd', 'puk_privet')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coordinates_pair check (
    (latitude is null and longitude is null) or
    (latitude is not null and longitude is not null)
  )
);

-- Миграция для уже существующей таблицы. CREATE TABLE IF NOT EXISTS
-- не добавляет новые столбцы, поэтому каждый столбец проверяется отдельно.
alter table public.checklist_items
  add column if not exists country text not null default 'vietnam',
  add column if not exists category text not null default 'Заведения',
  add column if not exists title text not null default 'Без названия',
  add column if not exists description text not null default '',
  add column if not exists photo_url text,
  add column if not exists photo_path text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists is_completed boolean not null default false,
  add column if not exists is_favorite boolean not null default false,
  add column if not exists priority smallint not null default 1,
  add column if not exists external_url text,
  add column if not exists planned_date date,
  add column if not exists created_by text not null default 'neverlordd',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists checklist_items_country_category_idx
  on public.checklist_items (country, category, created_at);

create index if not exists checklist_items_country_status_idx
  on public.checklist_items (country, is_completed, is_favorite, priority, planned_date);

-- Закрытая история изменений: позволяет восстановить случайно изменённые
-- или удалённые пункты. Клиентское приложение доступа к ней не имеет.
create table if not exists public.checklist_items_history (
  history_id bigint generated always as identity primary key,
  item_id uuid not null,
  operation text not null check (operation in ('UPDATE', 'DELETE')),
  snapshot jsonb not null,
  archived_at timestamptz not null default now()
);

alter table public.checklist_items_history enable row level security;
revoke all on public.checklist_items_history from anon, authenticated;

create or replace function public.archive_checklist_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.checklist_items_history (item_id, operation, snapshot)
  values (old.id, tg_op, to_jsonb(old));
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists checklist_items_archive_changes on public.checklist_items;
create trigger checklist_items_archive_changes
before update or delete on public.checklist_items
for each row execute function public.archive_checklist_item();

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

drop trigger if exists checklist_items_set_updated_at on public.checklist_items;
create trigger checklist_items_set_updated_at
before update on public.checklist_items
for each row execute function public.set_updated_at();

alter table public.checklist_items enable row level security;

drop policy if exists "anon can read checklist" on public.checklist_items;
create policy "anon can read checklist"
on public.checklist_items for select to anon using (true);

drop policy if exists "anon can add checklist" on public.checklist_items;
create policy "anon can add checklist"
on public.checklist_items for insert to anon
with check (created_by in ('neverlordd', 'puk_privet'));

drop policy if exists "anon can update checklist" on public.checklist_items;
create policy "anon can update checklist"
on public.checklist_items for update to anon
using (true) with check (created_by in ('neverlordd', 'puk_privet'));

drop policy if exists "anon can delete checklist" on public.checklist_items;
create policy "anon can delete checklist"
on public.checklist_items for delete to anon using (true);

grant select, insert, update, delete on public.checklist_items to anon;

-- Полная строка нужна, чтобы DELETE-события Realtime содержали старые данные.
alter table public.checklist_items replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'checklist_items'
  ) then
    alter publication supabase_realtime add table public.checklist_items;
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos',
  'photos',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public can view travel photos" on storage.objects;
create policy "public can view travel photos"
on storage.objects for select to public
using (bucket_id = 'photos');

drop policy if exists "anon can upload travel photos" on storage.objects;
create policy "anon can upload travel photos"
on storage.objects for insert to anon
with check (bucket_id = 'photos');

drop policy if exists "anon can update travel photos" on storage.objects;
create policy "anon can update travel photos"
on storage.objects for update to anon
using (bucket_id = 'photos') with check (bucket_id = 'photos');

drop policy if exists "anon can delete travel photos" on storage.objects;
create policy "anon can delete travel photos"
on storage.objects for delete to anon
using (bucket_id = 'photos');
