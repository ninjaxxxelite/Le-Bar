-- =====================================================================
-- LE BAR — Configuration Supabase
-- À coller dans : Supabase > votre projet > SQL Editor > New query > Run
-- Idempotent : peut être relancé sans risque.
-- =====================================================================

-- 1) PROFILS : une ligne par utilisateur, avec son rôle -----------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  name       text,
  role       text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now()
);

-- 2) BOUTEILLES : chaque ligne appartient à un utilisateur --------------
create table if not exists public.bottles (
  id             uuid primary key default gen_random_uuid(),
  owner          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name           text not null,
  producer       text,
  type           text,
  grape          text,
  vintage        int,
  region         text,
  quantity       int default 1,
  purchase_price numeric,
  current_value  numeric,
  location       text,
  rating         int,
  purchase_date  date,
  notes          text,
  favorite       boolean default false,
  photo_url      text,        -- URL publique de la photo (Storage)
  photo_path     text,        -- chemin interne (pour suppression)
  created_at     timestamptz not null default now()
);
create index if not exists bottles_owner_idx on public.bottles(owner);

-- 3) L'utilisateur courant est-il admin ? -------------------------------
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- 4) Création automatique du profil à l'inscription (rôle 'user') -------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, role)
  values (new.id, new.email, split_part(new.email, '@', 1), 'user')
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5) Empêcher un non-admin de modifier un rôle --------------------------
create or replace function public.protect_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() est vide dans le SQL Editor / service_role (contexte serveur de confiance) :
  -- on n'y bloque pas, ce qui permet de créer le premier admin.
  if (new.role is distinct from old.role)
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Seul un administrateur peut modifier un rôle';
  end if;
  return new;
end; $$;
drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.protect_role();

-- 6) SÉCURITÉ AU NIVEAU DES LIGNES (RLS) --------------------------------
alter table public.profiles enable row level security;
alter table public.bottles  enable row level security;

-- profiles : chacun voit/modifie le sien ; l'admin voit/gère tout
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = auth.uid() or public.is_admin())
             with check (id = auth.uid() or public.is_admin());
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete using (public.is_admin());

-- bottles : chacun gère sa cave ; l'admin peut tout lire/supprimer
drop policy if exists bottles_select on public.bottles;
create policy bottles_select on public.bottles
  for select using (owner = auth.uid() or public.is_admin());
drop policy if exists bottles_insert on public.bottles;
create policy bottles_insert on public.bottles
  for insert with check (owner = auth.uid());
drop policy if exists bottles_update on public.bottles;
create policy bottles_update on public.bottles
  for update using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists bottles_delete on public.bottles;
create policy bottles_delete on public.bottles
  for delete using (owner = auth.uid() or public.is_admin());

-- 7) STOCKAGE DES PHOTOS ------------------------------------------------
-- Bucket "photos" : lecture publique, écriture réservée au propriétaire
-- (chaque fichier est rangé dans un dossier au nom de l'utilisateur).
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

drop policy if exists photos_read on storage.objects;
create policy photos_read on storage.objects
  for select using (bucket_id = 'photos');
drop policy if exists photos_insert on storage.objects;
create policy photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists photos_update on storage.objects;
create policy photos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists photos_delete on storage.objects;
create policy photos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- 8) DEVENIR ADMIN (à exécuter UNE FOIS, après votre inscription) -------
--    Remplacez l'email, puis lancez cette ligne :
-- update public.profiles set role = 'admin' where email = 'VOTRE_EMAIL';

-- 9) RÉGLAGES PRIVÉS PAR UTILISATEUR (clé Gemini) -----------------------
-- Table verrouillée sur le profil : lisible et modifiable par le SEUL
-- propriétaire (aucun accès admin) -> la clé API reste privée, et suit le
-- compte sur tous les appareils.
create table if not exists public.user_settings (
  id           uuid primary key references auth.users(id) on delete cascade,
  gemini_key   text,
  gemini_model text,
  updated_at   timestamptz not null default now()
);
alter table public.user_settings enable row level security;
drop policy if exists user_settings_rw on public.user_settings;
create policy user_settings_rw on public.user_settings
  for all using (id = auth.uid()) with check (id = auth.uid());
