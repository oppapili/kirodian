# Composition constraints

`src/composition/` holds main-owned wiring that must reach both `app/` and
`features/`. Only `main.ts` and other composition modules import it; it never
imports `main.ts` or concrete providers, and `main.ts` still constructs,
registers, and tears it down.

## Boundary

- Modules here depend only on `@/core/*` contracts and the view/feature types
  they wire. They do not reach into plugin lifecycle internals, construct a
  second composition root, or act as a service locator.
- `ClaudianProviderHost` is a narrow delegating `ProviderHost`: it forwards only
  the provider-facing surface of the composition root and never widens it to
  plugin lifecycle APIs, so providers see this host and nothing more.
- View guards (e.g. `isClaudianView`) identify a mounted view structurally,
  not by class identity, so they survive plugin reloads.
