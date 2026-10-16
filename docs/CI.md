# CI/CD

Everything runs on GitHub Actions. The workflows live in `.github/workflows/`.

## Pipelines

| Workflow          | Runs when                                          | What it does                                                                                                                                                                                                                                                            |
| ----------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`          | Every PR, every push to `main`, or by hand         | Lint, format, typecheck, unit tests, catalog validation, and build on Node 20 and 22. A Windows smoke test. An end-to-end job that starts the mock server and runs the built CLI with SRV-01. The report is saved as an artifact.                                       |
| `pr-checks.yml`   | Every PR (opened, edited, or updated)              | The `Linked issue` check fails unless the PR closes an issue. Dependabot PRs are exempt.                                                                                                                                                                                |
| `conformance.yml` | Mondays 14:00 UTC, or by hand from the Actions tab | Builds the official x402 TypeScript example server at the pinned spec commit, runs the suite against it and against our mock server, and posts a compatibility grid on the run's summary page. Implementation failures don't fail the workflow. Only broken setup does. |
| `release.yml`     | Pushing a tag like `v0.1.0`                        | Checks that the tag matches `package.json`, runs `npm run check`, publishes to npm with provenance, and creates a GitHub release with generated notes.                                                                                                                  |

`dependabot.yml` opens weekly PRs for npm and GitHub Actions updates. TypeScript is held below 6.1 until typescript-eslint supports it.

## Branch protection

`main` is protected by the ruleset in [`.github/rulesets/main.json`](../.github/rulesets/main.json):

- No direct pushes for contributors. Their changes land only through pull requests.
- Each PR needs 1 approving review, and all review threads must be resolved. A new push dismisses earlier approvals.
- These checks must pass: `Check (Node 20)`, `Check (Node 22)`, `Windows smoke test`, `End to end (CLI vs mock server)`, `Linked issue`.
- No force pushes, and `main` can't be deleted.
- Repository admins (currently only @adichaudhary) bypass these rules and can push to `main` directly. Everyone with write access (contributors) must go through a PR. To give someone else this power, make them an admin. To take it away from yourself, change `bypass_mode` in the ruleset to `pull_request`.

To change the rules, edit the JSON and reapply it:

```bash
# first time
gh api -X POST repos/adichaudhary/x402-conformance-lab/rulesets --input .github/rulesets/main.json
# later updates (find the id with: gh api repos/adichaudhary/x402-conformance-lab/rulesets)
gh api -X PUT repos/adichaudhary/x402-conformance-lab/rulesets/<id> --input .github/rulesets/main.json
```

If a job is renamed in a workflow, update the matching `context` in the ruleset. Otherwise PRs wait forever on a check that never reports.

## Releasing

1. Open a PR that bumps `version` in `package.json` (for example to `0.1.0`), and merge it.
2. Tag the merge commit and push the tag:
   ```bash
   git checkout main && git pull
   git tag v0.1.0 && git push origin v0.1.0
   ```
3. `release.yml` publishes `x402-conformance@0.1.0` to npm and creates the GitHub release.

One-time setup: create an npm automation token and save it as the repository secret `NPM_TOKEN` (Settings, then Secrets and variables, then Actions). The workflow uses a GitHub environment named `npm`. Add required reviewers to that environment if you want a manual approval before every publish.

## Adding an implementation to the scheduled run

Copy the `official-typescript` job in `conformance.yml`, change the build and start steps, point it at the new config in `configs/implementations/`, upload the report as `report-<name>`, and add the job to the `needs` list of the `grid` job.
