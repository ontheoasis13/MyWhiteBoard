# My Whiteboard 0.2 Alpha Release Candidate Report

## Outcome

**Acceptance complete — Keep Draft under frozen release controls.**

The Agent-neutral Core, Semantic Board State, standalone Chinese Web Workspace, persistence restart, real Beta 5 migration, packaging, Codex Single-Agent path, current-project Codex + WorkBuddy collaboration, real second-client Conflict / Delta replay, and real Human Edit have passed. No fake WorkBuddy or automated substitute was counted as a pass.

## Frozen release controls

- Branch: `agent/workspace-v0.2`
- Frozen commit and tag: `v0.2.0-alpha.1` -> `9e900af7c51866b38e6ec5955c7233a7c18aa1ed`
- PR #1: open, Draft, mergeable, not merged
- Current installed development package: `0.2.0-alpha.1+codex.20260814092814`
- Tag not moved; `main` not merged; PR not marked ready.

## 1. Single Agent Result

Pass. One real Codex process used only My Whiteboard MCP for workspace operations. It produced Project, Agent, four Contexts, five Tasks, two Decisions, four Artifacts, an architecture Board with stable IDs/code references, delete operations, Delta, and a durable MCP re-read. Final Single-Agent checkpoint was Workspace v10 / Board v3 before Human Edit preflight activity.

## 2. WorkBuddy Connection

Transport, current-project identity, and Context comprehension pass. A prior real WorkBuddy 5.3.5 session used `mcp__my-whiteboard__workspace_get`, synchronized to Workspace v9, accepted Handoff `codex-to-workbuddy` v1 -> v2, and sent `WorkBuddy acceptance passed`. In the fixed project, real WorkBuddy synchronized as `workbuddy-validation-agent` v1 at Workspace v27, restarted after the compatibility fix, and synchronized to v2 / Workspace v28.

The first current-project read revealed an MCP interoperability defect: WorkBuddy surfaced `content.text` but not `structuredContent`, while the server put full entities only in `structuredContent`. The server now includes the same complete JSON in both channels. Real WorkBuddy confirmed `Structured result (JSON):` and accurately explained the project, Codex work, Board, Tasks, Decisions, Artifacts, Agents, and pending gates without private chat or direct Core access.

## 3. Multi-Agent Result

Pass for the current project. Independent WorkBuddy Agent identity, transport, Context comprehension, write collaboration, and bidirectional messages are real. WorkBuddy accepted and completed Handoff `codex-to-workbuddy-ui-ux`, completed Task `task-workbuddy-ui-ux`, created Context `ctx-workbuddy-ui-review`, six semantic Board elements, and Decision `decision-workspace-navigation`, then replied at Workspace v40. Codex re-read the exact nine-event Delta, accepted the Decision at v41, and sent the closing response at v42.

## 4. Shared Context

Codex created Goal, Requirements, Current State, and Open Questions Contexts with repository-path sources. The first real WorkBuddy attempt correctly refused to invent a comprehension report because its client only received summaries. After the MCP text fallback fix, WorkBuddy read the full Workspace and produced a correct Context report using only `agent_sync` and `workspace_get`.

## 5. Handoff

Pass. WorkBuddy accepted the current-project Handoff at v2, completed it at v3 with a delivery summary, completed the related Task at v3, and sent a structured response referencing the Handoff, Task, Decision, Context, and Board. Codex independently verified every referenced entity and closed the loop with a response message.

## 6. Board Collaboration

- Found and fixed a Board/UI hydration defect that rewrote normalized Excalidraw geometry when the page opened.
- Added a hydrated-scene baseline and real user-intent gate.
- Clean final reload from Workspace v21 produced zero events and no Board change.
- Web Workspace shell and Excalidraw controls are Chinese (`zh-CN`).
- WorkBuddy added a UI/UX section with Project Navigation, Agent Panel, and Task Panel nodes plus navigation edges; Codex accepted the read-only navigation Decision without changing Semantic Board authority.
- Real Human Edit passed. The user moved and renamed `acceptance-parallel-a`, created rectangle `NoPphwNzk-g19bpjUg9fU`, deleted `human-delete-test`, and created standalone text `NtRpRLfKWb0b8JgsjX0h4` with label `Human-created node`.
- Codex re-read the authoritative MCP state at Workspace v75 / Board v26; the text is v9 and the moved node is v4.
- The first text attempt exposed a process-lifetime defect (`Failed to fetch`) before any write reached MCP. The detached Workspace launcher fixed it, and the successful retry produced an ordered, durable Delta with no dirty failed-write event.

## 7. Conflict

Pass through both the independent MCP validation client and real WorkBuddy:

- `acceptance-conflict-target` v1 was updated by Codex to v2.
- A second validation client attempted `expectedVersion=1` and received `VERSION_CONFLICT`.
- The rejected write did not advance Workspace v23 and did not overwrite Codex.
- `acceptance-parallel-a` and `acceptance-parallel-b` were independently updated to v2 through Workspace v24 and v25; no global Workspace lock caused a false conflict.

For the coordinated real replay, WorkBuddy synced to Workspace v46, captured `acceptance-conflict-target` v2 and `acceptance-parallel-b` v2, confirmed the explicit Board change Schema, and stopped without writing. Codex advanced only the conflict target to v3 at Workspace v47 / Board v12. At Workspace v51, WorkBuddy attempted its captured `expectedVersion: 2` and received `VERSION_CONFLICT`; an immediate Delta reread remained v51 with the same five events, proving no dirty commit. WorkBuddy then updated the unrelated v2 element successfully at v52. Final Board v13 contains the Codex target at v3 and WorkBuddy parallel element at v3. Task and Handoff completed at v3, WorkBuddy replied at v55, and Codex independently accepted the result at v56.

## 8. Delta

- Cursor: Workspace v21
- Latest technical checkpoint: Workspace v25
- Returned events: 4 ordered `board.elements.applied` events
- Delta structured payload: 3,128 bytes
- Full Workspace structured payload: 18,191 bytes
- Delta/full ratio: approximately 17.2%
- Rejected stale write did not appear in Delta.

This validates Workspace Version for ordered change feeds and Entity Version for object concurrency as separate mechanisms.

Real WorkBuddy Delta evidence:

- Cursor: Workspace v46.
- Pre-conflict baseline: Workspace v51 / five events.
- Post-rejection baseline: still Workspace v51 / the same five events.
- Final committed replay: Workspace v55 / nine ordered events from v47 through v55.
- The stale WorkBuddy target label never appears in Delta.
- The unrelated WorkBuddy update appears once at v52.

## 9. Persistence

Codex-side restart pass:

- Stopped standalone runtime PID 36824.
- Started a new runtime PID 28444 with a new session.
- Restored Workspace v25, Board v10, 18 Board elements, five Tasks, two Decisions, one Agent, and 42 events.
- Persisted Workspace SHA-256 was unchanged across restart.
- `agent_sync(since_version=25)` reconnected Codex and refreshed Agent presence at Workspace v26 without losing domain state.

Real WorkBuddy connector restart pass: after the MCP text fallback update, WorkBuddy restarted, recovered the same current project at Workspace v28, and continued collaboration without direct Core or file access.

Web Workspace lifecycle pass: the user-visible HTTP runtime is now a detached bounded-idle process rather than a child lifetime tied to the MCP connector. A regression verifies the distinct PID and authorized page/API access; the real Human Edit retry remained writable across turns and committed through Workspace v75.

## 10. Legacy Migration

Pass using real Beta 5 source `board-1786671433667.whiteboard.json`:

- 21/21 Element IDs preserved.
- Text preserved exactly (the selected source intentionally contains empty labels).
- Positions and dimensions preserved exactly.
- 10/10 connections and point lists preserved.
- Source file, isolated test copy, and archived import copy share the same SHA-256.
- Second import returned `skipped` and kept Workspace v2.
- Semantic Board projected to 21 Excalidraw elements with 10 edges and zero missing IDs.
- The source contained no code metadata, risk tags, or test references; these fields were therefore not available to test for non-empty preservation.

## 11. Efficiency Metrics

- Final validation Workspace: 5 Contexts, 1 Board, 7 Tasks, 3 Decisions, 4 Artifacts, 2 Agents, 2 Handoffs, and 7 Messages at Workspace v75; Board v26 includes the completed Human Edit artifacts.
- Single-Agent checkpoint: 4 Contexts, 5 Tasks, 2 Decisions, 4 Artifacts, 1 Agent.
- Delta: 3,128 bytes versus 18,191-byte full Workspace.
- Current technical Delta required one incremental read and no unnecessary full Event Log transfer.
- WorkBuddy first successful full read used two MCP calls (`agent_sync`, `workspace_get`); its completed UI/UX collaboration produced nine ordered v31→v40 events and a high-quality Handoff completion summary without requesting private chat context.
- Real WorkBuddy Conflict / Delta used a v46 cursor, proved an unchanged five-event baseline across rejection, and recovered all nine committed events without a full Event Log reread.

## 12. Bugs Found

- Web Workspace hydration wrote Excalidraw normalization back into Semantic Board State.
- MCP/skill discoverability allowed clients to confuse Context string sources with structured Board code references.
- MCP responses assumed clients surfaced optional `structuredContent`; real WorkBuddy exposed only the one-line text summary.
- Generic Board/Task MCP schemas allowed WorkBuddy to infer an invalid Board create wrapper and the wrong Task completion status; strict Core validation correctly rejected both atomically.
- English HTTP title assertion became stale after the approved Chinese UI requirement.
- Validation procedures exposed launcher quoting, visible-tab selection, missing legacy fixture, malformed QA wrapper, stale marketplace, and missing `gh` CLI issues.
- The Web Workspace HTTP runtime was tied to the MCP connector lifetime, leaving a stale visible page that could no longer save.

## 13. Fixes

- Added hydrated-scene signature diffing and user-intent gating.
- Preserved Excalidraw `originalText` for semantic labels.
- Added adapter regression coverage.
- Localized Workspace UI and Excalidraw controls to Chinese.
- Updated the HTTP localization assertion.
- Added complete JSON fallback to every MCP text result while preserving `structuredContent`, plus text-only client and real stdio regression coverage.
- Added explicit Board create/update/delete schemas and Task status enums/descriptions, plus schema regression coverage.
- Reinstalled the current plugin from the correct repository marketplace and removed the stale installed personal copy.
- Added a detached, bounded-idle Workspace launcher and a cross-process HTTP/API lifecycle regression.

## 14. Remaining Risks

- Selection-context efficiency is not measured yet; current-project Handoff quality now passes.
- Excalidraw production build still reports a non-blocking large-chunk warning.
- The validated fixes are local working-tree changes; the frozen tag and Draft PR head intentionally remain at `9e900af` until the remaining gates and user release decision.

## 15. Recommendation

**Keep Draft.**

All executable, real multi-client, and real Human Edit gates pass. Keep the current tag and PR frozen exactly as instructed: do not move `v0.2.0-alpha.1`, mark PR Ready, or merge `main`. The release candidate is acceptance-complete at the local working-tree level; publishing these fixes, moving a tag, or changing PR state remains a separate user-controlled release decision.
