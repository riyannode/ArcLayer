# ArcLayer Production Runbook

Live external agent 24/7 operations guide for Arc Testnet.

## System Architecture

```
External Runtime (worker/provider)
  │  x402 autopay
  ▼
Circle Gateway / x402
  │
  ├── Bridge Rail (x402_offchain)
  │   └── /api/agent-bridge/events → Supabase
  │   └── /api/agent-bridge/sessions → View or scan
  │
  └── ERC-8183 Escrow Rail (erc8183_escrow)
      └── /api/erc8183-jobs/* → On-chain contracts + Supabase
      └── Arc Testnet: ERC-8183 AgenticCommerce
```

## Pre-Deployment Checklist

- [ ] `SUPABASE_PROJECT_REF` and `SUPABASE_SERVICE_ROLE_KEY` set in Vercel env
- [ ] `npm run check:schema` passes (columns + RPC functions)
- [ ] All 4 x402 RPC functions exist in Supabase
- [ ] `bridge_session_summary` view exists (optional, auto-fallback)
- [ ] ERC-8004 IdentityRegistry deployed and readable
- [ ] ERC-8183 AgenticCommerce deployed and funded
- [ ] USDC approval gates functional

## Health Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health/schema` | Column + RPC function existence |
| `GET /api/rails/overview` | Rail routing status |
| `GET /api/agent-bridge/sessions` | Bridge session activity |
| `GET /api/erc8183-jobs` | Escrow job list |

## Monitoring

### Required Alerts (4xx/5xx spikes)

Monitor these on Vercel Analytics or custom:

| Metric | Threshold | Action |
|--------|-----------|--------|
| 4xx rate | >5% of requests | Check API key validity, participant mismatch |
| 5xx rate | >1% of requests | Check Vercel logs, Supabase connectivity |
| `participant_mismatch` 403s | >3 in 5 min | Investigate API key rotation |
| `payload_hash_mismatch` 400s | >3 in 5 min | Verify bot hashing algorithm (canonical stable stringify) |
| Schema degraded | `ok: false` | Run `npm run check:schema`, apply missing migration |

### Escalation

1. Check Vercel deployment logs: `vercel logs --prod`
2. Check runtime logs: `pm2 logs <bot-name>`
3. Check Supabase status: `npm run check:schema`
4. Check on-chain: `cast call <AgenticCommerce> "getJob(uint256)(...)`

## Incident Response

### API Key Compromised

1. Revoke key: DELETE from `api_keys` in Supabase dashboard
2. Rotate affected bot's key
3. Monitor for unauthorized job mutations

### Schema Migration Failed

1. Identify missing migration: `SUPABASE_PROJECT_REF=<ref> SUPABASE_SERVICE_ROLE_KEY=<key> npm run check:schema`
2. Apply missing migration: `supabase migration up --linked`
3. Re-run schema health

### On-Chain Transaction Failure

1. Check tx hash on Arc Testnet explorer
2. Verify USDC allowance: `cast call <USDC> "allowance(address,address)(uint256)"`
3. Verify agent registration: `cast call <IdentityRegistry> "ownerOf(uint256)(address)"`

## Recovery Drills

### Runtime Restart

```bash
pm2 restart all          # Full restart
pm2 resurrect            # Restore saved process list
pm2 save                 # Save current list after changes
```

### Bot Full Cycle (ERC-8183)

Expect: create → set-budget → approve → fund → claim → running → submit → complete

Test:
```bash
pnpm --filter examples exec tsx scripts/test-erc8183-full-cycle.ts
```

### Database Reset (dev only)

```bash
supabase db reset --linked
npm run check:schema
```

## Production Gate

Do not operate live until:

- [ ] All 9 loopholes from build plan are closed
- [ ] `npm run test:console` passes
- [ ] 5 full ERC-8183 external bot cycles pass
- [ ] Runtime restart/idempotency test passes
- [ ] Revoked API key cannot write
- [ ] Wrong participant API key receives 403
- [ ] Wrong bridge payload hash receives 400
- [ ] Monitoring exists for all required metrics

## Safe Production Wording

> "ArcLayer is production-candidate for external 24/7 agents on Arc Testnet, with isolated Bridge Rail and ERC-8183 Escrow Rail, pending continued live monitoring."
