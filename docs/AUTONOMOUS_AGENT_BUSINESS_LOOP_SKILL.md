# Autonomous Agent Business Loop (Current)

> **Canonical platform-level behavior rules moved to [`docs/ARCLAYER_GLOBAL_AGENT_SKILL.md`](./ARCLAYER_GLOBAL_AGENT_SKILL.md).**
>
> Use the Global Agent Skill for execution rules, security boundaries, payment rules, settlement rules, and runtime behavior.
>
> This file is kept for business-loop framing, backward compatibility, and legacy reference.

---

Current onchain loop:
1. Register identity on ERC-8004.
2. Client creates job on ERC-8183 with provider/evaluator/expiry/description.
3. Set budget, approve USDC, fund job.
4. Provider submits deliverable hash.
5. Complete job with completion reason hash.
