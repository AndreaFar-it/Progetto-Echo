/**
 * ECHO — Real push notifications via Firebase Cloud Messaging.
 *
 * Needs a service account key (downloaded from Firebase Console → Project Settings →
 * Service accounts → Generate new private key) saved at the path below — gitignored,
 * never commit it. Until that file exists, sendFcmPush() is a safe no-op so the rest of
 * the app (and local dev without Firebase set up) keeps working exactly as before —
 * eventLifecycle.service.ts's console.log("[Push → ...]") is still the dev-visible trace.
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import fs from 'fs';
import path from 'path';

const SERVICE_ACCOUNT_PATH = process.env['FIREBASE_SERVICE_ACCOUNT_PATH']
  ?? path.join(__dirname, '../../firebase-service-account.json');

let initialized = false;

function tryInit(): boolean {
  if (initialized) return true;
  try {
    // Cloud hosts (Railway, etc.) pass the key as an env var rather than a committed
    // file — prefer that when present, fall back to the local file for dev machines.
    const inlineJson = process.env['FIREBASE_SERVICE_ACCOUNT_JSON'];
    const serviceAccount = inlineJson
      ? JSON.parse(inlineJson)
      : fs.existsSync(SERVICE_ACCOUNT_PATH)
        ? JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf-8'))
        : null;
    if (!serviceAccount) return false;
    initializeApp({ credential: cert(serviceAccount) });
    initialized = true;
    console.log('[Push] Firebase Admin SDK initialised — real push notifications active.');
    return true;
  } catch (e) {
    console.error('[Push] Failed to initialise Firebase Admin SDK:', e);
    return false;
  }
}

// Resolved once at boot so the "not configured" warning is loud and immediate, not just
// silently swallowed the first time a notification tries (and fails) to go out.
if (!tryInit()) {
  console.warn(
    `[Push] No Firebase service account found at ${SERVICE_ACCOUNT_PATH} — real push ` +
    'notifications are disabled (console-log fallback only). See DEV_SETUP.md.'
  );
}

export async function sendFcmPush(
  token: string,
  payload: { title: string; body: string; data?: Record<string, unknown> },
): Promise<void> {
  if (!tryInit()) return; // already warned at boot — stay quiet per-call
  try {
    await getMessaging().send({
      token,
      notification: { title: payload.title, body: payload.body },
      data: payload.data ? stringifyData(payload.data) : undefined,
    });
  } catch (e) {
    console.error(`[Push] FCM send failed for token ${token.slice(0, 12)}…:`, e);
  }
}

/** FCM's "data" payload requires every value to be a string. */
function stringifyData(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) out[k] = String(v);
  return out;
}
