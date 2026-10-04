---
inclusion: always
---

# リリース・バージョニング・ラベル運用

Kirodian で issue / PR を作成・更新するとき、およびバージョンを上げるときに
従う運用ルール。正本は `CONTRIBUTING.md` の「Versioning & Releases」節と
issue #34。この文書は Kiro が常時参照する運用指示であり、詳細が食い違う場合は
`CONTRIBUTING.md` を正とする。

## バージョニング

- fork 独自系列として `0.x` から育てる。Claudian 由来のタグ資産は引き継がない。
- `manifest.json` の `version` が単一の正。git タグ（`v` なし、例 `0.3.0`）と
  GitHub Release を同一バージョンに揃える。
- バージョンを上げるときは `npm version <major|minor|patch>` を使う。
  `scripts/sync-version.js` が `manifest.json` と `versions.json`
  （`"<plugin_version>": "<minAppVersion>"`）を自動更新し、両ファイルをステージする。
  手動で `manifest.json` / `versions.json` を書き換えない。

## ラベル付け（issue / PR 作成時に必ず付ける）

変更の bump 種別とラベルを 1 対 1 で対応させる。issue と PR の両方に、
変更の性質に応じて次のいずれかを**必ず**付ける。

| ラベル | bump | 対象 |
|---|---|---|
| `breaking` | メジャー (X) | 後方互換を壊す変更（設定ファイル形式の非互換、コマンド ID 改名、連携 API 破壊）。Conventional Commit の `feat!` / `BREAKING CHANGE:` 相当 |
| `enhancement` | マイナー (Y) | 後方互換の機能追加（feat） |
| `bug` | パッチ (Z) | 後方互換のバグ修正（fix） |
| `documentation` | パッチ (Z) | ドキュメントのみの変更（docs） |

- 複数に該当する PR は、最も影響の大きい種別のラベルを基準に bump を決める
  （breaking > enhancement > bug/documentation）。
- Conventional Commits のコミット種別（feat / fix / docs / `feat!`）とラベルを
  一致させる。

## 0.x 期間の例外

- semver 上 `0.x` は無保証区間。**`0.x` の間は breaking でもマイナー（`0.Y`）で
  吸収し、X=0 を据え置く。** メジャー（X）= breaking が実効化するのは `1.0.0`
  到達後。
- `breaking` ラベルは `0.x` の間も「破壊的変更の記録・可視化」として付ける
  （bump は `0.Y` だが、1.0.0 以降のメジャー判断の履歴になる）。

## `1.0.0` 到達基準

- Obsidian コミュニティプラグイン申請を済ませ、公開 API（設定ファイル形式・
  コマンド ID・公開インターフェース）を安定と宣言できる状態になったとき。

## ブランチ戦略

- GitHub Flow。`main` + 短命な `feature/xxx` / `fix/xxx` を PR 経由でマージ。
- `main` は常にリリース可能に保つ。単一成果物のため `develop` は設けない。
- 新規ブランチは最新 `origin/main` から分岐する（`kirodian-fork-policy.md` §8 /
  `workflow.md` の「ブランチと最新 main への追従」に従う）。

## Milestone

- Milestone はバージョン（例 `0.3.0`, `1.0.0`）に対応させ、リリースに含める
  issue をまとめる。
