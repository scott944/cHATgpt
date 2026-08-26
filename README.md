# cHATgpt
Greater Transfer 

## Claude Code GitHub Action

`.github/workflows/claude.yml` runs [`anthropics/claude-code-action@v1`](https://github.com/anthropics/claude-code-action).
Mention `@claude` in an issue, an issue comment, a PR review, or a PR review comment
and Claude will respond on the thread — answering questions, reviewing the diff, or
pushing commits to a `claude/` branch.

### Setup

The workflow needs one repository secret:

| Secret | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Authenticates the action against the Anthropic API |

Add it under **Settings → Secrets and variables → Actions**, and install the Claude
GitHub App on this repository. Running `/install-github-app` from the `claude` CLI
does both steps for you.

To use an OAuth token instead of an API key, swap the `anthropic_api_key` input for
`claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`.

### Manual runs

`.github/workflows/claude-base.yml` runs
[`anthropics/claude-code-base-action@beta`](https://github.com/anthropics/claude-code-base-action)
on `workflow_dispatch`. Trigger it from the **Actions** tab with a prompt, an optional
`--allowedTools` allowlist, and a turn limit; the execution log is uploaded as a
`claude-execution-log` artifact. It uses the same `ANTHROPIC_API_KEY` secret.

The base action is a thin wrapper with no trust boundary of its own, so this workflow
is deliberately `workflow_dispatch`-only — dispatch requires write access, which keeps
the prompt trusted. Anything driven by untrusted input (issue bodies, fork PRs,
external comments) belongs in `claude.yml`, which does the actor permission checks.

### Automatic test fixes

`.github/workflows/autofix.yml` runs
[`enriconunes/claude-autofix-action`](https://github.com/enriconunes/claude-autofix-action)
on pull requests against `main`. When the test suite fails it posts a diagnosis comment
and opens a follow-up PR with a proposed fix.

Two things to know:

- **It is inert today.** This repository has no test suite, so the action finds zero
  failures and skips its analyse and fix steps. It starts doing work once tests land
  under `tests/` (pytest) or a JS/TS runner is configured — adjust the `language` and
  `test-framework` inputs then.
- **It is a third-party action** that receives `ANTHROPIC_API_KEY`, unlike the two
  workflows above. It is pinned to the commit SHA that `v2.1.2` points at rather than
  the tag, because a lightweight tag can be repointed at new code by its owner. Bump
  the SHA and its trailing version comment together.

It also needs **Settings → Actions → General → Workflow permissions** set to
*Read and write*, with *Allow GitHub Actions to create and approve pull requests*
enabled, so it can open the fix PR.
