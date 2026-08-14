import http from "node:http";
import { verifyAuth, createContextClient } from "@supabase/server/core";

const port = Number(process.env.PORT || 8787);
const cors = {
  "access-control-allow-origin": process.env.ALLOWED_ORIGIN || "*",
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "content-type": "application/json; charset=utf-8",
};

async function api(request) {
  const { data: auth, error: authError } = await verifyAuth(request, { auth: "user" });
  if (authError) return Response.json({ error: authError.message }, { status: authError.status || 401, headers: cors });
  const supabase = createContextClient({ auth: { token: auth.token } });
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  if (request.method === "GET" && url.pathname === "/api/me") {
    return Response.json({ user: auth.userClaims }, { headers: cors });
  }
  if (request.method === "GET" && url.pathname === "/api/workspaces") {
    const { data, error } = await supabase.from("workspace_projects").select("id,local_id,name,schema_version,workspace_version,updated_at").order("updated_at", { ascending: false });
    if (error) return Response.json({ error: error.message }, { status: 400, headers: cors });
    return Response.json({ workspaces: data }, { headers: cors });
  }
  if (request.method === "POST" && url.pathname === "/api/workspaces/ensure") {
    const body = await request.json();
    const { data, error } = await supabase.rpc("ensure_workspace_project", {
      p_local_id: body.localId,
      p_name: body.name,
      p_schema_version: body.schemaVersion || 2,
      p_project: {},
    });
    if (error) return Response.json({ error: error.message, code: error.code }, { status: 400, headers: cors });
    return Response.json(data, { headers: cors });
  }
  if (segments[0] === "api" && segments[1] === "workspaces" && segments[2]) {
    const workspaceId = segments[2];
    if (request.method === "GET" && segments[3] === "events") {
      const since = Number(url.searchParams.get("since") || 0);
      const { data, error } = await supabase.from("workspace_events")
        .select("workspace_version,event_index,transaction_id,event_type,collection,entity_id,actor,payload,created_at")
        .eq("workspace_id", workspaceId).gt("workspace_version", since)
        .order("workspace_version").order("event_index");
      if (error) return Response.json({ error: error.message }, { status: 400, headers: cors });
      return Response.json({ events: data }, { headers: cors });
    }
    if (request.method === "POST" && segments[3] === "changes") {
      const body = await request.json();
      const { data, error } = await supabase.rpc("apply_workspace_changes", {
        p_workspace_id: workspaceId,
        p_transaction_id: body.transactionId,
        p_actor: body.actor || {},
        p_changes: body.changes,
      });
      if (error) return Response.json({ error: error.message, code: error.code }, { status: error.code === "40001" ? 409 : 400, headers: cors });
      return Response.json(data, { headers: cors });
    }
    if (request.method === "GET" && !segments[3]) {
      const [{ data: workspace, error: workspaceError }, { data: entities, error: entitiesError }] = await Promise.all([
        supabase.from("workspace_projects").select("id,local_id,name,schema_version,workspace_version,updated_at").eq("id", workspaceId).single(),
        supabase.from("workspace_entities").select("collection,entity_id,parent_entity_id,entity_version,document").eq("workspace_id", workspaceId),
      ]);
      const error = workspaceError || entitiesError;
      if (error) return Response.json({ error: error.message }, { status: workspaceError ? 404 : 400, headers: cors });
      return Response.json({ workspace, entities }, { headers: cors });
    }
  }
  if (url.pathname.startsWith("/api/boards")) return Response.json({ error: "Legacy Board API is migration-only. Use /api/workspaces." }, { status: 410, headers: cors });
  return Response.json({ error: "Not found" }, { status: 404, headers: cors });
}

function toRequest(req) {
  const origin = `http://${req.headers.host || `127.0.0.1:${port}`}`;
  const init = { method: req.method, headers: req.headers };
  if (!["GET", "HEAD"].includes(req.method || "GET")) init.body = req, init.duplex = "half";
  return new Request(new URL(req.url || "/", origin), init);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
    if (req.url === "/health") { res.writeHead(200, cors); res.end(JSON.stringify({ ok: true })); return; }
    const response = await api(toRequest(req));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.writeHead(500, cors);
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(port, "127.0.0.1", () => process.stdout.write(`My Whiteboard semantic cloud API listening on http://127.0.0.1:${port}\n`));
