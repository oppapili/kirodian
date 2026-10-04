---
created: 2026-10-04T23:00
updated: 2026-10-04T23:00
---
# 経緯（Context）

Kirodian は Claudian の Fork であり、upstream から 2 本の Claude 向け GitHub
Actions ワークフローを引き継いでいる。

- `.github/workflows/claude-code-review.yml`: PR 自動コードレビュー。upstream の
  `CLAUDE_CODE_OAUTH_TOKEN` secret を要求するため、`github.repository ==
  'YishenTu/claudian'` のときだけ動くよう条件付けられており、Kirodian では
  実質無効化されていた。
- `.github/workflows/claude.yml`: issue / PR での `@claude` メンション応答。

Kirodian は Kiro CLI を Agent backend として組み込む Obsidian プラグインであり、
レビュー CI も Kiro CLI ベースに揃えたい。無効化されたままの Claude レビュー CI を
放置するか、Kiro CLI ベースに置き換えるかを判断する必要が生じた。

# 要件（Requirements）

- PR の自動コードレビューと、`@kiro` によるオンデマンドレビューを Kiro CLI で行う。
- fork 利用者のリポジトリでも、secret 未設定なら安全にスキップされること
  （upstream リポジトリ名ハードコードに依存しない）。
- サードパーティ Action を使う場合、サプライチェーンリスクを管理すること。
- 二重保守（Claude 系と Kiro 系の並存）を避けること。

# 決定（Decision）

- `claude-code-review.yml` と `claude.yml` を削除し、新規 `kiro-review.yml` に
  統合する。PR 自動レビューと `@kiro` コメントトリガを 1 ファイルで賄う。
- レビュー実行は `konippi/kiro-cli-review-action` を採用し、フルコミット SHA で
  ピン留めする（`1c11ef476d5722d06a0c702a041e6393c8d5310d` = v1.0.1）。
- secret 名は `KIRO_API_KEY` に統一し、`CLAUDE_CODE_OAUTH_TOKEN` 参照を全除去する。
- upstream リポジトリ名のハードコード（`github.repository == 'YishenTu/claudian'`）を
  廃止する。fork では secret が無ければ Action 側が自動スキップする設計のため、
  リポジトリ名で縛る必要がない。
- **Claude 向け機能の互換は縮小方針とする。** issue 本文での汎用 `@claude` 応答など、
  PR レビュー以外の Claude アシスタント機能は引き継がない。

# 結果（Consequences）

## メリット

- レビュー CI が Kiro CLI に一本化され、二重保守がなくなる。
- fork 利用者も自分の `KIRO_API_KEY` を設定すれば動く（設定手順は別 issue #61 で
  README/CONTRIBUTING に整備）。未設定なら安全にスキップされる。
- サードパーティ Action は SHA ピン＋ソース監査済み（API キーはログマスク＋環境変数
  渡しのみで外部送信なし、fork PR では自動スキップ、`@kiro` は信頼ユーザ限定＋入力
  サニタイズ、`.kiro` 等の設定を base ブランチから復元して RCE 対策）。監査記録は
  PR #48 に残す。

## デメリット

- issue 本文での汎用 `@claude`（→ `@kiro`）対話応答は廃止される。PR レビューは
  `@kiro` / 自動に一本化する。汎用対話が将来必要になれば別途ワークフローを設計する。
- サードパーティ Action への依存が増える。SHA ピンで固定し、更新時は再監査する運用で
  リスクを抑える。
- レビュー観点は Action 同梱のデフォルト `code-reviewer` agent に委ねる。Kirodian 固有の
  観点（AGENTS.md / steering 準拠）へのカスタムは将来別 issue で `.kiro/agents/
  code-reviewer.json` を追加して対応できる。

# 代替案（Alternatives）

- **案 A: 自前の headless Kiro CLI レビューを GitHub Actions 上で実装する。**
  サードパーティ依存を避けられるが、ACP クライアント・設定復元・fork 対策・入力
  サニタイズをすべて自前保守することになり、コストが高い。監査済みの既製 Action を
  SHA ピンで使う方が費用対効果が高いため却下。
- **案 B: Claude レビュー CI を無効化のまま放置する。** レビュー自動化の価値を失い、
  無効化ワークフローが残り続けて混乱を招くため却下。
