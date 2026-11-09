---
name: sync-upstream
description: Claudian upstream を Kirodian に追従する際の司令塔スキル。測定→機械処理→テスト追従の順で、Kiro 専用方針（fork-policy §4）を保ったまま追従コストを最小化する。upstream追従・fork sync・claudian追従・段階追従・upstream 2.3.x と言われたときに使う。
triggers: upstream追従, fork sync, claudian追従, 段階追従, upstream 2.3.x
metadata:
  author: oppapili
  version: "1.1.0"
---

## いつ使うか

Kirodian が upstream Claudian の新バージョンに追従するとき、最初に読む。
このスキルは入口であり、実作業は3つの子スキルを順番に呼ぶ。

- `assess-upstream-merge-cost`: 乖離コストを測る。
- `resolve-upstream-merge-drift`: 削除プロバイダ由来の衝突を機械処理する。
- `retarget-tests-after-upstream-merge`: テストを追従させる。

## 前提方針（fork-policy §4）

Kirodian は Kiro 専用プラグイン。保持するプロバイダは `src/providers/kiro/` のみ。
claude を含む他プロバイダのソースは保持しない。この方針は追従で変えない。

upstream のマージは commit をそのまま取り込む作業ではない。各変更の「意図」を読み、
Kiro 側の実装にぶつける。Provider でない部分（中立層・features・style・i18n・
ビルド設定・共有 ACP 層）は流用可能なので追従する。Provider 固有の変更はソースを
保持しないので取り込まないが、設計思想（ACP 利用・セキュリティ fix 等）は参考にする。

## 衝突の実態（なぜ機械化できるか）

下表は Issue #107 の dry-run merge の実測値で、**起点は 2.3.37**（2.3.37→2.3.40、
132 コミット先行、本物の衝突 253 件）。内訳が合計と1件ずれるのは Issue 記載のまま
転記しているため。2.3.38 の取り込み（#87 段7）は完了済みなので、次回の起点は 2.3.38 で、
件数はこの表より減る見込み。ただし 2.3.38→2.3.40 は再測定していない。
追従に入る前に `assess-upstream-merge-cost` で必ず測り直す。

| 衝突の種類 | 件数（約） | 重さ | 理由 |
|---|---|---|---|
| 共有層 src（真の判断） | 18 | 重い | i18n・icons・ModelSelector 等 |
| provider src | 50 | ほぼ機械 | 削除した claude/codex 等が原因 |
| provider 系テスト | 125 | ほぼ機械 | 同上、古い前提 |
| 非 provider テスト | 49 | 中 | 共有層の追従に連動 |
| その他 | 10 | 軽 | scripts・ルート |

削除プロバイダ由来の約175件（provider src 50 + provider 系テスト 125）は
「Kiro 以外のソースを捨てた副作用」で、追従のたびに機械処理で消える。
子スキル `resolve-upstream-merge-drift` と `retarget-tests-after-upstream-merge` が担当する。

共有層18件をさらに開くと、Issue #107 の精査では、人が新しく頭を使うのは実質2〜3件/回。
残りは同型の繰り返しで、下記の2ルールと、import 行の両取り・新プロバイダのアイコン追加
（どちらもルール2に含める）に落ちる。

## 機械処理の具体ルール

詳細な手順と対象ファイルは `resolve-upstream-merge-drift` の同名の節にある。
ここでは判断基準だけを示す。

### ルール1: ブランド横展開は機械置換する

- 対象は Claudian の**表示用ブランド文字列**。衝突したら Kirodian 表記の HEAD 側を採る。
- 実測では i18n 10言語 + Settings + Welcome で約12件が同型だった（Issue #107 の dry-run）。
  1回方針を決めれば、残りは同じ置換の繰り返しになる。
- 識別子とファイル名は置換しない。`ClaudianView.ts`・`ClaudianSettings.ts`・
  `package.json` の `claudianVersion` は main でも upstream 名のまま残っている。
  置換すると次回以降の衝突が増える。
- 根拠の実績: PR #106（2.3.38 追従）で、新キー `chat.reloadingHistory` を10ロケールに
  ブランド名 Kirodian で追加した。

### ルール2: 新プロバイダは upstream 側を素通し（スルー）する

- 対象は、upstream が足した新プロバイダ（Issue #107 の dry-run では antigravity /
  deepseek）の文字列・アイコン・import といった**中立層の差分**。
  削除対象ではないので、upstream 側をそのまま受ける。import 行は両方残す（両取り）。
- 新プロバイダのソース（`src/providers/<name>/`）は取り込まない。Kiro 専用方針は変えない。
- 根拠の実績: PR #106 は削除済みプロバイダ（claude / codex / deepseek / grok / opencode / pi）
  のコンフリクト 97 ファイルを `git rm` した。一方、main の `src/i18n/locales/*.json`
  10本には、`deepseek` の空の枠（中身のない入れ物）が今も残っている（実測）。
  ソースを削除しても、中立層の i18n には痕跡が残る例。残った経緯は未確認。
- `antigravity` は main にまだ出ていない（`src/` 内に該当なし）。Issue #107 の dry-run
  にだけ現れた名前なので、次回追従の実測で確認する。
- 素通しした差分が、中立層に削除済みプロバイダへの依存を引き込んでいないかだけ確認する
  （`assess-upstream-merge-cost` の注意点）。

## 手順

1. `assess-upstream-merge-cost` を読み、乖離コストを測る。
   単一マージか段階マージかを決める。squash 履歴なので tag 単位で割る。
2. `resolve-upstream-merge-drift` を読み、マージして削除プロバイダ衝突を機械処理する。
   ブランド名はルール1、新プロバイダはルール2で解決する。
3. `retarget-tests-after-upstream-merge` を読み、テストを追従させる。
4. 検証はルート `AGENTS.md` のフル検証コマンドで行う。
   typecheck が緑でも、テストが緑とは限らない。必ずフルテストを回す。

   ```bash
   npm run typecheck && npm run lint && npm run test && npm run build && npm run check:performance
   ```

5. fork-policy §8 のレビュー（共有層変更の中立性理由の明記）を push 前に行う。
6. PR を出し、release-and-labels steering に従って bump 種別のラベルを付ける。

## 注意点

- このスキルはプロジェクトスキル（`<project>/.kiro/skills/`）。KiroCrew から読ませるには、
  ダッシュボードでこのプロジェクトのフォルダに信頼を付与する（1回）。
  発火の条件は `.kiro/skills/README.md` を参照。人と IDE はリポジトリ同梱なので、そのまま読める。
- 判断件数を「2〜3件」と固定値で信じない。毎回 `assess-upstream-merge-cost` で実測してから
  機械処理に入る。バージョン差が大きいと判断件数も増える。
