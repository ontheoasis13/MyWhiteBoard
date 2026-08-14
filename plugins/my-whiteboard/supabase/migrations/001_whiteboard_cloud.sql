create extension if not exists pgcrypto;

create table if not exists public.whiteboard_boards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  local_id text not null,
  title text not null default 'Untitled whiteboard',
  document jsonb not null,
  revision bigint not null default 1,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, local_id)
);

create table if not exists public.whiteboard_members (
  board_id uuid not null references public.whiteboard_boards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer', 'editor')),
  created_at timestamptz not null default now(),
  primary key(board_id, user_id)
);

create table if not exists public.whiteboard_versions (
  id bigint generated always as identity primary key,
  board_id uuid not null references public.whiteboard_boards(id) on delete cascade,
  revision bigint not null,
  document jsonb not null,
  author_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.whiteboard_share_links (
  token uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.whiteboard_boards(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  permission text not null check (permission in ('viewer', 'editor')),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists whiteboard_members_user_idx on public.whiteboard_members(user_id);
create index if not exists whiteboard_versions_board_idx on public.whiteboard_versions(board_id, revision desc);
create index if not exists whiteboard_share_board_idx on public.whiteboard_share_links(board_id);

alter table public.whiteboard_boards enable row level security;
alter table public.whiteboard_members enable row level security;
alter table public.whiteboard_versions enable row level security;
alter table public.whiteboard_share_links enable row level security;

create or replace function public.can_view_whiteboard(target uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.whiteboard_boards b
    where b.id = target and (
      b.owner_id = auth.uid() or b.is_public or exists (
        select 1 from public.whiteboard_members m where m.board_id = b.id and m.user_id = auth.uid()
      )
    )
  );
$$;

create or replace function public.can_edit_whiteboard(target uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.whiteboard_boards b
    where b.id = target and (
      b.owner_id = auth.uid() or exists (
        select 1 from public.whiteboard_members m
        where m.board_id = b.id and m.user_id = auth.uid() and m.role = 'editor'
      )
    )
  );
$$;

drop policy if exists "boards view" on public.whiteboard_boards;
create policy "boards view" on public.whiteboard_boards for select using (public.can_view_whiteboard(id));
drop policy if exists "boards create" on public.whiteboard_boards;
create policy "boards create" on public.whiteboard_boards for insert with check (owner_id = auth.uid());
drop policy if exists "boards edit" on public.whiteboard_boards;
create policy "boards edit" on public.whiteboard_boards for update using (public.can_edit_whiteboard(id)) with check (public.can_edit_whiteboard(id));
drop policy if exists "boards delete" on public.whiteboard_boards;
create policy "boards delete" on public.whiteboard_boards for delete using (owner_id = auth.uid());

drop policy if exists "members view" on public.whiteboard_members;
create policy "members view" on public.whiteboard_members for select using (public.can_view_whiteboard(board_id));
drop policy if exists "members manage" on public.whiteboard_members;
create policy "members manage" on public.whiteboard_members for all using (
  exists (select 1 from public.whiteboard_boards b where b.id = board_id and b.owner_id = auth.uid())
) with check (
  exists (select 1 from public.whiteboard_boards b where b.id = board_id and b.owner_id = auth.uid())
);

drop policy if exists "versions view" on public.whiteboard_versions;
create policy "versions view" on public.whiteboard_versions for select using (public.can_view_whiteboard(board_id));
drop policy if exists "versions create" on public.whiteboard_versions;
create policy "versions create" on public.whiteboard_versions for insert with check (public.can_edit_whiteboard(board_id));

drop policy if exists "shares view" on public.whiteboard_share_links;
create policy "shares view" on public.whiteboard_share_links for select using (public.can_view_whiteboard(board_id));
drop policy if exists "shares manage" on public.whiteboard_share_links;
create policy "shares manage" on public.whiteboard_share_links for all using (
  exists (select 1 from public.whiteboard_boards b where b.id = board_id and b.owner_id = auth.uid())
) with check (
  exists (select 1 from public.whiteboard_boards b where b.id = board_id and b.owner_id = auth.uid())
);

create or replace function public.save_whiteboard_version()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.document is distinct from old.document then
    insert into public.whiteboard_versions(board_id, revision, document, author_id)
    values(new.id, new.revision, new.document, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists whiteboard_version_trigger on public.whiteboard_boards;
create trigger whiteboard_version_trigger
after insert or update of document on public.whiteboard_boards
for each row execute function public.save_whiteboard_version();

create or replace function public.accept_whiteboard_share(invite_token uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare link public.whiteboard_share_links%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into link from public.whiteboard_share_links
  where token = invite_token and revoked_at is null and (expires_at is null or expires_at > now());
  if not found then raise exception 'Share link is invalid or expired'; end if;
  insert into public.whiteboard_members(board_id, user_id, role)
  values(link.board_id, auth.uid(), link.permission)
  on conflict(board_id, user_id) do update set role = excluded.role;
  return link.board_id;
end;
$$;

grant execute on function public.accept_whiteboard_share(uuid) to authenticated;
grant select, insert, update, delete on public.whiteboard_boards to authenticated;
grant select, insert, update, delete on public.whiteboard_members to authenticated;
grant select, insert on public.whiteboard_versions to authenticated;
grant select, insert, update, delete on public.whiteboard_share_links to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.whiteboard_boards;
exception when duplicate_object then null;
end $$;

