# arc-x402-agent-starter

Starter kit ArcOSS untuk wallet connect, x402 paywall, paid register-agent, paid create-job, dan proof receipt.

## Quickstart
1. Copy `.env.example` ke `.env.local`
2. `pnpm install`
3. `pnpm dev`

## Primitive list
- Wallet connect (demo hook)
- x402 protected-resource pay button
- register-agent gate
- create-job gate
- premium proof receipt

## Architecture
Lihat `docs/ARCHITECTURE.md`.

## x402 flow
Lihat `docs/X402_FLOW.md`.

## Agent flow
Lihat `docs/AGENT_FLOW.md`.

## Job flow
Lihat `docs/JOB_FLOW.md`.

## Proof flow
`/proof` membaca receipt dari API premium proof.

## Real vs demo-only
- Demo-only default: connect wallet, register, create job.
- Real mode: isi env contract address + ABI dan ganti hook mock ke wagmi write contract.

## How to extend
Mulai dari `src/hooks/useAgentRegistry.ts` dan `src/hooks/useJobFlow.ts`.

## ArcOSS submission note
Repo ini terpisah dari ArcLayer utama dan fokus sebagai starter kit.


## Demo mode vs real mode
- Demo mode: API gates accept any `X-PAYMENT` payload and return demo tx hashes/IDs so builders can run the starter without deployed contracts.
- Real mode: keep the same primitives but wire API verification to x402 settlement backend and replace demo register/create-job hooks with real `writeContract` calls.

## Build instructions
```bash
pnpm install
pnpm build
```
