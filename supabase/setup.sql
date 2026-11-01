-- One-time setup for the meal planner. Paste this into Supabase > SQL Editor and press Run.
-- It uses the same Supabase project (and the same sign-in) as the to-do app, with its own table.
-- Each row is one small piece of your data (a recipe, a category group, one meal on a day).

create table if not exists public.meal_records (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  key text not null,
  data jsonb,
  deleted boolean not null default false,
  mod bigint not null default 0,          -- when the device made the change (ms)
  server_at timestamptz not null default now(),
  primary key (user_id, key)
);

create index if not exists meal_records_user_server_at on public.meal_records (user_id, server_at);

-- Only you can see and change your own rows.
alter table public.meal_records enable row level security;
drop policy if exists "Own rows only" on public.meal_records;
create policy "Own rows only" on public.meal_records
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.meal_records to authenticated;

-- Stamp each change with the server's clock, and never let an older change
-- overwrite a newer one.
create or replace function public.meal_records_touch() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.mod < old.mod then
    return null;
  end if;
  new.server_at = clock_timestamp();
  return new;
end $$;

drop trigger if exists meal_records_touch on public.meal_records;
create trigger meal_records_touch before insert or update on public.meal_records
  for each row execute function public.meal_records_touch();

-- Recipe photos: a private folder per person (max 5 MB per photo; the app shrinks them first).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meal-photos', 'meal-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "Own meal photos" on storage.objects;
create policy "Own meal photos" on storage.objects
  for all to authenticated
  using (bucket_id = 'meal-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'meal-photos' and (storage.foldername(name))[1] = auth.uid()::text);
