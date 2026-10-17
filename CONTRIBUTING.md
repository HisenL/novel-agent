# Contributing

Small, reviewable changes that preserve author control are welcome.

## Before making changes

Read the [architecture](docs/architecture.md), [protocol](docs/protocol.md) and [security boundaries](docs/security/threat-model.md), currently in Simplified Chinese. Describe the problem and expected behavior in an issue or pull request.

Preserve exact capabilities, approval-bound changes, hash conflict checks, append-only events and immutable revisions. Document contract or boundary changes and compatibility implications. Published schema meanings must not change silently; breaking changes need a migration plan.

## Checks

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm desktop:prepare
pnpm desktop:build
pnpm desktop:test
```

The last three commands apply to desktop changes. Desktop tests use temporary projects and a local model fixture. Add meaningful tests for behavior and contract changes. Run `pnpm schemas:generate` after schema changes and commit generated files. Avoid unrelated dependency updates.

Use Conventional Commit prefixes such as `feat`, `fix`, `docs`, `test`, `refactor`, `build`, `ci` and `chore`. Keep all four READMEs aligned when changing capabilities, setup or limitations. Language links must work in a checkout and on GitHub.

## Data and community

Use synthetic manuscripts and clearly fake credentials. Never commit private manuscripts, desktop settings, runtime ledgers, real conversations or raw provider payloads. Follow the [security policy](SECURITY.md) and [code of conduct](CODE_OF_CONDUCT.md).
