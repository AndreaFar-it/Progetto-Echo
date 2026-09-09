import { Injectable } from '@angular/core';
import { ServizioPiattaforma } from '../core/piattaforma.service';
import { PushNotifications } from '@capacitor/push-notifications';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class ServizioNotifiche {
  private readonly isNativa: boolean;

  // Controlla se il dispositivo è mobile e nel caso lo registra al servizio PushNotification
  constructor(private api: ApiService, piattaforma: ServizioPiattaforma) {
    this.isNativa = piattaforma.isNativa;
    if (this.isNativa) this.register();
  }

  // Metodo per registrare i dispositivi alla ricezione di notifiche
  private async register(): Promise<void> {

    // Aspetta che l'utente accetti l'invio delle notifiche
    // Se rifiutata, non inviamo notifiche e può cambiare l'opzione nelle impostazioni successivamente
    const perm = await PushNotifications.requestPermissions().catch(() => null);
    if (perm?.receive !== 'granted') return;

    PushNotifications.addListener('registration', token => {
      this.api.registraPushToken(token.value).subscribe({
        error: errore => console.warn('[ServizioNotifiche] failed to register push token', errore),
      });
    });
    PushNotifications.addListener('registrationError', errore => {
      console.warn('[ServizioNotifiche] FCM registration error', errore);
    });
    // Segnaposto: il punto di aggancio resta pronto per quando servira'.
    PushNotifications.addListener('pushNotificationReceived', () => { /* da implementare */ });

    await PushNotifications.register();
  }
}
