---
inclusion: always
---

# Kirodian 開発方針

Kirodian は [Claudian](https://github.com/YishenTu/claudian) の Fork である。この文書は
Kirodian に固有の開発方針を定める。Claudian 由来の規約は `AGENTS.md` およびスコープ別
`AGENTS.md` に従う。矛盾する場合はこの文書が優先される。

## 1. プロジェクトの位置付け

Kirodian は Claudian の Fork として開発する。目的は次の一文に集約される。

> Claudian の Obsidian 上での AI Agent 体験を維持しつつ、Kiro CLI を利用可能にすること。

完全な別実装は作らない。Claudian を upstream として継続的に取り込む。

```text
Claudian (upstream)
       │  upstream changes
       ↓
   Kirodian ── Kiro CLI 対応
```

## 2. 設計原則: 作り直しではなく Provider 追加

Kiro CLI 対応は「Claudian を作り直す」のではなく、
「Claudian に Kiro CLI という新しい Agent backend を追加する」形で実装する。

- Kiro プロバイダは `src/providers/kiro/` に隔離する。
- Kiro CLI は ACP (`kiro-cli acp`, JSON-RPC over stdio) で接続する。共有 ACP 層
  (`src/providers/acp/`) を再利用し、Grok プロバイダを雛形とする。
- 既存プロバイダ (claude / codex / grok / opencode / pi) の挙動は変更しない。
- プロバイダ登録は `src/providers/index.ts` と `src/providers/defaultProviderConfigs.ts`
  への追加で行い、Claudian 中立層 (`src/core/`) には Kiro 固有の分岐を持ち込まない。

## 3. バージョニング

Claudian とは独立したバージョン番号を持つ。初期リリースは `v0.1.0` から開始し、
正式版として十分安定した段階で `v1.0.0` とする。SemVer に従う。

各 Release および README で upstream の対応バージョンを明示する。

```text
Kirodian v0.1.0
Based on Claudian v2.2.6
```

これにより Kirodian 自身のバージョンと upstream Claudian のバージョンを明確に分離する。

## 4. upstream への追従

Claudian を `upstream` remote に設定し、更新を定期的に取り込む。

```bash
git remote add upstream https://github.com/YishenTu/claudian.git
git fetch upstream --tags
git merge upstream/main
```

Claudian の更新を取り込むことを前提とした開発構造を維持する。

## 5. Kiro 固有変更の分離

Claudian 本体への変更と Kiro CLI 対応の変更を Git 上でも論理的に分離する。
upstream マージ時の衝突を最小化し、将来の還元を容易にするため、Kiro 固有実装は
できるだけ独立したファイル・ディレクトリに閉じ込める。

- Kiro 固有ロジック: `src/providers/kiro/` に集約する。
- 共有層への変更が避けられない場合は、その理由をコミットメッセージに明記する。
- 作業ブランチは `feature/kiro-*` を用いる。

## 6. 開発の優先順位

1. Claudian の既存機能を維持する。
2. Kiro CLI を Claudian の Provider として統合する。
3. Kiro CLI 固有の Session 操作を実装する。
4. Kiro CLI の出力・イベントを Claudian UI へ適切に変換する。
5. 必要に応じて Kiro 固有機能を追加する。

## 7. 将来的な方向性

Kirodian で先行して Kiro CLI 対応を実装し、十分成熟したら Claudian 本家への PR として
還元する可能性を残す。そのため Kiro 固有実装は独立した構造を保つ。

```text
Claudian
   ↑  Kiro 対応を還元
Kirodian
```

## 一言でまとめると

Kirodian は Claudian の Kiro CLI 対応 Fork。バージョンは独立して `v0.1.0` から開始し、
Claudian を upstream として追従。Kiro 固有の変更を分離して実装し、将来的には Claudian
本家への還元も可能な構造にする。
