# Contributing to ArcLayer

Thanks for your interest! Here's how to contribute.

## Getting started

1. Fork the repo.
2. Create a branch from `main`: `git checkout -b feat/your-feature`.
3. Make your changes.
4. Run validation: `node --check` on JS files, `npx tsc --noEmit` for TypeScript.
5. Commit with conventional commit format: `feat:`, `fix:`, `chore:`, `docs:`.

## Code style

- Follow existing patterns (see `sdk/`, `apps/console/`, `examples/`).
- Keep it simple. No unnecessary abstractions.
- No secrets in commits — `.env.*` files are gitignored.

## PR guidelines

- One feature per PR.
- Link related issues if any.
- Keep diffs focused — no unrelated changes.
- PR title should follow conventional commit format.

## Questions

Open a discussion or issue. We keep things informal.
