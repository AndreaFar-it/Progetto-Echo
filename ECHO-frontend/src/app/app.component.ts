import {
  Component,
  OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonApp,
  IonRouterOutlet,
  ToastController
} from '@ionic/angular/standalone';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { ComponenteSplash } from './shell/splash-overlay.component';
import { ApiService } from './services/api.service';
import { firstValueFrom, filter } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, IonApp, IonRouterOutlet, ComponenteSplash],
  template: `
    <ion-app>
      <ion-router-outlet></ion-router-outlet>
      <app-splash-overlay *ngIf="showSplash" (done)="showSplash = false"></app-splash-overlay>
      <div class="wakeup-banner" *ngIf="waking">
        <span class="wakeup-dot"></span>
        Avvio del server in corso…
      </div>
    </ion-app>
  `,
  styles: [`
    /* Stili per il banner di attesa del server: centrato, sfocato sul retro e in primo piano */
    .wakeup-banner {
      position: fixed;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(42,26,14,0.92);
      color: #f5efe6;
      padding: 10px 20px;
      border-radius: 24px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 8px;
      z-index: 9999;
      backdrop-filter: blur(8px);
      white-space: nowrap;
    }
    /* Indicatore pulsante (pallino) all'interno del banner */
    .wakeup-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #b85c38;
      animation: pulse 1.2s ease-in-out infinite;
    }
    /* Animazione di pulsazione per il pallino */
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.7); }
    }
  `],
})
export class AppComponent implements OnInit {
  showSplash = true;
  // Stato per la visibilità del banner di "risveglio" del server
  waking = false;

  constructor(
    private api: ApiService,
    private swUpdate: SwUpdate,
    private toastCtrl: ToastController,
  ) { }

  ngOnInit() {
    // Inizia la procedura di "risveglio" del server all'avvio dell'app
    this.prewarmBackend();
    // Ascolta le nuove versioni pubblicate dal service worker
    this.ascoltaAggiornamentiApp();
  }

  // Appena la nuova versione è pronta (VERSION_READY) proponiamo l'aggiornamento con un toast.
  private ascoltaAggiornamentiApp(): void {
    if (!this.swUpdate.isEnabled) return; // service worker assente (dev mode) o non registrato

    this.swUpdate.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(async () => {
        const toast = await this.toastCtrl.create({
          message: 'È disponibile una nuova versione di ECHO',
          position: 'bottom',
          color: 'dark',
          buttons: [{ text: 'Aggiorna', role: 'confirm' }],
          duration: 10000,
        });
        await toast.present();
        const { role } = await toast.onDidDismiss();
        if (role === 'confirm') {
          await this.swUpdate.activateUpdate();
          document.location.reload();
        }
      });
  }

  private async prewarmBackend() {

    const banner = setTimeout(() => (this.waking = true), 1500);
    let ok = false;
    while (!ok) {
      try {
        // Tenta di recuperare la configurazione dal server
        await firstValueFrom(this.api.getConfigurazione());
        ok = true;
      } catch {
        // Backend still sleeping — wait 8s and retry
        await new Promise(r => setTimeout(r, 8000));
      }
    }
    clearTimeout(banner);
    this.waking = false;
  }
}