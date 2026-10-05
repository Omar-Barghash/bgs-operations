/* Talking to the BGS Operations API (Google Apps Script).
 * Every call is a POST with a JSON body. "text/plain" is used on purpose:
 * it lets the browser call Google Apps Script directly without an extra
 * permission check that Apps Script cannot answer.
 *
 * Google's delivery of Apps Script answers is sometimes unreliable: an answer
 * can arrive late, as a Google "page not found" page, or as the wrong kind of
 * answer. Every call is therefore checked and quietly retried. Retrying is
 * safe: reading changes nothing, and every saved change carries a unique ID
 * that the server applies only once. */
import { CONFIG } from './config.js';

export class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
  get isNetwork() { return this.code === 'NETWORK'; }
  get isAuth() { return ['AUTH_REQUIRED', 'AUTH_EXPIRED', 'INACTIVE', 'NOT_REGISTERED'].includes(this.code); }
}

const RETRYABLE = new Set(['NETWORK', 'BAD_ANSWER', 'BUSY']);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** One attempt. */
async function once(action, body, timeoutSec) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutSec * 1000);
  let res, text;
  try {
    res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      signal: ctrl.signal
    });
    text = await res.text();
  } catch (e) {
    throw new ApiError('NETWORK', e.name === 'AbortError'
      ? 'The server took too long to answer. The connection may be weak.'
      : 'Could not reach the server. Check the internet connection.');
  } finally {
    clearTimeout(timer);
  }
  let data;
  try { data = JSON.parse(text); } catch (e) {
    throw new ApiError('BAD_ANSWER', 'Google returned an unreadable answer (HTTP ' + res.status + ').');
  }
  // A health-check answer means the request reached the server as the wrong type: try again.
  if (data && data.service === 'BGS Operations API' && action !== 'health') {
    throw new ApiError('BAD_ANSWER', 'Google delivered the request incorrectly.');
  }
  if (!data.ok) throw new ApiError(data.error && data.error.code || 'SERVER_ERROR', data.error && data.error.message || 'Unknown server error.');
  return data;
}

/** Call the API, retrying up to 3 times on delivery problems. */
export async function call(action, payload = {}, token = null) {
  if (!CONFIG.API_URL || CONFIG.API_URL.startsWith('PASTE_')) {
    throw new ApiError('NOT_CONFIGURED', 'The app is not connected to its server yet. The API address must be pasted into config.js (see the Setup Guide).');
  }
  const body = JSON.stringify(Object.assign({ action, token, appVersion: CONFIG.APP_VERSION }, payload));
  const attempts = action === 'requestCode' ? 1 : 3; // never send two sign-in emails by accident
  let last;
  for (let i = 0; i < attempts; i++) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ApiError('NETWORK', 'No internet connection.');
    try {
      return await once(action, body, CONFIG.REQUEST_TIMEOUT_SECONDS);
    } catch (e) {
      last = e;
      if (!(e instanceof ApiError) || !RETRYABLE.has(e.code) || i === attempts - 1) break;
      await sleep(1500 * (i + 1));
    }
  }
  if (last && last.code === 'BAD_ANSWER') throw new ApiError('NETWORK', last.message + ' Tried 3 times; will try again shortly.');
  throw last;
}
