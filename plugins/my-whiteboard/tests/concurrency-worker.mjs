import { applyWorkspaceTransaction } from "../core/index.mjs";

const [projectRoot, actor] = process.argv.slice(2);
try {
  const result = await applyWorkspaceTransaction(projectRoot, {
    actor,
    operations: [{ type: "entity.update", collection: "tasks", id: "shared", expectedVersion: 1, patch: { assignee: actor } }],
  });
  process.stdout.write(JSON.stringify({ ok: true, workspaceVersion: result.workspaceVersion }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, code: error.code, details: error.details }));
}
