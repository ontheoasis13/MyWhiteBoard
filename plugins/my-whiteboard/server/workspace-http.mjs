import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyWorkspaceTransaction,
  createProjectWorkspace,
  getChangesSince,
  importLegacyBoards,
  readWorkspace,
} from "../core/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_ROOT = path.join(ROOT, "assets", "workspace");
const BODY_LIMIT = 8 * 1024 * 1024;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function securityHeaders(contentType = "application/json; charset=utf-8") {
  return {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'",
  };
}

function sendJson(res, status, value) {
  res.writeHead(status, securityHeaders());
  res.end(JSON.stringify(value));
}

async function persistSelection(projectRoot, boardId, elementIds, actor) {
  const ids = [...new Set((Array.isArray(elementIds) ? elementIds : []).map(String))];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const workspace = await readWorkspace(projectRoot);
    const board = workspace.entities.boards[boardId];
    if (!board) throw Object.assign(new Error("Board not found."), { code: "NOT_FOUND", details: { boardId } });
    const validIds = ids.filter((id) => board.elements[id]);
    const current = workspace.entities.selections[boardId];
    if (current && JSON.stringify(current.elementIds || []) === JSON.stringify(validIds)) {
      return { selection: current, workspaceVersion: workspace.workspaceVersion, unchanged: true };
    }
    const operation = current
      ? { type: "entity.update", collection: "selections", id: boardId, expectedVersion: current.version, patch: { boardId, elementIds: validIds } }
      : { type: "entity.create", collection: "selections", entity: { id: boardId, boardId, elementIds: validIds } };
    try {
      const result = await applyWorkspaceTransaction(projectRoot, { actor, operations: [operation] });
      const next = await readWorkspace(projectRoot);
      return { selection: next.entities.selections[boardId], workspaceVersion: result.workspaceVersion, unchanged: false };
    } catch (error) {
      if (error?.code !== "VERSION_CONFLICT" || attempt === 2) throw error;
    }
  }
}

async function jsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(url, res) {
  const relative = url.pathname === "/workspace" || url.pathname === "/workspace/"
    ? "index.html"
    : decodeURIComponent(url.pathname.slice("/workspace/".length));
  const file = path.resolve(WEB_ROOT, relative);
  if (!(file === WEB_ROOT || file.startsWith(`${WEB_ROOT}${path.sep}`))) return false;
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    const body = await readFile(file);
    res.writeHead(200, { ...securityHeaders(MIME[path.extname(file).toLowerCase()] || "application/octet-stream"), "cache-control": relative === "index.html" ? "no-store" : "public, max-age=31536000, immutable" });
    res.end(body);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function createWorkspaceHttpService(options = {}) {
  const sessions = new Map();
  let port = null;
  const host = options.host || "127.0.0.1";

  function authorize(req) {
    const sessionId = String(req.headers["x-my-whiteboard-session"] || "");
    const token = String(req.headers["x-my-whiteboard-token"] || "");
    const session = sessions.get(sessionId);
    if (!session || token.length < 32 || token !== session.token) return null;
    return session;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port || 0}`}`);
      if (req.method === "GET" && url.pathname === "/api/health") return sendJson(res, 200, { ok: true, service: "my-whiteboard-workspace" });
      if (req.method === "GET" && url.pathname.startsWith("/workspace")) {
        if (await serveStatic(url, res)) return;
        res.writeHead(404, securityHeaders("text/plain; charset=utf-8"));
        res.end("Workspace asset not found");
        return;
      }
      if (url.pathname.startsWith("/api/session")) {
        const session = authorize(req);
        if (!session) return sendJson(res, 401, { error: { code: "UNAUTHORIZED", message: "Workspace session is invalid or expired." } });
        if (req.method === "GET" && url.pathname === "/api/session") {
          return sendJson(res, 200, { workspace: await readWorkspace(session.projectRoot), activeBoardId: session.boardId });
        }
        if (req.method === "GET" && url.pathname === "/api/session/changes") {
          return sendJson(res, 200, await getChangesSince(session.projectRoot, Number(url.searchParams.get("since") || 0)));
        }
        if (req.method === "POST" && url.pathname === "/api/session/transaction") {
          const body = await jsonBody(req);
          const result = await applyWorkspaceTransaction(session.projectRoot, body.transaction || body);
          return sendJson(res, 200, result);
        }
        if (req.method === "POST" && url.pathname === "/api/session/selection") {
          const body = await jsonBody(req);
          const boardId = String(body.boardId || session.boardId || "");
          return sendJson(res, 200, await persistSelection(
            session.projectRoot,
            boardId,
            body.elementIds,
            body.actor || { id: "human", displayName: "User", client: "web-workspace" },
          ));
        }
        if (req.method === "POST" && url.pathname === "/api/session/import-legacy") {
          return sendJson(res, 200, { results: await importLegacyBoards(session.projectRoot, await jsonBody(req)) });
        }
      }
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Route not found." } });
    } catch (error) {
      const status = error?.status || (error?.code === "VERSION_CONFLICT" ? 409 : error?.code === "NOT_FOUND" ? 404 : error instanceof SyntaxError ? 400 : 500);
      sendJson(res, status, { error: { code: error?.code || "INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error), details: error?.details || {} } });
    }
  });

  async function start() {
    if (port) return port;
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port || 0, host, () => resolve());
    });
    port = server.address().port;
    return port;
  }

  async function openWorkspace({ projectRoot, boardId, name, actor }) {
    await createProjectWorkspace(projectRoot, { name, actor });
    const currentPort = await start();
    const sessionId = randomUUID();
    const token = randomBytes(32).toString("base64url");
    sessions.set(sessionId, { projectRoot: path.resolve(projectRoot), boardId: boardId || null, token, createdAt: Date.now() });
    const url = new URL(`http://${host}:${currentPort}/workspace/`);
    url.searchParams.set("session", sessionId);
    url.searchParams.set("token", token);
    if (boardId) url.searchParams.set("board", boardId);
    return { url: url.toString(), sessionId, projectRoot: path.resolve(projectRoot), boardId: boardId || null };
  }

  async function stop() {
    sessions.clear();
    if (!server.listening) return;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    port = null;
  }

  return { start, stop, openWorkspace, server, sessions };
}
