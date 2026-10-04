---
inclusion: always
---

# AGENTS.md 参照の原則

このリポジトリのコーディング規約（アーキテクチャ制約・命名規約・回帰検証ルール・
ビルド/検証コマンド）の**正本は各ディレクトリの `AGENTS.md`** である。Kiro が
参照するのは `.kiro/steering/**/*.md` だけで `@AGENTS.md` インポートを辿らないため、
この steering が「どの作業でどの `AGENTS.md` を読むか」を橋渡しする。

**規約の内容はここに転記しない**（二重管理を避ける）。正本は `AGENTS.md`。
矛盾する場合は `AGENTS.md` を正とする。

## 必ず守ること

- **コードを編集する前に、まずルート `AGENTS.md` を読む。** 全体の検証コマンド・
  アーキテクチャ制約・命名規約・回帰検証ルールが書かれている。
- **編集対象のパスに対応する最も近い `AGENTS.md` も読む**（スコープ別 steering が
  `fileMatch` で発火し、どれを読むか指示する）。
- ルート `AGENTS.md` の「Loading and verification」節に従い、変更の種類ごとに
  追加で読むべき `AGENTS.md` を判断する（例: ビルド/依存/ロックファイル/
  静的アセット import の変更は `scripts/AGENTS.md` も要る。テストはそれがカバー
  するソースの `AGENTS.md` に従う）。

## パスと AGENTS.md の対応

| 編集するパス | 読む `AGENTS.md` |
|---|---|
| 任意（常に） | `AGENTS.md`（ルート） |
| `src/app/**` | `src/app/AGENTS.md` |
| `src/composition/**` | `src/composition/AGENTS.md` |
| `src/core/**` | `src/core/AGENTS.md` |
| `src/features/chat/**` | `src/features/chat/AGENTS.md` |
| `src/i18n/**` | `src/i18n/AGENTS.md` |
| `src/style/**` | `src/style/AGENTS.md` |
| `src/providers/acp/**` | `src/providers/acp/AGENTS.md` |
| `src/providers/claude/**` | `src/providers/claude/AGENTS.md` |
| `src/providers/codex/**` | `src/providers/codex/AGENTS.md` |
| `src/providers/grok/**` | `src/providers/grok/AGENTS.md` |
| `src/providers/kiro/**` | `src/providers/kiro/AGENTS.md` |
| `src/providers/opencode/**` | `src/providers/opencode/AGENTS.md` |
| `src/providers/pi/**` | `src/providers/pi/AGENTS.md` |
| `scripts/**` | `scripts/AGENTS.md` |
| `tests/**` | `tests/AGENTS.md`（＋カバー対象ソースの `AGENTS.md`） |

## 検証

- コード変更後は、ルート `AGENTS.md` のフル検証コマンドを実行する:
  `npm run typecheck && npm run lint && npm run test && npm run build && npm run check:performance`
- 焦点を絞った変更は `npm run test:affected -- --base origin/main` を併用（ただし
  typecheck / lint / build / performance の代替にはならない）。
- 挙動変更は、実装前に失敗する回帰を示し、実装後に再実行して通す
  （`AGENTS.md` の「Regression verification」に従う）。
