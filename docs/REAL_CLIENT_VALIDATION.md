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
- Required follow-up: restart WorkBuddy, then repeat the accept/message scenario in `BETA_TESTING.md`.

Claude Code is not required for runtime or release acceptance. WorkBuddy is the selected second real client for this environment.
