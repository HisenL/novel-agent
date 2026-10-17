# Novel Agent

[简体中文](README.md) · **English** · [日本語](README.ja.md) · [한국어](README.ko.md)

A local-first desktop agent for novel writing. Discuss ideas, plan scenes, write and review prose using your story files, then approve proposed changes before they become accepted content.

**0.1.0 is an early release**, primarily intended for Windows x64. The application interface and detailed documentation are mainly in Simplified Chinese; the README is available in four languages. Distribution is currently source-only.

## Features

- Create, open and import local projects; edit Markdown prose and YAML story contracts.
- Organize outlines, scene plans, characters, locations, timelines and foreshadowing as documents.
- Let the agent choose reading, search, planning and proposal tools across multiple model calls, with visible progress.
- Explore in read-only mode, coauthor through proposals, or generate batch proposals within an explicit file scope.
- Inspect built-in scene-planning, dialogue-polishing and continuity-review instructions.
- Compare, accept, reject, adjust or request a revision of proposals; edit selections or uniquely matched passages.
- Keep immutable revisions, undo through inverse proposals, and detect external-edit conflicts.
- Keep sessions and pending proposals, reopen a project and manually resume work.
- Preview and copy Markdown/YAML folders into a project; export saved content as ZIP.

## Run from source

Install Git, Node.js 22 or newer, and pnpm 11.8.0. Run these commands from the project root:

```powershell
pnpm install --frozen-lockfile
pnpm desktop:prepare
pnpm desktop:build
pnpm desktop:start
```

If Electron's runtime was not downloaded during installation, run `node apps/desktop/node_modules/electron/install.js` before preparation and build.

After preparation, Windows users can also double-click `启动小说智能体.cmd` in the project root. This launcher uses the local build and does not download dependencies.

## Start writing

1. Open model settings, enter the endpoint, protocol, model name and API key, then save and test the connection.
2. Choose “新建 / 导入作品” to select a project folder and edit its story contract through project management.
3. Describe a task in the right pane, such as reading the contract and current chapter, planning a scene and proposing an opening.
4. Inspect progress and the diff, then accept a proposal or reject it with feedback.

The service must support function tools. Explicitly select Responses or Chat Completions, and verify endpoint and model compatibility through connection tests and actual tool calls. The application never silently switches to a demo model.

## Content, credentials and cost

- Manuscripts, notes, sessions and proposals are stored locally. When using an external model, relevant story content is sent to your configured service and is subject to that service's data policies.
- API keys are encrypted using Electron's operating-system-backed secure storage. Do not place keys in manuscripts, conversations or public issue reports.
- Connection tests, writing and resumed tasks may incur charges. Per-turn call limits, token usage and optional price estimates are available; unknown cost does not mean free.
- Requests are not automatically resent after a connection failure. Failed or interrupted requests may already have been billed.

## Current limitations

- No installer is provided. macOS/Linux desktop support has not received equivalent validation.
- Unsaved editor text is not guaranteed to survive a crash. Save frequently and back up your project folder.
- ZIP exports contain saved prose and notes, not task ledgers, pending proposals or credentials. They are not full backups.
- Import is limited to eight directory levels, 2,000 scanned entries and 50 candidate files, each at most 1 MiB.
- Context and search are bounded, with no hierarchical long-novel memory yet. Authors must review generated prose and continuity reports.
- DOCX/EPUB, cloud sync, executable community plugins and one-click finished novels are not available.

## Documentation and contributing

Detailed documentation below is in Simplified Chinese unless otherwise indicated.

- [User guide](docs/user-guide.md)
- [Development and verification](docs/development.md)
- [Architecture](docs/architecture.md) · [Protocol and data](docs/protocol.md)
- [Contributing — English](CONTRIBUTING.md) · [Security — English](SECURITY.md)
- [Changelog — English](CHANGELOG.md)

Issues and improvements are welcome. Include reproduction steps, the version and error text, and remove credentials and private manuscripts.

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for copyright information.
