# End-to-End Proofs

Verified protocol execution proofs on Arc Testnet.

---

## x402 Facilitator — Production E2E

Paid agent run completed end-to-end on production (`https://arclayers.xyz`).

| Step | Result |
|---|---|
| No payment → `402` + `PAYMENT-REQUIRED` | ✅ |
| `createJob` on Arc Testnet | ✅ jobId `13` |
| `setBudget` + `approve USDC` + `fund escrow` | ✅ `JobFunded` emitted |
| `POST /api/x402/verify` | ✅ `verified` |
| `POST /api/x402/settle` | ✅ `settled` |
| `POST /api/agents/demo/run` first run | ✅ `200`, agent executed |
| Retry same payment | ✅ `200`, `cached: true` |
| Same txHash → different resource | ✅ rejected `PAYMENT_REPLAY_DIFFERENT_RESOURCE` |

- **txHash**: `0x3b5578f304970f3e91fa36e3de1af2c389dd4c01f2c3d17040fca7e020ae80d9`
- **jobId**: `13`
- **model**: `gpt-5.5` through an OpenAI-compatible agent endpoint
- **output**: `Hello. Task received for Agent ID demo, Job ID 13.`
- **latency**: `2724ms`
- **E2E score**: `17/17` ✅

---

## Protocol JobEscrow — Role-Separated E2E

Client, worker, and evaluator used separate burner wallets. Job `19` completed the full lifecycle on Arc Testnet:

1. `registerAgent`
2. `createJob`
3. `setBudget`
4. `approve USDC`
5. `fund escrow`
6. Worker `submitDeliverable`
7. Evaluator `evaluate(true)`
8. Client `settle`
9. `WorkProof #3` minted
10. Indexer and live UI verified

| Key | Value |
|---|---|
| Job ID | `19` |
| Agent ID | `1778814739` |
| WorkProof Token ID | `3` |
| Final status | `Settled` |
| Amount funded | `0.01 USDC` |
| Paid to worker | `0.00995 USDC` |
| Platform fee | `0.00005 USDC` |
| Live job page | https://arclayers.xyz/job/19 |

| Step | Tx |
|---|---|
| `submitDeliverable` | [0xf66a7ba5...](https://testnet.arcscan.app/tx/0xf66a7ba5e00fe2a23d96681f55facfa0fe76f29152215cbf60b999b1ba9bfa72) |
| `evaluate(true)` | [0x69734562...](https://testnet.arcscan.app/tx/0x6973456264d6b42be02560f003c280ce24afa7a26071cebb09d60f0e5da894ef) |
| `settle` | [0x8883f432...](https://testnet.arcscan.app/tx/0x8883f432d034c95b9a663fe602b69879b1fa3d089cb17a35f4b5741c2f6873cf) |

---

## Legacy V1 — MilestoneEscrow

Project `0` completed end-to-end on Arc Testnet.

| Step | Tx |
|---|---|
| `createProject` | [0x54393be9...](https://testnet.arcscan.app/tx/0x54393be919309c6492145606e135f0191297d4fc6f7f0cb11194b354b4ea45ab) |
| `approve USDC` | [0x76a37085...](https://testnet.arcscan.app/tx/0x76a3708537431f071cbf304af07d124009eddcf1cfa2c87fa352e1a201998775) |
| `fundProject` | [0xa79c1402...](https://testnet.arcscan.app/tx/0xa79c140210befdcaaf7b56979a57dd054490016bb66dc6bff5e2ae939412fb6e) |
| `submitMilestone(0)` | [0x17342a44...](https://testnet.arcscan.app/tx/0x17342a444ab7d142fc8c900316786471c55d53f03644cb36ce94e6cfdf03f32f) |
| `approveMilestone(0)` | [0x2b5cbd9a...](https://testnet.arcscan.app/tx/0x2b5cbd9a83fad46f57562595272b1cb94ecbcc16b55b499997ac4d1ca6ecc0d7) |
| `submitMilestone(1)` | [0x410e0c18...](https://testnet.arcscan.app/tx/0x410e0c18551b2cbc459e6708977dcbd728bdea8cf103168fcc563eca851ce79e) |
| `approveMilestone(1)` + `WorkProofMinted` | [0xd68f8e8a...](https://testnet.arcscan.app/tx/0xd68f8e8a77b5d7101c9954f81463c58fe4ffbec514930ffeb36e5845489cf767) |

Final state: `totalAmount=2000000`, `releasedAmount=2000000`, `milestoneCount=2`, `status=Completed`.

---

## Deployment Transactions

### Protocol Contracts

- `AgentRegistry`: [0xc973a730...](https://testnet.arcscan.app/tx/0xc973a730482eeb67ce17a7e04a96200a3d50bfcc4905ace265b04d9cf7fafbb9)
- `WorkProof`: [0x567eab55...](https://testnet.arcscan.app/tx/0x567eab55746b2b567304d61201dba18b80c3698bbaa7ca9830a8832051c5d35a)
- `JobEscrow`: [0x2b3e9006...](https://testnet.arcscan.app/tx/0x2b3e900692641a48080e705e959fcf8135fb7829100756ffa2b37ae6b9bedc45)
- `ReputationOracle`: [0x5232aa87...](https://testnet.arcscan.app/tx/0x5232aa8778a30f78d1173a5d36aa6dc17378c14af6cd4c9c3a9e985e5bf3256f)

### Legacy V1

- `MilestoneEscrow`: [0xd10476a0...](https://testnet.arcscan.app/tx/0xd10476a06b942348a22b32faea36e53f2b6d5f8ad1c6f4a0eb9f3e36d23ded10)
