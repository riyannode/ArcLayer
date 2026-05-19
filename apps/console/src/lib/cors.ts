import { NextResponse } from 'next/server';

const ALLOWED_ORIGINS = [
  'https://arclayers.xyz',
  'https://www.arclayers.xyz',
  'http://localhost:3000',
  'http://localhost:3001',
];

export function corsHeaders(origin?: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key, X-ArcLayer-Signature',
    'Access-Control-Max-Age': '86400',
  };
}

export function handleCorsOptions(origin?: string | null): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}
