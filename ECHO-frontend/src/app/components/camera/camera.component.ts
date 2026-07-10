import {
  Component,
  OnInit,
  OnDestroy,
  Input,
  ChangeDetectorRef
} from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonContent,
  ToastController
} from '@ionic/angular/standalone';
import {
  Haptics,
  ImpactStyle
} from '@capacitor/haptics';
import {
  Subscription,
  interval,
  firstValueFrom
} from 'rxjs';
import {
  ServizioFotocamera,
  ShotState,
  CameraFacing,
  FlashMode
} from '../../services/camera.service';
import { ApiService } from '../../services/api.service';
import {
  MS_PER_MINUTO,
  isoToMs
} from '../../core/time.util';

// Cadenza del ticker che tiene vivo il conto alla rovescia di sviluppo.
const DEVELOPMENT_TICKER_MS = 60_000;

@Component({
  selector: 'app-camera',
  standalone: true,
  imports: [CommonModule, IonContent],
  template: `

    <!-- SCHERMATA DI BLOCCO — mostrata una volta che esauriti = true; mai annullata -->
    <div class="lock-screen" *ngIf="shotState?.esauriti; else activeCamera">
      <div class="lock-symbol">🎞</div>
      <h2 class="lock-title">Rullino Esaurito</h2>
      <p class="lock-body">
        Hai usato tutti i {{ shotState?.scatti_totali }} scatti.<br>
        Torna tra <strong>{{ CD_Sviluppo }}</strong> per scoprire la galleria collettiva.
      </p>
      <div class="lock-divider"></div>
      <button class="lock-cta" (click)="router.navigate(['/eventi/miei'])">
        ← Vai ai tuoi eventi
      </button>
    </div>

    <!-- FOTOCAMERA ATTIVA — mirino (trasparente) + HUD + scatto         -->
    <ng-template #activeCamera>
      <ion-content class="camera-content" [fullscreen]="true"
        [scrollY]="false"
        [scrollX]="false">

        <div class="camera-hud-top"></div>
        <div class="hud-event-name" *ngIf="shotState">{{ shotState.scatti_totali - shotState.scatti_usati }} scatti rimasti</div>

        <!-- ── HUD inferiore: angoli mirino + zoom/controlli decorativi + scatto ── -->
        <div class="camera-hud-bottom">

          <p class="shoot-error" *ngIf="errorMessage">{{ errorMessage }}</p>

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
      /* Blocco del tocco sul mirino — impedisce doppio-tap-zoom, selezione testo, rimbalzo. */
      touch-action: none;
      -webkit-user-select: none; user-select: none;
      -webkit-touch-callout: none;
      overscroll-behavior: none;
      -webkit-tap-highlight-color: transparent;
    }

    /* ── Schermata di blocco — pagina opaca, nessun vincolo di trasparenza ── */
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

    /* ── Fotocamera attiva — CRITICO: --background deve restare trasparente, senza questo
       un colore pieno bloccherebbe il layer nativo CameraPreview sottostante. ── */
    ion-content.camera-content {
      --background: transparent;
      touch-action: none;
    }
    ion-content.camera-content::part(scroll) {
      touch-action: none;
      overflow: hidden;
      overscroll-behavior: none;
    }

    /* ── HUD superiore: scrim per leggibilità di status bar e contatore scatti ── */
    .camera-hud-top {
      position: absolute; top: 0; left: 0; right: 0;
      height: 100px;
      background: linear-gradient(to bottom, rgba(0,0,0,0.5), transparent);
      z-index: 10;
      pointer-events: none;
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
      /* La tab bar galleggia sopra questa pagina (vedi app-shell) — riserviamo la sua altezza
         reale per evitare che copra il pulsante di scatto. */
      padding-bottom: calc(40px + var(--echo-tab-bar-height, 74px));
      background: linear-gradient(to top, rgba(0,0,0,0.55), transparent);
      z-index: 10; gap: 10px;
      pointer-events: none;
    }
    /* Riabilita l'interazione SOLO sui controlli reali. */
    .camera-hud-bottom .control-row,
    .camera-hud-bottom .ctrl-btn,
    .camera-hud-bottom .shutter-btn,
    .camera-hud-bottom .preview-status { pointer-events: auto; }

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
  // l'ID dell'evento (obbligatorio)
  @Input() id_evento!: string;
  @Input() eventoNome = '';
  @Input() scatti_usati_iniziali = 0;
  @Input() scatti_per_utente = 3;

  // Variabile per memorizzare lo stato attuale degli scatti (es. usati, totali, esauriti), inizialmente null
  shotState: ShotState | null = null;
  // Indica se è in corso un'operazione di scatto
  isShooting = false;
  // Indica se è in corso il caricamento della foto
  isUploading = false;
  errorMessage = '';

  // Flag che abilita o blocca lo scatto. 
  previewReady = false;
  previewFailed = false;

  facing: CameraFacing = 'rear';
  flashMode: FlashMode = 'off';
  // Array che memorizza le modalità di flash effettivamente supportate dal dispositivo
  private supportedFlash: FlashMode[] = [];
  // Array di sola lettura che definisce l'ordine in cui il pulsante del flash deve ciclare tra le modalità
  private readonly flashCycle: FlashMode[] = ['off', 'auto', 'on'];

  // Restituisce true se il dispositivo supporta altre modalità di flash oltre a 'off'
  get flashAvailable(): boolean { return this.supportedFlash.filter(m => m !== 'off').length > 0; }
  // Funzione per l'UI
  get flashLabel(): string { return this.flashMode.toUpperCase(); }

  private sviluppo_ended_at: string | null = null;
  // Sottoscrizione per un timer che si aggiorna ogni minuto per simulare il conto alla rovescia
  private developmentTicker?: Subscription;

  // Calcola e formatta il tempo rimanente allo sviluppo dell'album
  get CD_Sviluppo(): string {
    // Se non è impostato un orario di fine, restituisce un valore di default "24 ore" (NON CONVINCE)
    if (!this.sviluppo_ended_at) return '24 ore';
    const minutiRimanenti = Math.max(0, Math.round((isoToMs(this.sviluppo_ended_at) - Date.now()) / MS_PER_MINUTO));
    return this.formatDelay(minutiRimanenti);
  }

  // Array che contiene i livelli di zoom preimpostati supportati dall'obiettivo attuale
  zoomLevels: number[] = [];
  currentZoom = 1.0;

  // Sottoscrizione generica utilizzata per lo stream dello stato della fotocamera
  private sub?: Subscription;
  // Variabile per memorizzare il timer relativo alla pulizia dei messaggi di errore
  private errorTimer?: ReturnType<typeof setTimeout>;

  // Costruttore della classe, inietta le dipendenze necessarie per il funzionamento del componente
  constructor(
    public router: Router,
    private cameraService: ServizioFotocamera,
    private api: ApiService,
    private toastCtrl: ToastController,
    private cdr: ChangeDetectorRef,
  ) { }

  ngOnInit() {
    this.cameraService.initState(this.scatti_usati_iniziali, this.scatti_per_utente);
    // Si iscrive all'Observable shot$ per ricevere aggiornamenti sullo stato degli scatti
    this.sub = this.cameraService.shot$.subscribe((state: ShotState) => {
      this.shotState = state;
      this.cdr.markForCheck();
    });
    this.loadDevelopmentTarget();
    this.developmentTicker = interval(DEVELOPMENT_TICKER_MS).subscribe(() => this.cdr.markForCheck());
  }

  // Metodo privato asincrono per recuperare l'orario di fine sviluppo dell'album dall'API
  private async loadDevelopmentTarget(): Promise<void> {
    try {
      const res = await firstValueFrom(this.api.getMieiEventi());
      const ev = res.events.find(e => e.id_evento === this.id_evento);
      if (ev?.album_sbloccato_at) {
        this.sviluppo_ended_at = ev.album_sbloccato_at;
      }
      this.cdr.markForCheck();
    } catch { 
      // In caso di errore nella chiamata di rete, mantiene silenziosamente il fallback di default a "24 ore"
    }
  }

  private formatDelay(minutes: number): string {
    return minutes < 60 ? `${minutes} minuti` : `${Math.round(minutes / 60)} ore`;
  }

  // Metodo chiamato per "attivare" o resettare la vista della fotocamera quando si entra nella schermata
  activate(): void {
    this.currentZoom = 1.0;
    this.setTransparentBg();
    this.startCameraPreview();
  }

  // Metodo chiamato per spegnere la fotocamera e ripristinare la UI quando si esce dalla schermata
  deactivate(): void {
    this.restoreBg();
    this.previewReady = false;
    this.cameraService.stopPreview().catch(errore =>
      console.warn('[Camera] Preview stop failed:', errore)
    );
  }

  // Metodo per avviare l'anteprima nativa. Abilita lo scatto a seconda del risultato.
  private async startCameraPreview(): Promise<void> {
    this.previewReady = false;
    this.previewFailed = false;
    this.cdr.markForCheck();

    const success = await this.cameraService.startPreview();

    this.previewReady = success;
    this.previewFailed = !success;
    if (success) await this.refreshCameraControls();
    this.cdr.markForCheck();
  }

  // Sincronizza i controlli UI (flash, obiettivo, zoom) con la fotocamera attualmente attiva
  private async refreshCameraControls(): Promise<void> {
    this.facing = this.cameraService.currentFacing;
    this.supportedFlash = await this.cameraService.getSupportedFlashModes();
    this.zoomLevels = await this.cameraService.getZoomButtonValues();
    this.currentZoom = this.zoomLevels.includes(1) ? 1 : (this.zoomLevels[0] ?? 1);
    // Applica la disponibilità del flash aggiornando la UI
    await this.applyFlashAvailability();
  }

  // Se la modalità flash attuale non è supportata dall'obiettivo attivo (es. dopo un cambio
  // fotocamera, o nessun hardware flash), la resetta a 'off' e la applica.
  private async applyFlashAvailability(): Promise<void> {
    if (!this.supportedFlash.includes(this.flashMode)) {
      this.flashMode = 'off';
      await this.cameraService.setFlashMode('off');
    }
    this.cdr.markForCheck();
  }

  // Metodo per cambiare sequenzialmente la modalità del flash
  async toggleFlash(): Promise<void> {
    // Filtra il ciclo predefinito (off -> auto -> on) mantenendo solo le modalità supportate 
    const available = this.flashCycle.filter(m => this.supportedFlash.includes(m));
    if (!available.length) return;
    // Trova l'indice della modalità attuale all'interno dell'array delle modalità disponibili
    const idx = available.indexOf(this.flashMode);
    // Seleziona la modalità successiva usando l'operatore modulo per tornare all'inizio dell'array
    this.flashMode = available[(idx + 1) % available.length];
    await this.cameraService.setFlashMode(this.flashMode);
    this.cdr.markForCheck();
  }

  // Metodo asincrono per passare dalla fotocamera frontale a quella posteriore e viceversa
  async switchCamera(): Promise<void> {
    this.facing = await this.cameraService.flipCamera();
    await this.refreshCameraControls(); 
  }

  // Metodo di supporto per formattare il livello di zoom da mostrare nella UI (es. "1×" o "1.5×")
  formatZoomLabel(level: number): string {
    return (Number.isInteger(level) ? level.toFixed(0) : level.toFixed(1)) + '×';
  }

  // Imposta un nuovo livello di zoom sulla fotocamera
  async setZoomLevel(level: number): Promise<void> {
    if (level === this.currentZoom) return;
    await this.cameraService.setZoom(level);
    this.currentZoom = level;
  }

  // Metodo per tentare di riavviare manualmente la preview in caso di fallimento 
  retryPreview(): void {
    this.startCameraPreview();
  }

  // Hook del ciclo di vita chiamato da Angular quando il componente sta per essere distrutto
  ngOnDestroy() {
    this.sub?.unsubscribe();
    this.developmentTicker?.unsubscribe();
    clearTimeout(this.errorTimer);
    this.restoreBg();
    this.cameraService.stopPreview().catch(() => { /* ignora errori di stop preview */ });
  }

  // Metodo asincrono innescato quando l'utente preme il pulsante di scatto
  async onShutter() {
    // Previene doppi click se sta già scattando o se l'utente ha esaurito il numero massimo di scatti
    if (this.isShooting || this.shotState?.esauriti) return;

    // Blocca ulteriori scatti impostando il flag
    this.isShooting = true;
    // Resetta eventuali messaggi di errore precedenti
    this.errorMessage = '';
    // Emette immediatamente il feedback aptico per una responsività istantanea
    Haptics.impact({ style: ImpactStyle.Medium }).catch(() => { /* ignora errori se il motore aptico non è presente */ });

    try {
      const state = await this.cameraService.captureAndUpload(this.id_evento);

      this.isUploading = true;
      setTimeout(() => { this.isUploading = false; }, 2000);

      if (state.esauriti) {
        this.showToast('Ultimo scatto! Il rullino è ora in sviluppo 🎞', 2500);
      }
      
    } catch (errore: unknown) {
      const msg = errore instanceof Error ? errore.message : '';
      if (!msg.includes('SCATTI_ESAURITI')) {
        this.showError(msg || 'Errore durante lo scatto');
      }
    } finally {
      this.isShooting = false;
    }
  }

  // Rimuove i colori di background per esporre la camera nativa
  private setTransparentBg(): void {
    document.documentElement.style.setProperty('--ion-background-color', 'transparent');
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.setProperty('--ion-background-color', 'transparent');
    document.body.style.overscrollBehavior = 'none';
  }

  // Ripristina i colori di background e comportamenti originali quando si disattiva la camera
  private restoreBg(): void {
    document.documentElement.style.removeProperty('--ion-background-color');
    document.documentElement.style.background = '';
    document.body.style.background = '';
    document.body.style.removeProperty('--ion-background-color');
    document.body.style.overscrollBehavior = '';
  }

  // Mostra a schermo una stringa di errore passata in input
  private showError(msg: string) {
    this.errorMessage = msg;
    clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => { this.errorMessage = ''; }, 3000);
  }

  // Metodo helper asincrono per creare e mostrare un toast informativo usando l'API di Ionic
  private async showToast(msg: string, duration = 2000) {
    const t = await this.toastCtrl.create({ message: msg, duration, position: 'top', color: 'dark' });
    t.present();
  }
}