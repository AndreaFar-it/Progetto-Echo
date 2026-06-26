/**
 * ECHO — Servizio Notifiche Push
 *
 * Registra questo dispositivo su Firebase Cloud Messaging e invia il token risultante al
 * backend (ApiService.registraPushToken()), che lo memorizza su UTENTE.push_token e lo usa
 * (inviaPushNotifica() in eventLifecycle.service.ts) per consegnare notifiche reali per le
 * transizioni del ciclo di vita (evento iniziato, foto in sviluppo, album sbloccato, votazioni
 * chiuse) — anche mentre l'app è completamente chiusa, poiché la consegna avviene a livello
 * OS/FCM, non tramite polling dell'app. Solo nativo; sul web la UI live riflette già i cambi
 * di stato direttamente, nessun push necessario.
 *
 * Richiede un progetto Firebase configurato (google-services.json in android/app/ + il
 * firebase-service-account.json del backend) — vedi DEV_SETUP.md. Senza, la registrazione
 * gira comunque ma il token che il backend riceve non corrisponderà a nulla che FCM possa
 * raggiungere; no-op innocuo finché Firebase non è configurato.
 */

import { Injectable } from '@angular/core';
import { Platform } from '@ionic/angular/common';
import { PushNotifications } from '@capacitor/push-notifications';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class ServizioNotifiche {
  private readonly isNativo: boolean;

  constructor(private api: ApiService, platform: Platform) {
    this.isNativo = platform.is('hybrid');
    if (this.isNativo) this.register();
  }

  private async register(): Promise<void> {
    const perm = await PushNotifications.requestPermissions().catch(() => null);
    if (perm?.receive !== 'granted') return; // utente ha rifiutato — può concedere dopo nelle impostazioni OS

    PushNotifications.addListener('registration', token => {
      this.api.registraPushToken(token.value).subscribe({
        error: errore => console.warn('[ServizioNotifiche] failed to register push token', errore),
      });
    });
    PushNotifications.addListener('registrationError', errore => {
      console.warn('[ServizioNotifiche] FCM registration error', errore);
    });
    // Consegna in foreground: la UI live (badge delle tab, countdown) riflette già lo stesso
    // cambio di stato, quindi logga solo per visibilità invece di duplicarlo come toast.
    PushNotifications.addListener('pushNotificationReceived', n => {
      console.log('[ServizioNotifiche] push received in foreground', n);
    });

    await PushNotifications.register();
  }
}
