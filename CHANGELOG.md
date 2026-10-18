# Changelog

## 0.2.1

- First published Windows binary edition, retaining the ready-to-run EXE/ZIP features below.
- Fix startup through Windows 8.3 paths by canonicalizing the resource directory before deriving strict renderer URL checks.
- Exercise short-path launches in both extracted-ZIP and portable-EXE regression tests without weakening renderer or IPC restrictions.

## 0.2.0 (source tag only; binary publication blocked)

The release gate caught a packaged short-path startup failure on the Windows runner; no binaries were published for this tag. Use 0.2.1 instead.

- Windows x64 ready-to-run portable EXE and ZIP, including Electron and SQLite; no Node.js, pnpm or source checkout needed by authors.
- Persistent per-user client settings outside the executable's temporary extraction directory; existing story folders remain unchanged.
- Allowlisted application packaging, bundled dependency licenses, SHA-256 checksums and a gated GitHub Releases workflow.
- Packaged-application regression with development tools removed from the application's PATH.
- Four-language download and launch instructions. Binaries are currently unsigned; no automatic update installation.

## 0.1.0

Initial source release.

- Windows-first Electron workspace with local Markdown/YAML projects.
- Multi-step tool use, planning, read-only exploration and scoped batch proposals.
- Scene planning, dialogue polishing and continuity-review instructions.
- Proposal diffs, author approval, immutable revisions and inverse-change undo.
- Session persistence, explicit resume, import preview and saved-content ZIP export.
- Chinese interface and Chinese, English, Japanese and Korean READMEs.

See the README for setup requirements and limitations.
