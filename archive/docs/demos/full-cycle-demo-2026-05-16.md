# ArcLayer Full Autonomous Cycle Demo

Captured run: 2026-05-16  
Network: Arc Testnet (`chainId=5042002`)  
Console: https://arclayers.xyz  
Explorer: https://testnet.arcscan.app

## Summary

ArcLayer executed a complete autonomous agent economy cycle:

```text
Capability → Payment → Execution → Verification → Settlement → Proof → Reputation
```

The run used Pythia as the signal/oracle agent and Hermes as the buyer/trader identity. The funded execution wallet paid for the x402 signal, created and traded an Ignia market, resolved the outcome, claimed winnings, anchored an EIP-712 receipt, and recorded reputation outcomes on-chain.

## Final Result

- Status: complete
- Pythia reputation: 27
- Hermes reputation: 20
- Payment: 0.01 USDC x402 signal purchase
- Trade: 0.05 USDC YES on Ignia market #9
- Outcome: YES

## Transaction Proofs

| Step | Action | Tx |
|---|---|---|
| 1. CAPABILITY | Agent discovery via `A2AAgentRegistry` | on-chain read |
| 2. PAYMENT | x402 signal purchase | [`0x6deceef7b512f9318a0afa272c80c593d8e089634cb7adb8dfbd2b591add3377`](https://testnet.arcscan.app/tx/0x6deceef7b512f9318a0afa272c80c593d8e089634cb7adb8dfbd2b591add3377) |
| 3a. EXECUTION | Ignia market created | [`0x856c8a72019dc354e9391d7a0948574bd510b0f57642bf520cd098284d2a9f68`](https://testnet.arcscan.app/tx/0x856c8a72019dc354e9391d7a0948574bd510b0f57642bf520cd098284d2a9f68) |
| 3b. EXECUTION | YES trade executed | [`0xdba3ba9dd8f77122af0976a06087ea625a1f377452591a6b434b5f99254ec58d`](https://testnet.arcscan.app/tx/0xdba3ba9dd8f77122af0976a06087ea625a1f377452591a6b434b5f99254ec58d) |
| 4. VERIFICATION | Market resolved to YES | [`0x0f3d36bcdaefc2c33a49e8d504587b5d641220bd9b7e1fa4bd5f61fdd149da1b`](https://testnet.arcscan.app/tx/0x0f3d36bcdaefc2c33a49e8d504587b5d641220bd9b7e1fa4bd5f61fdd149da1b) |
| 5. SETTLEMENT | Winnings claimed | [`0x134481457fb6c5506274c58828902ad5455f075c63ff2432531d04a3303ff69f`](https://testnet.arcscan.app/tx/0x134481457fb6c5506274c58828902ad5455f075c63ff2432531d04a3303ff69f) |
| 6. PROOF | Receipt anchored on `A2AReceiptRegistry` | [`0x358a869a14053bd17af94289facb91181940787fc31af8c0df180a1cefb1a29c`](https://testnet.arcscan.app/tx/0x358a869a14053bd17af94289facb91181940787fc31af8c0df180a1cefb1a29c) |
| 7a. REPUTATION | Interaction recorded | [`0xfeeea6a05e3d3534d3b7881b5151cecc678c53c8a093ae0d1955dfc47dfacc10`](https://testnet.arcscan.app/tx/0xfeeea6a05e3d3534d3b7881b5151cecc678c53c8a093ae0d1955dfc47dfacc10) |
| 7b. REPUTATION | Signal outcome recorded | [`0x07fc8aa9a3472a2122db574d9c241a5fe88657245d3683a4e70a0f45770d2bb0`](https://testnet.arcscan.app/tx/0x07fc8aa9a3472a2122db574d9c241a5fe88657245d3683a4e70a0f45770d2bb0) |
| 7c. REPUTATION | Trader outcome recorded | [`0xeeee3009565df67ed5229af096d52692eed7948f7ce406bd6f5fcbd7bfb868d6`](https://testnet.arcscan.app/tx/0xeeee3009565df67ed5229af096d52692eed7948f7ce406bd6f5fcbd7bfb868d6) |

## Run Command

```bash
cd agents
PYTHIA_URL=http://localhost:4001 npm run demo
```

## Raw Output

```text
════════════════════════════════════════════════════════════════
  ✅ FULL CYCLE COMPLETE — All 7 Steps Executed
════════════════════════════════════════════════════════════════

  1. CAPABILITY   — Agents discovered on AgentRegistry
  2. PAYMENT      — x402 signal purchased (0.01 USDC)
     tx: 0x6deceef7b512f9318a0afa272c80c593d8e089634cb7adb8dfbd2b591add3377
  3. EXECUTION    — Ignia market #9 trade (0.05 USDC YES)
     tx: 0xdba3ba9dd8f77122af0976a06087ea625a1f377452591a6b434b5f99254ec58d
  4. VERIFICATION — Market resolved → YES by Pythia oracle
     tx: 0x0f3d36bcdaefc2c33a49e8d504587b5d641220bd9b7e1fa4bd5f61fdd149da1b
  5. SETTLEMENT   — Winnings claimed
     tx: 0x134481457fb6c5506274c58828902ad5455f075c63ff2432531d04a3303ff69f
  6. PROOF        — Receipt anchored (EIP-712 signed)
     tx: 0x358a869a14053bd17af94289facb91181940787fc31af8c0df180a1cefb1a29c
  7. REPUTATION   — Outcomes recorded on-chain
     Pythia score: 27
     Hermes score: 20
```
