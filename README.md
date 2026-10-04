# Kirodian

<p>
  <img src="https://img.shields.io/github/stars/oppapili/kirodian" alt="GitHub stars" vspace="10">
  <img src="https://img.shields.io/github/v/release/oppapili/kirodian" alt="GitHub release" vspace="10">
  <img src="https://img.shields.io/github/license/oppapili/kirodian" alt="License" vspace="10">
  <br clear="both">
</p>

![Preview](assets/Preview.png)

> **Kirodian** is a fork of [Claudian](https://github.com/YishenTu/claudian) that adds **Kiro CLI** as an agent backend while preserving Claudian's Obsidian AI-agent experience. Kirodian tracks Claudian as `upstream` and keeps Kiro-specific changes isolated so they can eventually be contributed back upstream.
>
> **Versioning** — Kirodian uses its own [SemVer](https://semver.org/) line, independent of Claudian's. Each release states the upstream Claudian version it is based on:
>
> ```text
> Kirodian v0.2.0
> Based on Claudian v2.3.4
> ```
>
> The rest of this README has been adjusted for Kirodian; the shared plugin foundation it describes is inherited from Claudian.

An Obsidian plugin that embeds AI coding agents (Claude Code, Codex, Grok, Opencode, Pi, and more to come) in your vault. Your vault becomes the agent's working directory — file read/write, search, bash, and multi-step workflows all work out of the box. Kirodian is based on Claudian — see [claudian.md](https://claudian.md/) for more about the upstream project.

## Features & Usage

Open the chat sidebar from the ribbon icon or command palette. Select text and use the shortcut for inline editing. Everything works like your familiar coding agent, Claude Code, Codex, Grok, Opencode, and Pi — talk to the agent, and it reads, writes, edits, and searches files in your vault.

**Inline Edit** — Select text or start at the cursor position + hotkey to edit directly in notes with word-level diff preview.

**Slash Commands & Skills** — Type `/` or `$` for reusable prompt templates or Skills from user- and vault-level scopes.

**`@mention`** — Type `@` to reference vault files and folders.

**Side Chat (`/side` or `/btw`)** — Explore a separate, temporary conversation with follow-ups and tools while keeping the main chat unchanged.

**MCP Servers** — Connect external tools through each coding agent's native CLI-managed MCP configuration.

**Tabs & Session Management** — Use multiple tabs in single-panel mode or a persistent session manager beside the chat in dual-pane mode.

## Requirements

- At least one of the following harnesses:
  - [Claude Code CLI](https://code.claude.com/docs/en/overview)
  - [Codex CLI](https://github.com/openai/codex)
  - [Grok Build](https://github.com/xai-org/grok-build)
  - [OpenCode](https://github.com/anomalyco/opencode)
  - [Pi](https://github.com/earendil-works/pi)
- A compatible subscription or API provider, such as [OpenRouter](https://openrouter.ai/docs/guides/guides/claude-code-integration), [Kimi](https://platform.kimi.ai/docs/guide/claude-code-kimi), [GLM](https://docs.z.ai/devpack/tool/claude), or [DeepSeek](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code) etc.
- Obsidian v1.13.0+
- Desktop only (macOS, Linux, Windows)

Kirodian supports OpenCode v2; OpenCode v1 support will end on October 30, 2026. See the [OpenCode v2 migration guide](https://opencode.ai/v2/docs/migrate-v1).

## Installation

### Via BRAT (recommended)

Kirodian is not yet in the Obsidian community plugin registry, so updates are delivered through [BRAT](https://github.com/TfTHacker/obsidian42-brat) (Beta Reviewer's Auto-update Tool), which tracks this repository's GitHub Releases.

1. Install **BRAT** from Obsidian → Settings → Community plugins → Browse → search "BRAT".
2. In BRAT settings, choose **Add Beta Plugin** and enter `oppapili/kirodian`.
3. Enable **Kirodian** in Settings → Community plugins.

BRAT keeps Kirodian up to date from this repo's Releases. Do not install from the Claudian community page — that updates to Claudian, not Kirodian.

> **Upgrading from a manual install:** if an older `realclaudian` or hand-copied folder exists under `.obsidian/plugins/`, remove it first. A leftover copy causes duplicate entries and can trigger the wrong update source. Kirodian installs under `.obsidian/plugins/kirodian/`.

### From source (development)

1. Clone this repository into your vault's plugins folder:
   ```bash
   cd /path/to/vault/.obsidian/plugins
   git clone https://github.com/oppapili/kirodian.git
   cd kirodian
   ```

2. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```

3. Enable the plugin in Obsidian:
   - Settings → Community plugins → Enable "Kirodian"

### Development

```bash
# Watch mode
npm run dev

# Production build
npm run build
```

## Privacy & Data Use

- **Sent to API**: Your input, attached files, images, and tool call outputs. Depending on the selected provider, data is sent to Anthropic (Claude), OpenAI (Codex), xAI (Grok), or the providers configured in OpenCode or Pi. The destination can be configured through provider settings and environment variables.
- **No telemetry or unsolicited background activity**: Kirodian does not run telemetry beacons. UI polling timers read local Obsidian/editor selection state only. Network activity is limited to explicit provider runtime work, configured MCP endpoints, provider SDK/CLI calls needed to answer your requests, and their configured services.

## Troubleshooting

The following sections use Claude Code as an example.

### Provider CLI not found

If Kirodian cannot auto-detect a provider CLI, verify that the CLI is installed and available to GUI applications through PATH. Typical errors include `spawn claude ENOENT` and `Claude CLI not found`. This issue is common with Node version managers (nvm, fnm, volta).

Leave the CLI path setting empty first so Kirodian can auto-detect the CLI. If auto-detection fails, find the executable path and set it in Settings → Advanced → Claude CLI path.

| Platform | Command | Example Path |
|----------|---------|--------------|
| macOS/Linux | `which claude` | `/Users/you/.volta/bin/claude` |
| Windows (native) | `where.exe claude` | `C:\Users\you\AppData\Local\Claude\claude.exe` |
| Windows (npm) | `npm root -g` | `{root}\@anthropic-ai\claude-code\cli-wrapper.cjs` |

> **Note**: On Windows, avoid `.cmd` and `.ps1` wrappers. Use `claude.exe` for native installs, or `cli-wrapper.cjs` for package-manager installs. `cli.js` is only a legacy fallback for older Claude Code npm packages.

**Alternative**: Add your Node.js bin directory to PATH in Settings → Environment → Custom variables.

### npm CLI and Node.js not in the same directory

When using an npm-installed provider CLI, make sure its executable and Node.js are available from the same environment. Check their paths:

```bash
dirname $(which claude)
dirname $(which node)
```

If the paths differ, GUI apps like Obsidian may not find Node.js.

Either:

1. Install the native binary (recommended).
2. Add the Node.js path in Settings → Environment: `PATH=/path/to/node/bin`.

### More help

For provider-specific installation and configuration guidance, refer to the provider documentation linked in the [Requirements](#requirements) section. If you have a feature request or run into a bug, please [submit a GitHub issue](https://github.com/oppapili/kirodian/issues).

## Architecture

```
src/
├── main.ts                      # Plugin entry point
├── app/                         # Application services, and storage
├── core/                        # Provider-neutral execution, registry, and type contracts
│   ├── execution/               # Provider execution, session lifecycle, and interaction contracts
│   ├── providers/               # Provider registry and workspace services
│   ├── auxiliary/               # Shared provider auxiliary services
│   ├── bootstrap/               # Plugin bootstrap wiring
│   ├── security/                # Approval utilities
│   └── ...                      # commands, prompt, storage, tools, types
├── providers/
│   ├── claude/                  # Claude SDK adaptor, prompt encoding, storage, MCP, plugins
│   ├── codex/                   # Codex app-server adaptor, JSON-RPC transport, JSONL history
│   ├── grok/                    # Grok Build ACP adaptor, native history, models, and tools
│   ├── opencode/                # Opencode adaptor
│   ├── pi/                      # Pi RPC adaptor, model discovery, JSONL history
│   └── acp/                     # Agent Client Protocol shared transport
├── features/
│   ├── chat/                    # Sidebar chat: tabs, controllers, renderers
│   ├── inline-edit/             # Inline edit modal and provider-backed edit services
│   └── settings/                # Settings shell with provider tabs
├── shared/                      # Reusable UI components and modals
├── i18n/                        # Internationalization (10 locales)
├── types/                       # Shared ambient types
├── utils/                       # Cross-cutting utilities
└── style/                       # Modular CSS
```

## Contributing

Issues and focused pull requests are welcome. Issues are the preferred starting point: describe the problem, reproduction steps, and environment clearly so it can be investigated.

Before opening a pull request, please read the [contribution guide](CONTRIBUTING.md). Pull requests must explain the problem, the proposed solution, why the approach is appropriate, and how the change was validated. Pull requests that add a new provider are not accepted; the guide explains this maintenance and product-quality boundary in detail.

## License

Licensed under the [MIT License](LICENSE).
