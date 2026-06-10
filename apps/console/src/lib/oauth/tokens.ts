import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export type OAuthTokenPrefix = 'arc_code_' | 'arc_at_' | 'arc_rt_';
export function generateOAuthSecret(prefix: OAuthTokenPrefix): string { return `${prefix}${randomBytes(32).toString('base64url')}`; }
export function hashOAuthSecret(raw: string): string { return createHash('sha256').update(`${process.env.OAUTH_TOKEN_PEPPER ?? ''}${raw}`).digest('hex'); }
export function safeHashEqual(a: string, b: string): boolean { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
