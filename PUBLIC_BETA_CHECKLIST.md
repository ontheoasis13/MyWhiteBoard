# Maintainer Public Beta Checklist

- [ ] Make the GitHub repository public, or explicitly invite every private beta tester
- [ ] Keep `.agents`, `plugins`, installation scripts, and Markdown files at the repository root
- [ ] Rotate any previously exposed Supabase secret key
- [ ] Confirm no `.env`, secret key, access token, or database password is committed
- [ ] Enable GitHub Issues and private vulnerability reporting
- [ ] Configure Supabase authentication site URL, redirect URLs, and confirmation email
- [ ] Confirm database backups, quotas, and usage alerts
- [ ] Test installation on a clean Codex environment
- [ ] Test sign-in and sync with two separate user accounts
- [ ] Test viewer and editor permissions
- [ ] Publish the ZIP checksum with the release
- [ ] Review `PRIVACY.md`, `SECURITY.md`, and `SUPPORT.md` before announcing the beta
