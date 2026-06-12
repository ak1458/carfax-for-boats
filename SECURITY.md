# Security Policy

## Supported versions

Pre-1.0 — only the latest `main` is supported.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private vulnerability reporting ("Report a vulnerability" under the Security tab) or email the maintainer.

You can expect an acknowledgment within a few days. Coordinated disclosure appreciated.

## Scope notes for researchers

Things we care most about:

- Cross-tenant data access (RLS bypass, share-token weaknesses, storage path traversal)
- The public share page (`/r/[token]`) — it reads with the service role, gated only by the 192-bit token and revocation flag
- Photo upload pipeline (`photos` bucket is private, 10 MB cap, image MIME allowlist)
- Prompt-injection through photographed documents influencing extraction output (extraction is user-confirmed before persistence, which is the intended mitigation — bypasses of that confirmation gate are in scope)

Known accepted-risk items at MVP stage (still reportable if you find amplification): no per-user rate limiting on the extraction API beyond auth; reminder cron queries are capped, not paginated.
