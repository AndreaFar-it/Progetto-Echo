/**
 * ECHO — Componente Fotocamera (Analog Dark)
 *
 * REGOLE UX CRITICHE (spec §3.2.3):
 *   - Mirino in tempo reale tramite il plugin CameraPreview (layer nativo DIETRO la WebView)
 *   - Pulsante di scatto ad anello dorato — l'UNICA azione visibile
 *   - Pallini contatore scatti: dorato pieno = usato, vuoto = rimanente
 *   - NESSUNA anteprima, NESSUNA modifica, NESSUNA eliminazione in alcun momento
 *   - Upload fire-and-forget — lo scatto si riabilita subito dopo il tocco (~300ms)
 *   - La schermata di blocco appare quando esauriti = true, mai recuperabile in questa sessione
 *
 * CATENA DI TRASPARENZA (necessaria perché il layer nativo della fotocamera traspaia):
 *   MainActivity.java  → webView.setBackgroundColor(Color.TRANSPARENT)
 *   camera.page.ts     → <ion-content style="--background:transparent">
 *   camera.component   → ion-content.camera-content { --background: transparent }
 *   camera.component   → this.setTransparentBg() imposta body/html a trasparente
 *
 * CICLO DI VITA:
 *   Questo componente è annidato (<app-camera>) dentro PaginaFotocamera, non instradato
 *   direttamente, quindi i CustomEvent ionViewWillEnter/ionViewWillLeave di Ionic (emessi solo
 *   sull'host del componente instradato) non lo raggiungono mai. PaginaFotocamera implementa
 *   quegli hook e pilota i metodi pubblici activate()/deactivate() via @ViewChild.
 *   activate()   → startPreview + setTransparentBg
 *   deactivate() → stopPreview  + restoreBg
 *   ngOnDestroy  → stopPreview  + restoreBg  (rete di sicurezza: back hardware)
 */

import {
  Component, OnInit, OnDestroy, Input, ChangeDetectorRef, ElementRef, NgZone
} from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonContent, ToastController } from '@ionic/angular/standalone';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Subscription, interval, firstValueFrom } from 'rxjs';
import { ServizioFotocamera, ShotState, CameraFacing, FlashMode } from '../../services/camera.service';
import { ApiService } from '../../services/api.service';
import { MS_PER_MINUTO, isoToMs } from '../../core/time.util';

// Cadenza del ticker che tiene vivo il conto alla rovescia di sviluppo.
const DEVELOPMENT_TICKER_MS = 60_000;

@Component({
  selector: 'app-camera',
  standalone: true,
  imports: [CommonModule, IonContent],
  template: `

    <!-- ═══════════════════════════════════════════════════════════════ -->
    <!-- SCHERMATA DI BLOCCO — mostrata una volta che esauriti = true; mai annullata -->
    <!-- ═══════════════════════════════════════════════════════════════ -->
    <div class="lock-screen" *ngIf="shotState?.esauriti; else activeCamera">
      <div class="lock-symbol">🎞</div>
      <h2 class="lock-title">Rullino Esaurito</h2>
      <p class="lock-body">
        Hai usato tutti i {{ shotState?.scatti_totali }} scatti.<br>
        Torna tra <strong>{{ developmentWaitLabel }}</strong> per scoprire la galleria collettiva.
      </p>
      <div class="lock-divider"></div>
      <button class="lock-cta" (click)="router.navigate(['/eventi/miei'])">
        ← Vai ai tuoi eventi
      </button>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════ -->
    <!-- FOTOCAMERA ATTIVA — mirino (trasparente) + HUD + scatto         -->
    <!-- ═══════════════════════════════════════════════════════════════ -->
    <ng-template #activeCamera>
      <!--
        --background: transparent è OBBLIGATORIO qui.
        Il layer nativo CameraPreview viene renderizzato DIETRO la WebView.
        Qualsiasi sfondo pieno su questo ion-content lo bloccherebbe.
      -->
      <ion-content class="camera-content" [fullscreen]="true"
        [scrollY]="false"
        [scrollX]="false">

        <!-- Cornice marrone scuro decorativa + griglia 3x3 — entrambi overlay trasparenti,
             non toccano mai lo sfondo della WebView/body (vedi CATENA DI TRASPARENZA sopra). -->
        <div class="frame-border"></div>
        <div class="grid-overlay">
          <span class="grid-line v" style="left:33.33%"></span>
          <span class="grid-line v" style="left:66.66%"></span>
          <span class="grid-line h" style="top:33.33%"></span>
          <span class="grid-line h" style="top:66.66%"></span>
        </div>

        <!-- ── HUD superiore: icona flash (decorativa) · contatore scatti · etichetta spec fittizia ── -->
        <div class="camera-hud-top">
          <svg class="hud-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M11 21 22 8h-7l1-7L4 14h7z"/></svg>
          <div class="hud-counter" *ngIf="shotState">
            <span class="hud-counter-text">{{ shotState.scatti_usati }}/{{ shotState.scatti_totali }}</span>
          </div>
          <span class="hud-spec">4K-30</span>
        </div>
        <div class="hud-event-name">{{ eventoNome }}</div>

        <!-- ── HUD inferiore: angoli mirino + zoom/controlli decorativi + scatto ── -->
        <div class="camera-hud-bottom">

          <!-- Marcatori d'angolo del mirino (puramente decorativi, estetica analogica) -->
          <div class="vf-corners">
            <span class="vf-corner tl"></span>
            <span class="vf-corner tr"></span>
            <span class="vf-corner bl"></span>
            <span class="vf-corner br"></span>
          </div>

          <!-- Messaggio d'errore inline (si cancella da solo dopo 3s) -->
          <p class="shoot-error" *ngIf="errorMessage">{{ errorMessage }}</p>

          <!--
            Stato "anteprima non pronta". CameraPreview.start() è asincrona (1-3s su
            hardware reale; può essere più lunga su un emulatore) — lo scatto DEVE restare
            disabilitato finché non si risolve, altrimenti capture() lancia
            "Camera is not running". Toccabile per riprovare in caso di errore.
          -->
          <p
            class="preview-status"
            *ngIf="!previewReady"
            [class.failed]="previewFailed"
            (click)="previewFailed && retryPreview()"
          >{{ previewFailed ? 'Fotocamera non disponibile — tocca per riprovare' : 'Avvio fotocamera…' }}</p>

          <!-- Zoom a bottoni — livelli fissi riportati dall'obiettivo attuale (es. 0.5x/1x/2x/3x) -->
          <div class="zoom-row" *ngIf="previewReady && zoomLevels.length > 1">
            <button
              *ngFor="let level of zoomLevels"
              class="zoom-btn"
              type="button"
              [class.active]="level === currentZoom"
              (click)="setZoomLevel(level)"
            >{{ formatZoomLabel(level) }}</button>
          </div>

          <!-- Riga di controlli funzionali: flash (cicla le modalità supportate) + cambio fotocamera -->
          <div class="control-row" *ngIf="previewReady">
            <button
              class="ctrl-btn"
              *ngIf="flashAvailable"
              type="button"
              (click)="toggleFlash()"
              [attr.aria-label]="'Flash: ' + flashMode">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M11 21 22 8h-7l1-7L4 14h7z"/>
                <line *ngIf="flashMode === 'off'" x1="3" y1="3" x2="21" y2="21" stroke="#fff" stroke-width="2"/>
              </svg>
              <span class="ctrl-label">{{ flashLabel }}</span>
            </button>

            <button
              class="ctrl-btn"
              type="button"
              (click)="switchCamera()"
              aria-label="Cambia fotocamera">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                <path d="M20 5h-3l-2-2H9L7 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/>
                <path d="M9 13a3 3 0 0 0 5 2.2M15 12a3 3 0 0 0-5-2.2"/>
                <polyline points="14.5 9 14 11.5 11.5 11"/>
                <polyline points="9.5 16 10 13.5 12.5 14"/>
              </svg>
              <span class="ctrl-label">{{ facing === 'rear' ? 'Retro' : 'Front' }}</span>
            </button>
          </div>

          <!--
            Pulsante di scatto — l'UNICO target di tocco funzionale nella vista fotocamera attiva.
            [class.firing] aggiunge una breve animazione di scala alla pressione.
            disabilitato durante la chiamata ~300ms di CameraPreview.capture() E
            finché l'anteprima non è effettivamente partita (vedi previewReady sopra).
            Si riabilita prima che l'upload sia completato (fire-and-forget).
          -->
          <button
            class="shutter-btn"
            [class.firing]="isShooting"
            [disabled]="isShooting || !previewReady"
            (click)="onShutter()"
            aria-label="Scatta foto"
          >
            <div class="shutter-ring">
              <div class="shutter-disc"></div>
            </div>
          </button>

          <!-- Indicatore di upload: feedback discreto e non bloccante -->
          <div class="upload-indicator" [class.active]="isUploading">
            <span class="upload-dot"></span>
            <span class="upload-label">Caricamento</span>
          </div>

        </div>
      </ion-content>
    </ng-template>
  `,
  styles: [`
    :host {
      display: block; height: 100%;
      /* ── Blocco del tocco sul mirino ──────────────────────────────────────
       * Disattiva ogni comportamento di tocco di default del browser che potrebbe
       * spostare il layer HTML rispetto alla superficie nativa FISSA della fotocamera
       * ed esporre lo sfondo grigio dietro di essa:
       *   - touch-action: none      → disabilita il doppio-tap-per-zoom E il pan/zoom,
       *                               applicato sul thread del compositor (funziona
       *                               anche dove un listener passivo non può fare
       *                               preventDefault)
       *   - user-select / callout   → nessuna selezione di testo o menu da pressione
       *                               prolungata che dirotterebbe il gesto
       *   - overscroll-behavior     → nessuno spostamento da rimbalzo/pull-to-refresh
       *   - tap-highlight           → nessun riquadro lampeggiante al tocco              */
      touch-action: none;
      -webkit-user-select: none; user-select: none;
      -webkit-touch-callout: none;
      overscroll-behavior: none;
      -webkit-tap-highlight-color: transparent;
    }

    /* ── Schermata di blocco — una normale pagina opaca, nessun vincolo di trasparenza ── */
    .lock-screen {
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      min-height: 100vh; background: var(--echo-bg);
      padding: 48px 32px; text-align: center;
      animation: fadeIn 400ms ease-out;
    }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

    .lock-symbol { font-size: 64px; margin-bottom: 24px; }
    .lock-title {
      font-family: var(--echo-font-display);
      font-size: 30px; letter-spacing: 0.02em;
      color: var(--echo-ink); margin: 0 0 16px;
    }
    .lock-body {
      font-family: var(--echo-font-mono);
      font-size: 14px; line-height: 1.7; color: var(--echo-ink-soft);
      max-width: 280px; margin: 0 0 32px;
      strong { color: var(--echo-ink); font-weight: 700; }
    }
    .lock-divider { width: 40px; height: 1px; background: var(--echo-ink); opacity: 0.3; margin-bottom: 32px; }
    .lock-cta {
      font-family: var(--echo-font-mono);
      font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 700;
      color: var(--echo-cream); background: var(--echo-surface-dark); border: none;
      padding: 12px 28px; border-radius: var(--echo-radius-pill); cursor: pointer;
      box-shadow: 0 4px 0 #1E1209;
      transition: transform 150ms, box-shadow 150ms;
      &:active { transform: translateY(2px); box-shadow: 0 2px 0 #1E1209; }
    }

    /* ── Fotocamera attiva ────────────────────────────────────────────────── */
    /*
     * CRITICO: --background DEVE essere trasparente.
     * Senza questo, un colore pieno blocca il layer nativo CameraPreview.
     */
    ion-content.camera-content {
      --background: transparent;
      /* CRITICO: disabilita TUTTI i gesti di tocco di default di browser/WebView sul
       * mirino. Senza questo, un gesto a due dita può attivare il pan/zoom del compositor
       * sul layer HTML mentre la superficie nativa della fotocamera (toBack) resta ferma —
       * i due si desincronizzano e lo sfondo grigio del DOM traspare.
       * touch-action gira sul thread del compositor, quindi funziona anche quando un
       * listener passivo renderebbe ev.preventDefault() un no-op. */
      touch-action: none;
    }
    /* ion-content renderizza il suo scroller dentro lo shadow DOM; blocchiamo anche quello,
     * altrimenti un tocco che cade sull'elemento di scroll interno aggira il touch-action dell'host. */
    ion-content.camera-content::part(scroll) {
      touch-action: none;
      overflow: hidden;
      overscroll-behavior: none;
    }

    /* ── Cornice + griglia decorative (overlay trasparenti — vedi CATENA DI TRASPARENZA) ── */
    .frame-border {
      position: absolute; inset: 0; pointer-events: none; z-index: 11;
      box-shadow: inset 0 0 0 8px var(--echo-surface-dark, #3B2314);
    }
    .grid-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 5; }
    .grid-line { position: absolute; background: rgba(255,255,255,0.18); }
    .grid-line.v { top: 0; bottom: 0; width: 1px; }
    .grid-line.h { left: 0; right: 0; height: 1px; }

    /* ── HUD superiore: icona flash · contatore · etichetta spec fittizia — il testo resta BIANCO,
       sovrapposto a un feed live della fotocamera e non segue il tema beige dell'app ── */
    .camera-hud-top {
      position: absolute; top: 0; left: 0; right: 0;
      display: flex; align-items: center; justify-content: space-between;
      padding: 56px 24px 0;
      background: linear-gradient(to bottom, rgba(0,0,0,0.5), transparent);
      z-index: 10;
      /* Puramente informativo (icona flash, contatore, spec) — non cattura mai i tocchi. */
      pointer-events: none;
    }
    .hud-icon { width: 18px; height: 18px; color: rgba(255,255,255,0.9); }
    .hud-counter-text {
      font-family: var(--echo-font-mono); font-size: 13px; font-weight: 700;
      color: #fff; letter-spacing: 0.1em;
    }
    .hud-spec {
      font-family: var(--echo-font-mono); font-size: 11px;
      color: rgba(255,255,255,0.8); letter-spacing: 0.06em;
    }
    .hud-event-name {
      position: absolute; top: 84px; left: 0; right: 0;
      text-align: center;
      font-family: var(--echo-font-serif);
      font-size: 13px; letter-spacing: 0.04em;
      color: rgba(255,255,255,0.75);
      z-index: 10; pointer-events: none;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 60px;
    }

    /* ── HUD inferiore ── */
    .camera-hud-bottom {
      position: absolute; bottom: 0; left: 0; right: 0;
      display: flex; flex-direction: column; align-items: center;
      padding-bottom: 40px;
      background: linear-gradient(to top, rgba(0,0,0,0.55), transparent);
      z-index: 10; gap: 10px;
      /* Il contenitore e i suoi spazi vuoti/gradiente NON devono catturare i tocchi —
       * solo i controlli reali sotto riabilitano i pointer-events. Così un tocco
       * tra/attorno ai pulsanti (o vicino ai bordi) colpisce il mirino bloccato
       * invece di avviare un gesto della WebView. */
      pointer-events: none;
    }
    /* Riabilita l'interazione SOLO sui controlli reali. */
    .camera-hud-bottom .control-row,
    .camera-hud-bottom .ctrl-btn,
    .camera-hud-bottom .shutter-btn,
    .camera-hud-bottom .preview-status { pointer-events: auto; }

    /* Marcatori d'angolo del mirino (decorazione analogica) */
    .vf-corners { position: absolute; inset: 0; pointer-events: none; }
    .vf-corner {
      position: absolute; width: 16px; height: 16px;
      border-color: rgba(255,255,255,0.4); border-style: solid;
      &.tl { top: 16px;    left: 16px;   border-width: 1px 0 0 1px; }
      &.tr { top: 16px;    right: 16px;  border-width: 1px 1px 0 0; }
      &.bl { bottom: 160px; left: 16px;  border-width: 0 0 1px 1px; }
      &.br { bottom: 160px; right: 16px; border-width: 0 1px 1px 0; }
    }

    .shoot-error {
      font-family: var(--echo-font-mono);
      font-size: 12px; color: #fff; letter-spacing: 0.08em;
      text-align: center; margin: 0; padding: 6px 16px;
      background: rgba(184,92,56,0.55); border-radius: 4px;
    }

    .preview-status {
      font-family: var(--echo-font-mono);
      font-size: 11px; letter-spacing: 0.1em; color: rgba(255,255,255,0.7);
      text-align: center; margin: 0; padding: 6px 16px;
      &.failed { color: #fff; cursor: pointer; text-decoration: underline; }
    }

    /* Zoom a bottoni — livelli fissi riportati dall'obiettivo attuale */
    .zoom-row { display: flex; gap: 8px; padding: 4px 0; pointer-events: auto; }
    .zoom-btn {
      font-family: var(--echo-font-mono); font-size: 11px; font-weight: 700;
      color: rgba(255,255,255,0.75); background: rgba(0,0,0,0.35);
      border: 1px solid rgba(255,255,255,0.3); border-radius: var(--echo-radius-pill);
      padding: 4px 10px; cursor: pointer; -webkit-tap-highlight-color: transparent;
      &.active { color: #1E1209; background: #fff; border-color: #fff; }
    }

    /* Riga di controlli funzionali — flash + cambio fotocamera */
    .control-row { display: flex; gap: 22px; align-items: flex-start; }
    .ctrl-btn {
      display: flex; flex-direction: column; align-items: center; gap: 4px;
      background: transparent; border: none; color: #fff; cursor: pointer;
      -webkit-tap-highlight-color: transparent; padding: 0;
      &:active { opacity: 0.6; }
    }
    .ctrl-btn svg {
      width: 22px; height: 22px;
      background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.3);
      border-radius: 50%; padding: 8px; box-sizing: content-box;
    }
    .ctrl-label {
      font-family: var(--echo-font-mono); font-size: 9px; letter-spacing: 0.08em;
      text-transform: uppercase; color: rgba(255,255,255,0.75);
    }

    /* ── Pulsante di scatto ── */
    .shutter-btn {
      background: transparent; border: none; cursor: pointer; padding: 0;
      -webkit-tap-highlight-color: transparent;
      &[disabled] { cursor: not-allowed; opacity: 0.7; }
      &.firing .shutter-disc { transform: scale(0.82); background: var(--echo-surface-muted, #8C7B6E); }
    }
    .shutter-ring {
      width: 70px; height: 70px; border-radius: 50%;
      border: 3px solid #fff;
      display: flex; align-items: center; justify-content: center;
      transition: border-color 150ms;
    }
    .shutter-disc {
      width: 54px; height: 54px; border-radius: 50%; background: #fff;
      transition: transform 120ms ease-in-out, background 120ms;
    }

    /* ── Indicatore di upload ── */
    .upload-indicator {
      display: flex; align-items: center; gap: 6px;
      opacity: 0; transition: opacity 200ms;
      &.active { opacity: 1; }
    }
    .upload-dot {
      width: 5px; height: 5px; border-radius: 50%; background: #fff;
      animation: pulse 1s ease-in-out infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    .upload-label { font-family: var(--echo-font-mono); font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase; color: rgba(255,255,255,0.7); }
  `],
})
export class ComponenteFotocamera implements OnInit, OnDestroy {
  @Input() id_evento!: string;
  @Input() eventoNome = '';
  @Input() scatti_usati_iniziali = 0;
  @Input() scatti_per_utente = 3;

  shotState: ShotState | null = null;
  isShooting = false;
  isUploading = false;
  errorMessage = '';

  /** Abilita/blocca lo scatto — CameraPreview.start() è asincrona; capture() lancia
   *  "Camera is not running" se toccato prima che si risolva. */
  previewReady = false;
  previewFailed = false;

  /** Controlli fotocamera (cambio obiettivo + flash + zoom a bottoni). */
  facing: CameraFacing = 'rear';
  flashMode: FlashMode = 'off';
  private supportedFlash: FlashMode[] = [];
  /** Ordine in cui il pulsante flash cicla, intersecato con ciò che l'obiettivo supporta. */
  private readonly flashCycle: FlashMode[] = ['off', 'auto', 'on'];

  /** Il controllo flash è offerto solo quando l'obiettivo attuale riporta più del solo 'off'. */
  get flashAvailable(): boolean { return this.supportedFlash.filter(m => m !== 'off').length > 0; }
  get flashLabel(): string { return this.flashMode.toUpperCase(); }

  /**
   * Obiettivo di sblocco reale per QUESTO evento (album_sbloccato_at da /eventi/miei) — calcolato
   * lato server da sviluppo_started_at (o, prima che sia impostato, data_fine_calc) più
   * il ritardo di sviluppo attivo, così riflette automaticamente il dev_mode dell'evento e ogni
   * trigger anticipato — e diventa il valore reale non appena la galleria si sblocca davvero.
   * null finché non è caricato, nel qual caso developmentWaitLabel ricade sul valore generico
   * di default "24 ore".
   */
  private developmentUnlockAt: string | null = null;
  private developmentTicker?: Subscription;

  /**
   * Conto alla rovescia live verso album_sbloccato_at, ricalcolato rispetto a Date.now() a ogni
   * lettura — mai una durata statica/in cache. developmentTicker forza un re-render ogni minuto
   * così il valore mostrato continua a scendere mentre la schermata di blocco resta aperta.
   */
  get developmentWaitLabel(): string {
    if (!this.developmentUnlockAt) return '24 ore';
    const remainingMinutes = Math.max(0, Math.round((isoToMs(this.developmentUnlockAt) - Date.now()) / MS_PER_MINUTO));
    return this.formatDelay(remainingMinutes);
  }

  /** Livelli di zoom preimpostati per l'obiettivo attuale (es. [0.5, 1, 2, 3]), da getZoomButtonValues().
   *  Vuoto finché non caricato, o se il plugin non li espone (es. sul web in sviluppo). */
  zoomLevels: number[] = [];
  currentZoom = 1.0;

  private sub?: Subscription;
  private errorTimer?: ReturnType<typeof setTimeout>;
  private audioCtx?: AudioContext;

  constructor(
    public router: Router,
    private cameraService: ServizioFotocamera,
    private api: ApiService,
    private toastCtrl: ToastController,
    private cdr: ChangeDetectorRef,
    private host: ElementRef<HTMLElement>,
    private zone: NgZone,
  ) {}

  ngOnInit() {
    this.cameraService.initState(this.scatti_usati_iniziali, this.scatti_per_utente);
    this.sub = this.cameraService.shot$.subscribe((state: ShotState) => {
      this.shotState = state;
      this.cdr.markForCheck();
    });
    this.loadDevelopmentTarget();
    // Re-render ogni minuto così il conto alla rovescia continua a scorrere rispetto a Date.now()
    // mentre la schermata di blocco è visibile, invece di mostrare un valore congelato al caricamento.
    this.developmentTicker = interval(DEVELOPMENT_TICKER_MS).subscribe(() => this.cdr.markForCheck());
  }

  private async loadDevelopmentTarget(): Promise<void> {
    try {
      const res = await firstValueFrom(this.api.getMieiEventi());
      const ev = res.events.find(e => e.id_evento === this.id_evento);
      if (ev?.album_sbloccato_at) this.developmentUnlockAt = ev.album_sbloccato_at;
      this.cdr.markForCheck();
    } catch { /* mantieni il fallback generico "24 ore" */ }
  }

  private formatDelay(minutes: number): string {
    return minutes < 60 ? `${minutes} minuti` : `${Math.round(minutes / 60)} ore`;
  }

  /**
   * Chiamato dall'ionViewWillEnter di PaginaFotocamera (via @ViewChild) ogni volta che la pagina
   * (ri)entra nel viewport, inclusa la navigazione indietro. Così l'anteprima riparte
   * in modo affidabile sia che si tratti di una nuova istanza sia di una ri-entrata.
   */
  activate(): void {
    this.currentZoom = 1.0;
    this.setTransparentBg();
    this.lockViewfinderTouches();
    this.startCameraPreview();
  }

  /**
   * Rete di sicurezza JS al `touch-action: none` CSS. Un listener touchmove non-passivo in
   * fase di cattura sull'host del componente assorbe ogni trascinamento che NON parte da un
   * controllo reale — swipe dai bordi, pan accidentali — così non possono spostare il layer
   * WebView dalla superficie nativa della fotocamera. Aggiunto in runOutsideAngular così il
   * flusso touchmove ad alta frequenza non innesca mai il change detection.
   *
   * Vincolato una sola volta (campo arrow fn) così add/removeEventListener referenziano lo
   * stesso handler. I tap (touchstart→touchend senza movimento) sono intatti, quindi lo scatto
   * e i pulsanti di controllo continuano a funzionare; il doppio-tap-per-zoom è già eliminato
   * da `touch-action: none`.
   */
  private readonly blockViewfinderDrag = (e: TouchEvent): void => {
    const target = e.target as HTMLElement | null;
    // Lascia passare i gesti che iniziano su un controllo reale (i loro handler vengono eseguiti).
    if (target && target.closest('.shutter-btn, .ctrl-btn, .preview-status, .lock-cta')) return;
    if (e.cancelable) e.preventDefault();
  };

  private touchLockActive = false;
  private lockViewfinderTouches(): void {
    if (this.touchLockActive) return;
    this.touchLockActive = true;
    this.zone.runOutsideAngular(() => {
      // passive:false è OBBLIGATORIO per preventDefault(); capture:true intercetta prima
      // che qualsiasi handler figlio/del bridge nativo agisca sul trascinamento.
      this.host.nativeElement.addEventListener(
        'touchmove', this.blockViewfinderDrag, { passive: false, capture: true },
      );
    });
  }

  private unlockViewfinderTouches(): void {
    if (!this.touchLockActive) return;
    this.touchLockActive = false;
    this.host.nativeElement.removeEventListener(
      'touchmove', this.blockViewfinderDrag, { capture: true } as EventListenerOptions,
    );
  }

  /**
   * Chiamato dall'ionViewWillLeave di PaginaFotocamera (via @ViewChild) prima che la pagina lasci
   * il viewport. Ferma l'anteprima così il layer nativo della fotocamera non persiste sotto
   * altre pagine.
   */
  deactivate(): void {
    this.restoreBg();
    this.unlockViewfinderTouches();
    this.previewReady = false;
    this.cameraService.stopPreview().catch(errore =>
      console.warn('[Camera] Preview stop failed:', errore)
    );
  }

  /**
   * Avvia l'anteprima nativa e abilita lo scatto in base al risultato.
   * Condiviso da ionViewWillEnter e dal tocco di retry manuale.
   */
  private async startCameraPreview(): Promise<void> {
    this.previewReady = false;
    this.previewFailed = false;
    this.cdr.markForCheck();

    const ok = await this.cameraService.startPreview();

    this.previewReady = ok;
    this.previewFailed = !ok;
    if (ok) await this.refreshCameraControls();
    this.cdr.markForCheck();
  }

  /** Sincronizza la UI flash/obiettivo/zoom con la sessione fotocamera live — chiamato dopo (ri)avvio e
   *  dopo un cambio obiettivo, poiché le modalità flash e i livelli di zoom differiscono per obiettivo. */
  private async refreshCameraControls(): Promise<void> {
    this.facing = this.cameraService.currentFacing;
    this.supportedFlash = await this.cameraService.getSupportedFlashModes();
    this.zoomLevels = await this.cameraService.getZoomButtonValues();
    this.currentZoom = this.zoomLevels.includes(1) ? 1 : (this.zoomLevels[0] ?? 1);

    // CRITICO: chiama il setFlashMode nativo SOLO quando questo obiettivo ha EFFETTIVAMENTE il flash.
    // Su una fotocamera senza flash (es. l'emulatore), il setFlashMode del plugin fa
    // `supportedFlashModes.indexOf(...)` su una lista null → NullPointerException lanciata come
    // FATALE sul thread CapacitorPlugins, che fa crashare l'intera app e NON può essere
    // catturata da JS. Quindi dobbiamo evitare del tutto la chiamata, non incapsularla in try/catch.
    if (!this.flashAvailable) {
      this.flashMode = 'off';   // nessun hardware flash — la UI nasconde il pulsante, nessuna chiamata nativa
    } else if (!this.supportedFlash.includes(this.flashMode)) {
      // Il flash esiste ma la modalità attuale non è valida per questo obiettivo (es. dopo un cambio):
      // reimposta su un default supportato e spingilo così UI e hardware concordano.
      this.flashMode = 'off';
      await this.cameraService.setFlashMode('off');
    }
    this.cdr.markForCheck();
  }

  async toggleFlash(): Promise<void> {
    // Cicla off → auto → on, ma solo attraverso le modalità realmente supportate da questo obiettivo.
    const available = this.flashCycle.filter(m => this.supportedFlash.includes(m));
    if (!available.length) return;
    const idx = available.indexOf(this.flashMode);
    this.flashMode = available[(idx + 1) % available.length];
    await this.cameraService.setFlashMode(this.flashMode);
    this.cdr.markForCheck();
  }

  async switchCamera(): Promise<void> {
    this.facing = await this.cameraService.flipCamera();
    await this.refreshCameraControls(); // ricarica anche i livelli di zoom del nuovo obiettivo
  }

  formatZoomLabel(level: number): string {
    return (Number.isInteger(level) ? level.toFixed(0) : level.toFixed(1)) + '×';
  }

  async setZoomLevel(level: number): Promise<void> {
    if (level === this.currentZoom) return;
    await this.cameraService.setZoom(level);
    this.currentZoom = level;
  }

  retryPreview(): void {
    this.startCameraPreview();
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
    this.developmentTicker?.unsubscribe();
    clearTimeout(this.errorTimer);
    // Rete di sicurezza per il pulsante back hardware (che può bypassare ionViewWillLeave)
    this.restoreBg();
    this.unlockViewfinderTouches();
    this.cameraService.stopPreview().catch(() => { /* ignora */ });
    this.audioCtx?.close().catch(() => { /* ignora */ });
  }

  async onShutter() {
    if (this.isShooting || this.shotState?.esauriti) return;

    this.isShooting = true;
    this.errorMessage = '';
    this.fireShutterFeedback();

    try {
      const state = await this.cameraService.captureAndUpload(this.id_evento);

      // Mostra l'indicatore di upload discreto — non bloccante, visualizzato 2s
      this.isUploading = true;
      setTimeout(() => { this.isUploading = false; }, 2000);

      if (state.esauriti) {
        this.showToast('Ultimo scatto! Il rullino è ora in sviluppo 🎞', 2500);
        // La schermata di blocco apparirà automaticamente via *ngIf su shotState.esauriti
      }
      // CRITICO: nessun toast o anteprima che mostri la foto catturata (spec §3.2.3)

    } catch (errore: unknown) {
      const msg = errore instanceof Error ? errore.message : '';
      if (!msg.includes('SCATTI_ESAURITI')) {
        this.showError(msg || 'Errore durante lo scatto');
      }
    } finally {
      // Riabilita subito lo scatto — fire-and-forget significa che non aspettiamo l'upload
      this.isShooting = false;
    }
  }

  /**
   * Conferma di cattura istantanea — vibrazione aptica + click meccanico. Emessa nel momento
   * in cui lo scatto viene toccato (non dopo che capture/upload si risolvono) così il feedback
   * è immediato. Entrambe le chiamate sono fire-and-forget e non devono mai lanciare in onShutter().
   */
  private fireShutterFeedback(): void {
    Haptics.impact({ style: ImpactStyle.Medium }).catch(() => { /* nessun motore aptico (browser/dev) */ });
    this.playShutterSound();
  }

  /**
   * Sintetizza un breve click meccanico dell'otturatore via Web Audio — nessun asset audio
   * richiesto. Due rapidi burst di rumore filtrato (colpo dello specchio + chiusura otturatore) con
   * un inviluppo a decadimento esponenziale veloce. Riutilizza un unico AudioContext tra gli scatti.
   */
  private playShutterSound(): void {
    try {
      const ctx = this.audioCtx ??= new AudioContext();
      const click = (delaySec: number, durationSec: number, freq: number) => {
        const bufferSize = Math.floor(ctx.sampleRate * durationSec);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 8);
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = freq;
        filter.Q.value = 1.2;

        const gain = ctx.createGain();
        gain.gain.value = 0.9;

        noise.connect(filter).connect(gain).connect(ctx.destination);
        noise.start(ctx.currentTime + delaySec);
      };

      click(0, 0.02, 2200);     // colpo dello specchio
      click(0.025, 0.025, 1400); // chiusura otturatore
    } catch {
      // Web Audio non disponibile — salta in silenzio, non bloccare mai il flusso di cattura
    }
  }

  /**
   * Rende la WebView trasparente così il layer nativo CameraPreview traspare.
   * Chiamato su ionViewWillEnter; annullato su ionViewWillLeave.
   */
  private setTransparentBg(): void {
    // Copri l'INTERA catena di trasparenza così il layer nativo della fotocamera (renderizzato
    // SOTTO la WebView) non viene mai mascherato da una superficie bianca di default:
    //   - la var --ion-background-color su <html> E <body>
    //   - il `background` effettivo su ENTRAMBI <html> e <body> (la sola var non
    //     azzera un colore pieno ereditato sull'elemento radice)
    document.documentElement.style.setProperty('--ion-background-color', 'transparent');
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.setProperty('--ion-background-color', 'transparent');
    // Blocca rimbalzo/overscroll, che può esporre momentaneamente lo sfondo bianco della radice
    // ai bordi durante un gesto veloce (in coppia con [scrollY]/[scrollX]="false").
    document.body.style.overscrollBehavior = 'none';
  }

  private restoreBg(): void {
    document.documentElement.style.removeProperty('--ion-background-color');
    document.documentElement.style.background = '';
    document.body.style.background = '';
    document.body.style.removeProperty('--ion-background-color');
    document.body.style.overscrollBehavior = '';
  }

  private showError(msg: string) {
    this.errorMessage = msg;
    clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => { this.errorMessage = ''; }, 3000);
  }

  private async showToast(msg: string, duration = 2000) {
    const t = await this.toastCtrl.create({ message: msg, duration, position: 'top', color: 'dark' });
    t.present();
  }
}
