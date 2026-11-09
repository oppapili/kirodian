---
name: retarget-tests-after-upstream-merge
description: upstream を fork にマージした後、失敗テストを upstream 版の採用・ブランド/プロバイダ置換・層状検証で直す。upstream merge test failures・retarget tests・fork sync・provider substitution・typecheck green runtime fail・adopt upstream test version と言われたときに使う。
triggers: upstream merge test failures, retarget tests, fork sync, provider substitution, typecheck green runtime fail, adopt upstream test version
metadata:
  author: oppapili
  version: "1.1.0"
---

## いつ使うか

大きな upstream リリースを下流 fork にマージした後、API リネーム・削除/移動された
挙動・古いプロバイダ参照でテストが落ちるとき。fork が共有/中立 `src` を変えず、
テストだけ追従が要る場合に適用する。司令塔スキル `sync-upstream` から呼ばれる。

## 手順

1. まず失敗の全体像を測る。typecheck を回してエラーをファイル別にまとめる。
   次に、フルテストを別に回す。typecheck が緑でも、実行時が緑とは限らない。
   モックの配線漏れ、移動したハンドラ、古いアサーションといった実行時の失敗は、
   きれいな typecheck の裏に隠れる。

2. 落ちているテストファイルごとに、作業ツリー版と upstream 版の行数を比べ、
   次の2つの戦略から選ぶ。
   - 作業ツリー版と upstream 版の行数がほぼ同じ、または upstream が明らかに正しい目標のとき:
     **upstream のテスト版を採用**し、fork 固有の置換を当てる
     （例: `providerId: 'codex'/'claude'` を自分のプロバイダに、ブランド名のアサーションを置換）。
   - fork 版が意図して小さくしてある（行数が少なく、古いプロバイダ参照がすでにゼロ）とき:
     upstream を丸ごと採用せず、**API 呼び出しを1つずつ修正**する。丸ごと採用すると、
     削除したプロバイダのケースが戻り、意図した軽量化も失われる。

3. テストを削除する前に、その挙動が upstream で本当に廃止されたかを確認する。
   シンボルを upstream の src と upstream のテストの両方で grep する。両方で空なら廃止であり、
   削除してよい。移動しただけなら、新しい場所へ向け直す。

4. 削除・移動された API は、編集する前に後継を探す。現在の src で新しいメソッド名を grep し、
   現在の型・シグネチャを確認し、新 API をすでに使っている隣のテスト（例: worker のハーネス）を見る。
   配線の作法は自分で考えず、そこから写す。

5. 多数の独立したファイルにまたがる、文脈の重い繰り返しの向け直しは、バッチで委任する。
   委任時に次を渡す。
   - 後継 API と配線のスニペット。
   - 置換ルール。
   - 十分なターン数の予算。
   - ファイルごとのテスト実行を必須とすること。

   判断の重い少数のファイルは、自分で持つ。

6. すべての編集の後、層ごとに検証する。
   typecheck → ファイル単位のテスト → フルテスト → lint（import 順の自動修正による差分を許容）
   → build → performance。委任先の「通った」という報告を鵜呑みにせず、自分でフルテストを
   再実行して裏を取る。完了報告ではなく副作用（`git status`、実際のテスト実行）を読む。

## 注意点

- typecheck が通るのは必要条件で、十分条件ではない。フルテストの実行時パスを別に予定する。
- エージェントの完了報告より副作用を信じる。ターン上限に達した worker も、有効な作業を一部
  終えていることがある。想定せず、git とテストで測る。
- 再利用する共有ハーネスは、マージコミットにすでにある場合がある。新規とみなす前に、
  参照しているハーネスが upstream 由来かを確認する（マージコミットを `git show` する）。
- 値として import していたテストを消すと、型だけの import が残ることがある。lint の自動修正
  （`import type`）で直る。そのシンボルが他で使われているかは再確認する。
- 変更は `tests/` だけに収める。src の変更をゼロにすると、fork-policy の分離を保て、
  差分もレビューしやすい。
