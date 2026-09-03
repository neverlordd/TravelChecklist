-- Динамические страны и Google Maps URL.
-- Существующие Вьетнам, Таиланд и все места сохраняются.
create table if not exists public.countries (
  id text primary key,
  name text not null check (char_length(name) between 1 and 80),
  emoji text not null default '✈️',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.countries (id, name, emoji, sort_order)
values ('vietnam', 'Вьетнам', '🇻🇳', 0), ('thailand', 'Таиланд', '🇹🇭', 1)
on conflict (id) do nothing;

alter table public.checklist_items
  add column if not exists maps_url text,
  drop constraint if exists checklist_items_country_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.checklist_items'::regclass
      and contype = 'f'
      and conname = 'checklist_items_country_fkey'
  ) then
    alter table public.checklist_items
      add constraint checklist_items_country_fkey
      foreign key (country) references public.countries(id) on delete restrict;
  end if;
end $$;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists countries_set_updated_at on public.countries;
create trigger countries_set_updated_at before update on public.countries
for each row execute function public.set_updated_at();

alter table public.countries enable row level security;
drop policy if exists "anon can read countries" on public.countries;
create policy "anon can read countries" on public.countries for select to anon using (true);
drop policy if exists "anon can add countries" on public.countries;
create policy "anon can add countries" on public.countries for insert to anon with check (true);
drop policy if exists "anon can update countries" on public.countries;
create policy "anon can update countries" on public.countries for update to anon using (true) with check (true);
drop policy if exists "anon can delete countries" on public.countries;
create policy "anon can delete countries" on public.countries for delete to anon using (true);
grant select, insert, update, delete on public.countries to anon;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'countries'
  ) then alter publication supabase_realtime add table public.countries;
  end if;
end $$;
