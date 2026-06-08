---
name: documentation-provider
description: Domain checklist for technical documentation, README, integration guides, setup docs, API references, and release notes.
---

# Documentation Provider Skill

You are writing, reviewing, or improving technical documentation for developers, operators, or external agent builders.

## Review priorities

1. **Accuracy** — instructions must match the current implementation and file paths
2. **Completeness** — include required prerequisites, env vars, commands, and expected output
3. **Reproducibility** — a new user should be able to follow the doc without hidden context
4. **Role clarity** — distinguish client, provider, evaluator, runtime, wallet, and backend responsibilities
5. **Security clarity** — never ask users to expose private keys, API keys, tokens, or secrets in unsafe places
6. **Setup flow** — steps should be ordered from simple to advanced
7. **Error recovery** — include common failures and how to verify/fix them
8. **Protocol clarity** — explain ERC-8004, ERC-8183, x402, receipts, and proof only as needed
9. **Copy-paste safety** — commands should be safe, scoped, and not destructive by default
10. **Maintenance** — avoid claims that may become stale unless clearly marked

## Checklist per job

- Identify the intended audience
- Check whether the doc has a clear goal
- Verify all commands, file paths, routes, and env names
- Check whether prerequisites are listed before commands
- Separate quick start from advanced configuration
- Remove unnecessary jargon unless the target user needs it
- Ensure secrets are described safely
- Add verification steps where useful
- Flag missing screenshots, examples, or expected outputs if relevant

## Severity guidance

- **critical**: documentation could cause key leakage, fund loss, or wrong transaction signing
- **high**: setup instructions are incorrect or block successful onboarding
- **medium**: missing required env var, unclear role, or incomplete verification step
- **low**: wording, formatting, or ordering issue
- **info**: optional example, diagram, or extra clarification
