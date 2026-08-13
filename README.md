# My Whiteboard — Public Beta 2

My Whiteboard is an installable Codex plugin for creating editable whiteboards, UI wireframes, flowcharts, mind maps, and architecture sketches. This public beta includes a local-first canvas, version history, exports, optional Supabase sign-in, cross-device sync, sharing, and Realtime collaboration.

> Beta software: do not use it for passwords, financial records, medical information, confidential client data, or other sensitive content.

## Install

Requirements: a current Codex installation with plugin support.

```sh
codex plugin marketplace add ontheoasis13/MyWhiteBoard --ref main
codex plugin add my-whiteboard@my-whiteboard
```

Start a new Codex task after installation, then try:

```text
Use $whiteboard-design to create a contact form wireframe and open it.
```

The repository also includes `install.ps1` for Windows and `install.sh` for macOS/Linux.

## Update

```sh
codex plugin marketplace upgrade my-whiteboard
codex plugin add my-whiteboard@my-whiteboard
```

Start a new Codex task after updating.

## What to test

- Create and reopen a board
- Add, move, group, lock, align, duplicate, and delete elements
- Use undo/redo and local version history
- Export JSON, SVG, and PNG
- Sign up, confirm email, sign in, and sync a non-sensitive test board
- Open the same account on a second computer
- Create and accept viewer/editor share links
- Confirm Realtime changes appear on another signed-in client

See [BETA_TESTING.md](BETA_TESTING.md) for the test checklist and report format.

## Storage and cloud behavior

Boards default to `Documents/My Whiteboards`. Local JSON remains available for offline work. When a user signs in and enables cloud sync, the board document and collaboration metadata are sent to the configured Supabase project. Supabase row-level security isolates user data and controls shared-board access.

The client contains a Supabase publishable key, which is designed for client use. No Supabase secret or service-role key is included in this repository or release package.

## Documentation

- [Public beta testing](BETA_TESTING.md)
- [Privacy notice](PRIVACY.md)
- [Security policy](SECURITY.md)
- [Support](SUPPORT.md)
- [Release notes](RELEASE_NOTES.md)

## Status

Public beta. Interfaces, cloud behavior, and stored document formats may change before a stable release.

## License

MIT. See [LICENSE](LICENSE).
