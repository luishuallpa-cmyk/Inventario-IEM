-- Pedidos sugeridos — ejecutar en Supabase SQL Editor

create extension if not exists "pgcrypto";

create table if not exists public.pedidos_sugeridos (
  id uuid primary key default gen_random_uuid(),
  usuario text,
  vendedor_codigo text,
  vendedor_nombre text,
  ruta text,
  items jsonb not null default '[]'::jsonb,
  total_cajas integer default 0,
  total_unidades integer default 0,
  notas text,
  estado text default 'pendiente',
  created_at timestamptz default now()
);

alter table public.pedidos_sugeridos add column if not exists usuario text;
alter table public.pedidos_sugeridos add column if not exists vendedor_codigo text;
alter table public.pedidos_sugeridos add column if not exists vendedor_nombre text;
alter table public.pedidos_sugeridos add column if not exists ruta text;
alter table public.pedidos_sugeridos add column if not exists items jsonb default '[]'::jsonb;
alter table public.pedidos_sugeridos add column if not exists total_cajas integer default 0;
alter table public.pedidos_sugeridos add column if not exists total_unidades integer default 0;
alter table public.pedidos_sugeridos add column if not exists notas text;
alter table public.pedidos_sugeridos add column if not exists estado text default 'pendiente';
alter table public.pedidos_sugeridos add column if not exists created_at timestamptz default now();

-- id con default
do $$ begin
  alter table public.pedidos_sugeridos alter column id set default gen_random_uuid();
exception when others then null;
end $$;

-- Si usuario es NOT NULL sin default, permitir vacío temporal o rellenar
do $$ begin
  alter table public.pedidos_sugeridos alter column usuario drop not null;
exception when others then null;
end $$;

alter table public.pedidos_sugeridos enable row level security;
drop policy if exists "pedidos_sugeridos_insert_auth" on public.pedidos_sugeridos;
create policy "pedidos_sugeridos_insert_auth" on public.pedidos_sugeridos
  for insert to authenticated with check (true);
drop policy if exists "pedidos_sugeridos_select_auth" on public.pedidos_sugeridos;
create policy "pedidos_sugeridos_select_auth" on public.pedidos_sugeridos
  for select to authenticated using (true);
drop policy if exists "pedidos_sugeridos_update_auth" on public.pedidos_sugeridos;
create policy "pedidos_sugeridos_update_auth" on public.pedidos_sugeridos
  for update to authenticated using (true) with check (true);

notify pgrst, 'reload schema';
