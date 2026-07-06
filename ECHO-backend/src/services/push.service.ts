import {
  initializeApp,
  cert
} from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

let initialized = false;

// Inizializzazione del modulo Firebase, a partire dalla chiave di servizio in FIREBASE_SERVICE_ACCOUNT_JSON.
function tryInit(): boolean {
  if (initialized) return true;
  try {
    const inlineJson = process.env['FIREBASE_SERVICE_ACCOUNT_JSON'];
    if (!inlineJson) return false;
    initializeApp({ credential: cert(JSON.parse(inlineJson)) });
    initialized = true;
    return true;
  } catch (e) {
    console.error('[Push] Failed to initialise Firebase Admin SDK:', e);
    return false;
  }
}

// Invio effettivo della notifica push a un token specifico
export async function sendFcmPush(
  token: string,
  payload: { title: string; body: string; data?: Record<string, unknown> },
): Promise<void> {
  if (!tryInit()) return; // Fallback se Firebase non è configurato
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

// Utility per convertire tutti i valori del payload custom in stringhe (requisito FCM)
function stringifyData(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) out[k] = String(v);
  return out;
}