export const DERIV_JOB_KEY_ACTIONS = {
  CREATE: 'create_deriv_a2a_job_key',
  ROTATE: 'rotate_deriv_a2a_job_key',
  REVOKE: 'revoke_deriv_a2a_job_key',
} as const;

export type DerivJobKeyAction =
  (typeof DERIV_JOB_KEY_ACTIONS)[keyof typeof DERIV_JOB_KEY_ACTIONS];

/**
 * Build a human-readable EIP-191 message for the user to sign.
 * The full text is shown in the wallet prompt so the user knows exactly
 * what they're authorizing.
 */
export function buildDerivJobKeyMessage(input: {
  action: DerivJobKeyAction;
  agentId: string;
  ownerAddress: string;
  role: string;
  jobType: string;
  timestamp: number;
  requestId: string;
}): string {
  return [
    'ArcLayer Deriv A2A Job API Key Request',
    '',
    `Action: ${input.action}`,
    `Agent ID: ${input.agentId}`,
    `Owner: ${input.ownerAddress}`,
    `Role: ${input.role}`,
    `Job Type: ${input.jobType}`,
    `Rail: x402 Bridge Rail`,
    `Timestamp: ${input.timestamp}`,
    `Request ID: ${input.requestId}`,
    '',
    'This signature authorizes ArcLayer to manage an ArcLayer API key for this Deriv external A2A job agent.',
    'This does NOT authorize ArcLayer to access Deriv API keys or wallet private keys.',
  ].join('\n');
}
