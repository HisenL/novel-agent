# ADR-0010: Windows executable distribution and persistent settings

- Status: Accepted
- Date: 2026-10-18

## Decision

Distribute Windows x64 as a self-extracting portable EXE and a ZIP with the same application. Both include the pinned Electron runtime, bundled application JavaScript, third-party license notices and the checksum-verified official SQLite Node-API binary. No global Node.js, pnpm or source checkout is required at runtime.

Package only a newly generated staging directory with explicit inputs. Keep the Kernel Utility Process entry and its required SQLite JavaScript modules outside ASAR; load the native binary from a dedicated resources directory. Do not package development settings, API keys, workspaces, Git history or test databases.

Released clients keep encrypted model settings and recent-project metadata in the current Windows user's `%APPDATA%\Novel Agent`, not inside application resources or the portable extractor's temporary directory. Story files and ledgers remain in the author-selected workspace. Development settings keep their existing location; no implicit import of a development user's credentials is performed. Tests use a separate explicit temporary state directory.

Publication requires source checks, desktop regression, regressions for both the extracted ZIP and the single-file portable EXE outside the checkout with no development tools on their PATH, artifact integrity checks and SHA-256 sums. A tag-triggered GitHub workflow builds with read-only permissions and uses a separate publication job to attach checked artifacts to a release. It creates a draft first and publishes only after all uploads succeed.

This release is unsigned and makes no publisher-verification claim. Disclose that limitation without asking users to disable Windows protections. There is no automatic update check or installation, and no new plugin execution surface. Broker boundaries, approvals, protocol versions, accepted content and historical events are unchanged.

## Consequences

- Portable describes installation-free execution, not portable encrypted credentials or a complete story backup.
- Replacing the EXE does not remove settings or projects; copying it to another computer does not transfer them.
- Windows x64 is the only binary target in this release. macOS, Linux, signing and automatic update infrastructure remain separate work.

## References

- [Electron packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution)
- [Electron application paths](https://www.electronjs.org/docs/latest/api/app#appgetpathname)
- [electron-builder Windows targets](https://www.electron.build/win/)
