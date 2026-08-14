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
  if (request.method === "GET" && url.pathname === "/api/boards") {
    const { data, error } = await supabase.from("whiteboard_boards").select("id,local_id,title,revision,updated_at").order("updated_at", { ascending: false });
    if (error) return Response.json({ error: error.message }, { status: 400, headers: cors });
    return Response.json({ boards: data }, { headers: cors });
  }
  if (segments[0] === "api" && segments[1] === "boards" && segments[2]) {
    const boardId = segments[2];
    if (request.method === "GET") {
      const { data, error } = await supabase.from("whiteboard_boards").select("*").eq("id", boardId).single();
      if (error) return Response.json({ error: error.message }, { status: 404, headers: cors });
      return Response.json(data, { headers: cors });
    }
    if (request.method === "PUT") {
      const body = await request.json();
      const { data, error } = await supabase.from("whiteboard_boards").update({ title: body.title, document: body.document, revision: body.revision, updated_at: new Date().toISOString() }).eq("id", boardId).select().single();
      if (error) return Response.json({ error: error.message }, { status: 400, headers: cors });
      return Response.json(data, { headers: cors });
    }
  }
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

server.listen(port, "127.0.0.1", () => process.stdout.write(`My Whiteboard cloud API listening on http://127.0.0.1:${port}\n`));
