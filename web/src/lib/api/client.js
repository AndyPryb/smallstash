import { config } from '../config.js';
import { validateVaultSize } from '../policy.js';

/**
 * Thin fetch wrapper against the deployed HTTP API - same shape as
 * tests/api/lib/client.js, kept separate rather than shared because this one
 * needs a token *source* (getIdToken callback) wired to the app's session
 * state, not a token passed in per call from a test file.
 */

/**
 * @param {string} path e.g. '/vault'
 * @param {object} [options]
 * @param {'GET'|'PUT'} [options.method]
 * @param {string} [options.token] Cognito ID token (see docs/architecture.md
 *   §5 - the JWT authorizer trusts this token's `sub`, never a client-supplied one)
 * @param {object} [options.body]
 * @returns {Promise<{ status: number, body: any, rawBody: string }>}
 */
export async function apiRequest(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  return { status: res.status, body: parsed, rawBody: text };
}

/** Thrown by the typed wrappers below on a non-2xx response. */
export class ApiError extends Error {
  /** @param {number} status @param {any} body */
  constructor(status, body) {
    super(`API request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * @param {string} token
 * @returns {Promise<import('../crypto/vault.js').UserKeys>}
 */
export async function getKeys(token) {
  const res = await apiRequest('/keys', { token });
  if (res.status !== 200) throw new ApiError(res.status, res.body);
  return res.body;
}

/**
 * @param {string} token
 * @param {import('../crypto/vault.js').UserKeys} keys
 */
export async function putKeys(token, keys) {
  const res = await apiRequest('/keys', { method: 'PUT', token, body: keys });
  if (res.status !== 204) throw new ApiError(res.status, res.body);
}

/**
 * @param {string} token
 * @returns {Promise<{ ciphertextBase64: string, versionId: string }>}
 */
export async function getVault(token) {
  const res = await apiRequest('/vault', { token });
  if (res.status !== 200) throw new ApiError(res.status, res.body);
  return res.body;
}

/**
 * @param {string} token
 * @param {string} ciphertextBase64
 * @returns {Promise<{ ciphertextBase64: string, versionId: string }>}
 */
export async function putVault(token, ciphertextBase64) {
  // Checked before the request so an oversized vault doesn't get uploaded
  // just to be rejected. VaultController enforces the same limit server-side;
  // this only exists to make the failure legible.
  const tooLarge = validateVaultSize(ciphertextBase64);
  if (tooLarge) throw new Error(tooLarge);

  const res = await apiRequest('/vault', { method: 'PUT', token, body: { ciphertextBase64 } });
  if (res.status !== 200) throw new ApiError(res.status, res.body);
  return res.body;
}
