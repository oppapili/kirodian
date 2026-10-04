---
inclusion: fileMatch
fileMatchPattern: src/**
---

# src 編集時に読む AGENTS.md

`src/` 配下を編集している。実装の前に、次を**必ず読む**:

1. ルート `AGENTS.md`（全体の検証コマンド・アーキテクチャ制約・命名規約・
   回帰検証）。
2. 編集対象のパスに最も近い `AGENTS.md`。対応は `agents-md-reference.md` の
   「パスと AGENTS.md の対応」表に従う。例:
   - `src/providers/kiro/**` → `src/providers/kiro/AGENTS.md`
   - `src/app/**` → `src/app/AGENTS.md`
   - `src/core/**` → `src/core/AGENTS.md`
   - `src/features/chat/**` → `src/features/chat/AGENTS.md`
   - `src/style/**` → `src/style/AGENTS.md`

規約の正本は `AGENTS.md`。この steering は読む義務を課すだけで、規約内容は
転記しない（二重管理を避ける）。構成（composition）やサービス合成を変える場合は、
ルート `AGENTS.md` の指示に従い関係するサービスのガイドも読む。
