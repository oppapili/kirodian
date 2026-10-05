# Contributing to Kirodian

Issues and pull requests are welcome. Issues are the preferred way to contribute: if you describe the problem and your environment clearly, I will review it and make a best effort to address it.

## Before You Start

- Search existing issues and pull requests to avoid duplicates.
- For a substantial change, open an issue first so the problem and scope can be discussed before implementation.
- Keep each pull request focused on one problem. Unrelated fixes, refactors, formatting changes, or dependency updates should be submitted separately.

## Reporting an Issue

A useful issue explains the problem well enough for someone else to understand and reproduce it. Please include:

- What you were trying to do.
- What happened and what you expected instead.
- Clear reproduction steps or a minimal example.
- Your Kirodian version, Obsidian version, operating system, provider, provider CLI version, and installation method.
- Relevant logs, screenshots, or recordings.

Remove API keys, tokens, private vault content, personal paths, and other sensitive information before attaching logs or screenshots.

For a feature request, start with the user problem or unmet use case. A proposed solution is helpful, but explaining the need is more important than prescribing an implementation.

## Pull Requests

Pull requests are welcome when they solve a specific, well-defined problem. A pull request description must explain:

- **Why:** the problem being solved, who it affects, and why it is worth solving.
- **What:** the behavior or code that changes.
- **Why this approach:** why the proposed design is a good fit, including meaningful alternatives and tradeoffs.
- **Validation:** tests and manual checks performed, with screenshots or recordings for user-facing changes.
- **Impact:** known limitations, compatibility or data risks, and any follow-up work.
- **Context:** a linked issue when one exists.

Please also:

- Add or update tests for behavior changes and bug fixes.
- Preserve provider and feature ownership boundaries; avoid coupling shared feature code to provider internals.
- Avoid new production dependencies unless the need and tradeoff are explicit.
- Update documentation when behavior or user-facing configuration changes.

## Code Review (@kiro)

This repository runs an on-demand AI code review powered by Kiro CLI
(`.github/workflows/kiro-review.yml`). It is **advisory** — a helper, not a
required check. The quality gate remains human review plus the `ci.yml` checks
(typecheck, lint, test, build, performance).

### Using it

Comment `@kiro` on a pull request. The workflow runs Kiro CLI against the PR diff
and posts its review. There is no automatic trigger — the review runs only when
you ask for it with a comment.

### Enabling it on a fork

The workflow needs a `KIRO_API_KEY` secret, which is **not** inherited from the
upstream repository. Without it the review step skips and CI stays green, so a
fork does nothing until you opt in:

1. Obtain a Kiro CLI API key. A Kiro **Pro / Pro+ / Power** subscription is
   required; the free tier cannot run the review.
2. Add the key as an Actions secret on your fork, either via the CLI:

   ```bash
   gh secret set KIRO_API_KEY --repo <your-account>/kirodian
   ```

   or in the GitHub UI under **Settings → Secrets and variables → Actions → New
   repository secret**, named `KIRO_API_KEY`.
3. Open a pull request on your fork and comment `@kiro` to trigger a review.

The review agent is defined by `.kiro/agents/code-reviewer.json` on the default
branch (read-only tools; it cannot write files or run shell commands).

## Versioning & Releases

Kirodian is a fork of Claudian and versions independently. Claudian-derived tag
history is not carried over; the fork restarts its own line from `0.x`.

- **Source of truth:** `manifest.json`'s `version` is the single source of truth
  for the plugin version. Each release has a matching git tag (no `v` prefix,
  e.g. `0.3.0`) and GitHub Release at the same version.
- **`versions.json`:** records `"<plugin_version>": "<minAppVersion>"` so
  Obsidian can resolve the right build per app version. `npm version <type>
  --no-git-tag-version` runs `scripts/sync-version.js`, which syncs
  `manifest.json` to `package.json`'s version and adds/updates the matching
  `versions.json` entry; both files are staged automatically. The
  `--no-git-tag-version` flag is required: this repo uses `v`-less tags and a
  protected `main`, so the version bump lands through a PR and the tag is created
  by hand afterwards (see **Release procedure** below), not by `npm version`'s
  default commit-and-`v`-tag behaviour.

### Bump type and labels

The version bump for a change follows its issue label (and Conventional Commit
type):

- `breaking` (or `feat!` / a `BREAKING CHANGE:` commit footer) -> **major** (X).
  Examples: an incompatible settings-file format change, a renamed command ID, a
  breaking integration API.
- `enhancement` (feat) -> **minor** (Y). A backward-compatible feature.
- `bug` (fix) / `documentation` (docs) -> **patch** (Z).

### 0.x exception

Under SemVer, `0.x` is an unstable range with no backward-compatibility
guarantee. During `0.x`, breaking changes are absorbed into the **minor**
(`0.Y`) and `X` stays `0`. Major = breaking only takes effect once `1.0.0` is
reached.

`1.0.0` is reached when the Obsidian community-plugin submission is complete and
the public API — the settings-file format, command IDs, and public interfaces —
can be declared stable.

### Branching

Kirodian follows GitHub Flow: `main` plus short-lived `feature/xxx` / `fix/xxx`
branches merged via pull request. `main` is always releasable. Because the plugin
ships as a single artifact, there is no long-lived `develop` branch.

Milestones are named after target versions (e.g. `0.3.0`, `1.0.0`) to group the
issues a release includes.

### Release procedure

1. Bump the version with `npm version <major|minor|patch> --no-git-tag-version`.
   This updates `manifest.json` and `versions.json` via `scripts/sync-version.js`
   and stages both files, **without** creating a commit or a `v`-prefixed tag.
2. Commit the bump on a short-lived branch and open a PR; merge it into `main`.
   `main` is a protected branch, so the version bump cannot be pushed to it
   directly — it lands through the PR like any other change.
3. On the updated `main`, create a `v`-less tag at the release commit (e.g.
   `0.3.0`, matching `manifest.json`) and push it. Pushing the tag is the release
   trigger. The tag push is done by a human: the KiroCrew git-publish floor
   rejects pushes made by an agent.
4. `.github/workflows/release.yml` runs CI verification, builds the plugin, and
   creates a GitHub Release with `main.js`, `manifest.json`, `styles.css`, and
   `versions.json` attached. A tag whose name contains a hyphen (a SemVer
   pre-release identifier, e.g. `0.3.0-beta.1`) is published as a GitHub
   pre-release; see the beta/pre-release procedure in
   `.kiro/steering/release-and-labels.md`.
5. `scripts/check-release-version.mjs` enforces that the tag,
   `package.json`'s version, and `manifest.json`'s version all match before the
   release is published.

## New Provider Policy

Pull requests that add a new provider are not accepted.

This is a maintenance and product-quality boundary:

1. I am the sole maintainer of this project and remain responsible for every integration after it is merged. If I do not use a provider myself, I cannot test and maintain its integration responsibly over time.
2. Integrated providers must offer a broadly consistent feature set and user experience. Past attempts have shown that partial integrations are difficult to bring to parity and keep reliable.
3. Some provider CLIs do not currently expose the capabilities required for a complete integration. For example, Antigravity CLI does not expose ACP or a comparable integration protocol, and Cursor CLI does not allow the system prompt to be customized fully.
4. Integrating a separate CLI from every model vendor is not sustainable. Claude Code and Kiro CLI can already use alternative model endpoints through configuration. Inside an Obsidian vault, switching the underlying harness usually provides limited additional value compared with the ongoing integration and maintenance cost.

You may open an issue to describe an unmet provider-related use case, but please do not submit a new-provider implementation. An issue does not imply that the provider will be added.

Contributions that improve an existing provider are welcome when they follow the focused pull request requirements above and preserve the expected cross-provider experience.

## Development

Kirodian requires the Node.js version declared in `.node-version`.

```bash
npm install
npm run dev
```

For a bug fix or new behavior, add or update a failing test first, then make the narrowest implementation change that passes it. Use focused checks while iterating. Before submitting a pull request, run the full verification suite:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run check:performance
```

For local iteration, `npm run test:affected -- --base origin/main` selects tests from
committed, staged, unstaged and untracked changes using the CI dependency graph.
It prints the selection and runs the selected Jest and script checks.
Use `--list` to inspect without running, `--full` for all tests, and `-- --runInBand` to forward Jest
options. Unknown inputs or an unavailable base retain full coverage. This does not
replace typecheck, lint, build/performance checks or native checks on other platforms.

Full Linux CI verification uses two Jest shards, with script checks on the first
shard. Affected selections use one job. Each Linux test job uses three workers.
Both shards must pass the aggregate test gate, and each uploads its own timing artifact. Sharding uses more runner capacity
to reduce elapsed time; compare runner minutes as well as wall time.

JSON Jest runs also produce suite timings and execution metadata. CI uploads these
for Linux, native smoke and scheduled suites. To compare native worker counts locally:

```bash
npm run test:cross-platform -- --maxWorkers=2 --json --outputFile=.context/native.json
node scripts/summarize-jest-results.mjs .context/native.json .context/native-timings
```

CI runs native smoke with three workers on both macOS and Windows. The local wrapper
remains serial unless a worker count is supplied. Compare the same selection and
commit, including fixture setup/teardown, and report elapsed time separately from
summed suite durations. Recheck timings on the actual CI runners before increasing
concurrency further.

The project architecture and area-specific development rules are documented in `AGENTS.md` and the scoped `AGENTS.md` files under `src/`.
