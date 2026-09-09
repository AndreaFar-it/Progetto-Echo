import {
  Component,
  OnInit,
  OnDestroy,
  Input,
  ChangeDetectorRef
} from '@angular/core';
import { Router } from '@angular/router';

import {
  IonContent,
  IonIcon,
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

// Cadenza del ticker che tiene vivo il conto alla rovescia di sviluppo.
const DEVELOPMENT_TICKER_MS = 60_000;

@Component({
  selector: 'app-camera',
  standalone: true,
  imports: [IonContent, IonIcon],
  templateUrl: './camera.component.html',
  styleUrl: './camera.component.scss',
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