// Generic OIDC authentication: works against any standards-compliant IDP via
// discovery (no vendor-specific code), plus a dev-mode bypass for localhost that
// produces the exact same signed session cookie so the rest of the app never has
// an "auth branch" — it only ever trusts `getSession()`.
//
// Required bindings for real deployment (see README): OIDC_ISSUER, OIDC_CLIENT_ID,
// OIDC_CLIENT_SECRET (a `wrangler secret`, omit for a public/PKCE-only client),
// OIDC_REDIRECT_URI, SESSION_SECRET (a `wrangler secret`). With none of those set,
// the app runs in dev mode automatically — this is the "better story for localhost."
//
// Dev mode is gated on ENVIRONMENT=development (set in .dev.vars, never in
// wrangler.toml's [vars], so it can't accidentally ship to a real deployment) —
// deliberately NOT inferred from "OIDC just happens to be unconfigured". That
// distinction matters: dev mode signs sessions with a secret that's hardcoded in
// this file (public in source control), so if it ever activated in production —
// say, someone deploys before OIDC secrets are set — anyone could forge a valid
// session for any user. Failing closed (real OIDC required, or a clear error) is
// the only safe default for a deployed environment.

import type { Env } from './env.js';
export type { Env };

export interface Session {
  sub: string;
  name: string | null; // null until the user has picked a display name
}

const SESSION_COOKIE = 'ccz_session';
const STATE_COOKIE = 'ccz_oauth_state';
const DEV_ID_COOKIE = 'ccz_dev_id';

export function isDevMode(env: Env): boolean {
  return env.ENVIRONMENT === 'development';
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------
function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get('Cookie') ?? '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function setCookie(headers: Headers, name: string, value: string, opts: { maxAge?: number; path?: string } = {}): void {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? '/'}`, 'HttpOnly', 'SameSite=Lax'];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  headers.append('Set-Cookie', parts.join('; '));
}

// ---------------------------------------------------------------------------
// Session signing (HMAC-SHA256, no external deps — Workers ships Web Crypto).
// ---------------------------------------------------------------------------
function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// TextEncoder().encode() and our own decode helper both come back typed as
// Uint8Array<ArrayBufferLike>, which current DOM lib types for crypto.subtle's
// BufferSource param don't accept without a cast — encode() is otherwise correct.
function enc(s: string): BufferSource { return new TextEncoder().encode(s) as BufferSource; }

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signSession(session: Session, secret: string): Promise<string> {
  const payload = JSON.stringify({ ...session, iat: Date.now() });
  const payloadB64 = b64url(new TextEncoder().encode(payload));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc(payloadB64));
  return `${payloadB64}.${b64url(sig)}`;
}

async function verifySession(token: string, secret: string): Promise<Session | null> {
  const [payloadB64, sigB64] = token.split('.');
  if (!payloadB64 || !sigB64) return null;
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(sigB64) as BufferSource, enc(payloadB64));
  if (!ok) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
    if (typeof parsed.sub !== 'string') return null;
    return { sub: parsed.sub, name: typeof parsed.name === 'string' ? parsed.name : null };
  } catch {
    return null;
  }
}

function devSecret(): string {
  // Dev mode never leaves localhost and never needs a real secret; a fixed one keeps
  // sessions valid across `wrangler dev` restarts without requiring a .dev.vars file.
  return 'dev-mode-insecure-secret-do-not-use-in-production';
}

function sessionSecret(env: Env): string {
  return env.SESSION_SECRET ?? devSecret();
}

/** The one function the rest of the app calls. Returns null if not signed in. */
export async function getSession(request: Request, env: Env): Promise<Session | null> {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  return verifySession(token, sessionSecret(env));
}

export async function writeSessionCookie(headers: Headers, session: Session, env: Env): Promise<void> {
  const token = await signSession(session, sessionSecret(env));
  setCookie(headers, SESSION_COOKIE, token, { maxAge: 60 * 60 * 24 * 30 });
}

export function clearSessionCookie(headers: Headers): void {
  setCookie(headers, SESSION_COOKIE, '', { maxAge: 0 });
}

// ---------------------------------------------------------------------------
// Display-name persistence (per verified subject, across devices/sessions).
// ---------------------------------------------------------------------------
export async function getStoredName(env: Env, sub: string): Promise<string | null> {
  if (!env.USER_PROFILES) return null;
  return env.USER_PROFILES.get(`name:${sub}`);
}

export async function storeName(env: Env, sub: string, name: string): Promise<void> {
  if (!env.USER_PROFILES) return;
  await env.USER_PROFILES.put(`name:${sub}`, name);
}

// ---------------------------------------------------------------------------
// Dev-mode login: no network round trip to a real IDP, but the exact same
// session-cookie contract as production, so nothing downstream branches on env.
// ---------------------------------------------------------------------------
/** Only ever bounce to a path on this site — never to an absolute URL an attacker
 *  could smuggle into ?next=. */
function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  return raw.length > 200 ? null : raw;
}

export async function handleDevLogin(request: Request, env: Env): Promise<Response> {
  const cookies = parseCookies(request);
  const next = safeNext(new URL(request.url).searchParams.get('next'));
  let devId = cookies[DEV_ID_COOKIE];
  const headers = new Headers();
  if (!devId) {
    devId = `dev-${crypto.randomUUID()}`;
    setCookie(headers, DEV_ID_COOKIE, devId, { maxAge: 60 * 60 * 24 * 365 });
  }
  if (request.method === 'POST') {
    const form = await request.formData();
    const name = String(form.get('name') ?? '').trim().slice(0, 24);
    if (name) {
      await storeName(env, devId, name);
      await writeSessionCookie(headers, { sub: devId, name }, env);
      headers.set('Location', next ?? '/');
      return new Response(null, { status: 302, headers });
    }
  }
  // Always establish a session here, named or not — mirrors handleCallback's OIDC
  // flow exactly, so /welcome (which only requires *a* session, name optional) never
  // bounces a brand-new dev user back to /auth/login in a redirect loop.
  const existingName = await getStoredName(env, devId);
  await writeSessionCookie(headers, { sub: devId, name: existingName }, env);
  headers.set('Location', existingName ? (next ?? '/') : `/welcome${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  return new Response(null, { status: 302, headers });
}

// ---------------------------------------------------------------------------
// Real OIDC (Authorization Code + PKCE), via discovery — vendor-agnostic.
// ---------------------------------------------------------------------------
interface Discovery { authorization_endpoint: string; token_endpoint: string; jwks_uri: string; }
let discoveryCache: { at: number; issuer: string; doc: Discovery } | null = null;

async function discover(issuer: string): Promise<Discovery> {
  if (discoveryCache && discoveryCache.issuer === issuer && Date.now() - discoveryCache.at < 10 * 60 * 1000) {
    return discoveryCache.doc;
  }
  const res = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
  const doc = (await res.json()) as Discovery;
  discoveryCache = { at: Date.now(), issuer, doc };
  return doc;
}

function randomString(len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return b64url(bytes);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc(verifier));
  return b64url(digest);
}

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const issuer = env.OIDC_ISSUER!;
  const doc = await discover(issuer);
  const state = randomString(16);
  const verifier = randomString(64);
  const challenge = await pkceChallenge(verifier);
  const redirectUri = env.OIDC_REDIRECT_URI ?? new URL('/auth/callback', request.url).toString();

  const url = new URL(doc.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', env.OIDC_CLIENT_ID!);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  const next = safeNext(new URL(request.url).searchParams.get('next'));
  const headers = new Headers({ Location: url.toString() });
  // `next` rides along in the state cookie so the callback can land the player on
  // the room they were invited to, not the home page.
  setCookie(headers, STATE_COOKIE, JSON.stringify({ state, verifier, redirectUri, next }), { maxAge: 600 });
  return new Response(null, { status: 302, headers });
}

interface JWK { kid: string; kty: string; alg?: string; n?: string; e?: string; x?: string; y?: string; crv?: string; }

async function importJwk(jwk: JWK): Promise<CryptoKey> {
  if (jwk.kty === 'RSA') {
    return crypto.subtle.importKey('jwk', jwk as JsonWebKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  }
  return crypto.subtle.importKey('jwk', jwk as JsonWebKey, { name: 'ECDSA', namedCurve: jwk.crv ?? 'P-256' }, false, ['verify']);
}

async function verifyIdToken(idToken: string, doc: Discovery, clientId: string): Promise<{ sub: string; name?: string; email?: string }> {
  const [headerB64, payloadB64, sigB64] = idToken.split('.');
  if (!headerB64 || !payloadB64 || !sigB64) throw new Error('Malformed id_token');
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(headerB64)));
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));

  const jwksRes = await fetch(doc.jwks_uri);
  const jwks = (await jwksRes.json()) as { keys: JWK[] };
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Signing key not found');
  const key = await importJwk(jwk);
  const alg = jwk.kty === 'RSA' ? 'RSASSA-PKCS1-v1_5' : 'ECDSA';
  const verifyParams = alg === 'ECDSA' ? { name: 'ECDSA', hash: 'SHA-256' } : 'RSASSA-PKCS1-v1_5';
  const ok = await crypto.subtle.verify(verifyParams as AlgorithmIdentifier, key, b64urlDecode(sigB64) as BufferSource, enc(`${headerB64}.${payloadB64}`));
  if (!ok) throw new Error('id_token signature invalid');
  if (payload.aud !== clientId) throw new Error('id_token audience mismatch');
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) throw new Error('id_token expired');
  return { sub: payload.sub, name: payload.name, email: payload.email };
}

export async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookies = parseCookies(request);
  const stateCookie = cookies[STATE_COOKIE] ? JSON.parse(cookies[STATE_COOKIE]) : null;
  if (!code || !state || !stateCookie || state !== stateCookie.state) {
    return new Response('Invalid OIDC callback (state mismatch)', { status: 400 });
  }

  const doc = await discover(env.OIDC_ISSUER!);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: stateCookie.redirectUri,
    client_id: env.OIDC_CLIENT_ID!,
    code_verifier: stateCookie.verifier,
  });
  if (env.OIDC_CLIENT_SECRET) body.set('client_secret', env.OIDC_CLIENT_SECRET);

  const tokenRes = await fetch(doc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!tokenRes.ok) return new Response(`Token exchange failed: ${await tokenRes.text()}`, { status: 502 });
  const tokens = (await tokenRes.json()) as { id_token: string };
  const claims = await verifyIdToken(tokens.id_token, doc, env.OIDC_CLIENT_ID!);

  const headers = new Headers();
  setCookie(headers, STATE_COOKIE, '', { maxAge: 0 });
  const storedName = await getStoredName(env, claims.sub);
  const name = storedName ?? null;
  await writeSessionCookie(headers, { sub: claims.sub, name }, env);
  const next = safeNext(stateCookie.next);
  headers.set('Location', name ? (next ?? '/') : `/welcome${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  return new Response(null, { status: 302, headers });
}

export async function handleSetName(request: Request, env: Env): Promise<Response> {
  const session = await getSession(request, env);
  if (!session) return new Response('Not signed in', { status: 401 });
  const form = await request.formData();
  const name = String(form.get('name') ?? '').trim().slice(0, 24);
  if (!name) return new Response('Name required', { status: 400 });
  await storeName(env, session.sub, name);
  const headers = new Headers({ Location: safeNext(String(form.get('next') ?? '')) ?? '/' });
  await writeSessionCookie(headers, { sub: session.sub, name }, env);
  return new Response(null, { status: 302, headers });
}

export function handleLogout(): Response {
  const headers = new Headers({ Location: '/' });
  clearSessionCookie(headers);
  return new Response(null, { status: 302, headers });
}
