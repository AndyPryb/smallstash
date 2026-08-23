'use strict';

const config = require('./config');

/**
 * Thin fetch wrapper against the deployed HTTP API. Returns the parsed body
 * alongside the status so tests can assert on both without each test
 * re-implementing response parsing.
 */
async function apiRequest(path, { method = 'GET', token, body } = {}) {
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

module.exports = { apiRequest };
