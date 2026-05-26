export const API_KEY_ROTATION_ACTION = 'rotate_external_prediction_market_key';

export function buildApiKeyRotationMessage(input: {
  agentId: string;
  ownerAddress: string;
  timestamp: number;
}) {
  return [
    'ArcLayer External Bot API Key Rotation',
    '',
    `Action: ${API_KEY_ROTATION_ACTION}`,
    `Agent ID: ${input.agentId}`,
    `Owner: ${input.ownerAddress}`,
    `Category: prediction-market-bots`,
    `Timestamp: ${input.timestamp}`,
    '',
    'This signature authorizes ArcLayer to revoke active API keys for this external agent and issue a new API key shown once.',
  ].join('\n');
}
