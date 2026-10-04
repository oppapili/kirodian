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

## βリリース（プレリリース）手順

正式版の前に BRAT でβ配布するときの手順。正式版手順（上記）との差分のみ示す。

- **バージョン文字列**: `0.Y.Z-beta.N` 形式のプレリリース SemVer を使う（例 `0.3.0-beta.1`）。
  `scripts/check-release-version.mjs` の正規表現は `-beta.N` suffix を受け付ける。
- **版上げ**: `npm version prerelease --preid=beta --no-git-tag-version` を使う。
  本リポは `v` なしタグ運用のため、`npm version` 既定の `v` 付きタグ自動生成を
  `--no-git-tag-version` で切る。`scripts/sync-version.js` が `manifest.json` と
  `versions.json` を自動更新・ステージする（正式版と同じ）。
  なお `npm version prerelease` は**パッチ系列**を生成する（`0.2.0` →
  `0.2.1-beta.0`）。次のマイナーβ（例 `0.3.0-beta.1`）にしたいときは
  **バージョン文字列を明示指定**する: `npm version 0.3.0-beta.1 --no-git-tag-version`。
- **マージとタグ**: 版上げ変更は PR 化して `main` にマージする（保護ブランチへの
  直 push 不可）。マージ後の最新 `main` で `v` なしタグ（例 `0.3.0-beta.1`）を打って
  push するのが Release 発火トリガ。タグ push はユーザが手動で行う（KiroCrew の
  git-publish フロアによりエージェントの push は拒否される）。
- **prerelease フラグ**: `.github/workflows/release.yml` はタグ名にハイフンを含む場合
  （SemVer プレリリース識別子）に GitHub Release を `prerelease: true` で生成する。
  BRAT の判定基準はタグ名の文字列ではなく **Release の `prerelease` ブール値** である。
- **BRAT 側（ユーザ操作）**: 「Add Beta Plugin」で pre-release を含めるオプションを
  オンにしたユーザだけがβを拾う。オプションがオフの一般ユーザには降らない。
- **0.x 期間との整合**: `0.x` は無保証区間のため、βもマイナー系列
  （`0.Y.Z-beta.N`）で回す。X=0 は据え置く。

## Milestone

- Milestone はバージョン（例 `0.3.0`, `1.0.0`）に対応させ、リリースに含める
  issue をまとめる。
