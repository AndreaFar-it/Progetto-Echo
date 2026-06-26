/**
 * ECHO — Componente Creazione Evento (create-event.component.ts)
 *
 * Form di creazione evento estratto dalla vecchia pagina standalone (create-event.page.ts)
 * e incorporato come componente figlio nella pagina unificata "Crea / Partecipa"
 * (event-entry.page.ts) sotto un <ion-segment>.
 *
 * Comportamento invariato rispetto alla pagina originale:
 *   - Form a singolo scroll (spec §3.3.1 — nessun wizard)
 *   - Chiamata ApiService.creaEvento()
 *   - Validazione in-form con messaggi d'errore inline
 *   - Modal di successo con codice generato, copia negli appunti e condivisione
 *
 * Differenza rispetto alla pagina originale: non include <app-echo-header> né
 * <ion-content> — la pagina host li fornisce.
 *
 * Modalità sviluppo rapido (Dev Mode):
 *   Se la durata viene impostata a 0 ore e 3 minuti esatti, viene attivata una
 *   modalità speciale che bypassa i limiti di durata (1h-6h) e comprime l'intero
 *   ciclo di vita dell'evento a 3 minuti per i test end-to-end.
 */

import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ToastController } from '@ionic/angular/standalone';
import { Clipboard } from '@capacitor/clipboard';
import { ApiService } from '../../services/api.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-create-event',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="form-card">
      <h2 class="form-card-title">Crea il tuo evento</h2>

      <!-- ── Sezione 1 — Info Evento ── -->
      <div class="sub-section">
        <h3 class="sub-heading">1. Info Evento</h3>

        <div class="field-group">
          <label class="field-label">Nome:</label>
          <input class="field-input" [(ngModel)]="form.nome"
                 type="text" placeholder="Estate 2026" />
          <span class="field-error" *ngIf="campiToccati && !form.nome">Campo obbligatorio</span>
        </div>

        <div class="field-group">
          <label class="field-label">Luogo:</label>
          <input class="field-input" [(ngModel)]="form.luogo"
                 type="text" placeholder="Palermo, Villa Tasca" />
          <span class="field-error" *ngIf="campiToccati && !form.luogo">Campo obbligatorio</span>
        </div>

        <div class="field-group">
          <label class="field-label">Data &amp; Ora:</label>
          <input class="field-input field-datetime"
                 [(ngModel)]="form.data_inizio"
                 type="datetime-local" />
          <span class="field-error" *ngIf="campiToccati && !form.data_inizio">Campo obbligatorio</span>
        </div>

        <div class="field-group">
          <label class="field-label">
            Durata
            <span class="field-hint">(min: 1h, max: 6h)</span>
            <span class="dev-badge" *ngIf="modalitaSviluppo">⚡ Dev Mode</span>
          </label>
          <div class="duration-row">
            <div class="duration-block">
              <input class="field-input duration-input" [(ngModel)]="form.durata_ore"
                     type="number" min="0" max="6" step="1" placeholder="0"
                     (ngModelChange)="aggiornaDurata()" />
              <span class="duration-unit">ORE</span>
            </div>
            <span class="duration-sep">:</span>
            <div class="duration-block">
              <input class="field-input duration-input" [(ngModel)]="form.durata_min"
                     type="number" min="0" max="59" step="1" placeholder="00"
                     (ngModelChange)="aggiornaDurata()" />
              <span class="duration-unit">MIN</span>
            </div>
          </div>
          <span class="field-error" *ngIf="erroredurata">{{ erroredurata }}</span>
        </div>
      </div>

      <!-- ── Sezione 2 — Parametri Evento ── -->
      <div class="sub-section">
        <h3 class="sub-heading">2. Parametri Evento</h3>

        <div class="field-group">
          <label class="field-label">Numero Partecipanti: <span class="field-hint">(min:1, max:500)</span></label>
          <input class="field-input" [(ngModel)]="form.max_partecipanti"
                 type="number" min="1" max="500" />
        </div>

        <div class="field-group">
          <label class="field-label">Scatti per Partecipante: {{ form.scatti_per_utente }} <span class="field-hint">(min:1, max:5)</span></label>
          <div class="scatti-selector">
            <button
              *ngFor="let n of [1,2,3,4,5]"
              class="scatti-btn"
              [class.active]="n === form.scatti_per_utente"
              (click)="form.scatti_per_utente = n">
              {{ n }}
            </button>
          </div>
        </div>

        <div class="field-group">
          <label class="field-label">Tempo per Votare: {{ form.durata_votazione }}h <span class="field-hint">(min:12h, max:72h)</span></label>
          <input class="field-input" [(ngModel)]="form.durata_votazione"
                 type="number" min="12" max="72" step="12" />
        </div>
      </div>

      <p class="form-error" *ngIf="messaggioErrore">{{ messaggioErrore }}</p>

      <button class="btn-light-pill" (click)="creaEvento()" [disabled]="inCreazione">
        <span *ngIf="!inCreazione">Genera Evento</span>
        <span class="spinner" *ngIf="inCreazione"></span>
      </button>
    </div>

    <!-- ── Modal di Successo ── -->
    <div class="success-overlay" *ngIf="codiceCreatoEvento">
      <div class="success-modal">
        <h2 class="success-title">Evento creato!</h2>
        <p class="success-body">
          Ogni grande momento ha bisogno di voci per risuonare. Condividi il codice e fai iniziare l'eco del tuo evento.
        </p>
        <div class="success-code">{{ codiceCreatoEvento }}</div>
        <div class="success-actions">
          <button class="echo-btn" (click)="router.navigate(['/eventi/miei'])">Torna indietro</button>
          <button class="echo-btn" (click)="condividiInvito()">
            {{ copiato ? '✓ Copiato!' : 'Condividi' }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    /* ── Scheda form scura ── */
    .form-card {
      background: var(--echo-surface-dark);
      border-radius: var(--echo-radius-lg);
      padding: 24px 20px 28px;
      box-shadow: 0 4px 10px rgba(42,26,14,0.25);
    }
    .form-card-title {
      font-family: var(--echo-font-serif);
      font-size: 22px; font-weight: 400; letter-spacing: 0.06em;
      text-transform: uppercase; text-align: center;
      color: var(--echo-cream); margin: 0 0 22px;
    }

    /* ── Sotto-sezioni ── */
    .sub-section {
      background: var(--echo-surface-muted);
      border-radius: var(--echo-radius-md);
      padding: 18px 16px;
      margin-bottom: 18px;
    }
    .sub-heading {
      font-family: var(--echo-font-mono);
      font-size: 12px; font-weight: 700; letter-spacing: 0.12em;
      text-transform: uppercase; color: var(--echo-cream);
      margin: 0 0 16px;
    }

    /* ── Campi form ── */
    .field-group { margin-bottom: 18px; }
    .field-group:last-child { margin-bottom: 0; }
    .field-label {
      display: block; font-size: 10px; letter-spacing: 0.14em;
      text-transform: uppercase; color: var(--echo-cream); margin-bottom: 8px;
      font-family: var(--echo-font-mono);
    }
    .field-hint { text-transform: none; letter-spacing: 0; opacity: 0.75; }
    .field-input {
      width: 100%; background: transparent; border: 1.5px solid var(--echo-cream);
      border-radius: 2px; color: var(--echo-cream); font-size: 15px;
      padding: 11px 14px; outline: none; font-family: var(--echo-font-mono);
      transition: border-color 150ms;
      &::placeholder { color: rgba(245,239,230,0.5); }
      &:focus { border-color: var(--echo-rust); }
    }
    .field-datetime { color-scheme: dark; }
    .field-error { display: block; font-size: 11px; color: #F3DCD2; margin-top: 5px; font-family: var(--echo-font-mono); }

    /* ── Riga durata (Ore : Minuti) ── */
    .duration-row {
      display: flex; align-items: flex-end; gap: 8px; margin-top: 4px;
    }
    .duration-block { display: flex; flex-direction: column; align-items: center; flex: 1; gap: 4px; }
    .duration-input { text-align: center; font-size: 22px; font-weight: 700; padding: 10px 8px; }
    .duration-sep {
      font-family: var(--echo-font-mono); font-size: 22px; font-weight: 700;
      color: var(--echo-cream); padding-bottom: 14px;
    }
    .duration-unit {
      font-family: var(--echo-font-mono); font-size: 9px; letter-spacing: 0.18em;
      text-transform: uppercase; color: rgba(245,239,230,0.6);
    }
    .dev-badge {
      margin-left: 8px; font-size: 10px; letter-spacing: 0.06em;
      color: var(--echo-rust); font-weight: 700; text-transform: none;
    }

    /* ── Selettore scatti ── */
    .scatti-selector { display: flex; gap: 8px; margin-top: 8px; }
    .scatti-btn {
      flex: 1; padding: 10px; border: 1.5px solid var(--echo-cream);
      background: transparent; color: var(--echo-cream); font-size: 15px;
      border-radius: 4px; cursor: pointer; transition: all 150ms;
      font-family: var(--echo-font-mono);
      &.active {
        border-color: var(--echo-rust); background: var(--echo-rust); color: var(--echo-cream);
      }
    }

    .form-error {
      font-family: var(--echo-font-mono); font-size: 12px; line-height: 1.4;
      color: #F3DCD2; background: rgba(184,92,56,0.18);
      border-left: 2px solid var(--echo-rust); border-radius: 0 2px 2px 0;
      padding: 8px 12px; margin: 0 0 14px;
    }

    /* ── Bottone Genera Evento ── */
    .btn-light-pill {
      display: flex; width: 100%; align-items: center; justify-content: center; gap: 8px;
      margin-top: 6px;
      background: var(--echo-cream); color: var(--echo-ink); border: none;
      font-family: var(--echo-font-mono); font-weight: 700; font-size: 12px;
      letter-spacing: 0.14em; text-transform: uppercase;
      padding: 13px 28px; border-radius: var(--echo-radius-pill);
      cursor: pointer; transition: transform 150ms;
      &:active { transform: translateY(2px); }
      &[disabled] { opacity: 0.6; cursor: not-allowed; }
    }

    .spinner {
      width: 14px; height: 14px;
      border: 1.5px solid rgba(42,26,14,0.3); border-top-color: var(--echo-ink);
      border-radius: 50%; animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Modal di successo ── */
    .success-overlay {
      position: fixed; inset: 0; z-index: 200;
      background: rgba(42,26,14,0.6);
      display: flex; align-items: center; justify-content: center; padding: 24px;
    }
    .success-modal {
      background: var(--echo-bg); border-radius: var(--echo-radius-lg);
      padding: 30px 24px; max-width: 360px; width: 100%; text-align: center;
    }
    .success-title {
      font-family: var(--echo-font-serif);
      font-size: 22px; font-weight: 400; color: var(--echo-ink); margin: 0 0 12px;
    }
    .success-body {
      font-size: 13px; color: var(--echo-ink-soft); line-height: 1.6;
      font-family: var(--echo-font-mono); margin: 0 0 20px;
    }
    .success-code {
      font-family: var(--echo-font-mono); font-size: 32px; font-weight: 700;
      letter-spacing: 0.4em; color: var(--echo-rust);
      background: rgba(184,92,56,0.08);
      border: 1px solid rgba(184,92,56,0.3); border-radius: 4px;
      padding: 12px 16px; margin-bottom: 22px;
      text-indent: 0.4em;
    }
    .success-actions { display: flex; gap: 10px; justify-content: center; }
    .success-actions .echo-btn { flex: 1; padding: 12px 16px; }
  `],
})
export class CreateEventComponent {
  /** True dopo il primo tentativo di submit — attiva la visualizzazione degli errori inline. */
  campiToccati = false;

  /** True mentre la richiesta di creazione è in corso (disabilita il bottone). */
  inCreazione = false;

  /** True per 2.5 secondi dopo aver copiato il testo di invito negli appunti. */
  copiato = false;

  /** Codice a 5 cifre dell'evento appena creato; vuoto finché la creazione non va a buon fine. */
  codiceCreatoEvento = '';

  /** Messaggio di errore globale del form (visualizzato sopra il bottone di submit). */
  messaggioErrore = '';

  /** Messaggio di errore specifico per il campo durata. */
  erroredurata = '';

  /** True se la durata è impostata a 0h 3min — attiva il ciclo di vita rapido (3 min totali). */
  modalitaSviluppo = false;

  /** Dati del form legati ai campi input tramite ngModel. */
  form = {
    nome: '',
    luogo: '',
    data_inizio: '',
    durata_ore: 2,
    durata_min: 0,
    max_partecipanti: 50,
    scatti_per_utente: 3,
    durata_votazione: 24,
  };

  /**
   * Richiamata ad ogni modifica di durata_ore o durata_min.
   * Rileva la modalità sviluppo (0h 3min) e valida i limiti (1h-6h).
   */
  aggiornaDurata(): void {
    const ore = Math.floor(this.form.durata_ore ?? 0);
    const min = Math.floor(this.form.durata_min ?? 0);

    // La combinazione esatta 0h 3min attiva la modalità sviluppo rapido
    this.modalitaSviluppo = ore === 0 && min === 3;
    this.erroredurata = '';

    if (!this.modalitaSviluppo) {
      const totaleMinuti = ore * 60 + min;
      if (!Number.isInteger(ore) || !Number.isInteger(min) || ore < 0 || min < 0 || min > 59) {
        this.erroredurata = 'Inserisci valori interi validi (ore 0-6, minuti 0-59).';
      } else if (totaleMinuti < 60) {
        this.erroredurata = 'La durata minima è 1 ora (60 minuti).';
      } else if (totaleMinuti > 360) {
        this.erroredurata = 'La durata massima è 6 ore (360 minuti).';
      }
    }
  }

  /** Calcola la durata totale in minuti sommando ore e minuti del form. */
  private get durataTotaleMinuti(): number {
    const ore = Math.floor(this.form.durata_ore ?? 0);
    const min = Math.floor(this.form.durata_min ?? 0);
    return ore * 60 + min;
  }

  /** Testo dell'invito da condividere o copiare negli appunti. */
  get testoInvito(): string {
    return `Sei invitato a ${this.form.nome}! Usa il codice ${this.codiceCreatoEvento} per partecipare su ECHO.`;
  }

  constructor(
    public router: Router,
    private api: ApiService,
    private toastCtrl: ToastController,
  ) {}

  /**
   * Valida il form e invia la richiesta di creazione evento al backend.
   * Mostra il modal di successo con il codice generato se la creazione va a buon fine.
   */
  async creaEvento() {
    this.campiToccati = true;
    this.messaggioErrore = '';

    // Validazione campi obbligatori
    if (!this.form.nome || !this.form.luogo || !this.form.data_inizio) return;

    // Validazione durata (la modalità sviluppo bypassa i limiti 1h-6h)
    const totaleMinuti = this.durataTotaleMinuti;
    if (!this.modalitaSviluppo) {
      if (this.erroredurata) { this.messaggioErrore = this.erroredurata; return; }
      if (totaleMinuti < 60 || totaleMinuti > 360) {
        this.messaggioErrore = 'La durata deve essere tra 1h e 6h.';
        return;
      }
    }

    // Validazione parametri con controllo di intervallo
    const nelRange = (v: number, min: number, max: number) => Number.isFinite(v) && v >= min && v <= max;
    if (!nelRange(this.form.max_partecipanti, 1, 500))  { this.messaggioErrore = 'I partecipanti devono essere tra 1 e 500.'; return; }
    if (!nelRange(this.form.scatti_per_utente, 1, 5))   { this.messaggioErrore = 'Gli scatti devono essere tra 1 e 5.'; return; }
    if (!nelRange(this.form.durata_votazione, 12, 72))  { this.messaggioErrore = 'La finestra di votazione deve essere tra 12h e 72h.'; return; }

    this.inCreazione = true;
    try {
      const risposta = await firstValueFrom(
        this.api.creaEvento({
          nome: this.form.nome,
          luogo: this.form.luogo,
          data_inizio: this.form.data_inizio,
          durata_minuti: totaleMinuti,
          max_partecipanti: this.form.max_partecipanti,
          scatti_per_utente: this.form.scatti_per_utente,
          durata_votazione: this.form.durata_votazione,
          dev_mode: this.modalitaSviluppo,
        })
      );
      // Mostra il modal con il codice generato
      this.codiceCreatoEvento = risposta.codice;
    } catch (errore: unknown) {
      const messaggio = (errore as { error?: { error?: string } })?.error?.error ?? 'Errore nella creazione';
      const toast = await this.toastCtrl.create({ message: messaggio, duration: 3000, color: 'danger', position: 'bottom' });
      toast.present();
    } finally {
      this.inCreazione = false;
    }
  }

  /**
   * Condivide il testo di invito tramite la Web Share API (se disponibile),
   * altrimenti copia il testo negli appunti tramite Capacitor Clipboard.
   */
  async condividiInvito() {
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: 'ECHO', text: this.testoInvito });
        return;
      } catch {
        // L'utente ha annullato o la condivisione è fallita — fallback agli appunti
      }
    }
    await Clipboard.write({ string: this.testoInvito });
    this.copiato = true;
    setTimeout(() => (this.copiato = false), 2500);
  }
}
