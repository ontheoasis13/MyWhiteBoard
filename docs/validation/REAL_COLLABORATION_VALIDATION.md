# My Whiteboard 0.2 Real Collaboration Validation

## Frozen baseline

- Validation date: 2026-08-14 (Asia/Shanghai)
- Source branch: `agent/workspace-v0.2`
- Frozen commit: `9e900af7c51866b38e6ec5955c7233a7c18aa1ed`
- Frozen tag: `v0.2.0-alpha.1` -> `9e900af7c51866b38e6ec5955c7233a7c18aa1ed`
- Source baseline tag: `beta5-source-baseline` -> `4d20c3a1707d0e6237d8d915b0f880bfee0d5877`
- Pull request: #1, open Draft, base `main`, mergeable, no checks reported
- Validation project: `Complex AI Workbench`
- Rule: do not move `v0.2.0-alpha.1`, mark PR ready, or merge `main` during validation.

## Failure classification protocol

Every failure is classified before any code change:

1. Client
2. MCP
3. Core
4. Board/UI
5. Persistence
6. Test Procedure

The record must include the observed symptom, reproduced boundary, root cause, decision, change (if any), and retest result.

## Stage results

| Stage | Status | Evidence summary |
| --- | --- | --- |
| 1. Single-Agent | Pass | Real Codex used only My Whiteboard MCP for workspace operations. Final Workspace v10; Board `architecture-workbench` v3; 4 Contexts, 5 Tasks, 2 Decisions, 4 Artifacts, 1 Agent, 27 events. Temporary Task and element were versioned and deleted. Delta from v3 returned 21 events. Independent JSON audit matched the MCP result. Full automated suite: 19/19 pass. |
| 2. Human Edit | Pass | A real user moved and renamed `acceptance-parallel-a` (v4, `Parallel A — 人工编辑完成`), created rectangle `NoPphwNzk-g19bpjUg9fU` (v1), deleted `human-delete-test`, and created standalone text `NtRpRLfKWb0b8JgsjX0h4` (`Human-created node`, v9). Codex re-read the authoritative MCP Delta and Board at Workspace v75 / Board v26. No automation was substituted for the human actions. |
| 3. Codex + WorkBuddy | Pass | Real WorkBuddy restarted, synchronized as independent Agent `workbuddy-validation-agent`, and consumed full structured Workspace data through MCP only. It accepted Handoff `codex-to-workbuddy-ui-ux`, moved Task `task-workbuddy-ui-ux` through `in_progress` to `done`, created one review Context, six Board elements, one proposed Decision, completed the Handoff, and sent a response through Workspace v40. Codex independently re-read the exact nine-event v31→v40 Delta, accepted the Decision at v41, and sent the closing response at v42. |
| 4. Conflict / Delta | Pass with real WorkBuddy | WorkBuddy captured both target elements at v2 in Phase A. Codex advanced only `acceptance-conflict-target` to v3 at Workspace v47. WorkBuddy's stale `expectedVersion: 2` write was rejected at the unchanged v51 baseline with no event, while its unrelated `acceptance-parallel-b` v2→v3 update succeeded at v52. Final v46→v55 Delta contained exactly nine ordered committed events; Board v13 preserved the Codex target and WorkBuddy parallel update. Task and Handoff both completed at v3, and Codex independently re-read and accepted the result at Workspace v56. |
| 5. Restart | Pass | Standalone runtime PID 36824 was stopped and a new PID 28444 started. New session restored Workspace v25 with an identical persisted SHA-256, and Codex reconnected without losing domain state. Real WorkBuddy later restarted its connector and continued collaboration. Human Edit exposed a separate launcher-lifetime defect; the Web Workspace is now detached from the MCP process, covered by a cross-process HTTP/API regression, and remained writable through Workspace v75. |
| 6. Legacy Migration | Pass | A real Beta 5 board (`board-1786671433667`) was migrated in an isolated project. All 21 IDs, text, positions, and 10 connections matched; source/copy/archive hashes were identical; second import was idempotently skipped at Workspace v2. Excalidraw projection contained all 21 IDs and 10 edges. Source had no code/risk/test metadata, so none could be lost. |
| 7. Alpha Release Candidate Report | Complete; all acceptance gates pass | Codex, real WorkBuddy, Human Edit, conflict, Delta, restart, migration, packaging, and test gates pass. Keep Draft and preserve the frozen tag only because release controls explicitly require it. |

## Final Human Edit checkpoint

- Baseline: Workspace v56; Human Edit re-read checkpoint before standalone text was v64 / Board v17.
- Move and rename: `acceptance-parallel-a` is v4 at its human position with label `Parallel A — 人工编辑完成`.
- Create shape: `NoPphwNzk-g19bpjUg9fU` is a human-created node at v1.
- Delete: `human-delete-test` is absent from authoritative Board state.
- Create text: `NtRpRLfKWb0b8JgsjX0h4` is an independent text element labelled `Human-created node` at v9.
- Final state: Workspace v75; Board `architecture-workbench` v26; final selection v14 / empty.
- Delta from v64: 11 ordered events (nine Board commits for text creation/editing and two selection events). The intermediate per-keystroke text versions are durable, ordered, and converge on the exact final label.

## Final real WorkBuddy conflict checkpoint

- Workspace: v56 after Codex acceptance response.
- Board: `architecture-workbench` v13.
- Conflict target: `acceptance-conflict-target` v3, Codex label preserved.
- Independent target: `acceptance-parallel-b` v3, WorkBuddy label committed.
- Rejected stale write: Workspace remained v51 with five events before and after; no failed-write event exists.
- Committed Phase B Delta: nine ordered events from v47 through v55.
- Task: `task-workbuddy-conflict-delta` v3 / `done`.
- Handoff: `codex-to-workbuddy-conflict-delta` v3 / `completed`.
- WorkBuddy response: `message-bb823a97` v1; Codex acceptance response: `message-codex-conflict-delta-accepted` v1.

## Failure log

### VAL-001 — Codex validation launcher rejected arguments

- Stage: Single-Agent preflight
- Classification: Test Procedure
- Symptom: the background Codex process exited before producing any session event; PowerShell reported an invalid `name` argument.
- Reproduced boundary: Codex never started and no MCP call occurred.
- Root cause: `Start-Process -ArgumentList` flattened the repository path containing spaces, so the CLI received malformed arguments.
- Decision: no product code change. Relaunch with an encoded PowerShell command so the working-directory argument remains intact.
- Retest: The encoded launch did start successfully, but its redirected output was checked before the child process had finished. A second foreground session was then started and briefly overlapped it, producing two Codex Agent identities. This remains a Test Procedure issue; neither client bypassed MCP and both stopped before their rejected Context batches committed. Future stages use one foreground process with an explicit completion wait.

### VAL-002 — Codex supplied structured objects to `contexts.sources`

- Stage: Single-Agent
- Classification: Client (with a discoverability weakness in the MCP/skill contract)
- Symptom: two independently started Codex clients both sent code-reference objects in `contexts.sources`; `context_apply` returned `VALIDATION_ERROR` and committed none of the batch.
- Reproduced boundary: MCP transport and dispatch succeeded. Core validation rejected the invalid entity before persistence; Workspace v2/v3 contained no Context records, confirming atomic rejection.
- Root cause: the clients conflated the documented Board `properties.code` object with Context `sources`, whose Core contract is `string[]`. The MCP tool schema exposes only a generic `entity` object and the skill reference does not document Context fields, which made the client mistake easier, but Core behaved correctly.
- Decision: do not change Core. Correct the validation prompt to keep structured code references on Board elements and use repository path strings for Context sources. Record richer MCP schema documentation as a release-candidate observation rather than expanding scope during this gate.
- Change: Test Procedure prompt only.
- Retest: Pass. A single real Codex process completed 17 MCP calls with zero failed calls. Context sources are strings; six structured code references are stored on Board elements. No Core change was required.

### VAL-003 — Opening the Web Workspace rewrote projected Board data

- Stage: Human Edit preflight
- Classification: Board/UI
- Symptom: opening `architecture-workbench` without an intentional edit advanced Workspace v10 -> v12 and Board v3 -> v4. The transaction rewrote 12 elements with Excalidraw-normalized line wrapping, dimensions, style defaults, and fractional edge geometry. Selection initialization accounted separately for Workspace v11.
- Reproduced boundary: `workspace_get_changes(since_version: 10)` showed the write actor as `human / web-workspace`; MCP and Core accepted a syntactically valid Board transaction, and Persistence durably recorded it. The write originated in the Web Workspace `onChange` lifecycle.
- Root cause: the UI ignored only the first Excalidraw `onChange`. Hydration emits more than one normalized scene, and the adapter compares that normalized scene directly with semantic geometry, so a later hydration callback appeared to be a user edit. The UI had no user-intent gate or hydrated-scene baseline.
- Decision: fix the Board/UI boundary, not Core. Gate persistence on real pointer/keyboard interaction, retain the last hydrated Excalidraw scene as a baseline, and persist only semantic IDs whose scene representation changed from that baseline. Preserve unwrapped labels through Excalidraw `originalText`.
- Change: `excalidrawSceneToSemanticChangesSince` now compares semantic-ID scene signatures against the hydrated baseline and preserves `originalText`. The UI requires real pointer/keyboard intent before persistence and advances its hydration baseline after successful/no-op saves. Added adapter regression coverage.
- Retest: Preflight pass. Opening the fixed Web Workspace at Workspace v15 did not change Workspace or Board Version. After adding the dedicated human-delete fixture (Workspace v16 / Board v6), the final Chinese build was cleanly reloaded at Workspace v21 and produced zero further events. Intentional move/rename/create/delete remains the manual portion of this stage.

### VAL-004 — Standalone workspace test expected the retired English page title

- Stage: Human Edit UI localization
- Classification: Test Procedure
- Symptom: typecheck and production build passed, while the full suite reported 19/20 because the HTTP test expected `My Whiteboard Workspace` after the approved Chinese UI changed the title to `My Whiteboard 工作区`.
- Reproduced boundary: the token-protected page returned HTTP 200 with the required CSP and the expected localized HTML; only the literal title assertion failed.
- Root cause: the test fixture encoded the previous English interface copy.
- Decision: update the acceptance assertion; no Product, MCP, Core, or Persistence change.
- Retest: Pass. Full suite 20/20.

### VAL-005 — Visible-tab selections advanced Workspace Version during UI inspection

- Stage: Human Edit preflight
- Classification: Test Procedure
- Symptom: Workspace advanced v16 -> v21 while the board remained v6.
- Reproduced boundary: Delta contained only five `selection.updated` events (four visible-tab user selections and one selection clear during automated reload), with no `board.apply` event.
- Root cause: the visible interactive tab was selected while UI localization work and automated reload inspection were in progress. Selection is a versioned collaboration entity, so these actions correctly advanced Workspace Version without changing Semantic Board content.
- Decision: retain the selection events as valid audit history. Use Board Version plus Delta event types to distinguish UI inspection from Board mutation.
- Retest: Pass. From Workspace v21, a clean final reload produced zero events; Board remained v6.

### VAL-006 — WorkBuddy is configured but not callable from this Codex environment

- Stage: Codex + WorkBuddy
- Classification: Client
- Symptom: WorkBuddy MCP configuration contains `my-whiteboard`, but no WorkBuddy CLI executable is available to this process.
- Reproduced boundary: local command discovery found the MCP registration and no callable `workbuddy`, `wb`, or `workbuddy-cli` entry. The earlier real WorkBuddy session independently proved trusted MCP transport at Workspace v9 in `workbuddy-whiteboard-acceptance`.
- Root cause: WorkBuddy is an interactive external client account, not an automation surface exposed to this Codex session.
- Decision: do not impersonate WorkBuddy or call Core directly as WorkBuddy. Continue independent technical gates and keep the current-project WorkBuddy closed loop pending.
- Retest: Pass. A real WorkBuddy session joined `Complex AI Workbench`, completed the current-project Handoff and UI/UX work, and exchanged versioned messages with Codex through Workspace v42.

### VAL-007 — Current project had no legacy migration fixture

- Stage: Legacy Migration
- Classification: Test Procedure
- Symptom: `legacy_discover` returned zero files in the current repository.
- Reproduced boundary: `.codex/whiteboards` was absent; importer did not run and no migration state changed.
- Root cause: the real Beta 5 boards live in `C:\Users\NCKZ\Documents\My Whiteboards`, outside the v0.2 validation repository.
- Decision: copy one real Beta 5 file into a unique isolated validation project, record source/copy hashes, and run only the official discovery/import tools there.
- Retest: Pass. See Stage 6 evidence; original source hash remained unchanged.

### VAL-008 — Adapter QA launcher contained malformed tool arguments

- Stage: Legacy Migration
- Classification: Test Procedure
- Symptom: the one-off read-only Node projection command failed to parse before starting.
- Reproduced boundary: no product module executed and no filesystem state changed.
- Root cause: the wrapper call placed execution metadata inside the command string.
- Decision: correct only the launcher syntax.
- Retest: Pass. Semantic 21 elements projected to 21 Excalidraw elements with 10 edges and zero missing IDs.

### VAL-009 — Local plugin reinstall initially selected the stale personal marketplace

- Stage: Alpha RC packaging
- Classification: Test Procedure
- Symptom: `my-whiteboard@personal` resolved to old v0.1 source at `C:\Users\NCKZ\plugins\my-whiteboard` instead of the current repository.
- Reproduced boundary: plugin list showed two local marketplaces with different source paths and versions; source code and Git state were unchanged.
- Root cause: the default personal marketplace name was used before confirming its entry pointed at the current source.
- Decision: remove the stale installed `@personal` copy and reinstall from the repository's `my-whiteboard` marketplace.
- Retest: Pass. The latest installed root is `0.2.0-alpha.1+codex.20260814092814`; Workspace asset, MCP config, and skill are present. Plugin/skill validation, typecheck, build, 23/23 tests, and the 28-tool stdio smoke test pass.

### VAL-010 — GitHub CLI was unavailable for the final PR check

- Stage: Alpha RC report
- Classification: Test Procedure
- Symptom: the local shell could not resolve `gh`.
- Reproduced boundary: local branch and tag checks succeeded; only the optional CLI PR query failed.
- Root cause: GitHub CLI is not installed in this environment.
- Decision: use the connected GitHub application for the required read-only PR metadata query.
- Retest: Pass. PR #1 is open, Draft, mergeable, and not merged; remote head and frozen tag remain `9e900af`.

### VAL-011 — WorkBuddy received only one-line MCP summaries

- Stage: WorkBuddy Context Read
- Classification: MCP compatibility
- Symptom: real WorkBuddy successfully called `agent_sync`, `workspace_get`, `project_get`, `workspace_get_changes`, and `messages_get` at Workspace v27, but received only summary strings such as `Workspace v27.` It could count 44 events and zero messages but could not access Context, Board, Task, Decision, Artifact, or Agent bodies or its own Entity Version.
- Reproduced boundary: independent persisted-state audit confirmed `workbuddy-validation-agent` v1 plus 4 Contexts, 1 Board, 5 Tasks, 2 Decisions, 4 Artifacts, and 2 Agents. Codex could read those objects from the same MCP result's `structuredContent`, proving Core and Persistence were complete. WorkBuddy consumed only the standard text content portion.
- Root cause: the shared MCP result helper put the complete object only in optional `structuredContent`; `content.text` contained a one-line human summary. The implementation assumed every client surfaced `structuredContent`, which violated the Agent-neutral interoperability goal.
- Decision: fix the MCP response boundary, not Core or WorkBuddy. Every tool now retains `structuredContent` and also appends an exact pretty-printed JSON representation after `Structured result (JSON):` in `content.text`.
- Retest: Pass in real WorkBuddy. After connector restart, `agent_sync` and `workspace_get` both exposed `Structured result (JSON):`; WorkBuddy reported Workspace v28, its own Entity Version 2, and exact counts/details for 4 Contexts, 1 Board, 5 Tasks, 2 Decisions, 4 Artifacts, and 2 Agents using MCP only. Internal suite is now 22/22 and the real stdio 28-tool smoke test also passes.

### VAL-012 — WorkBuddy initially used ambiguous Board and Task change forms

- Stage: Codex + WorkBuddy UI/UX collaboration
- Classification: Client, with MCP schema discoverability weakness
- Symptom: WorkBuddy first sent a Board create change without the required nested `element` object, then used Task status `completed` instead of `done`.
- Reproduced boundary: MCP/Core rejected both requests with validation errors before any transaction committed. Workspace Version did not advance and Persistence contained no partial or dirty state.
- Root cause: the client inferred shapes from generic MCP input schemas. `board_apply.changes.items` was only declared as an arbitrary object, and `tasks_apply` did not expose its status enum or explain that `completed` belongs to Handoffs.
- Decision: retain strict Core validation and improve the Agent-neutral MCP contract. Board create now explicitly requires `{ op: "create", element: {...} }`; Board update/delete expose camelCase `expectedVersion`; Task create/update expose `todo | in_progress | blocked | done | cancelled`, with `completed` explicitly excluded.
- Retest: WorkBuddy corrected both calls through MCP and completed all intended writes through Workspace v40. New schema regression passes; typecheck, build, 22/22 tests, 28-tool stdio smoke, plugin validation, and skill validation pass.

### VAL-013 — Active plugin cache initially lacked the built Workspace asset

- Stage: Human Edit
- Classification: Client lifecycle / packaging activation
- Symptom: the first post-update launch attempted to open `assets/workspace/index.html` from an older active cache and returned `ENOENT` / blocked content.
- Reproduced boundary: the active cache path was the older package and did not contain the requested built asset; current source and the newly built package did contain it. No MCP/Core/Persistence operation ran.
- Root cause: Codex retained the previously activated plugin cache until a full application restart.
- Decision: do not change Core or Board state. Rebuild, cache-bust, reinstall, and restart Codex so the new package becomes active.
- Retest: Pass. The current installed package contains the Workspace assets and its token-protected page returns HTTP 200.

### VAL-014 — Web Workspace process died while the page remained open

- Stage: Human Edit
- Classification: Client / MCP lifecycle
- Symptom: the user completed the intended text visually, but the header showed `保存失败`; the page reported `Failed to fetch`, and its loopback port was no longer listening.
- Reproduced boundary: Workspace remained v64 and no text element or Delta event existed, proving the request never reached MCP, Core, or Persistence and produced no dirty state.
- Root cause: `workspace_open` hosted HTTP inside the MCP server process. Connector turnover ended that process while leaving the stale browser page visible.
- Decision: detach the standalone Web Workspace runtime from the MCP process, give it a bounded idle lifetime, and refresh the idle deadline on HTTP activity.
- Change: added `server/workspace-launcher.mjs`, extended `scripts/workspace-server.mjs` for detached startup/lifetime handling, and routed `workspace_open` through the launcher. Added a regression that verifies a distinct runtime PID plus authorized page/API access.
- Retest: Pass. The replacement runtime remained available across the next user turn; the user created `Human-created node`, which Codex re-read at Workspace v75 / Board v26.

### VAL-015 — Lifecycle regression expected the wrong initial Workspace Version

- Stage: Human Edit lifecycle fix
- Classification: Test Procedure
- Symptom: the new detached-runtime test failed because it expected Workspace v1 after initializing both a Project and a Board.
- Reproduced boundary: the returned v2 was correct: Project creation and Board creation are two committed transactions.
- Root cause: the new assertion counted only one initialization transaction.
- Decision: correct the test expectation; no product change.
- Retest: Pass. Targeted HTTP tests are 2/2; full suite is 23/23.

### VAL-016 — Final quality command started from the marketplace root

- Stage: Final Alpha RC quality gate
- Classification: Test Procedure
- Symptom: the first final command could not find `package.json` or `scripts/smoke-test.mjs`.
- Reproduced boundary: the command ran from the marketplace repository root, while the Node package lives under `plugins/my-whiteboard`; no product test or build had started.
- Root cause: the final orchestration used the repository directory instead of the plugin package directory.
- Decision: change only the working directory and rerun with fail-fast exit checks.
- Retest: Pass. Typecheck, 23/23 tests, production build, 28-tool stdio Smoke, plugin validation, and skill validation all pass from the correct package root.
