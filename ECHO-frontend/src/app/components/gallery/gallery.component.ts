/**
 * ECHO — Componente Galleria (Analog Dark)
 *
 * Galleria collettiva, accessibile solo dopo le 24h di sviluppo (spec §3.4.1).
 *
 * REGOLE UX CRITICHE (spec §3.4.2):
 *   - Griglia di tutte le foto dell'evento, ordinate per timestamp
 *   - Tap → modale di dettaglio a schermo intero: foto + nome/avatar dell'autore
 *   - Pulsante voto: anello dorato, DISABILITATO IMMEDIATAMENTE al click (prima della risposta server)
 *     per imporre il peso psicologico del meccanismo di scarsità "1 voto per evento".
 *   - Una volta che ha_votato = true in questa sessione, il pulsante è bloccato in modo permanente —
 *     anche in caso di errore — per prevenire race condition da doppio tap.
 *   - I punteggi sono nascosti finché ha_votato = false (previene il voto strategico).
 */

import { Component, OnInit, OnDestroy, Input, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent, IonRefresher, IonRefresherContent, ToastController } from '@ionic/angular/standalone';
import type { RefresherCustomEvent } from '@ionic/angular/standalone';
import { Platform } from '@ionic/angular/common';
import { ApiService } from '../../services/api.service';
import { environment } from '../../../environments/environment';
import { firstValueFrom, Subscription, interval } from 'rxjs';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { FilmBorderComponent, ComponenteMedaglia, MedalTipo } from '../../shared/components';

/** Filesystem.writeFile() wants raw base64 — strip FileReader's "data:<mime>;base64," prefix. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

interface FotoGalleria {
  id_foto: string;
  url_originale: string;
  punteggio_voti: number;
  timestamp_scatto: string;
  id_autore: string;
  nome: string;
  cognome: string;
  foto_profilo_url: string | null;
  is_own_photo: boolean;
  user_has_voted_this: boolean;
}

interface PodiumEntry {
  posizione: 1 | 2 | 3; nome: string; cognome: string;
  foto_profilo_url: string | null; id_foto: string; url_originale: string;
  punteggio_voti: number; badge: 'oro' | 'argento' | 'bronzo';
}

@Component({
  selector: 'app-gallery',
  standalone: true,
  imports: [CommonModule, IonContent, IonRefresher, IonRefresherContent, FilmBorderComponent, ComponenteMedaglia],
  template: `

    <!-- ── Loading ──────────────────────────────────────────────────── -->
    <div class="gallery-loading" *ngIf="caricamento">
      <div class="film-loader" aria-hidden="true"></div>
      <p class="loading-label">Sviluppo in corso…</p>
    </div>

    <!-- ── Error / not yet available ────────────────────────────────── -->
    <div class="gallery-error" *ngIf="!caricamento && errorMessage">
      <div class="error-symbol">⏳</div>
      <p class="error-title">Galleria non disponibile</p>
      <p class="error-body">{{ errorMessage }}</p>
    </div>

    <!-- ── Main gallery ─────────────────────────────────────────────── -->
    <ion-content *ngIf="!caricamento && !errorMessage" class="gallery-content">
      <ion-refresher slot="fixed" (ionRefresh)="handleRefresh($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <!-- Plain event-title header (no ECHO branding here — see mockups) -->
      <header class="gallery-title-block">
        <h1 class="event-title">{{ eventoNome }}</h1>
        <div class="status-pill" *ngIf="stato === 'chiusa'; else votingPill">
          Le votazioni sono chiuse! Guarda i risultati
        </div>
        <ng-template #votingPill>
          <div class="status-pill" *ngIf="votingTimeLabel">Le votazioni chiuderanno tra: {{ votingTimeLabel }}</div>
        </ng-template>
      </header>

      <div class="tab-switcher">
        <button class="tab-pill" [class.active]="activeTab==='rullino'" (click)="activeTab='rullino'">Rullino</button>
        <button class="tab-pill" [class.active]="activeTab==='classifica'" (click)="activeTab='classifica'">Classifica</button>
      </div>

      <div class="tab-panel" *ngIf="activeTab==='rullino'">
  <div class="download-row" *ngIf="foto.length">
    <button class="download-btn" [disabled]="downloadingZip" (click)="downloadAlbum()">
      <span *ngIf="!downloadingZip">⬇ Scarica Album</span>
      <span *ngIf="downloadingZip">Preparazione… {{ downloadProgress }}/{{ foto.length }}</span>
    </button>
  </div>

  <div class="ranking-pending" *ngIf="foto.length === 0">
    <svg class="pending-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; margin: 0 auto 12px; display: block; opacity: 0.5;">
      <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
    </svg>
    <p class="pending-title">Rullino vuoto</p>
    <p class="pending-body">Non sono ancora presenti foto <br> per questo evento.</p>
  </div>

        <!-- Banner di stato voto — significativo solo mentre la votazione è ancora aperta -->
        <div class="vote-banner vote-banner--pending" *ngIf="!ha_votato && stato !== 'chiusa'">
          <span class="banner-icon">◈</span>
          <span class="banner-text">Hai 1 voto — scegli con cura</span>
        </div>
        <div class="vote-banner vote-banner--cast" *ngIf="ha_votato && stato !== 'chiusa'">
          <span class="banner-icon">♥</span>
          <span class="banner-text">Voto espresso · Risultati alla chiusura</span>
        </div>

        <!-- Griglia foto — stile masonry a 3 colonne -->
        <div class="photo-grid">
          <div class="photo-cell" *ngFor="let photo of foto" (click)="openDetail(photo)">
            <app-film-border>
              <img [src]="photoUrl(photo.url_originale)" [alt]="'Foto di ' + photo.nome" class="photo-thumb" loading="lazy" />
            </app-film-border>
            <!-- Overlay "votato" — mostrato solo dopo che l'utente ha espresso il voto -->
            <div class="vote-score" *ngIf="ha_votato">
              <span class="score-heart">♥</span>
              <span class="score-num">{{ photo.punteggio_voti }}</span>
            </div>
            <!-- Marcatore foto propria -->
            <div class="own-marker" *ngIf="photo.is_own_photo">tu</div>
          </div>
        </div>
      </div>

      <!-- ── Classifica Finale — visibile a ogni partecipante una volta chiuso l'evento ── -->
      <div class="tab-panel" *ngIf="activeTab==='classifica'">
        <section class="podium-section" *ngIf="stato === 'chiusa' && ranking.length; else noRanking">
          <div class="rank-list">
            <div class="rank-row" *ngFor="let e of ranking" (click)="openPodiumPhoto(e)">
              <app-film-border class="rank-photo-wrap">
                <img class="rank-photo" [src]="photoUrl(e.url_originale)" [alt]="'Foto di ' + e.nome" loading="lazy" />
              </app-film-border>
              <div class="rank-info">
                <span class="rank-name">Scatto di: {{ e.nome }} {{ e.cognome }}</span>
                <span class="rank-votes">Numero di voti: {{ e.punteggio_voti }}</span>
                <span class="rank-prize">Premio {{ eventoNome }} - {{ prizeLabel(e.badge) }}</span>
              </div>
              <app-medal-badge class="rank-medal" [tipo]="e.badge"></app-medal-badge>
            </div>
          </div>
        </section>
        <ng-template #noRanking>
          <div class="ranking-pending">
            <svg class="pending-clock" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" stroke-width="3"/>
              <line x1="32" y1="32" x2="32" y2="16" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
              <line x1="32" y1="32" x2="44" y2="38" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
              <line x1="32" y1="6"  x2="32" y2="10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
              <line x1="32" y1="54" x2="32" y2="58" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
              <line x1="6"  y1="32" x2="10" y2="32" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
              <line x1="54" y1="32" x2="58" y2="32" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
            </svg>
            <p class="pending-title">L'attesa aumenta il desiderio!</p>
            <p class="pending-body">Aspetta la fine delle votazioni<br>e torna per scoprire se hai vinto!</p>
          </div>
        </ng-template>
      </div>

      <!-- ── Barra inferiore: indietro · etichetta voto ── -->
      <div class="gallery-bottom-bar">
  <button class="bottom-back" (click)="goBack()" aria-label="Indietro">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px;">
      <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
    </svg>
  </button>
  <span class="bottom-label">{{ bottomLabel() }}</span>
</div>

    </ion-content>

    <!-- ════════════════════════════════════════════════════════════════ -->
    <!-- DETAIL MODAL                                                    -->
    <!-- Full-screen overlay (no ion-modal to avoid fixed positioning)  -->
    <!-- ════════════════════════════════════════════════════════════════ -->
    <div class="detail-overlay" *ngIf="selectedPhoto" (click)="closeOnBackdrop($event)">
      <div class="detail-panel" #detailPanel>

        <!-- Header: close -->
        <div class="detail-header">
          <span class="detail-author-label" *ngIf="selectedPhoto">Scatto di: {{ selectedPhoto.nome | uppercase }}</span>
          <button class="detail-close" (click)="closeDetail()" aria-label="Chiudi">✕</button>
        </div>

        <!-- Foto intera — avvolta nella cornice a perforazioni, pulsante voto in basso a destra.
             Cerchio bianco semplice in stile otturatore (nessun cuore), secondo il mockup: vuoto
             quando votabile, piccolo glifo fotocamera una volta votato. -->
        <div class="detail-photo-wrap">
          <app-film-border [rounded]="false">
            <img
              [src]="photoUrl(selectedPhoto.url_originale)"
              [alt]="'Foto di ' + selectedPhoto.nome"
              class="detail-photo"
            />
          </app-film-border>

          <button
            class="detail-vote-fab"
            *ngIf="!selectedPhoto.is_own_photo && !ha_votato"
            [disabled]="isVoting"
            (click)="castVote(selectedPhoto)"
            aria-label="Vota questa foto"
          >
            <span class="vote-spinner" *ngIf="isVoting"></span>
          </button>
          <div class="detail-vote-fab detail-vote-fab--done" *ngIf="selectedPhoto.user_has_voted_this">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </div>
        </div>

        <!-- Riga autore: avatar + nome -->
        <div class="detail-author">
          <div class="author-avatar">
            <img
              [src]="selectedPhoto.foto_profilo_url ? photoUrl(selectedPhoto.foto_profilo_url) : 'assets/default-avatar.svg'"
              [alt]="selectedPhoto.nome"
            />
          </div>
          <div class="author-info">
            <span class="author-name">{{ selectedPhoto.nome }} {{ selectedPhoto.cognome }}</span>
            <span class="author-ts">{{ selectedPhoto.timestamp_scatto | date:'d MMM · HH:mm' }}</span>
          </div>
          <!-- Punteggio mostrato solo dopo il voto -->
          <div class="detail-score" *ngIf="ha_votato">
            <span class="score-heart">♥</span> {{ selectedPhoto.punteggio_voti }}
          </div>
        </div>

        <!-- ───────────────────────────────────────────────────────── -->
        <!-- TESTO DI STATO VOTO                                       -->
        <!--                                                           -->
        <!-- CRITICO (spec §3.4.2): castVote() disabilita il voto      -->
        <!-- IMMEDIATAMENTE al click. this.ha_votato è messo a true    -->
        <!-- PRIMA che parta la chiamata API — il meccanismo di        -->
        <!-- scarsità va sentito nella UI nell'istante in cui l'utente -->
        <!-- si impegna. Nessun annullamento.                          -->
        <!-- ───────────────────────────────────────────────────────── -->
        <div class="detail-vote">
          <p class="vote-own-msg" *ngIf="selectedPhoto.is_own_photo">Questa è una tua foto — non puoi votarla</p>
          <p class="vote-hint" *ngIf="!selectedPhoto.is_own_photo && !ha_votato">Hai 1 solo voto — non si può cambiare.</p>
          <p class="vote-hint" *ngIf="ha_votato && !selectedPhoto.user_has_voted_this">Voto già espresso su un'altra foto.</p>
        </div>

      </div>
    </div>

  `,
  styles: [`
    :host {
          display: block;
          position: relative;
          height: 100%;
          width: 100%;
          max-width: 600px;
          margin: 0 auto;
        }
    /* Desktop: allarga la galleria a una colonna centrata e immersiva (host + barra inferiore
       si allargano insieme così la barra sticky resta allineata), in linea con landing/dashboard. */
    @media (min-width:768px){
      :host { max-width: 1180px; }
    }

    /* ── Loading ── */
    .gallery-loading {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; height: 60vh; gap: 24px;
    }

    /* Fix 5: animazione di scorrimento della pellicola (due file di perforazioni che vanno a sinistra) */
    .film-loader {
      width: 200px; height: 48px;
      overflow: hidden;
      background: #1a0e00;
      border-radius: 3px;
      position: relative;
    }
    .film-loader::before,
    .film-loader::after {
      content: '';
      position: absolute;
      left: 0; width: 400px; height: 12px;
      background: repeating-linear-gradient(
        90deg,
        transparent 0 4px,
        #3d2b10 4px 14px,
        transparent 14px 18px
      );
      animation: filmRoll 1.4s linear infinite;
    }
    .film-loader::before { top: 5px; }
    .film-loader::after  { bottom: 5px; }
    @keyframes filmRoll {
      from { transform: translateX(0); }
      to   { transform: translateX(-180px); } /* 10 × 18px period — seamless loop */
    }

    .loading-label {
      font-size: 11px; letter-spacing: 0.2em;
      text-transform: uppercase; color: #666655; margin: 0;
    }

    /* ── Error ── */
    .gallery-error {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; height: 60vh; text-align: center; padding: 32px;
    }
    .error-symbol { font-size: 40px; margin-bottom: 16px; color: #666655; }
    .error-title {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 18px; color: #f0ead8; margin: 0 0 8px;
    }
    .error-body { font-size: 13px; color: #666655; line-height: 1.6; margin: 0; }

    /* ── Gallery content ── */
    ion-content.gallery-content { --background: var(--echo-bg); }

    /* ── Title block + status pill ── */
    .gallery-title-block { text-align: center; padding: 20px 20px 12px; }
    .event-title {
      font-family: var(--echo-font-serif); font-weight: 400;
      font-size: 24px; color: var(--echo-ink); margin: 0 0 10px;
    }
    .status-pill {
      display: inline-block; border: 1.5px solid var(--echo-ink); border-radius: var(--echo-radius-pill);
      padding: 8px 18px; font-family: var(--echo-font-mono); font-size: 11px;
      letter-spacing: 0.04em; color: var(--echo-ink); line-height: 1.5;
    }

    /* ── Rullino / Classifica tabs ── */
    .tab-switcher { display: flex; padding: 0 16px 14px; gap: 0; }
    .tab-pill {
      flex: 1; padding: 11px; border: none; cursor: pointer;
      font-family: var(--echo-font-mono); font-weight: 700; font-size: 12px;
      letter-spacing: 0.08em; text-transform: uppercase;
      background: var(--echo-surface-muted); color: var(--echo-cream);
    }
    .tab-pill:first-child { border-radius: var(--echo-radius-md) 0 0 0; }
    .tab-pill:last-child  { border-radius: 0 var(--echo-radius-md) 0 0; }
    .tab-pill.active { background: var(--echo-surface-dark); }

    /* Fix 1: il tab-panel non porta più un proprio sfondo — traspare lo sfondo di ion-content
       (--echo-bg). Questo impedisce al layer scuro della pellicola di sconfinare sull'area
       bianca della barra inferiore sotto la griglia foto. */
    .tab-panel { background: transparent; padding-top: 4px; }

    /* ── Banner voto ── */
    .vote-banner {
      display: flex; align-items: center; gap: 10px;
      padding: 11px 16px; font-family: var(--echo-font-mono); font-size: 12px; letter-spacing: 0.04em;
    }
    .vote-banner--pending { color: var(--echo-cream); }
    .vote-banner--cast    { color: var(--echo-surface-card); }

    /* ── Scarica Album Completo ── */
    .download-row { padding: 8px 16px 18px; }
    /*
     * CTA primaria, Vintage Warm. Prima era testo crema + bordo crema sullo sfondo
     * crema (--echo-bg) della galleria → invisibile. Ora una pillola PIENA marrone scuro
     * con testo crema e l'ombra di pressione 3D caratteristica dell'app (come .lock-cta e
     * le CTA della landing), così si legge come l'azione di download chiara e prominente.
     */
    .download-btn {
      width: 100%;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      padding: 16px 24px;
      background: var(--echo-surface-dark); color: var(--echo-cream); border: none;
      font-family: var(--echo-font-mono); font-size: 13px; font-weight: 700;
      letter-spacing: 0.12em; text-transform: uppercase;
      border-radius: var(--echo-radius-pill); cursor: pointer;
      box-shadow: 0 4px 0 #1E1209;
      transition: transform 150ms, box-shadow 150ms, opacity 150ms;
      &:active { transform: translateY(2px); box-shadow: 0 2px 0 #1E1209; }
      &[disabled] {
        opacity: 0.6; cursor: not-allowed;
        transform: translateY(2px); box-shadow: 0 2px 0 #1E1209;
      }
    }

    /* ── Classifica Finale (podium) ── */
    .podium-section { padding: 16px; }
    .ranking-pending { text-align: center; padding: 48px 24px; }
    .pending-clock {
      width: 80px; height: 80px; color: var(--echo-rust);
      margin-bottom: 20px;
    }
    .pending-title {
      font-family: var(--echo-font-mono); font-weight: 700; font-size: 15px;
      color: var(--echo-cream); margin: 0 0 10px; text-transform: uppercase; letter-spacing: 0.04em;
    }
    .pending-body {
      font-family: var(--echo-font-mono); font-size: 12px; line-height: 1.6;
      color: var(--echo-surface-card); margin: 0;
    }
    .rank-list { display: flex; flex-direction: column; gap: 12px; }
    .rank-row {
      position: relative; display: flex; align-items: center; gap: 12px; padding: 14px;
      background: var(--echo-bg); border-radius: var(--echo-radius-md); cursor: pointer;
    }
    .rank-photo-wrap { width: 52px; height: 52px; flex-shrink: 0; }
    .rank-photo { width: 100%; height: 100%; object-fit: cover; display: block; }
    .rank-info { flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .rank-name { font-family: var(--echo-font-mono); font-weight: 700; font-size: 12px; color: var(--echo-ink); }
    .rank-votes { font-family: var(--echo-font-mono); font-size: 11px; color: var(--echo-ink-soft); }
    .rank-prize { font-family: var(--echo-font-mono); font-size: 11px; color: var(--echo-ink-soft); }
    .rank-medal { position: absolute; top: -10px; right: -8px; }
    .banner-icon { font-size: 14px; }

    /* ── Griglia foto ── */
    .photo-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4px;
      padding: 0 4px 16px;
    }

    .photo-cell {
      position: relative;
      aspect-ratio: 1;
      cursor: pointer;

      &:active .photo-thumb { opacity: 0.75; }
    }

    .photo-thumb {
      width: 100%; height: 100%;
      object-fit: cover; display: block;
      transition: opacity 150ms;
    }

    .vote-score {
      position: absolute; bottom: 4px; right: 12px;
      background: rgba(0,0,0,0.65);
      color: var(--echo-cream);
      font-size: 11px; font-family: var(--echo-font-mono);
      padding: 2px 6px; border-radius: 3px;
      display: flex; align-items: center; gap: 3px;
      z-index: 2;
    }
    .score-heart { font-size: 10px; }

    .own-marker {
      position: absolute; top: 5px; left: 12px;
      font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase;
      color: var(--echo-cream); background: rgba(0,0,0,0.6);
      padding: 2px 6px; border-radius: 2px;
      z-index: 2;
    }

    /* ── Bottom bar ── */
    .gallery-bottom-bar {
  position: sticky; 
  bottom: 0;
  display: flex; 
  align-items: center; 
  justify-content: space-between;
  padding: 14px 20px calc(14px + env(safe-area-inset-bottom, 0px));
  background: var(--echo-bg);
  z-index: 10; 
  /* AGGIUNGI QUESTE RIGHE PER CORREGGERE IL LAYOUT OUTOUT */
  width: 100%;
  max-width: 600px;
  box-sizing: border-box;
}
    /* Mantieni la barra inferiore sticky allineata con l':host allargato su desktop. */
    @media (min-width:768px){ .gallery-bottom-bar{ max-width: 1180px; } }
    .bottom-back {
  width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
  background: transparent; border: 1.5px solid var(--echo-ink); color: var(--echo-ink);
  cursor: pointer; 
  display: flex; align-items: center; justify-content: center;
  padding: 0;
}
    .bottom-label {
      max-width: 110px;
      font-family: var(--echo-font-mono); font-size: 9px; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--echo-ink-soft); text-align: right;
    }

    /* ── Detail overlay ── */
    .detail-overlay {
      position: fixed;
      inset: 0;
      z-index: 100;
      background: rgba(42,26,14,0.85);
      display: flex;
      align-items: flex-end;
      animation: overlayIn 200ms ease-out;
    }
    @keyframes overlayIn { from { opacity: 0; } to { opacity: 1; } }

    .detail-panel {
      width: 100%;
      max-height: 92vh;
      background: var(--echo-bg);
      border-radius: var(--echo-radius-lg) var(--echo-radius-lg) 0 0;
      overflow-y: auto;
      animation: slideUp 250ms ease-out;
    }
    @keyframes slideUp {
      from { transform: translateY(40px); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }

    .detail-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 16px 0;
    }
    .detail-author-label {
      font-family: var(--echo-font-mono); font-weight: 700; font-size: 12px;
      letter-spacing: 0.06em; color: var(--echo-ink);
    }
    .detail-close {
      width: 32px; height: 32px; border-radius: 50%;
      background: transparent; border: 1.5px solid var(--echo-ink);
      color: var(--echo-ink); font-size: 13px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
    }

    .detail-photo-wrap { position: relative; padding: 8px; }
    .detail-photo {
      width: 100%; aspect-ratio: 1;
      object-fit: cover; display: block;
    }
    .detail-vote-fab {
      position: absolute; bottom: 18px; right: 18px;
      width: 44px; height: 44px; border-radius: 50%;
      background: #fff; border: none; color: var(--echo-ink);
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 6px rgba(42,26,14,0.4);
      svg { width: 20px; height: 20px; }
      &[disabled] { opacity: 0.6; cursor: not-allowed; }
    }
    .detail-vote-fab--done { color: var(--echo-rust); cursor: default; }

    /* Author row */
    .detail-author {
      display: flex; align-items: center; gap: 12px;
      padding: 16px;
    }
    .author-avatar {
      width: 36px; height: 36px; border-radius: 50%;
      overflow: hidden; flex-shrink: 0;
      border: 1px solid var(--echo-ink); background: var(--echo-surface-card);
      img { width: 100%; height: 100%; object-fit: cover; }
    }
    .author-info { flex: 1; min-width: 0; }
    .author-name {
      display: block; font-family: var(--echo-font-mono); font-size: 13px; color: var(--echo-ink);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .author-ts { font-size: 11px; color: var(--echo-ink-soft); font-family: var(--echo-font-mono); }
    .detail-score {
      font-size: 14px; color: var(--echo-rust);
      font-family: var(--echo-font-mono);
      display: flex; align-items: center; gap: 4px;
    }

    /* ── Vote status copy ── */
    .detail-vote { padding: 4px 16px 28px; }

    .vote-own-msg {
      text-align: center; font-family: var(--echo-font-mono); font-size: 12px;
      color: var(--echo-ink-soft); letter-spacing: 0.04em;
      padding: 14px; margin: 0;
      border: 1px solid var(--echo-ink); border-radius: var(--echo-radius-md); opacity: 0.85;
    }
    .vote-hint {
      text-align: center; font-family: var(--echo-font-mono); font-size: 11px; color: var(--echo-ink-soft);
      letter-spacing: 0.04em; margin: 0;
    }

    .vote-spinner {
      width: 14px; height: 14px;
      border: 1.5px solid rgba(184,92,56,0.3); border-top-color: var(--echo-rust);
      border-radius: 50%; animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `],
})
export class ComponenteGalleria implements OnInit, OnDestroy {
  @Input() id_evento!: string;
  @Input() eventoNome = '';

  foto: FotoGalleria[] = [];
  ha_votato = false;
  caricamento = true;
  errorMessage = '';
  selectedPhoto: FotoGalleria | null = null;
  isVoting = false;

  /** 'album_aperto' | 'chiusa' — la galleria è raggiungibile solo in uno di questi due stati
   *  (imposto lato backend). Determina se mostrare il banner di voto o la classifica finale. */
  stato = '';
  ranking: PodiumEntry[] = [];

  downloadingZip = false;
  downloadProgress = 0;

  /** album_sbloccato_at + durata_votazione, in epoch ms — il target reale e fisso rispetto al
   *  quale il countdown sotto è calcolato a ogni lettura (nessuna stringa di durata in cache). */
  private voteEndAt: number | null = null;
  private votingTicker?: Subscription;

  /** Solo stato di vista — sia le foto che la classifica arrivano già nella stessa risposta
   *  getGalleria(), quindi cambiare tab non innesca mai una nuova chiamata API. */
  activeTab: 'rullino' | 'classifica' = 'rullino';

  constructor(
    private api: ApiService,
    private toastCtrl: ToastController,
    private cdr: ChangeDetectorRef,
    private platform: Platform,
    private router: Router,
  ) {}

  ngOnInit() {
    this.loadGallery();
    // Ogni minuto: rifà il fetch (nuove foto / voti / transizioni di stato avvengono lato server)
    // e ri-renderizza così il countdown "vota entro" continua a scorrere rispetto a Date.now()
    // tra un fetch e l'altro.
    this.votingTicker = interval(60_000).subscribe(() => { this.cdr.markForCheck(); this.loadGallery(); });
  }

  ngOnDestroy() { this.votingTicker?.unsubscribe(); }

  /** Handler del pull-to-refresh — rifà il fetch e segnala al refresher di fermare lo spinner. */
  async handleRefresh(event: RefresherCustomEvent) {
    await this.loadGallery();
    event.target.complete();
  }

  /** Etichetta live "tempo rimasto per votare" ("23h 45m" / "45m"), ricalcolata rispetto a
   *  Date.now() a ogni lettura. '' una volta chiusa la votazione o se non applicabile. */
  get votingTimeLabel(): string {
    if (!this.voteEndAt) return '';
    const remainingMs = this.voteEndAt - Date.now();
    if (remainingMs <= 0) return '';
    const totalMin = Math.ceil(remainingMs / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  private async loadGallery() {
  try {
    const res = await firstValueFrom(this.api.getGalleria(this.id_evento));
    
    // Fallback ?? [] per sicurezza, nel caso il server restituisca un payload incompleto
    this.foto = res?.foto ?? [];
    this.ha_votato = res?.ha_votato ?? false;
    this.stato = res?.stato ?? '';
    
    // voting_end_at è calcolato lato server...
    this.voteEndAt = res.voting_end_at ? new Date(res.voting_end_at).getTime() : null;
    const BADGES: ('oro' | 'argento' | 'bronzo')[] = ['oro', 'argento', 'bronzo'];
    this.ranking = (res.classifica ?? []).slice(0, 3).map((c, i) => ({
      posizione: (i + 1) as 1 | 2 | 3,
      nome: c.nome, cognome: c.cognome, foto_profilo_url: c.foto_profilo_url,
      id_foto: c.id_foto, url_originale: c.url_originale, punteggio_voti: c.punteggio_voti,
      badge: BADGES[i],
    }));
  } catch (errore: unknown) {
    this.errorMessage = (errore as { error?: { error?: string } })?.error?.error ?? 'Galleria non disponibile.';
  } finally {
    this.caricamento = false;
  }
}

  /** Toccare una riga del podio riusa la modale esistente di dettaglio/voto della singola foto. */
  openPodiumPhoto(entry: PodiumEntry) {
    const photo = this.foto.find(p => p.id_foto === entry.id_foto);
    if (photo) this.openDetail(photo);
  }
  photoUrl(path: string): string {
    return `${environment.apiUrl}${path}`;
  }

  prizeLabel(tipo: MedalTipo): string {
    return ({ oro: 'Oro', argento: 'Argento', bronzo: 'Bronzo' } as Record<MedalTipo, string>)[tipo];
  }

  goBack(): void {
    this.router.navigate(['/eventi/miei']);
  }

  bottomLabel(): string {
    if (this.stato === 'chiusa') return 'Classifica Finale';
    return this.ha_votato ? 'Hai assegnato il tuo unico voto' : 'Assegna il tuo unico voto';
  }

  /** Scarica ogni foto come blob (in parallelo, il CORS lo consente già — vedi l'override
   *  CORP di /uploads in server.ts) e le zippa lato client. Nessun coinvolgimento del backend:
   *  le foto sono già URL pubblici che la galleria stessa usa.
   *
   *  La consegna poi si divide per piattaforma: le WebView native (Android/iOS) non supportano
   *  affatto il trigger HTML5 <a download> / file-saver — non c'è una UI cartella "Download"
   *  in cui possa atterrare — quindi su `capacitor` scriviamo invece lo zip nella cache dir
   *  dell'app via @capacitor/filesystem e lo passiamo al foglio di condivisione dell'OS
   *  (@capacitor/share), lasciando che l'utente lo salvi dove vuole (Drive, File, invio via chat, ecc).
   *  Sul web, il download browser originale via file-saver resta invariato. */
  async downloadAlbum() {
    if (this.downloadingZip || !this.foto.length) return;
    this.downloadingZip = true;
    this.downloadProgress = 0;
    this.cdr.markForCheck();

    const filename = `ECHO-${this.sanitizeFilename(this.eventoNome || 'Album')}.zip`;

    try {
      const zip = new JSZip();
      await Promise.all(this.foto.map(async (photo, i) => {
        const blob = await fetch(this.photoUrl(photo.url_originale)).then(r => r.blob());
        zip.file(`${String(i + 1).padStart(3, '0')}-${photo.nome}-${photo.id_foto}.jpg`, blob);
        this.downloadProgress++;
        this.cdr.markForCheck();
      }));
      const zipped = await zip.generateAsync({ type: 'blob' });

      if (this.platform.is('capacitor')) {
        await this.saveAndShareNative(zipped, filename);
      } else {
        saveAs(zipped, filename);
      }
    } catch {
      this.toast('Errore durante la preparazione dello ZIP. Riprova.', 'danger');
    } finally {
      this.downloadingZip = false;
      this.cdr.markForCheck();
    }
  }

  /** Scrive lo zip in Directory.Cache (base64, come richiesto dall'API writeFile del plugin
   *  Filesystem) e apre il foglio di condivisione nativo sull'URI file:// risultante. Un utente
   *  che chiude il foglio di condivisione non è un errore — catturato separatamente così non
   *  mostra il toast generico "preparazione fallita" per un file salvato con successo. */
  private async saveAndShareNative(zipped: Blob, filename: string): Promise<void> {
    const base64Data = await blobToBase64(zipped);
    const result = await Filesystem.writeFile({ path: filename, data: base64Data, directory: Directory.Cache });
    try {
      await Share.share({ url: result.uri, title: filename, dialogTitle: 'Salva o condividi l\'album' });
    } catch { /* utente ha chiuso il foglio di condivisione — lo zip è comunque salvato in cache, non è un errore */ }
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9 _-]/g, '_').trim() || 'Album';
  }

  openDetail(photo: FotoGalleria) { this.selectedPhoto = photo; }
  closeDetail() { this.selectedPhoto = null; }

  closeOnBackdrop(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('detail-overlay')) {
      this.closeDetail();
    }
  }

  async castVote(photo: FotoGalleria) {
    if (this.ha_votato || photo.is_own_photo || this.isVoting) return;

    // CRITICO: disabilita il pulsante di voto IMMEDIATAMENTE — prima di ogni chiamata di rete.
    // Questo è il cuore della UX di scarsità: l'utente vede la conseguenza nel momento
    // dell'impegno, non 200ms dopo quando il server risponde.
    // Anche se la chiamata API fallisce manteniamo ha_votato = true per prevenire il rage-tapping.
    this.isVoting = true;
    this.ha_votato = true;
    this.cdr.markForCheck();

    try {
      await firstValueFrom(
        this.api.votaFoto(photo.id_foto )
      );
      photo.user_has_voted_this = true;
      photo.punteggio_voti += 1; // optimistic local update
      this.toast('Voto registrato ♥', 'success');
    } catch (errore: unknown) {
      const msg = (errore as { error?: { error?: string } })?.error?.error ?? 'Errore nel voto';
      // ha_votato remains true even on error (ambiguous state = safer than allowing retry)
      this.toast(msg, 'danger');
    } finally {
      this.isVoting = false;
    }
  }

  private async toast(msg: string, color: 'success' | 'danger' = 'success') {
    const t = await this.toastCtrl.create({
      message: msg, duration: 2500, color, position: 'bottom',
    });
    t.present();
  }
}
