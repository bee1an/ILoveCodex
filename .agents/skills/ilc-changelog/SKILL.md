---
name: ilc-changelog
description: Write and update the ilovecodex repository changelog in CHANGELOG.md using package.json version, Git tags, and Git history. Use when asked to write changelog, update release notes, summarize changes from the previous tag to the current commit, or generate a new release section for this repository from Git changes, including requests such as “写 changelog”, “更新发布日志”, or “根据 tag 到当前提交生成版本说明”.
---

# ILC Changelog

This skill is only for the `ilovecodex` repository. It writes the root `CHANGELOG.md` and defaults to summarizing changes from the previous release tag to the current commit.

## Workflow

1. Assume the working directory is the repository root.
2. Run `python3 skills/ilc-changelog/scripts/collect_release_context.py --json` first.
3. Read `references/changelog-format.md` before drafting or editing the changelog.
4. Inspect the current `CHANGELOG.md` so the new section is inserted below the intro, not appended to the bottom.
5. Draft one new release section with the current `package.json` version and today's date.

## Defaults

- Default output target: root `CHANGELOG.md`
- Default version source: `package.json`
- Default Git range: previous reachable release tag to `HEAD`
- If `HEAD` is already tagged, use the next older reachable tag so the range stays non-empty.
- If no earlier tag exists, fall back to full reachable history and state that fallback in the draft notes or working summary.

## Overrides

- If the user gives a version, tag, or target ref, honor it over the defaults.
- Use `--from-tag`, `--to-ref`, and `--version` on the helper script when the release range must be overridden.

## Writing Rules

- Write for end users, not maintainers reading commit logs.
- Merge related commits into a few high-signal bullets.
- Do not dump raw commit subjects verbatim.
- Keep low-signal docs-only or internal-only maintenance out of the main bullets unless it materially affects users or release flow.
- Preserve the existing changelog style used in this repository.
