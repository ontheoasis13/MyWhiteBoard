-- Explicit grants and non-overlapping policies for the semantic workspace API.

revoke execute on function public.can_view_workspace(uuid) from public, anon;
revoke execute on function public.can_edit_workspace(uuid) from public, anon;
revoke execute on function public.ensure_workspace_project(text, text, integer, jsonb) from public, anon;
revoke execute on function public.apply_workspace_changes(uuid, uuid, jsonb, jsonb) from public, anon;

-- Legacy functions stay available only where Beta 5 migration needs them.
revoke execute on function public.can_view_whiteboard(uuid) from public, anon;
revoke execute on function public.can_edit_whiteboard(uuid) from public, anon;
revoke execute on function public.accept_whiteboard_share(uuid) from public, anon;
revoke execute on function public.save_whiteboard_version() from public, anon, authenticated;

drop policy if exists "workspace members manage" on public.workspace_members;
drop policy if exists "workspace members create" on public.workspace_members;
create policy "workspace members create" on public.workspace_members
for insert to authenticated
with check (exists (
  select 1 from public.workspace_projects workspace
  where workspace.id = workspace_id and workspace.owner_id = auth.uid()
));

drop policy if exists "workspace members edit" on public.workspace_members;
create policy "workspace members edit" on public.workspace_members
for update to authenticated
using (exists (
  select 1 from public.workspace_projects workspace
  where workspace.id = workspace_id and workspace.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.workspace_projects workspace
  where workspace.id = workspace_id and workspace.owner_id = auth.uid()
));

drop policy if exists "workspace members delete" on public.workspace_members;
create policy "workspace members delete" on public.workspace_members
for delete to authenticated
using (exists (
  select 1 from public.workspace_projects workspace
  where workspace.id = workspace_id and workspace.owner_id = auth.uid()
));

-- workspace_entities is the sole cloud authority for Project and domain entity JSON.
-- workspace_projects keeps only identity, ownership and Workspace Version metadata.
alter table public.workspace_projects drop column if exists project;

create or replace function public.ensure_workspace_project(
  p_local_id text,
  p_name text,
  p_schema_version integer,
  p_project jsonb
)
returns public.workspace_projects
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.workspace_projects%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if nullif(trim(p_local_id), '') is null then raise exception 'local_id is required' using errcode = '22023'; end if;

  insert into public.workspace_projects(owner_id, local_id, name, schema_version)
  values(auth.uid(), p_local_id, coalesce(nullif(trim(p_name), ''), p_local_id), p_schema_version)
  on conflict(owner_id, local_id) do update
    set name = excluded.name,
        schema_version = excluded.schema_version,
        updated_at = now()
  returning * into result;

  return result;
end;
$$;

revoke execute on function public.ensure_workspace_project(text, text, integer, jsonb) from public, anon;
grant execute on function public.ensure_workspace_project(text, text, integer, jsonb) to authenticated;

-- Replace Beta 5 all-operation policies so SELECT has one permissive path per role.
drop policy if exists "members manage" on public.whiteboard_members;
drop policy if exists "members create" on public.whiteboard_members;
create policy "members create" on public.whiteboard_members
for insert to authenticated
with check (exists (
  select 1 from public.whiteboard_boards board where board.id = board_id and board.owner_id = auth.uid()
));
drop policy if exists "members edit" on public.whiteboard_members;
create policy "members edit" on public.whiteboard_members
for update to authenticated
using (exists (
  select 1 from public.whiteboard_boards board where board.id = board_id and board.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.whiteboard_boards board where board.id = board_id and board.owner_id = auth.uid()
));
drop policy if exists "members delete" on public.whiteboard_members;
create policy "members delete" on public.whiteboard_members
for delete to authenticated
using (exists (
  select 1 from public.whiteboard_boards board where board.id = board_id and board.owner_id = auth.uid()
));

drop policy if exists "shares manage" on public.whiteboard_share_links;
drop policy if exists "shares create" on public.whiteboard_share_links;
create policy "shares create" on public.whiteboard_share_links
for insert to authenticated
with check (exists (
  select 1 from public.whiteboard_boards board where board.id = board_id and board.owner_id = auth.uid()
));
drop policy if exists "shares edit" on public.whiteboard_share_links;
create policy "shares edit" on public.whiteboard_share_links
for update to authenticated
using (exists (
  select 1 from public.whiteboard_boards board where board.id = board_id and board.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.whiteboard_boards board where board.id = board_id and board.owner_id = auth.uid()
));
drop policy if exists "shares delete" on public.whiteboard_share_links;
create policy "shares delete" on public.whiteboard_share_links
for delete to authenticated
using (exists (
  select 1 from public.whiteboard_boards board where board.id = board_id and board.owner_id = auth.uid()
));
