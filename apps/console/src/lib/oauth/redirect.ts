import 'server-only';

import { NextResponse } from 'next/server';
import { isAllowedRedirectUri } from './validation';

export function findRegisteredRedirectUri(
  requestedRedirectUri: string,
  registeredRedirectUris: unknown,
): string | null {
  if (typeof requestedRedirectUri !== 'string') return null;
  if (!Array.isArray(registeredRedirectUris)) return null;

  const exact = registeredRedirectUris.find(
    (value): value is string =>
      typeof value === 'string' &&
      value === requestedRedirectUri &&
      isAllowedRedirectUri(value),
  );

  return exact ?? null;
}

export function redirectToRegisteredOAuthClient(
  registeredRedirectUri: string,
  params: Record<string, string | undefined>,
) {
  if (!isAllowedRedirectUri(registeredRedirectUri)) {
    throw new Error('invalid_registered_redirect_uri');
  }

  const target = new URL(registeredRedirectUri);

  for (const [key, value] of Object.entries(params)) {
    if (value) target.searchParams.set(key, value);
  }

  return NextResponse.redirect(target);
}
