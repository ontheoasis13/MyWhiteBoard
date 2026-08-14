# Real Single-Agent Workspace validation

Work inside this repository and perform the first formal validation stage for My Whiteboard 0.2.

Hard constraints:

- This is a real Codex client acceptance test. Use the installed `my-whiteboard` MCP tools for every workspace read and mutation.
- Do not import or call the Core modules directly. Do not use Node, PowerShell, curl, HTTP, or filesystem writes as a fallback for whiteboard operations.
- You may inspect repository source files read-only to create accurate code references.
- Use the current My Whiteboard skill and Semantic Board State workflow.
- Do not modify application source code, Git tags, PR state, or Git branches.
- Do not start WorkBuddy or multi-agent testing.
- If an MCP operation fails, stop mutating the workspace and report the exact tool, input category, error, and likely boundary (Client / MCP / Core / Board/UI / Persistence / Test Procedure). Do not repair it.
- Use exactly one connected Agent identity: `codex-validation-agent` (`client: Codex`). If another Agent is already present, stop and report that the workspace was not fresh.

Create a fresh project named `Complex AI Workbench` rooted at the current repository. Connect a Codex Agent identity first, then build a useful single-agent workspace that describes My Whiteboard itself as a complex AI coding workbench.

Acceptance content:

1. Project: create and read it back.
2. Shared Context: add distinct durable records for Goal, Requirements, Current State, and Open Questions. Context `sources` is strictly an array of repository path strings, never objects.
3. Tasks: exercise create, read, update/status, assignment to the connected Codex Agent, and dependencies. Use at least five meaningful tasks. Include one temporary task and delete it with its current entity version so delete behavior is verified.
4. Decisions: add at least two architectural decisions with rationale.
5. Board: create one architecture board with stable semantic IDs. In one or more batch operations, add sections/nodes/edges that show Client -> Agent-neutral MCP -> Core -> Semantic Board State -> Excalidraw Adapter and Persistence. Give the composition a readable layout. Exercise create, update with `expected_version`, and delete with `expected_version` on a temporary test element. Read the latest board back.
6. Code references: attach real repository references using `file`, `symbol`, `line`, `riskTags`, and `testRefs` inside Board element `properties.code`. Do not place structured code-reference objects in Context `sources`. Inspect the referenced files so the references are truthful.
7. Artifacts: register the architecture board and at least two relevant repository files/documents.
8. History and Delta: capture an early Workspace Version, then call `workspace_get_changes` from that cursor and finally read the latest full workspace.
9. Persistence: verify the final workspace can be read again through MCP in the same independent Codex process.

Use stable IDs and optimistic concurrency exactly as the skill requires. End with a compact machine-checkable summary containing: project ID, Codex Agent ID, final Workspace Version, board ID/version, counts for contexts/tasks/decisions/artifacts/agents/events, the deleted temporary entity IDs, delta cursor and delta event count, and PASS/FAIL for each numbered acceptance item.
