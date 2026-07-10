import {
  Component,
  OnInit,
  AfterViewInit,
  OnDestroy,
  ChangeDetectorRef,
  ElementRef,
  ViewChild,
  effect
} from '@angular/core';
import {
  Router,
  NavigationEnd
} from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonRouterOutlet } from '@ionic/angular/standalone';
import { Platform } from '@ionic/angular/common';
import {
  Subscription,
  filter
} from 'rxjs';
import {
  ServizioStatoEvento,
  StatoEventoAttivo
} from '../services/event-state.service';
import { ServizioNotifiche } from '../services/notification.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, IonRouterOutlet],
  template: `
    <div class="shell-wrap">
      <div class="shell-content">
        <ion-router-outlet></ion-router-outlet>
      </div>
      <nav class="tab-bar" #tabBar [class.tab-bar-overlay]="tabAttiva === 'camera'">

        <button class="tab" [class.tab-active]="tabAttiva==='eventi'" (click)="go('/eventi/miei')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="2" width="20" height="20" rx="2"/>
            <line x1="7" y1="2" x2="7" y2="22"/>
            <line x1="17" y1="2" x2="17" y2="22"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
          </svg>
          <span>Rullini</span>
        </button>

        <button class="tab"
          *ngIf="isHybrid"
          [class.tab-active]="tabAttiva==='camera'"
          [class.tab-on]="st?.showCamera"
          [disabled]="!st?.showCamera"
          (click)="goCamera()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          <span class="badge" *ngIf="st?.showCamera && (st?.scattiRimanenti ?? 0) > 0">
            {{ st?.scattiRimanenti }}
          </span>
          <span>Camera</span>
        </button>

        <button class="tab"
          [class.tab-active]="tabAttiva==='partecipa'"
          (click)="go('/eventi/partecipa')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/>
            <line x1="13" y1="6" x2="13" y2="18" stroke-dasharray="2 2"/>
          </svg>
          <span>Partecipa</span>
        </button>

        <button class="tab" [class.tab-active]="tabAttiva==='profilo'" (click)="go('/profilo')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          <span>Profilo</span>
        </button>

      </nav>
    </div>
  `,
  styles: [`
    /* Struttura principale: la shell occupa tutto lo schermo, la barra si posiziona in basso */
    .shell-wrap {
      display: flex;
      flex-direction: column;
      height: 100vh;
      height: 100dvh;
      overflow: hidden;
      position: relative;
    }

    /* Il router outlet riempie tutto lo spazio rimanente sopra la tab bar */
    .shell-content {
      flex: 1;
      overflow: hidden;
      position: relative;
    }

    ion-router-outlet {
      height: 100%;
    }

    /* La tab bar è sempre in BASSO */
    .tab-bar {
      display: flex;
      flex-shrink: 0;
      background: var(--echo-surface-dark);
      border-top: 1px solid rgba(0,0,0,0.25);
      padding-bottom: env(safe-area-inset-bottom, 4px);
      z-index: 1000;
    }

    .tab-bar-overlay {
      position: absolute;
      left: 0; right: 0; bottom: 0;
    }

    /* Stile generale per i pulsanti della tab bar */
    .tab {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      padding: 10px 4px 6px;
      background: transparent;
      border: none;
      cursor: pointer;
      position: relative;
      font-family: var(--echo-font-mono);
      color: rgba(245,239,230,0.3);
      transition: color 150ms;
      -webkit-tap-highlight-color: transparent;
    }

    .tab svg {
      width: 22px;
      height: 22px;
      stroke: currentColor;
    }

    .tab span:last-child {
      font-size: 9px;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    
    /* Stati dei pulsanti della tab bar */
    .tab-on     { color: var(--echo-surface-card); }
    .tab-active { color: var(--echo-cream); }
    .tab[disabled] { color: rgba(245,239,230,0.15); cursor: default; }

    /* Indicatore rosso (badge) per il numero di scatti */
    .badge {
      position: absolute;
      top: 6px;
      right: calc(50% - 16px);
      min-width: 16px;
      height: 16px;
      border-radius: 8px;
      background: var(--echo-rust);
      color: var(--echo-cream);
      font-size: 9px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 4px;
    }
  `],
})
export class ComponenteShellApp implements OnInit, AfterViewInit, OnDestroy {
  // Stato corrente dell'evento (es. se c'è un evento attivo a cui si partecipa)
  st: StatoEventoAttivo | null = null;

  // Tiene traccia della tab attualmente selezionata per evidenziarla
  tabAttiva: 'eventi' | 'camera' | 'partecipa' | 'profilo' = 'eventi';

  /** La fotocamera si basa sul layer nativo CameraPreview — nascosta del tutto su web/desktop. */
  readonly isHybrid: boolean;
  private subs = new Subscription();

  @ViewChild('tabBar') tabBarRef!: ElementRef<HTMLElement>;

  constructor(
    private svc: ServizioStatoEvento,
    private router: Router,
    private cdr: ChangeDetectorRef,
    platform: Platform,
    // Iniettato solo per avviarlo non appena lo shell autenticato viene montato — non ha
    // un'API pubblica che lo shell debba chiamare, ascolta semplicemente ServizioStatoEvento da sé.
    _notifications: ServizioNotifiche,
  ) 
  {
    // Verifica se l'app gira su dispositivo mobile (iOS/Android) tramite Capacitor/Cordova
    this.isHybrid = platform.is('hybrid');

    // Aggiorna la vista automaticamente quando cambia il segnale dello stato dell'evento
    effect(() => {
      this.st = this.svc.segnaleStato();
      this.cdr.markForCheck(); // Forza l'aggiornamento UI per OnPush
    });
  }

  ngOnInit() {
    // Avvia polling e countdown dello stato evento SOLO ora: il servizio non interroga mai il server da sloggati.
    this.svc.start();

    // Ascolta i cambiamenti di rotta (URL) per mantenere sincronizzata la tab bar
    this.subs.add(
      this.router.events
        .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
        .subscribe(e => {
          this.syncTab(e.urlAfterRedirects);
          this.cdr.markForCheck(); // Forza l'aggiornamento UI per OnPush
        })
    );
    // Sincronizza la tab al primo caricamento
    this.syncTab(this.router.url);
  }

  ngAfterViewInit() {
    // Espone l'altezza reale della tab bar come variabile CSS, così le pagine che la fanno
    // galleggiare sopra il proprio contenuto (es. camera fullscreen) sanno quanto spazio riservare.
    document.documentElement.style.setProperty(
      '--echo-tab-bar-height',
      this.tabBarRef.nativeElement.offsetHeight + 'px'
    );
  }

  ngOnDestroy() {
    // Evita memory leaks scollegando le iscrizioni (subscriptions)
    this.subs.unsubscribe();
    // La shell muore quando si esce dall'area autenticata (logout): ferma polling e ticker.
    this.svc.stop();
  }

  // Navigazione generica
  go(path: string) {
    this.router.navigateByUrl(path);
  }

  // Navigazione specifica per la fotocamera con passaggio di parametri (stato)
  goCamera() {
    const ev = this.st?.evento;
    // Blocca l'accesso se non c'è un evento o se la camera non deve essere mostrata
    if (!ev || !this.st?.showCamera) return;

    // Passa i dati dell'evento alla rotta della camera senza metterli nell'URL
    this.router.navigate(['/camera', ev.id_evento], {
      state: {
        scatti_usati: ev.scatti_usati,
        scatti_per_utente: ev.scatti_per_utente,
        eventoNome: ev.nome,
      },
    });
  }

  // Determina quale tab evidenziare in base all'URL corrente
  private syncTab(url: string) {
    if (url.startsWith('/camera')) this.tabAttiva = 'camera';
    else if (url.startsWith('/eventi/partecipa')) this.tabAttiva = 'partecipa';
    else if (url.startsWith('/profilo') || url.startsWith('/impostazioni')) this.tabAttiva = 'profilo';
    else this.tabAttiva = 'eventi';
  }
}