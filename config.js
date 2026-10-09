/* =====================================================================
 * BGS Operations — APP SETTINGS
 * After deploying the Google Apps Script API, paste its "Web app URL"
 * (it ends in /exec) between the quotes below, then upload this file.
 * ===================================================================== */

const API_URL_PRODUCTION = 'https://script.google.com/macros/s/AKfycbwUw4IkfNuFrK3YlJ3DJN1PuHfrsAxmiPSA5502bhHk6Ynisq9KwzmX0kuwg8BL3YADoA/exec';

export const CONFIG = {
  // When the app runs on this computer for testing, it talks to the local test server.
  API_URL: (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? '/api' : API_URL_PRODUCTION,

  // Must match the "version" in sw.js when you publish an update.
  APP_VERSION: '1.0.3',

  // How often the app checks for new data while it is open (minutes).
  SYNC_EVERY_MINUTES: 5,

  // Requests that take longer than this are treated as "no connection" (seconds).
  REQUEST_TIMEOUT_SECONDS: 40,

  // Photos are shrunk to at most this many pixels on the long side before upload.
  PHOTO_MAX_PX: 1600
};
