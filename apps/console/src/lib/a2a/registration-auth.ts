import { isAddress, recoverMessageAddress } from 'viem';

export async function verifyExternalRegistrationAuth(input: { address: string; message?: string; signature?: string }): Promise<{ signatureVerified: boolean }> {
  const { address, message, signature } = input;
  if (!isAddress(address)) throw new Error('invalid_address');

  const allowUnsigned = process.env.A2A_ALLOW_UNSIGNED_EXTERNAL_REGISTRATION === 'true';
  const hasMessageAndSignature = Boolean(message && signature);

  if (!hasMessageAndSignature) {
    if (allowUnsigned) return { signatureVerified: false };
    throw new Error('signature_required');
  }

  const recovered = await recoverMessageAddress({ message: message as string, signature: signature as `0x${string}` });
  if (recovered.toLowerCase() !== address.toLowerCase()) throw new Error('invalid_signature');

  return { signatureVerified: true };
}
