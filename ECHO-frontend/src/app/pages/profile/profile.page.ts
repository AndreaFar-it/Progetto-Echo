/**
 * ECHO — Pagina Profilo (profile.page.ts)
 *
 * Mostra il profilo pubblico dell'utente autenticato con:
 *   - Avatar in formato Polaroid con nome e data di iscrizione
 *   - Griglia statistiche (scatti totali, eventi partecipati, voti ricevuti)
 *   - Bacheca trofei con i badge conquistati (oro/argento/bronzo), disposti a "parete"
 *   - Archivio rullini: tutti gli eventi passati, navigabili se hanno una galleria
 *
 * Spec §3.2.4 — Avatar · stats grid · badge trophy wall · event archive
 */

import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonContent, ToastController } from '@ionic/angular/standalone';
import { ViewWillEnter } from '@ionic/angular';
import { ApiService } from '../../services/api.service';
import { environment } from '../../../environments/environment';
import { firstValueFrom } from 'rxjs';
import { ComponenteIntestazione, ComponenteCornicePolaroid, ComponenteMedaglia, ComponenteRullino, MedalTipo } from '../../shared/components';

/** Struttura dati del profilo utente restituita dal backend. */
interface DatiProfilo {
  utente: {
    nome: string;
    cognome: string;
    foto_profilo_url: string | null;
    data_registrazione: string;
    scatti_totali: number;
    voti_ricevuti: number;
  };
  eventi_count: number;
  badge: { id_badge: string; tipo: string; etichetta: string; data_emissione: string }[];
  archivio: { id_evento: string; nome: string; data_inizio: string; stato: string }[];
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, IonContent, ComponenteIntestazione, ComponenteCornicePolaroid, ComponenteMedaglia, ComponenteRullino],
  template: `
    <app-echo-header [showTagline]="false">
      <button class="toolbar-gear" (click)="router.navigate(['/impostazioni'])" aria-label="Impostazioni">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>
    </app-echo-header>

    <ion-content>
      <div class="profile-shell" *ngIf="profilo">

        <!-- ── Scheda Profilo ── -->
        <div class="profile-card">
          <app-polaroid-frame class="profile-avatar">
            <img [src]="profilo.utente.foto_profilo_url ? urlFoto(profilo.utente.foto_profilo_url) : 'assets/default-avatar.svg'"
                 [alt]="profilo.utente.nome" />
          </app-polaroid-frame>
          <div class="profile-card-info">
            <h1 class="profile-name">{{ profilo.utente.nome | uppercase }} {{ profilo.utente.cognome | uppercase }}</h1>
            <p class="profile-since">
              Data iscrizione:<br>{{ profilo.utente.data_registrazione | date:'d MMMM yyyy' }}
            </p>
          </div>
        </div>

        <!-- ── Griglia Statistiche ── -->
        <div class="stats-grid">
          <div class="stat-cell">
            <div class="stat-value">{{ profilo.utente.scatti_totali }}</div>
            <div class="stat-label">Scatti</div>
          </div>
          <div class="stat-cell stat-cell--middle">
            <div class="stat-value">{{ profilo.eventi_count }}</div>
            <div class="stat-label">Eventi</div>
          </div>
          <div class="stat-cell">
            <div class="stat-value">{{ profilo.utente.voti_ricevuti }}</div>
            <div class="stat-label">Voti ricevuti</div>
          </div>
        </div>

        <!-- ── Bacheca Trofei ── -->
        <div class="section-header">
          <span class="section-label">Bacheca Trofei</span>
        </div>
        <div class="trophy-wall" *ngIf="profilo.badge.length; else bagheccaVuota">
          <app-medal-badge
            *ngFor="let badge of profilo.badge; let i = index"
            [tipo]="tipoMedaglia(badge.tipo)"
            [rotationDeg]="rotatazioneMedaglia(i)"
            [style.left.%]="posizioneSinistra(i)"
            [style.top.px]="posizioneAlto(i)"
            class="trophy-medal"
          ></app-medal-badge>
        </div>
        <ng-template #bagheccaVuota>
          <div class="badge-empty">
            <p class="badge-empty-text">Partecipa a un evento e scala la classifica per ottenere il tuo primo badge.</p>
          </div>
        </ng-template>

        <!-- ── Archivio Rullini ── -->
        <div class="section-header" *ngIf="profilo.archivio.length">
          <span class="section-label">Archivio Rullini</span>
        </div>

        <div class="archive-strip" *ngIf="profilo.archivio.length">
          <app-film-canister
            *ngFor="let evento of profilo.archivio"
            [label]="evento.nome"
            (click)="apriArchiviato(evento)"
            [class.tappable]="['album_aperto','chiusa'].includes(evento.stato)"
          ></app-film-canister>
        </div>

      </div>

      <!-- Scheletro di caricamento -->
      <div class="profile-loading" *ngIf="!profilo">
        <div class="skeleton skeleton--avatar"></div>
        <div class="skeleton skeleton--name"></div>
        <div class="skeleton skeleton--stats"></div>
      </div>
    </ion-content>
  `,
  styles: [`
    ion-content { --background: var(--echo-bg); }

    .toolbar-gear {
      display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px;
      color: var(--echo-cream); background: transparent; border: none; cursor: pointer;
      padding: 0; opacity: 0.85;
      -webkit-tap-highlight-color: transparent;
      svg { width: 22px; height: 22px; }
    }

    .profile-shell { padding: 16px 16px 110px; }

    /* ── Scheda profilo ── */
    .profile-card {
      position: relative;
      display: flex; align-items: center; gap: 16px;
      background: var(--echo-surface-dark);
      border-radius: var(--echo-radius-lg);
      padding: 18px;
      margin-bottom: 20px;
    }
    .profile-avatar { width: 70px; flex-shrink: 0; }
    /* Solo la larghezza è impostata qui — il componente Polaroid deriva l'altezza tramite
       aspect-ratio:1/1, così qualsiasi foto caricata (verticale/orizzontale) viene ritagliata
       a 70×70 pixel fissi e l'altezza della scheda non cambia mai. */
    ::ng-deep .profile-avatar .photo { width: 70px; }
    .profile-card-info { flex: 1; min-width: 0; }
    .profile-name {
      font-family: var(--echo-font-mono); font-weight: 700;
      font-size: 14px; letter-spacing: 0.02em;
      color: var(--echo-cream); margin: 0 0 6px;
    }
    .profile-since {
      font-family: var(--echo-font-mono); font-size: 10px; line-height: 1.5;
      color: var(--echo-surface-card); margin: 0;
    }

    /* ── Statistiche ── */
    .stats-grid {
      display: grid; grid-template-columns: repeat(3, 1fr);
      border: 1px solid var(--echo-ink); border-radius: var(--echo-radius-md);
      margin-bottom: 20px;
    }
    .stat-cell {
      padding: 16px 8px; text-align: center;
      border-right: 1px solid var(--echo-ink);
      &:last-child { border-right: none; }
    }
    .stat-value {
      font-family: var(--echo-font-display);
      font-size: 24px; color: var(--echo-ink); line-height: 1;
      margin-bottom: 6px;
    }
    .stat-label {
      font-family: var(--echo-font-mono);
      font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--echo-ink-soft);
    }

    /* ── Intestazioni sezione ── */
    .section-header { padding: 4px 4px 10px; }
    .section-label {
      font-family: var(--echo-font-mono);
      font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--echo-ink-soft);
    }

    /* ── Bacheca trofei ── */
    .trophy-wall {
      position: relative; height: 160px;
      background: var(--echo-surface-muted);
      border: 1px solid var(--echo-ink);
      border-radius: var(--echo-radius-md);
      margin-bottom: 20px;
    }
    .trophy-medal { position: absolute; }

    .badge-empty {
      padding: 16px; margin-bottom: 20px;
      border: 1px solid var(--echo-ink); border-radius: var(--echo-radius-md);
    }
    .badge-empty-text {
      font-family: var(--echo-font-mono);
      font-size: 13px; color: var(--echo-ink-soft); line-height: 1.6; margin: 0; text-align: center;
    }

    /* ── Striscia archivio rullini ── */
    .archive-strip {
      display: flex; gap: 0; overflow-x: auto;
      padding: 4px 4px 16px;
      app-film-canister { margin-right: -6px; }
      app-film-canister.tappable { cursor: pointer; }
    }

    /* ── Scheletro di caricamento (shimmer) ── */
    .profile-loading { padding: 36px 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
    .skeleton { background: var(--echo-surface-muted); border-radius: 4px; animation: shimmer 1.5s ease-in-out infinite; }
    @keyframes shimmer {
      0%, 100% { opacity: 0.5; }
      50% { opacity: 1; }
    }
    .skeleton--avatar { width: 80px; height: 80px; border-radius: 50%; }
    .skeleton--name   { width: 160px; height: 20px; }
    .skeleton--stats  { width: 100%; height: 80px; border-radius: 6px; }
  `],
})
export class PaginaProfilo implements OnInit, ViewWillEnter {
  /** Dati profilo caricati dal backend; null durante il caricamento iniziale. */
  profilo: DatiProfilo | null = null;

  constructor(
    private api: ApiService,
    public router: Router,
    private toastCtrl: ToastController,
  ) {}

  ngOnInit() { this.caricaProfilo(); }
  ionViewWillEnter() { this.profilo = null; this.caricaProfilo(); }

  /** Recupera il profilo dal backend e aggiorna la vista. Mostra un toast in caso di errore. */
  private async caricaProfilo() {
    try {
      this.profilo = await firstValueFrom(this.api.getProfilo()) as any;
    } catch (errore: unknown) {
      const messaggio = (errore as { error?: { error?: string } })?.error?.error ?? 'Errore caricamento profilo';
      const toast = await this.toastCtrl.create({ message: messaggio, duration: 2000, color: 'danger' });
      toast.present();
    }
  }

  /** Naviga alla galleria dell'evento archiviato (solo se in stato album_aperto o chiusa). */
  apriArchiviato(evento: { id_evento: string; nome: string; stato: string }) {
    if (['album_aperto', 'chiusa'].includes(evento.stato)) {
      this.router.navigate(['/galleria', evento.id_evento], { state: { eventoNome: evento.nome } });
    }
  }

  /**
   * Costruisce l'URL completo della foto profilo.
   * foto_profilo_url è un percorso relativo al backend ("/uploads/profili/...") e deve
   * essere risolto rispetto all'origine API (diversa da quella del frontend su web
   * e specialmente sull'emulatore Android, che usa 10.0.2.2:3000 come host).
   */
  urlFoto(percorso: string): string {
    return `${environment.apiUrl}${percorso}`;
  }

  /** Converte il tipo badge dal DB al tipo accettato dal componente MedalBadge.
   *  I valori validi sono 'oro', 'argento', 'bronzo'; qualsiasi altro valore ritorna 'bronzo'. */
  tipoMedaglia(tipo: string): MedalTipo {
    return (tipo === 'oro' || tipo === 'argento' || tipo === 'bronzo') ? tipo : 'bronzo';
  }

  /**
   * Posizioni deterministiche per la "parete dei trofei" (effetto "gettati su una lavagna").
   * Basate sull'indice (non casuali) per essere stabili tra i re-render di Angular.
   */
  posizioneSinistra(i: number): number   { return [8, 32, 18, 58, 74, 46, 64, 12][i % 8]; }
  posizioneAlto(i: number): number       { return [20, 12, 78, 26, 70, 100, 50, 96][i % 8]; }
  rotatazioneMedaglia(i: number): number { return [-12, 8, -6, 14, -18, 5, 11, -9][i % 8]; }
}
