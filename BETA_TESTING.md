# Public Beta Testing Guide

Thank you for testing My Whiteboard. The goal of this beta is to validate installation, editing reliability, cross-device sync, sharing permissions, and Realtime collaboration.

## Before testing

1. Use test content only; do not enter confidential or regulated information.
2. Install the plugin from the repository root instructions.
3. Start a new Codex task after installing or updating.
4. For cloud tests, use an email address you control and complete the Supabase confirmation email.

## Core checklist

- [ ] Install succeeds without manually moving plugin files
- [ ] A new Codex task recognizes `$whiteboard-design`
- [ ] A board can be created, opened, edited, and reopened
- [ ] Multi-select, grouping, locking, alignment, layers, duplicate, undo, and redo work
- [ ] JSON, SVG, and PNG exports complete
- [ ] Local version history can list and restore a chosen revision
- [ ] Sign-up, confirmation, sign-in, and sign-out work
- [ ] A test board syncs to a second computer using the same account
- [ ] Viewer links cannot edit
- [ ] Editor links can edit
- [ ] Realtime changes appear on the second signed-in client
- [ ] Signed-out users cannot see private boards

## Reporting a problem

Open an issue at <https://github.com/ontheoasis13/MyWhiteBoard/issues> and include:

- A short title
- Windows, macOS, or Linux and OS version
- Codex surface and version, if visible
- Plugin version from `.codex-plugin/plugin.json`
- Exact steps to reproduce
- Expected and actual result
- A screenshot with private data removed
- Whether the problem happens again after starting a new Codex task

Do not paste access tokens, API keys, private board contents, email confirmation links, or personal information into an issue.

## Suggested issue labels

Use `bug`, `installation`, `sync`, `sharing`, `realtime`, `editor`, `export`, or `documentation` when available.
