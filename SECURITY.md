# Security Policy

## Reporting

Report vulnerabilities privately through the repository's Security tab when private vulnerability reporting is enabled. Otherwise, open an issue requesting a private contact without exploit details, credentials or manuscripts. Do not submit sensitive material in public issues, pull requests or attachments.

Include the version, operating system, reproduction steps with synthetic data and expected impact. This early release has no guaranteed response-time SLA.

## Boundaries

- Model output creates proposals; accepted files require author approval and current base-hash checks.
- Renderer sandboxing and context isolation separate the UI from Main's native dialogs and encrypted credentials.
- Relevant story content is sent to the configured external model endpoint.
- No executable community plugin host is enabled. A Utility Process alone is not an arbitrary-code sandbox.
- Event ordering and publication recovery have tests; no independent security certification is claimed.

## Sensitive data

Never commit real manuscripts, keys, tokens, desktop settings, runtime ledgers, private conversations or raw provider payloads. Encryption does not make credential files suitable for publication. Runtime directories are ignored; portable project configuration may be intentionally shared after review.

Unsaved text is not guaranteed to survive a crash. ZIP export is not a full session backup. See the [threat model](docs/security/threat-model.md), in Simplified Chinese.
