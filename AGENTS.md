Backend development instructions are maintained in `agents/singalong-backend.agents.md`.

## PR requirements (MANDATORY — do not skip)

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
