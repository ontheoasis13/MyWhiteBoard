-- All semantic mutations and Workspace Version changes must pass through RPCs.

revoke insert, update on public.workspace_projects from authenticated;
grant delete on public.workspace_projects to authenticated;

revoke all on public.workspace_projects, public.workspace_members, public.workspace_entities, public.workspace_events from anon;
