# Security Policy

## Supported version

Only the latest public beta version on the `main` branch is supported during the beta.

## Report a vulnerability

Use GitHub's private **Report a vulnerability** feature on this repository when it is available. If it is not available, open a minimal issue at <https://github.com/ontheoasis13/My-WhiteBoard/issues> requesting a private reporting channel.

Do not publish exploit details, private board content, credentials, authentication links, tokens, API keys, or personal data in a public issue.

Include the affected version, impact, reproduction conditions, and a safe proof of concept. Allow the maintainer reasonable time to investigate before public disclosure.

## Credential policy

- Supabase publishable keys may be present in client configuration.
- Supabase secret/service-role keys must remain in server-side secret storage.
- `.env` files, access tokens, database passwords, and private keys must never be committed.
- If a secret is exposed, rotate it immediately and review project logs.

## User safety

Use non-sensitive test data during the beta. Revoke unused share links, keep Codex updated, and install only from the repository owned by `ontheoasis13`.
