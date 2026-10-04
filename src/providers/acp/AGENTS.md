# Shared ACP constraints

`src/providers/acp/` is the protocol layer shared by ACP-backed providers
(currently grok and kiro). It owns Agent Client Protocol mechanics and
protocol-level normalization only; provider launch policy, extensions,
provider-specific normalization, and history stay provider-owned. Each provider
guide (`../grok/AGENTS.md`, `../kiro/AGENTS.md`) states how it uses this layer.

## Boundary

- Hold protocol primitives only: JSON-RPC transport, the client connection,
  subprocess stdio, method-name resolution, session-config/model/mode
  extraction, session-update and execution-event normalization, the permission
  and tool-stream adapters, and usage mapping.
- Do not add provider launch policy, environment construction, CLI resolution,
  native-history interpretation, or any vendor extension (`x.ai/*`,
  `_kiro.dev/*`). Those are provider-owned; a provider injects its specifics
  through the delegates and adapter interfaces this layer exposes
  (`ACPClientConnectionDelegate`, `ACPToolStreamPresentationAdapter`,
  `resolveToolScope`, `mapUsage`, `presentPermission`, `methodOverrides`).
- Do not add a generic ACP runtime superclass providers must extend. Share
  primitives; keep provider policy and lifecycle explicit in each provider.
- Depend only on `../../core/*` contracts. Never import a concrete provider.

## Protocol compatibility

- Logical methods resolve to a candidate list of wire names in `methodNames.ts`
  (spec `method/name` first, legacy camelCase fallback). Absorb only `-32601`
  (method not found) when probing candidates; every other JSON-RPC error is
  real and must propagate. Keep the server notification/request aliases aligned
  with the same spec-then-legacy ordering.
- `ACP_PROTOCOL_VERSION` is `1`. Prompt turns are long-running RPCs with no
  timeout; progress streams as `session/update` notifications until the final
  response.

## Conventions

- Preserve acronym capitals in filenames and matching owned identifiers
  (`ACPClientConnection`, `buildACPUsageInfo`); leading acronyms stay lowercase
  in camelCase (`acpConnection`). Preserve serialized ACP keys verbatim.
