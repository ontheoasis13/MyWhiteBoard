# Security Policy

## Supported version

Only the latest `0.2.x` alpha tag is supported.

## Report a vulnerability

Prefer GitHub private vulnerability reporting. If unavailable, open a minimal issue requesting a private channel. Never publish exploit details, credentials, access tokens, private Workspace data, or confirmation links.

## Security design

- Loopback Workspace binds to `127.0.0.1`, uses a short-lived random token, and sends `frame-ancestors 'none'`.
- Semantic changes use atomic local writes, a process lock, Workspace Version ordering, and Entity Version optimistic concurrency.
- Supabase tables enable RLS. Entity writes go through an authenticated atomic RPC.
- Anonymous execution of Semantic Workspace `SECURITY DEFINER` functions is explicitly revoked.
- Client code rejects `sb_secret_...` when a Publishable Key is expected.
- `.env`, user JWTs, Secret Keys, database passwords, and private keys must never be committed.

If a secret is exposed, rotate it immediately and review Supabase/GitHub logs.
