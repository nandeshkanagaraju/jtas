/** Redirects use the public app origin, never the container's listening address. */
export function appRedirectUrl(path: string, requestUrl: string): URL {
  const origin = new URL(process.env.APP_BASE_URL || requestUrl).origin;
  const destination = new URL(path, origin);
  return destination.origin === origin ? destination : new URL('/', origin);
}

/** Keep notification/deep-link destinations within this app, including after URL normalization. */
export function safeReturnPath(value: string | null): string {
  if (!value?.startsWith('/') || value.startsWith('//')) return '/';
  const base = 'https://jtas.invalid';
  try {
    const destination = new URL(value, base);
    return destination.origin === base
      ? `${destination.pathname}${destination.search}${destination.hash}`
      : '/';
  } catch {
    return '/';
  }
}
