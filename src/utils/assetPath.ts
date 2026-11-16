const PASSTHROUGH_PROTOCOL_RE = /^(blob:|data:|https?:|\/\/)/i;
const KNOWN_PUBLIC_PREFIXES = ['assets/', 'audio/', 'images/', 'music/', 'sounds/', 'src/assets/'];

/**
 * Returns Vite's base URL guaranteed to end with a trailing slash
 * (e.g. "/flappy-baby/" in production builds, "/" in local dev).
 */
export function getViteBaseUrl(): string {
  const raw = import.meta.env.BASE_URL || './';
  return raw.endsWith('/') ? raw : `${raw}/`;
}

/**
 * Resolves any static image or audio asset path against Vite's BASE_URL
 * so assets always load properly under "/flappy-baby/" on GitHub Pages
 * without root-domain 404 errors.
 */
export function resolveAssetUrl(
  rawPath: string,
  defaultSubdir = 'assets/'
): string {
  const trimmed = rawPath.trim();
  if (!trimmed || PASSTHROUGH_PROTOCOL_RE.test(trimmed)) {
    return trimmed;
  }

  const base = getViteBaseUrl();
  const baseNoLeadingSlash = base.replace(/^\/+/, '');

  // Strip leading "./" or "/" so paths never resolve to the domain root
  let clean = trimmed.replace(/^(\.\/)+/, '').replace(/^\/+/, '');

  // Avoid duplicating the base prefix if already included (e.g. "flappy-baby/assets/...")
  if (baseNoLeadingSlash && clean.startsWith(baseNoLeadingSlash)) {
    clean = clean.slice(baseNoLeadingSlash.length);
  }

  const hasKnownPrefix = KNOWN_PUBLIC_PREFIXES.some((prefix) =>
    clean.startsWith(prefix)
  );
  if (hasKnownPrefix) {
    return `${base}${clean}`;
  }

  const normalizedSubdir = defaultSubdir
    ? `${defaultSubdir.replace(/^\/+|\/+$/g, '')}/`
    : '';
  return `${base}${normalizedSubdir}${clean}`;
}
