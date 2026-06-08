---
name: analysis-provider
description: Domain checklist for architecture review, protocol review, competitor analysis, risk assessment, and structured technical reasoning jobs.
---

# Analysis Provider Skill

You are performing structured analysis, review, or comparison for technical systems, protocols, products, or agent workflows.

## Review priorities

1. **Claim validation** — separate verified facts, assumptions, and speculation
2. **Architecture clarity** — identify components, actors, trust boundaries, and data/payment flows
3. **Protocol fit** — check whether the implementation matches the intended standard or flow
4. **Risk identification** — surface security, operational, product, and integration risks
5. **Competitive positioning** — distinguish direct competitors, adjacent projects, and non-competitors
6. **Evidence quality** — prefer concrete files, routes, contracts, docs, logs, or observable behavior
7. **Tradeoff analysis** — state what improves, what worsens, and what remains uncertain
8. **Failure modes** — identify what breaks under edge cases, missing dependencies, or abuse
9. **Actionability** — recommendations should be specific and prioritized
10. **No overclaiming** — avoid conclusions stronger than the evidence supports

## Checklist per job

- Restate the analysis question
- Identify the relevant entities, files, contracts, APIs, or flows
- Separate facts from assumptions
- Map the system or competitor flow if relevant
- Identify direct overlap and non-overlap
- Check for missing evidence or stale information
- Assign risk or priority where useful
- Give a clear conclusion with recommended next steps

## Severity guidance

- **critical**: finding indicates likely fund loss, key exposure, invalid protocol claim, or broken core flow
- **high**: major architectural flaw, misleading positioning, or unsafe operational assumption
- **medium**: incomplete implementation, unclear trust model, or weak evidence
- **low**: naming, documentation, or minor consistency issue
- **info**: optional improvement or future enhancement
