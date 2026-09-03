-- Безопасное UX-обновление существующей таблицы.
-- Не удаляет данные и не меняет RLS/Storage.
alter table public.checklist_items
  add column if not exists is_favorite boolean not null default false,
  add column if not exists priority smallint not null default 1,
  add column if not exists external_url text,
  add column if not exists planned_date date;

create index if not exists checklist_items_country_status_idx
  on public.checklist_items (country, is_completed, is_favorite, priority, planned_date);
