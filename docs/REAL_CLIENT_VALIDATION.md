# Real Client Validation

Date: 2026-08-14

## Codex CLI

- Version: `codex-cli 0.144.3`
- Loaded the current source MCP directly.
- Created a real Workspace, `codex` and `claude` Agent identities, Task `integration-task`, and Handoff `codex-to-claude-real`.
- Final Handoff state: `open`, Entity Version `1`.
- The run exposed an overly broad domain-change Schema; the Schema was tightened afterward and the 28-tool smoke test passed again.

## Claude Code

- Version: `2.1.175`
- MCP configuration was prepared for the same Workspace.
- Both an overriding API key and the stored OAuth credential returned `401 Invalid token` before any MCP call.
- Required follow-up: run `claude auth login`, then repeat the accept/message scenario in `BETA_TESTING.md`.

This document deliberately distinguishes a plugin result from an external authentication blocker.
