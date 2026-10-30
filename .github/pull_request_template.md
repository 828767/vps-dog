# Pull request template

## What does this PR do?

<!-- One or two sentences. Link the issue it closes: "Closes #12". -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change (interface, schema or config)
- [ ] Documentation / tooling only

## Component(s) touched

- [ ] `worker/` (API, D1, cron)
- [ ] `web/` (SPA)
- [ ] `agent/` (Go)
- [ ] docs / CI

## Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes (worker vitest suite)
- [ ] `cd web && pnpm build` passes
- [ ] `cd agent && go vet ./... && gofmt -l .` is clean (if the agent changed)
- [ ] `docs/CONTRACT.md` updated if a cross-component interface changed
- [ ] `docs/API.md` updated if an endpoint was added or changed
- [ ] New behaviour is covered by tests
- [ ] UI changes verified in **both** themes and at 375 px width
- [ ] No secrets, tokens or `.dev.vars` committed

## Screenshots / evidence

<!-- For UI changes: before/after. For API changes: the curl command and response. -->

## Notes for reviewers

<!-- Anything non-obvious: migration order, trade-offs, follow-up work. -->
