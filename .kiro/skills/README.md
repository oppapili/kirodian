# プロジェクトスキル

Kirodian リポジトリ同梱の開発手順スキル。人（開発者）・IDE・KiroCrew の
どのインターフェースからも同じ手順を使えるよう、リポジトリに同梱している。

## スキル一覧

| スキル | 役割 |
|---|---|
| `sync-upstream/` | upstream 追従の司令塔。測定→機械処理→テスト追従の順番と、ブランド横展開（機械置換）・新プロバイダのスルーの具体ルールをまとめる。最初に読む。 |
| `assess-upstream-merge-cost/` | upstream との乖離コストを測り、段階マージの境界を導く。 |
| `resolve-upstream-merge-drift/` | 削除プロバイダ由来の衝突を機械処理し、フルテストで検証する。 |
| `retarget-tests-after-upstream-merge/` | マージ後の失敗テストを、upstream 版の採用・置換・層状検証で直す。 |

## 使い方

upstream（Claudian）追従をするときは、まず `sync-upstream/SKILL.md` を読む。
そこから3つの子スキルを順番に呼ぶ。追従方針は fork-policy §4（Kiro 専用、
他プロバイダのソース非保持）を前提とする。

## SKILL.md の書式

- 本文は日本語で書く。ディレクトリ名は英語のケバブケースにする。
- frontmatter は `name`・`description`・`triggers` と、Agent Skills 仕様の `metadata` を使う。
  個人環境に依存する値（セッション ID、作成日時、生成元）は書かない。
- `triggers` は KiroCrew 用で、カンマ区切りの語句。Kiro は `description` を見るので、
  発火させたい語は `description` の文中にも書く。

## KiroCrew からの発火

KiroCrew のドキュメント（`skills.md`）に基づく。

- プロジェクトスキルは `<project>/.kiro/skills/` から読まれる。読み込みには、
  そのプロジェクトのフォルダへの信頼付与が要る。付与はダッシュボードで1回行う。
  プロジェクトスキルを呼ぶ（`$スキル名` を使う）と、「Trust this project's skills?」の確認が出る。
  「Trust this folder」を押すと付与される。
- 設定 `skills.project_skills_enabled` が `false` だと、信頼を付与していても読まれない（既定は `true`）。
- `triggers` による自動の注入は、設定 `skills.max_triggered` が1以上のときだけ働く（既定は `0`）。
  `0` のままなら、`triggers` は効かない。`$スキル名` で呼ぶか、`skill_search` で探して読む。
- 現行のダッシュボードでは、Windows ではプロジェクトスキルが読まれない。

人と IDE は、リポジトリ同梱のファイルをそのまま読める。信頼付与は要らない。
