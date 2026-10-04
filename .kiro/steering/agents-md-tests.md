---
inclusion: fileMatch
fileMatchPattern: tests/**
---

# tests 編集時に読む AGENTS.md

`tests/` 配下を編集している。実装の前に、次を**必ず読む**:

1. ルート `AGENTS.md`。
2. `tests/AGENTS.md`。
3. そのテストが**カバーするソースの `AGENTS.md`**（テストは `src/` の指示を
   自動継承しない。カバー対象のスコープのガイドに従う）。

規約の正本は `AGENTS.md`（内容は転記しない）。
