import {
  arcTestnet,
  buildValidationRequestConfig,
  buildValidationResponseConfig,
  readValidationStatus as sdkReadValidationStatus,
  publicClient,
} from '@arclayer/sdk';
import {
  createWalletClient,
  http,
  isAddress,
  keccak256,
  toBytes,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import {
  isBytes32,
  normalizeBytes32,
  normalizePrivateKey,
  parseBigIntField,
  parseUint8Field,
} from './utils';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export const VALIDATION_RESPONSE = {
  NONE: 0,
  PASSED: 1,
  FAILED: 2,
} as const;

export type ValidationRequestInput = {
  validator: string;
  agentTokenId: string | number | bigint;
  taskUri: string;
  requestHash?: Hex;
};

export type ValidationResponseInput = {
  requestHash: Hex;
  status: string | number;
  resultUri: string;
  resultHash?: Hex;
  reason: string;
};

function sameAddress(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

function getRequiredPrivateKey(envName: string): `0x${string}` {
  const pk = normalizePrivateKey(process.env[envName]);

  if (!pk) {
    throw new Error(`missing_or_invalid_${envName}`);
  }

  return pk;
}

function makeValidationRequestHash(input: {
  validator: string;
  agentTokenId: bigint;
  taskUri: string;
}): Hex {
  return keccak256(
    toBytes(
      [
        'arclayer-validation-request',
        input.validator.toLowerCase(),
        input.agentTokenId.toString(),
        input.taskUri,
      ].join(':'),
    ),
  );
}

function makeValidationResultHash(input: {
  requestHash: Hex;
  status: number;
  resultUri: string;
  reason: string;
}): Hex {
  return keccak256(
    toBytes(
      [
        'arclayer-validation-response',
        input.requestHash.toLowerCase(),
        String(input.status),
        input.resultUri,
        input.reason,
      ].join(':'),
    ),
  );
}

function parseResponseStatus(value: unknown) {
  const status = parseUint8Field(value, 'status');

  if (status !== VALIDATION_RESPONSE.PASSED && status !== VALIDATION_RESPONSE.FAILED) {
    throw new Error('status_must_be_1_passed_or_2_failed');
  }

  return status;
}

export function buildValidationRequest(input: ValidationRequestInput) {
  const validator = String(input.validator || '').trim();

  if (!isAddress(validator)) {
    throw new Error('validator_invalid_address');
  }

  const agentTokenId = parseBigIntField(input.agentTokenId, 'agentTokenId');

  if (agentTokenId <= 0n) {
    throw new Error('agentTokenId_must_be_positive');
  }

  const taskUri = String(input.taskUri || '').trim();

  if (!taskUri) {
    throw new Error('taskUri_required');
  }

  const requestHash = input.requestHash
    ? normalizeBytes32(input.requestHash, 'requestHash')
    : makeValidationRequestHash({ validator, agentTokenId, taskUri });

  const config = buildValidationRequestConfig(
    validator as `0x${string}`,
    agentTokenId,
    taskUri,
    requestHash,
  );

  return {
    validator: validator as `0x${string}`,
    agentTokenId,
    taskUri,
    requestHash,
    config,
  };
}

export async function createValidationRequest(input: ValidationRequestInput) {
  const validation = buildValidationRequest(input);
  const requestSigner = privateKeyToAccount(
    getRequiredPrivateKey('VALIDATION_REQUEST_PRIVATE_KEY'),
  );

  const responseSigner = privateKeyToAccount(
    getRequiredPrivateKey('VALIDATION_RESPONSE_PRIVATE_KEY'),
  );

  if (!sameAddress(validation.validator, responseSigner.address)) {
    throw new Error('validator_must_match_VALIDATION_RESPONSE_PRIVATE_KEY');
  }

  const supabase = getSupabaseAdmin();
  const { data: existing, error: existingError } = await supabase
    .from('a2a_validations')
    .select('request_hash, request_tx_hash, response_status')
    .eq('request_hash', validation.requestHash)
    .maybeSingle();

  if (existingError) throw new Error(`db_read_failed:${existingError.message}`);

  if (existing?.request_tx_hash) {
    return {
      ok: true,
      source: 'erc8004_validation_registry',
      action: 'validationRequest',
      idempotent: true,
      requestHash: existing.request_hash,
      txHash: existing.request_tx_hash,
      responseStatus: existing.response_status,
    };
  }

  const { error: insertError } = await supabase
    .from('a2a_validations')
    .insert({
      request_hash: validation.requestHash,
      agent_token_id: validation.agentTokenId.toString(),
      validator_address: validation.validator,
      requester_address: requestSigner.address,
      task_uri: validation.taskUri,
      response_status: VALIDATION_RESPONSE.NONE,
    });

  if (insertError?.code === '23505') {
    const { data: duplicate, error: duplicateReadError } = await supabase
      .from('a2a_validations')
      .select('request_hash, request_tx_hash, response_status')
      .eq('request_hash', validation.requestHash)
      .maybeSingle();

    if (duplicateReadError) {
      throw new Error(`db_read_failed:${duplicateReadError.message}`);
    }

    if (duplicate?.request_tx_hash) {
      return {
        ok: true,
        source: 'erc8004_validation_registry',
        action: 'validationRequest',
        idempotent: true,
        requestHash: duplicate.request_hash,
        txHash: duplicate.request_tx_hash,
        responseStatus: duplicate.response_status,
      };
    }

    throw new Error('validation_request_already_pending');
  }

  if (insertError) {
    throw new Error(`db_insert_failed:${insertError.message}`);
  }

  const walletClient = createWalletClient({
    account: requestSigner,
    chain: arcTestnet,
    transport: http(process.env.ARC_RPC_URL),
  });

  let txHash: `0x${string}`;

  try {
    txHash = await walletClient.writeContract(validation.config);
  } catch (writeError) {
    await supabase
      .from('a2a_validations')
      .delete()
      .eq('request_hash', validation.requestHash)
      .is('request_tx_hash', null);

    throw writeError;
  }

  const { error: txHashUpdateError } = await supabase
    .from('a2a_validations')
    .update({
      request_tx_hash: txHash,
      updated_at: new Date().toISOString(),
    })
    .eq('request_hash', validation.requestHash);

  if (txHashUpdateError) {
    throw new Error(`db_update_failed:${txHashUpdateError.message}`);
  }

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 60_000,
  });

  const { error: updateError } = await supabase
    .from('a2a_validations')
    .update({
      request_block_number: Number(receipt.blockNumber),
      updated_at: new Date().toISOString(),
    })
    .eq('request_hash', validation.requestHash);

  if (updateError) throw new Error(`db_update_failed:${updateError.message}`);

  return {
    ok: true,
    source: 'erc8004_validation_registry',
    action: 'validationRequest',
    requestHash: validation.requestHash,
    agentTokenId: validation.agentTokenId.toString(),
    validator: validation.validator,
    taskUri: validation.taskUri,
    txHash,
    status: receipt.status,
    blockNumber: receipt.blockNumber.toString(),
    signer: requestSigner.address,
  };
}

export function buildValidationResponse(input: ValidationResponseInput) {
  const requestHash = normalizeBytes32(input.requestHash, 'requestHash');
  const status = parseResponseStatus(input.status);

  const resultUri = String(input.resultUri || '').trim();
  if (!resultUri) throw new Error('resultUri_required');

  const reason = String(input.reason || '').trim().slice(0, 500);
  if (!reason) throw new Error('reason_required');

  const resultHash = isBytes32(input.resultHash)
    ? normalizeBytes32(input.resultHash, 'resultHash')
    : makeValidationResultHash({
        requestHash,
        status,
        resultUri,
        reason,
      });

  const config = buildValidationResponseConfig(
    requestHash,
    status,
    resultUri,
    resultHash,
    reason,
  );

  return {
    requestHash,
    status,
    resultUri,
    resultHash,
    reason,
    config,
  };
}

export async function getValidationStatus(requestHash: Hex) {
  const normalizedRequestHash = normalizeBytes32(requestHash, 'requestHash');
  const status = await sdkReadValidationStatus(normalizedRequestHash);
  const agentTokenId = status.agentId.toString();

  return {
    ok: true,
    source: 'erc8004_validation_registry',
    requestHash: normalizedRequestHash,
    validatorAddress: status.validatorAddress,
    agentId: agentTokenId,
    agentTokenId,
    response: Number(status.response),
    responseHash: status.responseHash,
    tag: status.tag,
    lastUpdate: status.lastUpdate.toString(),
  };
}

export async function createValidationResponse(input: ValidationResponseInput) {
  const validation = buildValidationResponse(input);
  const supabase = getSupabaseAdmin();

  const { data: row, error: rowError } = await supabase
    .from('a2a_validations')
    .select('*')
    .eq('request_hash', validation.requestHash)
    .maybeSingle();

  if (rowError) throw new Error(`db_read_failed:${rowError.message}`);
  if (!row) throw new Error('validation_request_not_found');

  if (Number(row.response_status) !== VALIDATION_RESPONSE.NONE) {
    return {
      ok: true,
      source: 'erc8004_validation_registry',
      action: 'validationResponse',
      idempotent: true,
      requestHash: validation.requestHash,
      response: Number(row.response_status),
      txHash: row.response_tx_hash,
    };
  }

  if (row.response_tx_hash) {
    return {
      ok: true,
      source: 'erc8004_validation_registry',
      action: 'validationResponse',
      idempotent: true,
      requestHash: validation.requestHash,
      response: Number(row.response_status),
      txHash: row.response_tx_hash,
    };
  }

  const chainStatus = await getValidationStatus(validation.requestHash);

  if (
    !chainStatus.validatorAddress ||
    sameAddress(chainStatus.validatorAddress, ZERO_ADDRESS) ||
    chainStatus.agentTokenId === '0'
  ) {
    throw new Error('validation_request_not_found_onchain');
  }

  if (chainStatus.response !== VALIDATION_RESPONSE.NONE) {
    throw new Error('validation_already_responded_onchain');
  }

  const responseSigner = privateKeyToAccount(
    getRequiredPrivateKey('VALIDATION_RESPONSE_PRIVATE_KEY'),
  );

  if (!sameAddress(responseSigner.address, row.validator_address)) {
    throw new Error('validation_response_signer_mismatch_db');
  }

  if (!sameAddress(responseSigner.address, chainStatus.validatorAddress)) {
    throw new Error('validation_response_signer_mismatch_onchain');
  }

  const walletClient = createWalletClient({
    account: responseSigner,
    chain: arcTestnet,
    transport: http(process.env.ARC_RPC_URL),
  });

  const txHash = await walletClient.writeContract(validation.config);

  const { error: responseTxHashUpdateError } = await supabase
    .from('a2a_validations')
    .update({
      response_tx_hash: txHash,
      updated_at: new Date().toISOString(),
    })
    .eq('request_hash', validation.requestHash)
    .eq('response_status', VALIDATION_RESPONSE.NONE)
    .is('response_tx_hash', null);

  if (responseTxHashUpdateError) {
    throw new Error(`db_update_failed:${responseTxHashUpdateError.message}`);
  }

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 60_000,
  });

  const { error: updateError } = await supabase
    .from('a2a_validations')
    .update({
      response_status: validation.status,
      result_uri: validation.resultUri,
      result_hash: validation.resultHash,
      reason: validation.reason,
      response_block_number: Number(receipt.blockNumber),
      updated_at: new Date().toISOString(),
    })
    .eq('request_hash', validation.requestHash)
    .eq('response_tx_hash', txHash);

  if (updateError) throw new Error(`db_update_failed:${updateError.message}`);

  return {
    ok: true,
    source: 'erc8004_validation_registry',
    action: 'validationResponse',
    requestHash: validation.requestHash,
    agentTokenId: String(row.agent_token_id),
    validatorAddress: row.validator_address,
    response: validation.status,
    resultUri: validation.resultUri,
    resultHash: validation.resultHash,
    reason: validation.reason,
    txHash,
    status: receipt.status,
    blockNumber: receipt.blockNumber.toString(),
    signer: responseSigner.address,
  };
}
