# Kiro Provider

`src/providers/kiro/` adapts Kiro CLI (`kiro-cli`) through Agent Client Protocol
over a `kiro-cli acp` subprocess (JSON-RPC on stdio). It reuses the shared ACP
transport in `src/providers/acp/` and keeps Kiro-specific policy here.

## Dependency Boundary

- Standard ACP transport and interaction mechanics may be shared. Kiro's
  `_kiro.dev/*` extensions, launch policy, model/agent semantics, tool
  normalization, session metadata, and history interpretation stay Kiro-owned.
- Do not add a generic ACP runtime superclass. Share protocol primitives while
  keeping provider policy and lifecycle explicit.
- Kiro does NOT implement xAI's `x.ai/*` fork, rewind, or interject extensions.
  `KIRO_PROVIDER_CAPABILITIES` sets `supportsFork`/`supportsRewind`/
  `supportsTurnSteer` to false; it supports `reasoningControl: 'effort'`, image
  attachments, native history, and provider commands.

## Ownership

| Area | Owns |
| --- | --- |
| `execution/` | process/session binding, native connection, interaction routing, snapshots, recovery, agent-mode/model metadata reconciliation |
| `runtime/` | CLI resolution, `_kiro.dev/*` notification normalization, model-catalog + agent-catalog discovery/coordination, agent model lock, environment construction, cancel delivery, session meta |
| `history/` | native-history discovery and replay projection — both the legacy v1 (`<encoded-cwd>/<sessionId>/updates.jsonl`) and the v2 flat layout (`<root>/cli/<sessionId>.jsonl`) |
| `commands/` and `app/` | slash-command + skill catalog, command metadata probe, workspace services |
| `normalization/` | tool-call, subagent, and lifecycle-tool-name normalization |
| `prompt/` | system-prompt construction |
| `ui/` | chat UI config and the settings tab |
| `types.ts` and `settings.ts` | typed `KiroProviderState` and provider settings |

- Provider-owned conversation data stays behind `parseKiroProviderState` /
  `buildPersistedKiroProviderState` helpers; feature code must not inspect it.

## Protocol and Session Rules

- Kiro streams session updates over standard ACP `session/update` (no `x.ai/*`
  envelope). The only Kiro-specific notification consumed is the command/skill
  catalog pushed as `_kiro.dev/commands/available` AFTER a session is created.
- Command/skill metadata is only pushed post-`session/new`; there is no
  synchronous list RPC. The metadata probe must open a session and wait for the
  first `commands/available` push before returning.
- `commands/available` carries `commands` (built-in slash commands) AND
  `prompts`. Prompts with `serverName: "skill:config"`
  (`KIRO_SKILL_PROMPT_SERVER_NAME`) are user Agent Skills — surface them with a
  `$` display prefix and a `/` insert prefix (invoked on the wire as
  `/<skillname>`). Prompts from MCP servers (other serverName) are not skills.
- Preserve `Conversation.sessionId` and provider state across prompt, CLI-path,
  and environment changes. Recycle the process and `session/load` the same
  native session; never silently fall back to `session/new` when a saved id
  exists.
- Native history lives under `~/.kiro/sessions/`. Resolve the v2 layout
  (`cli/<sessionId>.jsonl`, cwd recorded in the sibling `<sessionId>.json`)
  first, then fall back to the v1 directory layout. Read-only.
- Send image attachments as ACP image content blocks and rehydrate persisted
  native blocks.
- Agent modes come from `session/new`/`session/load` and config-option updates:
  built-in agents (`kiro_default`, `kiro_planner`, …) plus custom agents. A
  custom agent's `model` field (including `"auto"`) overrides the UI model
  selection — surface that lock in the UI rather than letting the selection
  appear effective.

## Models and Settings

- Model selections are `kiro/<raw-id>` (`KIRO_MODEL_PREFIX`) in Claudian and raw
  ids on the ACP wire; `encodeKiroModelId`/`decodeKiroModelId` convert.
- Catalog snapshots contain only normalized non-secret metadata.
- Reasoning effort is exposed per the agent's advertised metadata; never create
  a session solely for discovery.
- Any change to Kiro environment text or resolved CLI-path fingerprint reloads
  provider processes while preserving native conversation identifiers.

## Repository Instructions vs Runtime Instructions

- This `AGENTS.md` is a repository developer guide for contributors editing
  Claudian's Kiro adapter.
- Vault/runtime steering and `AGENTS.md` files belong to the user and are
  discovered natively by Kiro CLI.
- Claudian must never create, import, append, suppress, rewrite, or explicitly
  inject vault/runtime instruction files.

## Evidence and Fixtures

- Provider behavior not established by standard ACP must be backed by sanitized
  Kiro protocol evidence (e.g. a captured `_kiro.dev/commands/available`
  payload, a v2 `updates`/`cli/*.jsonl` sample).
- Put raw captures and throwaway scripts in `.context/`. Never commit
  credentials, private prompts, absolute personal paths, or raw user
  configuration.
