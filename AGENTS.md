Backend development instructions are maintained in `agents/singalong-backend.agents.md`.

## PR requirements (MANDATORY — do not skip)

**ALWAYS STRICTLY FOLLOW `.github/workflows/pr-conventional-commits.yml` WHEN MAKING PRS.** This applies to every `gh pr create` AND every `gh pr edit` that touches the title or body — no exceptions, no "just this once." Before running either command, re-read that workflow file if there's any doubt about the current rules; do not rely on memory or a template that may be stale. A PR that fails this check blocks the rest of CI from being useful and has to be fixed after the fact — get it right on the first attempt.

When creating a pull request with `gh pr create`, you MUST follow these rules. The CI check in `.github/workflows/pr-conventional-commits.yml` will reject PRs that don't comply.

### Title

Must match Conventional Commits: `type(scope)?(!)?: subject`

Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `build`, `ci`, `revert`

```
✅ feat(login): add remember-me checkbox
✅ fix: guard recover_pending_downloads against StaleDataError
❌ feat: move client to root + fix stale guest auth (#33, #30)  — no summary-style titles
```

### Body

Must include these three headers — use the template from `.github/pull_request_template.md`:

```
## Summary

(one or two sentences describing the change)

## Motivation

(why is this change needed, link issues)

## Testing

(how was this tested, provide steps and results)
```

The CI will grep for `## Summary`, `## Motivation`, and `## Testing` at the start of lines. Missing any = rejected PR.
