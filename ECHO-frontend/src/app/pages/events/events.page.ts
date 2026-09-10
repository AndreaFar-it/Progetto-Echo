import {
  Component,
  OnInit,
  OnDestroy
} from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import {
  IonContent,
  IonRefresher,
  IonRefresherContent,
  ToastController,
  AlertController,
  LoadingController
} from '@ionic/angular/standalone';
import { Clipboard } from '@capacitor/clipboard';
import type { RefresherCustomEvent } from '@ionic/angular/standalone';
import { ViewWillEnter } from '@ionic/angular';
import { ServizioPiattaforma } from '../../services/piattaforma.service';
import { ApiService } from '../../services/api.service';
import { ServizioStatoEvento } from '../../services/event-state.service';
import { EventoCard } from '../../models/index';
import {
  ComponenteIntestazione,
  ComponenteEtichettaStato
} from '../../components';
import {
  firstValueFrom,
  Subscription
} from 'rxjs';
import {
  MS_PER_MINUTO,
  isoToMs
} from '../../core/time.util';

@Component({
  selector: 'app-events', standalone: true,
  imports: [DatePipe, IonContent, IonRefresher, IonRefresherContent, ComponenteIntestazione, ComponenteEtichettaStato],
  templateUrl: './events.page.html',
  styleUrl: './events.page.scss',
})
export class PaginaEventi implements OnInit, OnDestroy, ViewWillEnter {
  eventi: EventoCard[] = [];
  caricamento = true;
  modalitaVista: 'partecipante' | 'creatore' = 'partecipante';
  eventoConCodice: EventoCard | null = null;
  codiceCopiate = false;

  private subEventi?: Subscription;
  private promptedIds = new Set<string>();

  get eventiFiltrati(): EventoCard[] {
    return this.eventi.filter(e => this.modalitaVista === 'creatore' ? e.is_organiser : !e.is_organiser);
  }

  constructor(
    public router: Router,
    private api: ApiService,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private loadingCtrl: LoadingController,
    private piattaforma: ServizioPiattaforma,
    private svc: ServizioStatoEvento,
  ) { }

  ngOnInit() {
    this.subEventi = this.svc.eventi$.subscribe(events => {
      this.eventi = events;
      this.checkExtensionPrompts();
    });

    this.loadEvents();
  }

  ngOnDestroy() {
    this.subEventi?.unsubscribe();
  }

  ionViewWillEnter() {
    this.loadEvents();
  }

  async handleRefresh(event: RefresherCustomEvent) {
    await this.loadEvents();
    event.target.complete();
  }

  // Forza un fetch tramite il servizio condiviso: la lista arriva poi via subEventi.
  async loadEvents() {
    const ok = await this.svc.refresh();
    if (!ok) {
      await this.toast('Impossibile caricare gli eventi', 'danger');
    }
    this.caricamento = false;
  }

  // Controlla se bisogna inviare un alert per l'estensione dell'evento
  private checkExtensionPrompts() {
    const toEstendi = this.eventi.find(e => e.needs_estensione_response && !this.promptedIds.has(e.id_evento));
    if (toEstendi) {
      this.promptEstensione(toEstendi);
      return;
    }

    const toPermanenza = this.eventi.find(e => e.needs_permanenza_response && !this.promptedIds.has(e.id_evento));
    if (toPermanenza) {
      this.promptPermanenza(toPermanenza);
    }
  }

  // Mostra un alert per chiedere all'organizzatore se vuole estendere l'evento
  private async promptEstensione(event: EventoCard) {
    this.promptedIds.add(event.id_evento);
    const durata = this.extDurataLabel(event);
    const alert = await this.alertCtrl.create({
      header: 'Estendi evento',
      message: `"${event.nome}" sta per finire. Vuoi estenderlo di ${durata}?`,
      backdropDismiss: false,
      buttons: [
        { text: 'No, termina ora', role: 'cancel', handler: () => this.rispondiEstensione(event, false) },
        { text: 'Sì, estendi', handler: () => this.rispondiEstensione(event, true) },
      ],
    });
    await alert.present();
  }

  // Gestisce la risposta dell'utente alla richiesta di estensione
  private async rispondiEstensione(event: EventoCard, accetta: boolean) {
    try {
      await firstValueFrom(this.api.estendiEvento(event.id_evento, accetta));
      await this.toast(accetta ? `Evento esteso di ${this.extDurataLabel(event)}` : 'Evento terminerà come previsto', 'success');
      await this.loadEvents();
    } catch {
      await this.toast('Impossibile registrare la risposta', 'danger');
    }
  }

  // Mostra un alert ai partecipanti per notificare che l'evento è stato esteso e chiedere se rimangono
  private async promptPermanenza(event: EventoCard) {
    this.promptedIds.add(event.id_evento);
    const alert = await this.alertCtrl.create({
      header: 'Evento esteso',
      message: `"${event.nome}" è stato esteso di ${this.extDurataLabel(event)}. Desideri rimanere all'evento?`,
      backdropDismiss: false,
      buttons: [
        { text: 'No', role: 'cancel', handler: () => this.rispondiPermanenza(event, false) },
        { text: 'Sì, rimango', handler: () => this.rispondiPermanenza(event, true) },
      ],
    });
    await alert.present();
  }

  // Gestisce la risposta dei partecipanti riguardo il rimanere all'evento esteso
  private async rispondiPermanenza(event: EventoCard, rimane: boolean) {
    try {
      await firstValueFrom(this.api.rimaniEvento(event.id_evento, rimane));
      await this.toast(rimane ? "Bene, ci vediamo all'evento!" : 'Sei libero per altri impegni', 'success');
      await this.loadEvents();
    } catch {
      await this.toast('Impossibile registrare la risposta', 'danger');
    }
  }

  // Gestisce l'interazione del click/tap su un'intera card evento
  onEventTap(event: EventoCard) {
    switch (event.stato) {
      case 'in_corso':
        if (!this.piattaforma.isNativa) {
          this.toast("Per scattare le foto usa l'app ECHO sul tuo telefono", 'dark');
        } else if (event.scatti_usati < event.scatti_per_utente) {
          this.router.navigate(['/camera', event.id_evento], {
            state: { scatti_usati: event.scatti_usati, scatti_per_utente: event.scatti_per_utente, eventoNome: event.nome }
          });
        } else {
          this.toast('Hai già esaurito i tuoi scatti', 'warning');
        }
        break;
      case 'album_aperto': case 'chiusa':
        this.router.navigate(['/gallery', event.id_evento], { state: { eventoNome: event.nome } });
        break;
      case 'sviluppo':
        this.toast('Il rullino è in sviluppo — torna tra poco!', 'dark');
        break;
      case 'non_iniziata':
        this.toast("L'evento non è ancora iniziato", 'dark');
        break;
    }
  }

  // Metodo per andare alle analitcs
  openAnalytics(event: EventoCard, $event: MouseEvent) {
    $event.stopPropagation();
    this.router.navigate(['/events', event.id_evento, 'analytics'], { state: { eventoNome: event.nome } });
  }

  // Chiede conferma prima di procedere all'eliminazione dell'evento
  async confirmDelete(event: EventoCard, $event: MouseEvent) {
    // Evita che il click sul bottone elimini apra accidentalmente i dettagli dell'evento
    $event.stopPropagation();
    const alert = await this.alertCtrl.create({
      header: 'Elimina evento',
      message: `Vuoi eliminare "${event.nome}"? L'azione è irreversibile.`,
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        // Pulsante di conferma (stile distruttivo per segnalare pericolo), chiama deleteEvent se premuto
        { text: 'Elimina', role: 'destructive', handler: () => this.deleteEvent(event.id_evento) },
      ],
    });
    await alert.present();
  }

  // Esegue l'eliminazione effettiva dell'evento invocando le API
  async deleteEvent(id: string) {
    const loading = await this.loadingCtrl.create({ message: 'Eliminazione…' });
    await loading.present();
    try {
      await firstValueFrom(this.api.deleteEvento(id));
      await this.toast('Evento eliminato', 'success');
      await this.loadEvents();
    } catch {
      await this.toast("Impossibile eliminare l'evento", 'danger');
    } finally {
      loading.dismiss();
    }
  }

  // Funzione di utilità per creare un array di lunghezza 'n'
  makePips(n: number): number[] {
    return Array.from({ length: n });
  }

  // Restituisce la stringa descrittiva dello stato per la visualizzazione partecipante
  statoCopy(e: EventoCard): string {
    const esteso = e.estensione_accettata === 1;
    switch (e.stato) {
      case 'non_iniziata': {
        const r = this.eventStartsIn(e);
        return r ? `Inizia tra ${r}` : "Preparati all'evento! Ricordati di portare con te il telefono.";
      }
      case 'in_corso':
        return esteso
          ? `L'evento è stato prolungato di ${this.extDurataLabel(e)}. Continua a scattare!`
          : "L'evento è ancora in corso. Goditelo!";
      case 'sviluppo': {
        const r = this.formatRemaining(e.album_sbloccato_at);
        return r ? `Le foto sono in fase di sviluppo. Torna tra ${r}` : 'Le foto sono in fase di sviluppo.';
      }
      case 'album_aperto': {
        const r = e.voting_end_at ? this.formatRemaining(e.voting_end_at) : '';
        return r ? `Il rullino è pronto! Vota — scade tra ${r}` : 'Il rullino è pronto! Vota la tua foto preferita.';
      }
      case 'chiusa':
        return esteso
          ? 'Evento prolungato e concluso! Le foto sono state sviluppate.'
          : 'Le foto sono state sviluppate!';
      default: return '';
    }
  }

  // Ritorna l'etichetta della durata di estensione
  private extDurataLabel(e: EventoCard): string {
    return e.durata_minuti <= 5 ? '3 minuti' : '2 ore';
  }

  // Tempo rimanente leggibile da ora a un target epoch-ms ("23h 45m", "45m").
  private remainingFromMs(targetMs: number): string {
    const diffMs = targetMs - Date.now();
    if (!Number.isFinite(diffMs) || diffMs <= 0) return '';
    const totalMin = Math.ceil(diffMs / MS_PER_MINUTO);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  // Tempo rimanente verso un target ISO assoluto (usato per le fasi sviluppo/album_aperto).
  formatRemaining(targetIso: string): string {
    return this.remainingFromMs(isoToMs(targetIso));
  }

  // Tempo prima che un evento 'non_iniziata' inizi (basato su data_inizio).
  eventStartsIn(e: EventoCard): string {
    return this.remainingFromMs(isoToMs(e.data_inizio));
  }

  eventEndsIn(e: EventoCard): string {
    const fineMs = e.estensione_accettata === 1
      ? isoToMs(e.data_fine_calc)
      : isoToMs(e.data_inizio) + e.durata_minuti * MS_PER_MINUTO;
    return this.remainingFromMs(fineMs);
  }

  // Genera l'etichetta del bottone di Call To Action (azione principale)
  ctaLabel(e: EventoCard): string | null {
    switch (e.stato) {
      case 'in_corso':
        return (this.piattaforma.isNativa && e.scatti_usati < e.scatti_per_utente) ? 'Scatta una foto' : null;
      case 'album_aperto':
      case 'chiusa':
        return 'Guarda il rullino';
      default:
        return null;
    }
  }

  // Restituisce la stringa descrittiva dello stato per la visualizzazione dell'organizzatore (creatore)
  creatorStatoCopy(e: EventoCard): string {
    const esteso = e.estensione_accettata === 1;
    switch (e.stato) {
      case 'non_iniziata': {
        const r = this.eventStartsIn(e);
        return r ? `Inizia tra ${r}` : 'Condividi il codice per far partecipare i tuoi ospiti.';
      }
      case 'in_corso': {
        const r = this.eventEndsIn(e);
        const label = esteso ? 'In corso (esteso)' : 'In corso';
        return r ? `${label} — termina tra ${r}` : `${label}.`;
      }
      case 'sviluppo': {
        const r = this.formatRemaining(e.album_sbloccato_at);
        return r ? `Le foto sono in fase di sviluppo. Torna tra ${r}` : 'Le foto sono in fase di sviluppo.';
      }
      case 'album_aperto': return 'Le votazioni sono aperte.';
      case 'chiusa':
        return esteso
          ? 'Esteso e concluso con successo! Guarda il report.'
          : 'È stato un successo! Guarda il report.';
      default:
        return '';
    }
  }

  // Prepara e apre l'interfaccia/modale (o mostra una porzione UI) del codice dell'evento
  showCode(event: EventoCard, $event: MouseEvent) {
    $event.stopPropagation();
    this.eventoConCodice = event;
    this.codiceCopiate = false;
  }

  // Chiude solo se il click cade sullo sfondo, non sul pannello.
  chiudiCodiceSuBackdrop(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('code-overlay')) {
      this.eventoConCodice = null;
    }
  }

  // Attiva la funzionalità nativa di condivisione del dispositivo o la copia appunti per il codice invito
  async shareCode(event: EventoCard) {
    const text = `Sei invitato a "${event.nome}"! Usa il codice ${event.codice} per partecipare su ECHO.`;
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };

    if (nav.share) {
      try {
        await nav.share({ title: 'ECHO', text });
        return;
      } catch {
        // Condivisione annullata dall'utente o non riuscita: si ripiega sulla
        // copia negli appunti, subito sotto.
      }
    }

    // Scrive il messaggio nella clipboard del dispositivo
    await Clipboard.write({ string: text });
    this.codiceCopiate = true;
    setTimeout(() => (this.codiceCopiate = false), 2500);
  }

  private async toast(msg: string, color: string = 'dark') {
    const t = await this.toastCtrl.create({ message: msg, duration: 2800, color, position: 'bottom' });
    t.present();
  }
}