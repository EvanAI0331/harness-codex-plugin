# Security Policy

## Do Not Share Secrets in Issues

Never paste API keys, passwords, cookies, or tokens into public issues or pull requests.

## How Secrets Work

- Secrets are resolved server-side
- Frontend fields store `credentialRef`, not raw secret values
- `credentialRef` maps to environment variables such as `OPENAI_MAIN_API_KEY`

## Vulnerability Reports

If you believe you found a security issue, please open a private report through the repository's security contact or the hosting platform's security advisory flow.

Include:

- the affected route or component
- the environment you used
- whether `DEMO_MODE` was enabled
- the minimal reproduction steps

## Current Security Posture

This OSS release is a skeleton and is **not** production hardened.

It does not yet claim:

- multi-tenant isolation
- production-grade secret isolation across all deployments
- exhaustive abuse protection
- hardened external integration boundaries

Treat it as a local or controlled deployment base, not as a production security guarantee.
