---
name: assess-upstream-merge-cost
description: upstream との乖離を測り、データに基づく段階マージ境界を導く。大きな追従マージに着手する前に、追従コストを見積もる。upstream追従・fork sync・large merge・merge conflict estimate・staged merge・段階追従・upstream 2.3.x と言われたときに使う。
triggers: upstream追従, fork sync, large merge, merge conflict estimate, staged merge, 段階追従, upstream 2.3.x
metadata:
  author: oppapili
  version: "1.1.0"
---

## いつ使うか

fork が大きく進んだ upstream に追従しなければならず、単一マージで足りるか段階に
割るべきかを決めたいとき。コードに触れる前に、コスト見積もりと恣意的でない段階計画を
出すために使う。司令塔スキル `sync-upstream` から最初に呼ばれる。

## 手順

1. upstream を fetch し、素の差分を測る。
   - `git fetch upstream --tags`
   - `git rev-list --count origin/main..upstream/main`（upstream が先行している数）
   - `git rev-list --count upstream/main..origin/main`（こちらの乖離数）
   - `git diff --stat $(git merge-base origin/main upstream/main)..upstream/main | tail -1`
     （merge base 以降のファイル数・行数）
2. 変更を領域ごとに分ける。`git diff --dirstat` やディレクトリ別の `--stat` で、次を分けて数える。
   - 削除済みプロバイダのディレクトリ（機械処理: keep-ours / 削除）。
   - 共有層・中立層（判断が重い統合）。
   - fork 独自の資産。
   - テスト。
3. 使い捨て worktree で dry-run merge を行い、実際の衝突数を得る。
   - `git worktree add ../scratch-merge origin/main`
   - その中で `git merge --no-commit --no-ff upstream/main` を実行し、
     `git diff --name-only --diff-filter=U | wc -l` で件数を数え、ディレクトリ別に分類する。
   - `git merge --abort` を実行し、`git worktree remove ../scratch-merge` で片付ける。
4. 単一マージか段階マージかを決める。判断を要する衝突（共有層と fork 独自資産）が多い場合や、
   upstream が squash / rebase で履歴を積んでいて PR 単位で割れない場合
   （`git log --merges` が空かで確認する）は、リリースタグに沿って段階マージにする。
5. 段階の境界は、累積ではなくタグ間の**増分**サイズから非恣意的に決める。
   各タグの組について `git diff --stat tagA..tagB` を測り、次のように切る。
   - 累積変更が閾値（目安は約200ファイル）を超える手前で切る。
   - 大きなリファクタや一括リネームのリリースは単独の段に分ける。
     リネーム追従と機能追従が重ならないようにする。
6. 重いリリースの性格を、リリースノート・CHANGELOG・squash コミット件名の PR 番号
   （`git log --oneline tagA..tagB`）から読む。各段を番号だけでなく意図に対応づける。
7. 段の表（段 → 対象タグ → 変更の性格 → 理由）を作る。各段の受け入れ条件は次のとおり。
   - マージする。
   - 削除プロバイダの衝突を機械処理する。
   - 共有層を意図に沿って統合する。
   - フル検証が緑になる。
   - PR を出す。

## 注意点

- 見出しの衝突数は誤解を招く。削除プロバイダ由来の衝突と古いテストの衝突は機械処理で済むので、
  実作業量は大きく減る。実現性を判断する前に、必ず分類する。
- 中立層（共有プロバイダレジストリ等）が衝突ゼロで自動マージできたなら、fork が層の境界を
  きれいに保てているという合図。思い込まず、確認する。
- squash / rebase の履歴には merge commit が無い。PR 単位では割れず、tag 単位でしか割れない。
- fork が除外したい新プロバイダが upstream に増えていないかを見る。中立層がそれに依存する
  コードを引き込んでいないか、段ごとに確認する。
- 使い捨て worktree は必ず片付ける（`git worktree remove`）。`git merge --abort` も実行し、
  dry-run の痕跡を残さない。
- 切りのよいバージョン番号で切らない。境界は、測った増分とリファクタの切り分けから導く。
