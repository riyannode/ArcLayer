/**
 * Job envelope helpers for autonomous ERC-8183 jobs.
 *
 * Wraps runner-core schemas with encoding/decoding for the contract
 * description field. The contract stores a string — we use versioned JSON.
 */
export {
  AutonomousJobEnvelopeSchema,
  type AutonomousJobEnvelope,
  encodeJobEnvelope,
  decodeJobEnvelope,
  isAutonomousJobEnvelope,
} from "@arclayer/runner-core";
