import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonContent, IonRefresher, IonRefresherContent, ToastController, AlertController, LoadingController } from '@ionic/angular/standalone';
import { Clipboard } from '@capacitor/clipboard';
import type { RefresherCustomEvent } from '@ionic/angular/standalone';
import { ViewWillEnter } from '@ionic/angular';
import { Platform } from '@ionic/angular/common';
import { ApiService } from '../../services/api.service';
import { EventoCard } from '../../models/index';
import { ComponenteIntestazione, ComponenteEtichettaStato } from '../../shared/components';
import { firstValueFrom, interval, Subscription } from 'rxjs';
import { MS_PER_MINUTO, isoToMs } from '../../core/time.util';

// Cadenza del ticker che rifà il fetch e aggiorna i countdown per card.
const TICKER_MS = 60_000;

@Component({
  selector: 'app-events', standalone: true,
  imports: [CommonModule, IonContent, IonRefresher, IonRefresherContent, ComponenteIntestazione, ComponenteEtichettaStato],
  template: `
    <app-echo-header></app-echo-header>
    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="handleRefresh($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>
      <div class="page-shell">
        <button class="join-card" (click)="router.navigate(['/eventi/partecipa'])">
          <span class="join-card-label">Partecipa a un evento</span>
          <span class="join-card-sub">Inserisci il codice fornito dall'organizzatore</span>
        </button>

        <div class="section-header">
          <span class="section-label">I tuoi eventi</span>
        </div>

        <div class="tab-switcher">
          <button class="tab-pill" [class.active]="modalitaVista==='partecipante'" (click)="modalitaVista='partecipante'">Come Partecipante</button>
          <button class="tab-pill" [class.active]="modalitaVista==='creatore'" (click)="modalitaVista='creatore'">Come Creatore</button>
        </div>

        <div class="event-list">
          <div class="event-item" *ngFor="let event of eventiFiltrati" (click)="onEventTap(event)">
            <div class="event-name-row">
              <div class="event-name-group">
                <app-event-status-tag [stato]="event.stato"></app-event-status-tag>
                <div class="event-name">{{ event.nome }}</div>
              </div>
              <div class="event-meta">{{ event.data_inizio | date:'dd/MM/yy' }} - {{ event.luogo }}</div>
            </div>
            <div class="event-divider"></div>
            <div class="event-status-row">
              <span class="event-status-text">{{ modalitaVista === 'creatore' ? creatorStatoCopy(event) : statoCopy(event) }}</span>
              <div class="event-shots" *ngIf="event.stato === 'in_corso'">
                <div class="shot-pips">
                  <span class="shot-pip" *ngFor="let p of makePips(event.scatti_per_utente); let i = index" [class.used]="i < event.scatti_usati"></span>
                </div>
                <span class="shot-count">{{ event.scatti_usati }}/{{ event.scatti_per_utente }}</span>
              </div>
            </div>

            <!-- Tab creatore: azioni differenziate (codice / galleria / report) -->
            <div class="event-cta-row" *ngIf="modalitaVista === 'creatore'">
              <button class="event-cta" *ngIf="event.stato === 'non_iniziata' || event.stato === 'in_corso'"
                      (click)="showCode(event, $event)">Mostra codice</button>
              <button class="event-cta event-cta--half" *ngIf="event.stato === 'in_corso' || event.stato === 'sviluppo'"
                      (click)="openAnalytics(event, $event)">Statistiche live</button>
              <button class="event-cta event-cta--half" *ngIf="event.stato === 'album_aperto' || event.stato === 'chiusa'"
                      (click)="onEventTap(event); $event.stopPropagation()">Guarda il rullino</button>
              <button class="event-cta event-cta--half" *ngIf="event.stato === 'album_aperto' || event.stato === 'chiusa'"
                      (click)="openAnalytics(event, $event)">Guarda il report</button>
            </div>

            <!-- Tab partecipante: CTA singola -->
            <button class="event-cta" *ngIf="modalitaVista === 'partecipante' && ctaLabel(event) as label"
                    (click)="onEventTap(event); $event.stopPropagation()">{{ label }}</button>

            <div class="event-right-row" *ngIf="event.is_organiser">
              <button class="delete-btn" (click)="confirmDelete(event, $event)">✕</button>
            </div>
          </div>
        </div>

        <!-- ── Mostra codice modal ── -->
        <div class="code-overlay" *ngIf="eventoConCodice" (click)="eventoConCodice = null">
          <div class="code-modal" (click)="$event.stopPropagation()">
            <p class="code-modal-title">Codice evento</p>
            <p class="code-modal-sub">Condividi questo codice per far partecipare i tuoi ospiti a "{{ eventoConCodice.nome }}"</p>
            <div class="code-boxes">
              <div class="code-box" *ngFor="let ch of eventoConCodice.codice.split('')">{{ ch }}</div>
            </div>
            <div class="code-modal-actions">
              <button class="echo-btn code-modal-share" (click)="shareCode(eventoConCodice)">
                {{ codiceCopiate ? '✓ Copiato!' : 'Condividi' }}
              </button>
              <button class="echo-btn code-modal-close" (click)="eventoConCodice = null">Chiudi</button>
            </div>
          </div>
        </div>
        <div class="empty-state" *ngIf="!eventiFiltrati.length && !caricamento">
          <div class="empty-symbol">🎞</div>
          <p class="empty-title">Nessun rullino ancora</p>
          <p class="empty-body">Inserisci un codice o crea il tuo primo evento.</p>
        </div>
      </div>
    </ion-content>`,
  styles: [`
    ion-content{--background:var(--echo-bg)}
    .page-shell{padding:20px 16px 120px;max-width:600px;margin:0 auto}
    /* Desktop: allarga a una colonna centrata e immersiva, in linea con landing/dashboard. */
    @media (min-width:768px){ .page-shell{max-width:1180px} }
    .join-card{
      display:flex;flex-direction:column;align-items:flex-start;gap:4px;width:100%;
      background:transparent;border:1.5px solid var(--echo-ink);border-radius:var(--echo-radius-lg);
      padding:18px 20px;margin-bottom:24px;cursor:pointer;text-align:left;
    }
    .join-card-label{font-family:var(--echo-font-mono);font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--echo-ink)}
    .join-card-sub{font-family:var(--echo-font-mono);font-size:11px;color:var(--echo-ink-soft)}
    .section-header{margin-bottom:10px}
    .section-label{font-family:var(--echo-font-mono);font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--echo-ink-soft)}

    .tab-switcher{display:flex;gap:8px;margin-bottom:18px}
    .tab-pill{
      flex:1;padding:10px;border-radius:var(--echo-radius-pill);border:1px solid var(--echo-surface-muted);
      background:transparent;color:var(--echo-ink-soft);font-family:var(--echo-font-mono);
      font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;
    }
    .tab-pill.active{background:var(--echo-cream);border-color:var(--echo-ink);color:var(--echo-ink);box-shadow:0 2px 4px rgba(42,26,14,0.15)}

    .event-list{display:flex;flex-direction:column;gap:14px}
    .event-item{position:relative;background:var(--echo-surface-card);border-radius:var(--echo-radius-lg);padding:16px 18px;cursor:pointer;box-shadow:0 2px 6px rgba(42,26,14,0.12)}
    .event-name-row{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px}
    .event-name-group{display:flex;align-items:baseline;gap:8px;min-width:0;flex:1}
    .event-name{font-family:var(--echo-font-mono);font-weight:700;font-size:15px;letter-spacing:.02em;text-transform:uppercase;color:var(--echo-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
    .event-meta{flex-shrink:0;font-family:var(--echo-font-mono);font-size:11px;color:var(--echo-ink-soft)}
    .event-divider{height:1px;background:var(--echo-ink);opacity:.2;margin-bottom:10px}
    .event-status-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .event-status-text{font-family:var(--echo-font-mono);font-size:12px;color:var(--echo-ink);line-height:1.5}
    .event-shots{display:flex;align-items:center;gap:8px;flex-shrink:0}
    .shot-pips{display:flex;gap:4px}
    .shot-pip{width:7px;height:7px;border-radius:50%;background:rgba(42,26,14,.2);border:1px solid rgba(42,26,14,.3)}
    .shot-pip.used{background:var(--echo-ink);border-color:transparent}
    .shot-count{font-family:var(--echo-font-mono);font-size:11px;color:var(--echo-ink)}
    .event-cta{
      display:block;margin-top:14px;width:100%;background:var(--echo-surface-dark);color:var(--echo-cream);
      border:none;padding:10px;border-radius:var(--echo-radius-pill);font-family:var(--echo-font-mono);
      font-weight:700;font-size:11px;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;
      box-shadow:0 3px 0 #1E1209;
    }
    .event-cta-row{display:flex;gap:8px;margin-top:14px}
    .event-cta-row .event-cta{margin-top:0}
    .event-cta--half{flex:1}
    .event-right-row{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:10px}
    .delete-btn{background:transparent;border:1px solid rgba(42,26,14,.4);color:var(--echo-ink);border-radius:var(--echo-radius-sm);width:26px;height:26px;font-size:11px;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
    .delete-btn:active{border-color:var(--echo-rust);color:var(--echo-rust)}
    .empty-state{text-align:center;padding:48px 24px}
    .empty-symbol{font-size:52px;margin-bottom:16px}
    .empty-title{font-family:var(--echo-font-display);font-size:22px;color:var(--echo-ink);margin:0 0 8px}
    .empty-body{font-family:var(--echo-font-mono);font-size:13px;color:var(--echo-ink-soft);line-height:1.6;margin:0}

    /* ── Mostra codice modal ── */
    .code-overlay{position:fixed;inset:0;z-index:200;background:rgba(42,26,14,.6);display:flex;align-items:center;justify-content:center;padding:24px}
    .code-modal{background:var(--echo-bg);border-radius:var(--echo-radius-lg);padding:28px 24px;max-width:340px;width:100%;text-align:center}
    .code-modal-title{font-family:var(--echo-font-mono);font-weight:700;font-size:15px;letter-spacing:.06em;text-transform:uppercase;color:var(--echo-ink);margin:0 0 10px}
    .code-modal-sub{font-family:var(--echo-font-mono);font-size:12px;color:var(--echo-ink-soft);margin:0 0 22px;line-height:1.5}
    .code-boxes{display:flex;gap:8px;justify-content:center;margin-bottom:24px}
    .code-box{width:42px;height:50px;border-radius:var(--echo-radius-sm);background:var(--echo-surface-dark);color:var(--echo-cream);display:flex;align-items:center;justify-content:center;font-family:var(--echo-font-mono);font-weight:700;font-size:20px}
    .code-modal-actions{display:flex;gap:8px}
    .code-modal-share{flex:1;background:var(--echo-surface-dark);color:var(--echo-cream)}
    .code-modal-close{flex:1}
  `],
})
export class PaginaEventi implements OnInit, OnDestroy, ViewWillEnter {
  // Elenco completo degli eventi dell'utente (sia come organizzatore che partecipante).
  eventi: EventoCard[] = [];
  // True finché il primo caricamento dal server non è completato.
  caricamento = true;
  /** Suddivisione lato client sugli eventi già caricati — nessuna chiamata API extra. */
  modalitaVista: 'partecipante' | 'creatore' = 'partecipante';
  /** Evento la cui modale "Mostra codice" è aperta, null quando è chiusa. */
  eventoConCodice: EventoCard | null = null;
  codiceCopiate = false;

  /** Ri-renderizzato ogni minuto così i countdown per card (statoCopy) restano live senza
   *  un re-fetch. Incrementato a ogni tick solo per innescare il change detection; il tempo
   *  rimanente effettivo è calcolato da Date.now() dentro statoCopy(). */
  contatore = 0;
  private ticker?: Subscription;

  /** Id degli eventi per cui un popup estensione/permanenza è già aperto o ha avuto risposta
   *  in questa sessione — loadEvents() rifà il fetch ogni 60s, e senza questa guardia lo
   *  stesso prompt riapparirebbe prima che il server rifletta la risposta dell'utente. */
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
    private platform: Platform,
  ) {}

  ngOnInit() {
    this.loadEvents();
    // Tick di 1 minuto: rifà il fetch dal server (le transizioni di stato come sviluppo →
    // album_aperto avvengono lato server via cron) E incrementa `contatore` così i countdown
    // per card (statoCopy) restano live tra un fetch e l'altro. Memorizzato così può essere
    // smontato in ngOnDestroy — lasciarlo attivo farebbe trapelare una subscription (e
    // continuerebbe a innescare change detection) ogni volta che l'utente lascia questa pagina.
    this.ticker = interval(TICKER_MS).subscribe(() => { this.contatore++; this.loadEvents(); });
  }
  ngOnDestroy() { this.ticker?.unsubscribe(); }
  ionViewWillEnter() { this.loadEvents(); }

  /** Handler del pull-to-refresh — rifà il fetch e segnala al refresher di fermare lo spinner. */
  async handleRefresh(event: RefresherCustomEvent) {
    await this.loadEvents();
    event.target.complete();
  }

  async loadEvents() {
    try {
      const res = await firstValueFrom(this.api.getMieiEventi());
      this.eventi = res.events;
      this.checkExtensionPrompts();
    } catch { this.toast('Impossibile caricare gli eventi', 'danger'); }
    finally { this.caricamento = false; }
  }

  /** Scansiona gli eventi appena caricati per un prompt in sospeso "vuoi estendere?" (organizzatore)
   *  o "desideri rimanere?" (partecipante) e apre un alert per il primo trovato. Uno alla volta per
   *  scelta — sono rari (al massimo uno per evento) e impilare più dialog di conferma confonderebbe. */
  private checkExtensionPrompts() {
    const toEstendi = this.eventi.find(e => e.needs_estensione_response && !this.promptedIds.has(e.id_evento));
    if (toEstendi) { this.promptEstensione(toEstendi); return; }
    const toPermanenza = this.eventi.find(e => e.needs_permanenza_response && !this.promptedIds.has(e.id_evento));
    if (toPermanenza) this.promptPermanenza(toPermanenza);
  }

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

  private async rispondiEstensione(event: EventoCard, accetta: boolean) {
    try {
      await firstValueFrom(this.api.estendiEvento(event.id_evento, accetta));
      await this.toast(accetta ? `Evento esteso di ${this.extDurataLabel(event)}` : 'Evento terminerà come previsto', 'success');
      await this.loadEvents();
    } catch { await this.toast('Impossibile registrare la risposta', 'danger'); }
  }

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

  private async rispondiPermanenza(event: EventoCard, rimane: boolean) {
    try {
      await firstValueFrom(this.api.rimaniEvento(event.id_evento, rimane));
      await this.toast(rimane ? "Bene, ci vediamo all'evento!" : 'Sei libero per altri impegni', 'success');
      await this.loadEvents();
    } catch { await this.toast('Impossibile registrare la risposta', 'danger'); }
  }

  onEventTap(event: EventoCard) {
    switch (event.stato) {
      case 'in_corso':
        // La fotocamera è solo nativa (vedi guardCamera) — sul web non c'è nulla a cui
        // navigare, quindi spiega semplicemente invece di rimbalzare con un redirect di guardia.
        if (!this.platform.is('hybrid')) {
          this.toast("Per scattare le foto usa l'app ECHO sul tuo telefono", 'dark');
        } else if (event.scatti_usati < event.scatti_per_utente) {
          this.router.navigate(['/camera', event.id_evento], {
            state: { scatti_usati: event.scatti_usati, scatti_per_utente: event.scatti_per_utente, eventoNome: event.nome }
          });
        } else { this.toast('Hai già esaurito i tuoi scatti', 'warning'); }
        break;
      case 'album_aperto': case 'chiusa':
        this.router.navigate(['/galleria', event.id_evento], { state: { eventoNome: event.nome } });
        break;
      case 'sviluppo': this.toast('Il rullino è in sviluppo — torna tra poco!', 'dark'); break;
      case 'non_iniziata': this.toast("L'evento non è ancora iniziato", 'dark'); break;
    }
  }

  openAnalytics(event: EventoCard, $event: MouseEvent) {
    $event.stopPropagation();
    this.router.navigate(['/eventi', event.id_evento, 'analytics'], { state: { eventoNome: event.nome } });
  }

  async confirmDelete(event: EventoCard, $event: MouseEvent) {
    $event.stopPropagation();
    const alert = await this.alertCtrl.create({
      header: 'Elimina evento',
      message: `Vuoi eliminare "${event.nome}"? L'azione è irreversibile.`,
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        { text: 'Elimina', role: 'destructive', handler: () => this.deleteEvent(event.id_evento) },
      ],
    });
    await alert.present();
  }

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

  makePips(n: number): number[] { return Array.from({ length: n }); }

  statoCopy(e: EventoCard): string {
    const esteso = e.estensione_accettata === 1;
    switch (e.stato) {
      case 'non_iniziata': {
        const r = this.eventStartsIn(e);
        return r ? `Inizia tra ${r}` : "Preparati all'evento! Ricordati di portare con te il telefono.";
      }
      case 'in_corso':     return esteso
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
      case 'chiusa':       return esteso
        ? 'Evento prolungato e concluso! Le foto sono state sviluppate.'
        : 'Le foto sono state sviluppate!';
      default:              return '';
    }
  }

  /** Ritorna l'etichetta della durata di estensione, usando la durata dev-mode per eventi brevi
   *  (durata_minuti ≤ 5 è il proxy per dev_mode poiché il modello EventoCard non espone dev_mode
   *  direttamente — gli eventi dev sono sempre creati con durate di 3 minuti). */
  private extDurataLabel(e: EventoCard): string {
    return e.durata_minuti <= 5 ? '3 minuti' : '2 ore';
  }

  /** Tempo rimanente leggibile da ora a un target epoch-ms ("23h 45m", "45m").
   *  Ritorna '' una volta passato il target, così i chiamanti possono ricadere su testo statico.
   *  Legge Date.now() live; il ticker di 1 minuto (this.contatore) guida la rivalutazione. */
  private remainingFromMs(targetMs: number): string {
    const diffMs = targetMs - Date.now();
    if (!Number.isFinite(diffMs) || diffMs <= 0) return '';
    const totalMin = Math.ceil(diffMs / MS_PER_MINUTO);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  /** Tempo rimanente verso un target ISO assoluto (usato per le fasi sviluppo/album_aperto). */
  formatRemaining(targetIso: string): string {
    return this.remainingFromMs(isoToMs(targetIso));
  }

  /** Tempo prima che un evento 'non_iniziata' inizi (data_inizio). */
  eventStartsIn(e: EventoCard): string {
    return this.remainingFromMs(isoToMs(e.data_inizio));
  }

  /** Tempo prima che un evento 'in_corso' finisca. Usa data_fine_calc quando esteso (estensione_accettata=1),
   *  altrimenti usa data_inizio + durata_minuti (la fine originale configurata). */
  eventEndsIn(e: EventoCard): string {
    const fineMs = e.estensione_accettata === 1
      ? isoToMs(e.data_fine_calc)
      : isoToMs(e.data_inizio) + e.durata_minuti * MS_PER_MINUTO;
    return this.remainingFromMs(fineMs);
  }

  ctaLabel(e: EventoCard): string | null {
    switch (e.stato) {
      // La fotocamera richiede il layer nativo CameraPreview (vedi guardCamera) — la
      // build web non ha un flusso fotocamera funzionante, quindi non mostrare la CTA lì.
      case 'in_corso':     return (this.platform.is('hybrid') && e.scatti_usati < e.scatti_per_utente) ? 'Scatta una foto' : null;
      case 'album_aperto':
      case 'chiusa':        return 'Guarda il rullino';
      default:               return null;
    }
  }

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
      case 'chiusa':       return esteso
        ? 'Esteso e concluso con successo! Guarda il report.'
        : 'È stato un successo! Guarda il report.';
      default:              return '';
    }
  }

  showCode(event: EventoCard, $event: MouseEvent) {
    $event.stopPropagation();
    this.eventoConCodice = event;
    this.codiceCopiate = false;
  }

  async shareCode(event: EventoCard) {
    const text = `Sei invitato a "${event.nome}"! Usa il codice ${event.codice} per partecipare su ECHO.`;
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: 'ECHO', text }); return; } catch { /* fall through */ }
    }
    await Clipboard.write({ string: text });
    this.codiceCopiate = true;
    setTimeout(() => (this.codiceCopiate = false), 2500);
  }

  private async toast(msg: string, color: string = 'dark') {
    const t = await this.toastCtrl.create({ message: msg, duration: 2800, color, position: 'bottom' });
    t.present();
  }
}
