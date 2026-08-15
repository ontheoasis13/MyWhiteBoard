-- My Whiteboard 0.2 semantic workspace cloud replica.
-- Legacy whiteboard_* tables remain available only for Beta 5 migration and rollback.

create extension if not exists pgcrypto;

create table if not exists public.workspace_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  local_id text not null,
  name text not null,
  schema_version integer not null default 2 check (schema_version > 0),
  workspace_version bigint not null default 0 check (workspace_version >= 0),
  project jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, local_id)
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspace_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer', 'editor')),
  created_at timestamptz not null default now(),
  primary key(workspace_id, user_id)
);

create table if not exists public.workspace_entities (
  workspace_id uuid not null references public.workspace_projects(id) on delete cascade,
  collection text not null check (collection in (
    'projects', 'contexts', 'boards', 'board_elements', 'tasks', 'decisions',
    'artifacts', 'agents', 'handoffs', 'messages', 'selections'
  )),
  entity_id text not null,
  parent_entity_id text,
  entity_version bigint not null check (entity_version > 0),
  document jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(workspace_id, collection, entity_id)
);

create table if not exists public.workspace_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspace_projects(id) on delete cascade,
  workspace_version bigint not null check (workspace_version > 0),
  event_index integer not null check (event_index >= 0),
  transaction_id uuid not null,
  event_type text not null,
  collection text,
  entity_id text,
  actor jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(workspace_id, workspace_version, event_index),
  unique(workspace_id, transaction_id, event_index)
);

create index if not exists workspace_members_user_idx on public.workspace_members(user_id);
create index if not exists workspace_entities_parent_idx on public.workspace_entities(workspace_id, parent_entity_id);
create index if not exists workspace_events_delta_idx on public.workspace_events(workspace_id, workspace_version, event_index);

alter table public.workspace_projects enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_entities enable row level security;
alter table public.workspace_events enable row level security;

create or replace function public.can_view_workspace(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_projects workspace
    where workspace.id = target
      and (
        workspace.owner_id = auth.uid()
        or exists (
          select 1 from public.workspace_members member
          where member.workspace_id = workspace.id and member.user_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.can_edit_workspace(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_projects workspace
    where workspace.id = target
      and (
        workspace.owner_id = auth.uid()
        or exists (
          select 1 from public.workspace_members member
          where member.workspace_id = workspace.id
            and member.user_id = auth.uid()
            and member.role = 'editor'
        )
      )
  );
$$;

revoke all on function public.can_view_workspace(uuid) from public;
revoke all on function public.can_edit_workspace(uuid) from public;
grant execute on function public.can_view_workspace(uuid) to authenticated;
grant execute on function public.can_edit_workspace(uuid) to authenticated;

drop policy if exists "workspace projects view" on public.workspace_projects;
create policy "workspace projects view" on public.workspace_projects
for select to authenticated using (public.can_view_workspace(id));

drop policy if exists "workspace projects create" on public.workspace_projects;
create policy "workspace projects create" on public.workspace_projects
for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "workspace projects edit" on public.workspace_projects;
create policy "workspace projects edit" on public.workspace_projects
for update to authenticated using (public.can_edit_workspace(id)) with check (public.can_edit_workspace(id));

drop policy if exists "workspace projects delete" on public.workspace_projects;
create policy "workspace projects delete" on public.workspace_projects
for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "workspace members view" on public.workspace_members;
create policy "workspace members view" on public.workspace_members
for select to authenticated using (public.can_view_workspace(workspace_id));

drop policy if exists "workspace members manage" on public.workspace_members;
create policy "workspace members manage" on public.workspace_members
for all to authenticated
using (exists (
  select 1 from public.workspace_projects workspace
  where workspace.id = workspace_id and workspace.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.workspace_projects workspace
  where workspace.id = workspace_id and workspace.owner_id = auth.uid()
));

drop policy if exists "workspace entities view" on public.workspace_entities;
create policy "workspace entities view" on public.workspace_entities
for select to authenticated using (public.can_view_workspace(workspace_id));

drop policy if exists "workspace events view" on public.workspace_events;
create policy "workspace events view" on public.workspace_events
for select to authenticated using (public.can_view_workspace(workspace_id));

revoke insert, update, delete on public.workspace_entities from authenticated;
revoke insert, update, delete on public.workspace_events from authenticated;
grant select on public.workspace_projects, public.workspace_members, public.workspace_entities, public.workspace_events to authenticated;
grant insert, update, delete on public.workspace_projects, public.workspace_members to authenticated;

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

  insert into public.workspace_projects(owner_id, local_id, name, schema_version, project)
  values(auth.uid(), p_local_id, coalesce(nullif(trim(p_name), ''), p_local_id), p_schema_version, coalesce(p_project, '{}'::jsonb))
  on conflict(owner_id, local_id) do update
    set name = excluded.name,
        schema_version = excluded.schema_version,
        project = case
          when coalesce((excluded.project->>'version')::bigint, 0) >= coalesce((workspace_projects.project->>'version')::bigint, 0)
          then excluded.project else workspace_projects.project end,
        updated_at = now()
  returning * into result;

  return result;
end;
$$;

revoke all on function public.ensure_workspace_project(text, text, integer, jsonb) from public;
grant execute on function public.ensure_workspace_project(text, text, integer, jsonb) to authenticated;

create or replace function public.apply_workspace_changes(
  p_workspace_id uuid,
  p_transaction_id uuid,
  p_actor jsonb,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  workspace public.workspace_projects%rowtype;
  change jsonb;
  existing public.workspace_entities%rowtype;
  change_index integer := 0;
  next_workspace_version bigint;
  requested_version bigint;
  expected_version bigint;
  operation text;
  collection_name text;
  entity_key text;
  document_value jsonb;
  existing_workspace_version bigint;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if not public.can_edit_workspace(p_workspace_id) then raise exception 'Workspace edit access denied' using errcode = '42501'; end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'p_changes must be a non-empty array' using errcode = '22023';
  end if;

  select min(workspace_version) into existing_workspace_version
  from public.workspace_events
  where workspace_id = p_workspace_id and transaction_id = p_transaction_id;
  if existing_workspace_version is not null then
    return jsonb_build_object(
      'transactionId', p_transaction_id,
      'workspaceVersion', existing_workspace_version,
      'idempotent', true
    );
  end if;

  select * into workspace from public.workspace_projects where id = p_workspace_id for update;
  if not found then raise exception 'Workspace not found' using errcode = 'P0002'; end if;
  next_workspace_version := workspace.workspace_version + 1;

  for change in select value from jsonb_array_elements(p_changes)
  loop
    operation := change->>'op';
    collection_name := change->>'collection';
    entity_key := change->>'entityId';
    document_value := change->'document';

    if collection_name not in (
      'projects', 'contexts', 'boards', 'board_elements', 'tasks', 'decisions',
      'artifacts', 'agents', 'handoffs', 'messages', 'selections'
    ) then raise exception 'Unsupported collection: %', collection_name using errcode = '22023'; end if;
    if nullif(entity_key, '') is null then raise exception 'entityId is required' using errcode = '22023'; end if;

    select * into existing
    from public.workspace_entities
    where workspace_id = p_workspace_id and collection = collection_name and entity_id = entity_key
    for update;

    if operation = 'create' then
      if found then raise exception 'Entity already exists: %.%', collection_name, entity_key using errcode = '23505'; end if;
      requested_version := coalesce((document_value->>'version')::bigint, 1);
      if requested_version < 1 then raise exception 'Entity version must be positive' using errcode = '22023'; end if;
      document_value := jsonb_set(coalesce(document_value, '{}'::jsonb), '{version}', to_jsonb(requested_version), true);
      insert into public.workspace_entities(workspace_id, collection, entity_id, parent_entity_id, entity_version, document)
      values(p_workspace_id, collection_name, entity_key, change->>'parentEntityId', requested_version, document_value);
      insert into public.workspace_events(workspace_id, workspace_version, event_index, transaction_id, event_type, collection, entity_id, actor, payload)
      values(p_workspace_id, next_workspace_version, change_index, p_transaction_id, 'entity.created', collection_name, entity_key, coalesce(p_actor, '{}'::jsonb), jsonb_build_object('document', document_value, 'parentEntityId', change->>'parentEntityId'));
    elsif operation = 'update' then
      if not found then raise exception 'Entity not found: %.%', collection_name, entity_key using errcode = 'P0002'; end if;
      expected_version := (change->>'expectedVersion')::bigint;
      if expected_version is null or existing.entity_version <> expected_version then
        raise exception 'Entity version conflict for %.%: expected %, actual %', collection_name, entity_key, expected_version, existing.entity_version using errcode = '40001';
      end if;
      requested_version := coalesce((document_value->>'version')::bigint, expected_version + 1);
      if requested_version <= expected_version then raise exception 'Updated Entity version must advance' using errcode = '22023'; end if;
      document_value := jsonb_set(coalesce(document_value, '{}'::jsonb), '{version}', to_jsonb(requested_version), true);
      update public.workspace_entities
      set parent_entity_id = change->>'parentEntityId', entity_version = requested_version, document = document_value, updated_at = now()
      where workspace_id = p_workspace_id and collection = collection_name and entity_id = entity_key;
      insert into public.workspace_events(workspace_id, workspace_version, event_index, transaction_id, event_type, collection, entity_id, actor, payload)
      values(p_workspace_id, next_workspace_version, change_index, p_transaction_id, 'entity.updated', collection_name, entity_key, coalesce(p_actor, '{}'::jsonb), jsonb_build_object('document', document_value, 'previousVersion', expected_version, 'parentEntityId', change->>'parentEntityId'));
    elsif operation = 'delete' then
      if not found then raise exception 'Entity not found: %.%', collection_name, entity_key using errcode = 'P0002'; end if;
      expected_version := (change->>'expectedVersion')::bigint;
      if expected_version is null or existing.entity_version <> expected_version then
        raise exception 'Entity version conflict for %.%: expected %, actual %', collection_name, entity_key, expected_version, existing.entity_version using errcode = '40001';
      end if;
      delete from public.workspace_entities
      where workspace_id = p_workspace_id and collection = collection_name and entity_id = entity_key;
      insert into public.workspace_events(workspace_id, workspace_version, event_index, transaction_id, event_type, collection, entity_id, actor, payload)
      values(p_workspace_id, next_workspace_version, change_index, p_transaction_id, 'entity.deleted', collection_name, entity_key, coalesce(p_actor, '{}'::jsonb), jsonb_build_object('previousVersion', expected_version, 'parentEntityId', existing.parent_entity_id));
    else
      raise exception 'Unsupported operation: %', operation using errcode = '22023';
    end if;

    change_index := change_index + 1;
  end loop;

  update public.workspace_projects
  set workspace_version = next_workspace_version, updated_at = now()
  where id = p_workspace_id;

  return jsonb_build_object(
    'transactionId', p_transaction_id,
    'previousWorkspaceVersion', workspace.workspace_version,
    'workspaceVersion', next_workspace_version,
    'changeCount', change_index,
    'idempotent', false
  );
end;
$$;

revoke all on function public.apply_workspace_changes(uuid, uuid, jsonb, jsonb) from public;
grant execute on function public.apply_workspace_changes(uuid, uuid, jsonb, jsonb) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.workspace_projects;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.workspace_entities;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.workspace_events;
exception when duplicate_object then null;
end $$;
