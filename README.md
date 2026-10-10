# Kirodian

<p>
  <img src="https://img.shields.io/github/stars/oppapili/kirodian" alt="GitHub stars" vspace="10">
  <img src="https://img.shields.io/github/v/release/oppapili/kirodian" alt="GitHub release" vspace="10">
  <img src="https://img.shields.io/github/license/oppapili/kirodian" alt="License" vspace="10">
  <br clear="both">
</p>

![Preview](assets/Preview.png)

Kirodian is an Obsidian plugin for integrating Kiro CLI into your vault as an AI coding agent. Based on [Claudian](https://github.com/YishenTu/claudian), Kirodian adapts its Obsidian-native AI agent experience for Kiro CLI.

Kirodian is developed and released independently of Claudian, with its own release cycle and versioning.

## Versioning

Kirodian uses its own Semantic Versioning ([SemVer](https://semver.org/)) scheme. Each release identifies the Claudian version it was originally based on:

```text
Kirodian v0.4.0
Based on Claudian v2.3.16
```

## Features & Usage

Open the chat sidebar from the ribbon icon or command palette. Select text and use the keyboard shortcut for inline editing. Powered by Kiro CLI, the agent can read, write, edit, and search files in your vault through natural conversation.

**Inline Edit** — Select text or place the cursor where you want to make a change, then use the keyboard shortcut to edit directly in your notes with a word-level diff preview.

**Zen Mode** — When you collapse the sidebar containing Kirodian, the chat moves to a [compact composer](assets/zen-mode-collapsed.png) at the bottom of your note. A one-line activity preview keeps you informed, and [the full conversation is always one click away](assets/zen-mode-expanded.png).

**Slash Commands & Skills** — Type `/` or `$` for reusable prompt templates or Skills from user-level and vault-level scopes.

**@mention** — Type `@` to reference vault files, folders, and other chat sessions.

**Side Chat (`/side` or `/btw`)** — Explore a separate, temporary conversation with follow-up questions and tool access without changing the main conversation.

**MCP Servers** — Connect external tools through Kiro CLI's MCP configuration.

**Tabs & Session Management** — Use multiple tabs in [single-pane mode](assets/main-chat-single-pane.png) or a persistent session manager alongside the chat in [dual-pane mode](assets/main-chat-dual-pane.png).

## Requirements

- [Kiro CLI](https://kiro.dev/) v2.6.0+, installed and authenticated
- An active Kiro subscription
- Obsidian v1.13.0+
- Obsidian desktop app (macOS, Linux, or Windows)

## Installation

### Via BRAT (recommended)

Kirodian is not yet in the Obsidian community plugin registry, so updates are delivered through [BRAT](https://github.com/TfTHacker/obsidian42-brat) (Beta Reviewer's Auto-update Tool), which tracks this repository's GitHub Releases.

1. Install **BRAT** from Obsidian → Settings → Community plugins → Browse → search "BRAT".
2. In BRAT settings, choose **Add Beta Plugin** and enter `oppapili/kirodian`.
3. Enable **Kirodian** in Settings → Community plugins.

BRAT keeps Kirodian up to date from this repo's Releases.

### From source (development)

1. Clone this repository into your vault's plugins folder:
   ```bash
   cd /path/to/vault/.obsidian/plugins
   git clone https://github.com/oppapili/kirodian.git
   cd kirodian
   ```

2. Install dependencies and build:
   ```bash
   npm ci
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

## Privacy

Kirodian does not intentionally collect telemetry. When you use Kiro CLI, requests and data handling are governed by Kiro CLI and its associated services.

You can disable code and content sharing with AWS and telemetry collection through Kiro CLI settings:

```bash
# Disable code and content sharing with AWS
kiro-cli settings codeWhisperer.shareCodeWhispererContentWithAWS false

# Disable telemetry collection
kiro-cli settings telemetry.enabled false
```

These settings control Kiro CLI's behavior and do not change Kirodian's own functionality.

## Troubleshooting

### Getting help

For installation and configuration guidance, refer to the [Kiro CLI documentation](https://kiro.dev/docs/cli/). If you have a feature request or encounter a bug, please [submit a GitHub issue](https://github.com/oppapili/kirodian/issues).

## Architecture

```
src/
├── main.ts                      # Plugin entry point and sole composition root
├── composition/                 # Host objects and view wiring shared by app and features
├── app/                         # Startup, conversations, settings, and storage
├── core/                        # Provider-neutral execution, registry, and type contracts
│   ├── execution/               # Run, session snapshot, and interaction primitives
│   ├── providers/               # Provider registry and workspace services
│   ├── process/                 # CLI discovery and managed child processes
│   ├── prompt/                  # Prompt and context encoding
│   ├── auxiliary/               # Shared provider auxiliary services
│   └── ...                      # bootstrap, commands, rpc, security, storage, tools, types
├── providers/
│   ├── kiro/                    # Kiro CLI ACP adaptor, native history, models, and tools
│   └── acp/                     # Agent Client Protocol shared transport
├── features/
│   ├── chat/                    # Sidebar chat: tabs, workspace lifecycle, controllers, renderers
│   ├── inline-edit/             # Inline edit modal and provider-backed edit services
│   └── settings/                # Settings shell, provider tabs, Vault skill management
├── shared/                      # Reusable UI components, settings controls, mention/dropdown
├── i18n/                        # Internationalization (10 locales)
├── utils/                       # Domain-free leaf helpers
└── style/                       # Modular CSS
```

## Contributing

Issues and focused pull requests are welcome. Issues are the preferred starting point: describe the problem, reproduction steps, and environment clearly so it can be investigated.

Before opening a pull request, please read the [contribution guide](CONTRIBUTING.md). Pull requests must explain the problem, the proposed solution, why the approach is appropriate, and how the change was validated. Pull requests that add a new provider are not accepted; the guide explains this maintenance and product-quality boundary in detail.

### AI code review (@kiro)

This repository has an on-demand AI code review workflow (`.github/workflows/kiro-review.yml`). Comment `@kiro` on a pull request and Kiro CLI reviews it. There is no automatic trigger; it runs only when you ask.

If you work from a fork and want the review in your own repository, set a `KIRO_API_KEY` secret on the fork (a Kiro **Pro / Pro+ / Power** subscription is required — the free tier does not work):

```bash
gh secret set KIRO_API_KEY --repo <your-account>/kirodian
```

Secrets are not inherited from the upstream repository, so a fork without its own `KIRO_API_KEY` simply skips the review (the CI stays green). See [CONTRIBUTING.md](CONTRIBUTING.md) for the full setup.

## License

Licensed under the [MIT License](LICENSE).
