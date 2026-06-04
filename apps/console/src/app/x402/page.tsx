import { redirect } from 'next/navigation';

/**
 * /x402 — redirects to dashboard.
 * The actual x402 settlement logic lives in /api/x402/* and /jobs/x402/*.
 */
export default function X402Page() {
  redirect('/dashboard');
}
