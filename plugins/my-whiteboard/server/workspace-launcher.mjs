import { spawn } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const WORKSPACE_SERVER = fileURLToPath(new URL("../scripts/workspace-server.mjs", import.meta.url));

export async function launchStandaloneWorkspace(input, options = {}) {
  const actor = input.actor && typeof input.actor === "object" ? input.actor : {};
  const child = spawn(process.execPath, [
    WORKSPACE_SERVER,
    input.projectRoot,
    input.boardId || "",
    input.name || "",
    JSON.stringify(actor),
  ], {
    detached: true,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      MY_WHITEBOARD_WORKSPACE_IDLE_MS: String(options.idleMs || process.env.MY_WHITEBOARD_WORKSPACE_IDLE_MS || 4 * 60 * 60 * 1000),
    },
  });

  return await new Promise((resolve, reject) => {
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => finish(new Error("Standalone Workspace did not start in time.")), options.timeoutMs || 10_000);
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4_000); });

    function cleanup() {
      clearTimeout(timeout);
      lines.close();
      child.stdout.destroy();
      child.stderr.destroy();
      child.removeAllListeners();
    }

    function finish(error, opened) {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        try { child.kill(); } catch {}
        reject(error);
        return;
      }
      child.unref();
      resolve({ ...opened, processId: child.pid, detached: true });
    }

    child.once("error", (error) => finish(error));
    child.once("exit", (code) => finish(new Error(`Standalone Workspace exited before startup (${code}). ${stderr}`.trim())));
    lines.once("line", (line) => {
      try {
        finish(null, JSON.parse(line));
      } catch (error) {
        finish(new Error(`Standalone Workspace returned invalid startup data. ${stderr}`.trim(), { cause: error }));
      }
    });
  });
}
