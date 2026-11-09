---
name: resolve-upstream-merge-drift
description: 段階的な upstream バージョン同期マージを解決する。削除プロバイダ由来のファイルを一括削除し、衝突を分類し、typecheck だけでなくフルテストで検証する。upstream sync merge・version bump merge conflicts・deleted provider removal・fork maintenance・merge drift・typecheck passes but tests fail と言われたときに使う。
triggers: upstream sync merge, version bump merge conflicts, deleted provider removal, fork maintenance, merge drift, typecheck passes but tests fail
metadata:
  author: oppapili
  version: "1.2.0"
---

## いつ使うか

fork を新しい upstream バージョンに同期し、`git merge <upstream-tag>` が削除
プロバイダ・i18n・テスト・バージョン/ロックファイルにまたがる多数の衝突を生むとき。
fork は特定の upstream プロバイダ/機能を削除し、独自の命名を維持している前提。
司令塔スキル `sync-upstream` から呼ばれる。

## 手順

1. **まず衝突の内訳を測る。** マージ後に、衝突をカテゴリ別に数える。
   カテゴリは、削除プロバイダのファイル・テスト・provider 以外の src・i18n・kiro/core・
   バージョン関連ファイル。作業量と、人の判断が要る量・機械処理で済む量が分かる。
2. **削除プロバイダのファイルを一括で消す**（`git rm`）。これらは戻ってこない。
   消したら残りの衝突を数え直す。
3. **残る衝突を MERGE-ADD と IN-MAIN に分ける。** 衝突した各パスが `origin/main` に
   あるかを確認する。
   - MERGE-ADD（upstream からの新規。プロバイダ依存が多い）: 削除済みプロバイダに依存するなら削除する。
   - IN-MAIN（fork が保持している）: HEAD 側を採り、そのうえで adapt する。
4. **バージョン・ロックファイルを解決する。** fork 自身のバージョンを保ち、upstream
   バージョンの参照（`claudianVersion` など）だけを上げる。ロックファイルは手でマージせず、
   再生成する。不要な依存が戻っていないかを確認する。
5. **コードの衝突では upstream のファイルを読む。** 意図された API の変更
   （新しい必須インターフェースメンバー、改名された capability、新しいキャスト形）を理解し、
   推測せずに fork 側へ同等の変更を当てる。
6. **マージを WIP コミットする。** コンパイルエラーに手を付ける前に、解決済みの状態を残す。
7. **typecheck を回し、src のエラーとテストのエラーを分けて**直す。
8. **重要: typecheck だけでなく、フルテストを回す。** typecheck が通ってもマージがきれいとは限らない。
   未登録プロバイダ、変わった初期化の条件、構造的な `undefined.get` といった実行時のずれは、
   緑の typecheck の裏に隠れる。ハーネスや型のエラーを直すと、潜んでいた実行時の失敗が
   表に出ることもある。
9. **実行時の失敗を根本原因ごとにまとめる。** 共有の条件分岐のバグか、スイートごとの独立したずれか。
   作業を並列に振る前に共通原因が1つないかを確認し、委任先で同じ調査が重ならないようにする。
10. すべて緑になったら、lint・build・performance check を回し、push して PR を出す。

## 機械処理ルール（Kirodian 固有）

共有層の衝突は、Issue #107 の dry-run 実測では大半が下の2つの型に落ちた。
人が新しく頭を使うのは実質2〜3件/回（2.3.37 起点の実測。次回起点では再測定する）。

### ブランド横展開（機械置換）

Claudian → Kirodian のブランド名の取り分けは、衝突のたびに同じ判断になる。
1回方針を決めて、全衝突に同じ置換を当てる。

- 対象は表示用のブランド文字列。衝突したら、Kirodian 表記の HEAD 側を採る。
  実測では i18n 10言語 + Settings + Welcome で約12件が同型だった。
- `src/i18n/locales/*.json`（10言語）は、すべて同じ形の衝突になる。
  HEAD の Kirodian 表記を保つ。upstream が新しく足した非ブランドのキー（新機能の説明文等）は
  upstream 側をそのまま受ける（次節）。
- `src/features/settings/` と `src/features/chat/rendering/WelcomeRenderer.ts` 等の
  ブランド文字列にも同じ置換を当てる。
- 識別子とファイル名（`ClaudianView.ts`、`ClaudianSettings.ts`、`claudianVersion` など）は
  置換しない。main でも upstream 名のまま残っている。置換すると次回以降の衝突が増える。
- 根拠の実績: PR #106（2.3.38 追従）で、新キー `chat.reloadingHistory` を10ロケールに
  ブランド名 Kirodian で追加した。
- 確認: main の `src/i18n/locales/*.json` には、今も `Claudian` を含む文字列が各ロケールに2か所ずつある。
  置換漏れか意図した残しかを、追従のたびに `grep -rn "Claudian" src/i18n/locales/` で見て人が判断する。

### 新プロバイダのスルー

upstream が足した新プロバイダ（Issue #107 の dry-run では antigravity, deepseek）の
文字列・アイコン・import は、削除対象ではない。upstream 側をそのまま受ける。
Kiro 専用方針なのでこれらは使わないが、衝突の解決としては「スルー＝upstream を受ける」が正しい。

- 新プロバイダの説明文（i18n の installation / codeMode 等）: upstream 側を受ける。
- 新プロバイダのアイコン（`src/shared/icons.ts`）: upstream 側を受ける（足すだけ）。
- import 行の衝突（`src/shared/toolbar/ModelSelector.ts`、
  `src/features/chat/ClaudianView.ts` 等）: 両方残す（両取り）。
- 新プロバイダのソース（`src/providers/<name>/`）は取り込まない。上の手順2で削除側に倒す。
  スルーするのは、中立層に出る文字列・アイコン・import だけ。
- 根拠の実績: PR #106 で削除済みプロバイダのコンフリクト 97 ファイルを `git rm` した。
  main の `src/i18n/locales/*.json` 10本には、`deepseek` の空の枠が今も残っている（実測）。
  `antigravity` は main の `src/` にまだ無い。Issue #107 の dry-run にだけ現れた名前で、
  次回追従の実測で確認する。

スルーした新プロバイダが、中立層に依存を引き込んでいないかだけ確認する。

## 注意点

- typecheck は、マージの正しさを守る力が弱い。typecheck のエラーが5件でも、実行時の失敗が
  200件以上隠れていることがある。作業範囲を小さく見積もる前に、必ずフルテストを回す。
- テストファイルを削除したら、テストスイートのマニフェスト（`scripts/testSuites.cjs` 等）に
  死んだパスが残っていないか確認する。残っていると、存在しないファイルを集めようとして CI が落ちる。
- 新しい upstream のインターフェースメンバーに合わせるときは、upstream のキャストをそのまま
  写す（例: `as unknown as X & NewOwnerType`）。一部だけのキャストはローカルで通るが、
  ジェネリクスの制約で失敗する。
- 環境依存の不安定な CI（faketime・時計のずれ、遅いランナーでの onload タイムアウト、
  Windows のクリーンアップ時のファイルロック）と、本物のバグを区別する。これらはローカルや
  affected のみの実行では通る。1回だけ再実行し、特定のシャードでタイムアウトが再現するなら
  負荷に敏感なテストである。タイムアウトを隠すだけでなく、テストごとのタイムアウトを明示し、
  テスト間の状態も片付ける（afterEach でレジストリを戻す）。
- フックが失敗した後に amend しない。未 push の自分のコミットを、些細な整形修正のために
  amend するのは構わない。
