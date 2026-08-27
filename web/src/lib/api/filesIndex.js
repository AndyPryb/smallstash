import { apiRequest, ApiError } from './client.js';

/**
 * GET/PUT for the encrypted files index - mirrors `getVault`/`putVault` in
 * client.js almost exactly (docs/file-storage-plan.md §4/§9), against
 * `files-lambda` rather than the vault Lambda. Same `apiBaseUrl` either way
 * (one HttpApi in front of both - docs/file-storage-plan.md §3a), so this
 * reuses `apiRequest` as-is rather than a second fetch wrapper.
 *
 * @param {string} token
 * @returns {Promise<{ ciphertextBase64: string, updatedAt: string } | null>}
 *   `null` specifically for "this user has never uploaded a files index" -
 *   unlike the vault (proactively created at signup, so a missing vault is
 *   an error condition), having no files yet is the normal state for most
 *   users, not a failure. Distinguishing it here means every caller doesn't
 *   have to special-case `ApiError.status === 404` itself.
 */
export async function getFilesIndex(token) {
  const res = await apiRequest('/files-index', { token });
  if (res.status === 404) return null;
  if (res.status !== 200) throw new ApiError(res.status, res.body);
  return res.body;
}

/**
 * @param {string} token
 * @param {string} ciphertextBase64
 * @returns {Promise<{ ciphertextBase64: string, updatedAt: string }>}
 */
export async function putFilesIndex(token, ciphertextBase64) {
  const res = await apiRequest('/files-index', { method: 'PUT', token, body: { ciphertextBase64 } });
  if (res.status !== 200) throw new ApiError(res.status, res.body);
  return res.body;
}
