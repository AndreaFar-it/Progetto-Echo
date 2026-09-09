import {
  Component,
  OnInit,
  AfterViewInit,
  OnDestroy,
  ElementRef,
  ViewChild,
  effect
} from '@angular/core';
import {
  Router,
  NavigationEnd
} from '@angular/router';

import { IonRouterOutlet } from '@ionic/angular/standalone';
import { ServizioPiattaforma } from '../core/piattaforma.service';
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
  imports: [IonRouterOutlet],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss',
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
    piattaforma: ServizioPiattaforma,
    // Iniettato solo per avviarlo non appena lo shell autenticato viene montato — non ha
    // un'API pubblica che lo shell debba chiamare, ascolta semplicemente ServizioStatoEvento da sé.
    _notifications: ServizioNotifiche,
  ) 
  {
    // Verifica se l'app gira su dispositivo mobile (iOS/Android) tramite Capacitor/Cordova
    this.isHybrid = piattaforma.isNativa;

    // Aggiorna la vista automaticamente quando cambia il segnale dello stato dell'evento
    effect(() => {
      this.st = this.svc.segnaleStato();
    });
  }

  ngOnInit() {
    // Avvia polling e countdown dello stato evento SOLO ora: il servizio non interroga mai il server da sloggati.
    this.svc.start();

    // Ascolta i cambiamenti di rotta (URL) per mantenere sincronizzata la tab bar
    this.subs.add(
      this.router.events
        .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
        .subscribe(e => this.syncTab(e.urlAfterRedirects))
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