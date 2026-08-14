import path from "node:path";
import { createWorkspaceHttpService } from "../server/workspace-http.mjs";

const projectRoot = path.resolve(process.argv[2] || process.cwd());
const boardId = process.argv[3] || null;
const service = createWorkspaceHttpService();
const opened = await service.openWorkspace({ projectRoot, boardId, name: path.basename(projectRoot), actor: { id: "manual", client: "browser" } });
process.stdout.write(`${JSON.stringify(opened)}\n`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await service.stop();
    process.exit(0);
  });
}
