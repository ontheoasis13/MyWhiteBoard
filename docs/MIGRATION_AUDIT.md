# My Whiteboard 0.2 Migration Audit

Date: 2026-08-14

Baseline: `beta5-source-baseline` (`04021e86e37b774fb6ff3fc335b5443cb687fc0c`)

The complete local Beta 5 source is the source of truth. The earlier GitHub upload is preserved in Git history but is not used as the implementation baseline because it omitted hidden plugin and marketplace files.

## Current architecture

- A Codex marketplace package under `plugins/my-whiteboard`.
- A single Node.js stdio MCP server in `scripts/server.mjs` also hosts a loopback HTTP editor.
- A geometry-first board document with seven element types and optional code metadata.
- Personal boards under `Documents/My Whiteboards` and project boards under `<project>/.codex/whiteboards`.
- Atomic JSON replacement plus per-revision JSON snapshots.
- An SVG/DOM browser editor with selection, grouping, layout, history, export, and optional Supabase sync.
- Optional Supabase board/member/version/share tables with RLS and Realtime board-document updates.
- One smoke test covering the 19 MCP tools and JSON/SVG/PNG output.

## KEEP

- MCP transport and the agent-to-whiteboard tool concept.
- Codex plugin packaging as one client adapter.
- Local-first operation with no account requirement.
- Project source scanning and relative-import graph generation.
- Code references: file, symbol, line, status, risk tags, and test references.
- Selection context as an agent input.
- JSON, SVG, and PNG export capability.
- Local revision snapshots as a recovery mechanism.
- Supabase authentication, RLS, membership, sharing, and Realtime foundations.
- Existing board files as immutable migration inputs.

## REFACTOR

- Split the monolithic MCP/HTTP server into Agent-neutral Core, persistence, MCP adapter, and Web Workspace modules.
- Make Project the root aggregate instead of Board.
- Replace board revision-only writes with Workspace Version plus Entity Version.
- Replace in-memory-only selection with persisted board selection context.
- Replace full-document cloud updates with version-checked workspace transactions.
- Convert the Codex-specific skill into an Agent-neutral workflow with a Codex distribution wrapper.
- Turn the current snapshot history into recovery snapshots backed by an authoritative event log.
- Move new project data to `<project>/.my-whiteboard` while preserving import compatibility.

## REPLACE

- Replace the active SVG/DOM canvas with an Excalidraw adapter and standalone Web Workspace.
- Replace geometry-first agent operations with a Semantic Board State and semantic batch operations.
- Replace individual board-centric cloud tables as the top-level model with project/workspace entities.
- Replace Last Writer Wins updates with object-level optimistic concurrency.

## REMOVE OR DEPRECATE

- Remove forced iframe/output-template rendering from the active plugin path.
- Deprecate `.codex/whiteboards` as a destination for newly created boards.
- Remove Codex-specific assumptions from Core and persistence.
- Do not persist Excalidraw scene JSON as an independent authority.
- Do not maintain live bidirectional synchronization among Legacy Canvas, Semantic Board, and Excalidraw.
- Deprecate legacy board mutation tools after compatibility wrappers and migration tests are available.

## Gaps against the 0.2 target

- No Project aggregate, Shared Context, Task, Decision, Artifact, Agent, Handoff, or Project Message entities.
- No Semantic Board IR.
- No Event Log or Delta Context.
- No entity-level expected-version checks.
- No safe multi-process transaction lock.
- No Excalidraw adapter or React workspace.
- No Claude Code setup or real two-agent integration test.
- No UI or browser automation tests.
- No migration fixture suite.

## Baseline test result

- MCP smoke test: passed.
- Plugin manifest validation: passed.
- Whiteboard skill validation: passed.
- MCP server and browser JavaScript syntax: passed.
- Cloud server syntax check: passed.
- Real Codex + Claude integration: not yet run.
- Concurrent write test: not yet implemented.

## Principal risks

1. Excalidraw change events are geometric; careless persistence would make Excalidraw JSON a second authority.
2. File-based optimistic concurrency requires an inter-process lock around read/compare/write.
3. Existing `.codex/whiteboards` files must never be silently overwritten or deleted during migration.
4. A single workspace file will eventually need event-log compaction, but premature distributed storage would slow the first correct implementation.
5. Cloud schema changes must be additive until local and cloud migration tests pass.

