# My Whiteboard for Codex

A portable, local-first whiteboard plugin for Codex with professional editing, inline/fullscreen UI, local version history, and optional Supabase authentication, sync, sharing, and Realtime collaboration.

For coding work, create a project board with `create_code_board`. Project boards live in `<project>/.codex/whiteboards`, can link nodes to files and symbols, and expose dependency, risk, dangling-edge, and test-reference analysis through `analyze_code_board`.

## Professional editor

- Multi-select, marquee selection, grouped dragging, copy/paste, duplicate, lock, group/ungroup
- Align and layer controls, keyboard shortcuts, zoom/pan, autosave and local revision history
- Codex selection context through `get_board_context`
- MCP Apps inline/fullscreen renderer through `render_board`

## Supabase setup

Run `supabase/migrations/001_whiteboard_cloud.sql` once when connecting a new Supabase project. Migration `001_whiteboard_cloud.sql` has already been applied to the configured project and its four public API tables were verified on 2026-08-13. The browser uses only `assets/canvas/cloud-config.js` and its publishable key. Never place a secret or service-role key in client assets.

The configured project is `wketdxmdrdkmaryahnwk`. Email sign-up is enabled and email confirmation is required by the current project settings.

The optional `cloud/` backend uses `@supabase/server` for stateless authenticated API routes. Copy `cloud/.env.example` to your deployment environment and provide the full secret there, not in Git.
Normal user-scoped routes do not require the secret; they verify the JWT and use an RLS-scoped client. Keep the secret only for future administrator-only routes.

## Install from GitHub

After this repository is pushed to GitHub, install it on any computer with Codex:

```sh
codex plugin marketplace add ontheoasis13/MyWhiteBoard --ref main
codex plugin add my-whiteboard@my-whiteboard
```

Start a new Codex task after installation. Try: `Use $whiteboard-design to create a contact form wireframe and open it.`

## Update

```sh
codex plugin marketplace upgrade my-whiteboard
codex plugin add my-whiteboard@my-whiteboard
```

Start a new Codex task after updating.

## Board storage and sync

Boards default to `Documents/My Whiteboards`. Ask Codex to show the current whiteboard storage or change it to an existing OneDrive, Dropbox, iCloud Drive, or other synced folder. Existing files are not moved when the storage directory changes.

For advanced setup, set `MY_WHITEBOARD_HOME` before Codex starts to override the storage directory for the MCP server process.

The plugin runs locally. GitHub distributes plugin code; a cloud-synced board directory synchronizes board data.

## Supported systems

The plugin derives user and configuration paths at runtime and supports Windows, macOS, and Linux with Node.js supplied by Codex. JSON and SVG exports have no external dependency. PNG export uses Sharp when available in the Codex runtime.

## Privacy

The local canvas service binds only to `127.0.0.1`. Boards remain local unless the user signs in and enables Supabase cloud sync or chooses a synchronized storage folder. Supabase access is protected by row-level security; secrets must stay in server-side deployment settings and must never be committed or placed in client assets.
