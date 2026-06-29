/**
 * ECHO — Notifiche Push tramite Firebase Cloud Messaging (FCM).
 * Richiede una chiave di servizio (Service Account) salvata localmente o configurata tramite variabili d'ambiente.
 * Se la chiave manca, il servizio fallisce silenziosamente per consentire lo sviluppo locale senza configurazioni obbligatorie.
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import fs from 'fs';
import path from 'path';

// Percorso della chiave di servizio Firebase
const SERVICE_ACCOUNT_PATH = process.env['FIREBASE_SERVICE_ACCOUNT_PATH']
  ?? path.join(__dirname, '../../firebase-service-account.json');

let initialized = false;

// Inizializzazione del modulo Firebase
function tryInit(): boolean {
  if (initialized) return true;
  try {
    // Caricamento credenziali: preferisce la variabile d'ambiente (cloud), poi il file locale
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

// Controllo configurazione all'avvio dell'applicazione
if (!tryInit()) {
  console.warn(
    `[Push] No Firebase service account found at ${SERVICE_ACCOUNT_PATH} — real push ` +
    'notifications are disabled (console-log fallback only). See DEV_SETUP.md.'
  );
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