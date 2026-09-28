import { Injectable } from '@angular/core';
import { ServizioPiattaforma } from './piattaforma.service';
import { PushNotifications } from '@capacitor/push-notifications';
import { ToastController } from '@ionic/angular/standalone';
import { ApiService } from './api.service';
import { ServizioStatoEvento } from './event-state.service';

@Injectable({ providedIn: 'root' })
export class ServizioNotifiche {
  private readonly isNativa: boolean;
  // Impedisce di registrare due volte gli stessi listener se register() viene richiamato più volte.
  private listenersRegistrati = false;

  constructor(
    private api: ApiService,
    private eventState: ServizioStatoEvento,
    private toastCtrl: ToastController,
    piattaforma: ServizioPiattaforma,
  ) {
    this.isNativa = piattaforma.isNativa; // Controlla la piattaforma: se non è nativa, non ha senso registrare le notifiche push.
    if (this.isNativa) void this.register(); // Se l'app è nativa, registra subito le notifiche push
  }

  //Richiamabile su richiesta esplicita dell'utente
  async richiediPermessoNotifiche(): Promise<boolean> {
    if (!this.isNativa) return false;
    await this.register();
    return (await PushNotifications.checkPermissions()).receive === 'granted';
  }

  private async register(): Promise<void> {
    const perm = await PushNotifications.requestPermissions().catch(() => null);
    if (perm?.receive !== 'granted') return;

    if (!this.listenersRegistrati) {
      this.listenersRegistrati = true;
      PushNotifications.addListener('registration', token => {
        this.api.registraPushToken(token.value).subscribe({
          error: errore => console.warn('[ServizioNotifiche] failed to register push token', errore),
        });
      }).catch(errore => console.warn('[ServizioNotifiche] addListener registration fallito', errore));

      PushNotifications.addListener('registrationError', errore => {
        console.warn('[ServizioNotifiche] FCM registration error', errore);
      }).catch(errore => console.warn('[ServizioNotifiche] addListener registrationError fallito', errore));

      // In foreground il sistema non mostra da solo il banner: lo mostriamo noi con un toast,
      // e forziamo un refresh subito perché lo stato locale potrebbe essere fino a 30s indietro.
      PushNotifications.addListener('pushNotificationReceived', notifica => {
        this.toastCtrl.create({
          message: notifica.title ? `${notifica.title}: ${notifica.body}` : (notifica.body ?? ''),
          duration: 3500,
          position: 'top',
        }).then(t => t.present());
        void this.eventState.refresh();
      }).catch(errore => console.warn('[ServizioNotifiche] addListener pushNotificationReceived fallito', errore));
    }

    await PushNotifications.register();
  }
}
