# Real Client Validation

Date: 2026-08-14

## Codex CLI

- Version: `codex-cli 0.144.3`
- Loaded the current source MCP directly.
- Created a real Workspace, a `codex` identity plus a second-client placeholder identity, Task `integration-task`, and Handoff `codex-to-claude-real` through the actual Codex CLI.
- Final Handoff state: `open`, Entity Version `1`.
- The run exposed an overly broad domain-change Schema; the Schema was tightened afterward and the 28-tool smoke test passed again.

## WorkBuddy

- Version: `5.3.5`
- The installed desktop application contains standard MCP client and MCP Apps support.
- `my-whiteboard` was merged into `%USERPROFILE%\.workbuddy\.mcp.json`; the original configuration was backed up first.
- Verified client-side core workflow in `workbuddy-whiteboard-acceptance`: Agent sync reached Workspace Version `7`; Handoff `codex-to-workbuddy` changed from Version `1`/`open` to Version `2`/`accepted` at Workspace Version `8`; WorkBuddy sent `WorkBuddy acceptance passed` at Workspace Version `9`.
- The persisted Workspace was independently inspected and matches the WorkBuddy report.
- This run used direct Core module calls because the server was not activated in WorkBuddy's deferred-tool index. `%USERPROFILE%\.workbuddy\mcp-approvals.json` remained empty.
- Required follow-up: trust `my-whiteboard` in WorkBuddy connector management, start a new session, and repeat one read or write through the MCP Tool transport.

Claude Code is not required for runtime or release acceptance. WorkBuddy is the selected second real client for this environment. The Core/client closed loop has passed; MCP Transport acceptance is tracked separately.
