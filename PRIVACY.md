# Public Beta Privacy Notice

Last updated: 2026-08-13

My Whiteboard is local-first and offers optional cloud collaboration through Supabase.

## Data processed

Local use may store board JSON, exported files, preferences, and local version history on the user's computer.

When cloud features are used, the configured Supabase project may process:

- Account identifiers and email address used for authentication
- Board titles and structured board documents
- Board ownership, membership, and viewer/editor roles
- Version history and timestamps
- Share-link identifiers, permissions, expiry, and revocation state

## Why data is processed

The data is used to authenticate users, save and synchronize boards, restore versions, enforce sharing permissions, and deliver Realtime collaboration.

## Access and sharing

Supabase row-level security limits access to the board owner, explicitly added members, and users allowed by the board's sharing state. Anyone receiving an active share link may be able to join with the permission attached to that link; users should revoke links they no longer need.

## Retention and deletion

Local files remain until the user deletes them. Cloud records remain until the associated board or account data is deleted by an authorized user or project operator. During the beta, users can request help through <https://github.com/ontheoasis13/My-WhiteBoard/issues>; do not post personal data publicly. Open a minimal issue asking for a private contact channel.

## Security and limitations

The public client contains only a Supabase publishable key. Server secrets are not distributed. This is beta software and should not be used for sensitive, regulated, or business-critical information. No security system eliminates all risk.

## Changes

This notice may change as the beta evolves. Material changes should be documented in the repository release notes.
