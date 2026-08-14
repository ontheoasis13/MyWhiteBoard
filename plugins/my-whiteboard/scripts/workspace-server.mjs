import path from "node:path";
import { createWorkspaceHttpService } from "../server/workspace-http.mjs";

const projectRoot = path.resolve(process.argv[2] || process.cwd());
const boardId = process.argv[3] || null;
const name = process.argv[4] || path.basename(projectRoot);
let actor = { id: "manual", displayName: "User", client: "browser" };
try { actor = { ...actor, ...JSON.parse(process.argv[5] || "{}") }; } catch {}
const service = createWorkspaceHttpService();
const opened = await service.openWorkspace({ projectRoot, boardId, name, actor });
process.stdout.write(`${JSON.stringify({ ...opened, processId: process.pid })}\n`);

const idleMs = Math.max(1_000, Number(process.env.MY_WHITEBOARD_WORKSPACE_IDLE_MS || 4 * 60 * 60 * 1_000));
let idleTimer;
function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    await service.stop();
    process.exit(0);
  }, idleMs);
  idleTimer.unref();
}
service.server.on("request", resetIdleTimer);
resetIdleTimer();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    clearTimeout(idleTimer);
    await service.stop();
    process.exit(0);
  });
}
