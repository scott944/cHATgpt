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
