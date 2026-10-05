/* Talking to the BGS Operations API (Google Apps Script).
 * Every call is a POST with a JSON body. "text/plain" is used on purpose:
 * it lets the browser call Google Apps Script directly without an extra
 * permission check that Apps Script cannot answer. */
import { CONFIG } from './config.js';

export class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
  get isNetwork() { return this.code === 'NETWORK'; }
  get isAuth() { return ['AUTH_REQUIRED', 'AUTH_EXPIRED', 'INACTIVE', 'NOT_REGISTERED'].includes(this.code); }
}

export async function call(action, payload = {}, token = null) {
  if (!CONFIG.API_URL || CONFIG.API_URL.startsWith('PASTE_')) {
    throw new ApiError('NOT_CONFIGURED', 'The app is not connected to its server yet. The API address must be pasted into js/config.js (see the Deployment Guide).');
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError('NETWORK', 'No internet connection.');
  }
  const body = JSON.stringify(Object.assign({ action, token, appVersion: CONFIG.APP_VERSION }, payload));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.REQUEST_TIMEOUT_SECONDS * 1000);
  let res;
  try {
    res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      redirect: 'follow',
      signal: ctrl.signal
    });
  } catch (e) {
    throw new ApiError('NETWORK', e.name === 'AbortError'
      ? 'The server took too long to answer. The connection may be weak.'
      : 'Could not reach the server. Check the internet connection.');
  } finally {
    clearTimeout(timer);
  }
  let data;
  try { data = await res.json(); } catch (e) {
    throw new ApiError('NETWORK', 'The server sent an answer the app could not read (HTTP ' + res.status + '). If this continues, check that the API is deployed with access "Anyone".');
  }
  if (!data.ok) throw new ApiError(data.error && data.error.code || 'SERVER_ERROR', data.error && data.error.message || 'Unknown server error.');
  return data;
}
