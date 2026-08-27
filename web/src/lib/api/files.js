import { apiRequest, ApiError } from './client.js';

/**
 * Mint/commit/delete/download-URL calls against `files-lambda`, plus the
 * raw upload/download requests that actually move file bytes.
 *
 * The mint/commit/delete/download-URL calls are ordinary JSON round trips
 * against the same HttpApi as everything else, so they go through
 * `apiRequest` like `api/filesIndex.js` does. The upload/download calls are
 * different in kind, not just detail: they go straight to S3 at a presigned
 * URL, with no `Authorization` header (the signature in the URL/headers
 * *is* the authorization - adding a bearer token would do nothing and the
 * bucket doesn't check for one) and a raw binary body, never JSON - so they
 * bypass `apiRequest` entirely rather than contort it to fit.
 */

/**
 * Asks the backend to mint a presigned upload URL. Non-authoritative
 * server-side pre-check only (real enforcement is at commit - see
 * `FilesController`'s Javadoc for why presigned PUT rather than the POST
 * the original plan called for).
 *
 * @param {string} token
 * @param {number} sizeBytes ciphertext length, after `encryptFile`
 * @returns {Promise<{ fileId: string, upload: { url: string, headers: Record<string, string> } }>}
 */
export async function mintFileUpload(token, sizeBytes) {
  const res = await apiRequest('/files', { method: 'POST', token, body: { sizeBytes } });
  if (res.status !== 200) throw new ApiError(res.status, res.body);
  return res.body;
}

/**
 * Uploads already-encrypted bytes to the presigned URL from
 * {@link mintFileUpload}. `headers` must be sent exactly as returned - they
 * (particularly `x-amz-tagging`) are covered by the URL's SigV4 signature,
 * so an altered or missing header invalidates it and S3 rejects the request.
 *
 * @param {{ url: string, headers: Record<string, string> }} upload
 * @param {Uint8Array} ciphertext
 * @returns {Promise<void>}
 * @throws {Error} if S3 rejects the upload (expired URL, signature mismatch, ...)
 */
export async function uploadFileBytes(upload, ciphertext) {
  const res = await fetch(upload.url, {
    method: 'PUT',
    headers: upload.headers,
    body: ciphertext,
  });
  if (!res.ok) {
    throw new Error(`Upload failed with status ${res.status}`);
  }
}

/**
 * Confirms an upload landed and asks the backend to mark it live. This is
 * also where real size/quota enforcement happens server-side - a rejection
 * here means the object was already deleted server-side, not left dangling.
 *
 * @param {string} token
 * @param {string} fileId
 * @returns {Promise<{ sizeBytes: number }>} the authoritative size S3 actually received
 */
export async function commitFileUpload(token, fileId) {
  const res = await apiRequest(`/files/${encodeURIComponent(fileId)}/commit`, { method: 'POST', token });
  if (res.status !== 200) throw new ApiError(res.status, res.body);
  return res.body;
}

/**
 * @param {string} token
 * @param {string} fileId
 * @returns {Promise<{ url: string }>} a presigned GET, short-lived - fetch it promptly
 */
export async function getFileDownloadUrl(token, fileId) {
  const res = await apiRequest(`/files/${encodeURIComponent(fileId)}/url`, { token });
  if (res.status !== 200) throw new ApiError(res.status, res.body);
  return res.body;
}

/**
 * Downloads and returns ciphertext bytes from a presigned GET URL - no
 * Authorization header, same reasoning as {@link uploadFileBytes}.
 *
 * @param {string} url
 * @returns {Promise<Uint8Array>}
 * @throws {Error} if S3 rejects the request (expired URL, object gone, ...)
 */
export async function downloadFileBytes(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed with status ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * @param {string} token
 * @param {string} fileId
 * @returns {Promise<void>}
 */
export async function deleteFile(token, fileId) {
  const res = await apiRequest(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE', token });
  if (res.status !== 204) throw new ApiError(res.status, res.body);
}
