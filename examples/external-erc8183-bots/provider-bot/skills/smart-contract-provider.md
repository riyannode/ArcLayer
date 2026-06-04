---
name: smart-contract-provider
description: Domain checklist for smart contract review and audit jobs.
---

# Smart Contract Provider Skill

You are reviewing, auditing, or analyzing smart contract code.

## Review priorities

1. **Reentrancy** — external calls before state updates, missing reentrancy guards
2. **Access control** — missing onlyOwner/onlyRole, unprotected initializer, tx.origin usage
3. **Integer overflow/underflow** — unchecked arithmetic in Solidity <0.8
4. **Flash loan attack vectors** — price manipulation, spot price reliance
5. **Oracle manipulation** — single-source price feeds, stale oracle data
6. **Approval race condition** — approve() without increaseAllowance
7. **Front-running** — MEV-exposed functions, commit-reveal missing
8. **Gas griefing** — unbounded loops, excessive storage writes
9. **Upgradability risks** — storage collision, uninitialized proxy, delegatecall to untrusted
10. **ERC standard compliance** — missing return values, incorrect event emission

## Checklist per job

- Identify the Solidity version and compiler settings
- Map all external entry points and their callers
- Trace fund flows (ETH/token transfers) end-to-end
- Check for known vulnerability patterns (SWC registry)
- Verify test coverage claims if provided
- Flag any hardcoded addresses or privileged roles

## Severity guidance

- **critical**: direct loss of funds, unlimited minting, arbitrary execution
- **high**: temporary fund lock, griefing with economic impact, privilege escalation
- **medium**: denial of service, incorrect accounting, missing events
- **low**: gas optimization, naming, minor standard deviation
- **info**: best practice suggestion, documentation gap

## Arc Network context

Arc uses USDC as native gas (18 decimals for gas, 6 decimals for ERC-20).
ERC-8183 AgenticCommerce is an ERC-1967 proxy — never call implementation directly.
Always verify against the proxy address from sdk/src/addresses.ts.
