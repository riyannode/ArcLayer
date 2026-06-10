import { createHash } from 'node:crypto';
export function pkceChallenge(verifier: string): string { return createHash('sha256').update(verifier).digest('base64url'); }
export function verifyPkceS256(verifier: string, challenge: string): boolean { return verifier.length >= 43 && verifier.length <= 128 && /^[A-Za-z0-9._~-]+$/.test(verifier) && pkceChallenge(verifier) === challenge; }
