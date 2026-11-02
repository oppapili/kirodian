# Agent skill constraints

- Vault skill management is filesystem-only and never changes how providers discover skills. A panel manages exactly one skills root; the active provider re-reads that folder after a mutation through the host's skill-change notification, never through persisted panel state.
