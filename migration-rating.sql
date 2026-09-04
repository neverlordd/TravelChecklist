-- Безопасная миграция: добавляет оценку месту без изменения существующих данных.
alter table public.checklist_items
  add column if not exists rating smallint;

alter table public.checklist_items
  drop constraint if exists checklist_items_rating_check,
  add constraint checklist_items_rating_check
  check (rating is null or rating between 1 and 5);
