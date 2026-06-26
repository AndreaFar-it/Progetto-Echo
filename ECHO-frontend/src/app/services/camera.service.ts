/**
 * ECHO — ServizioFotocamera
 *
 * Flusso di cattura (spec §3.2.3):
 *   1. CameraPreview.capture() — acquisisce il fotogramma in silenzio, NESSUN dialog nativo
 *   2. Aggiornamento UI ottimistico — i pallini si animano prima che l'upload sia completato
 *   3. Upload fire-and-forget — lo scatto si riabilita entro ~300ms
 *   4. L'ACK del server riconcilia il contatore; rollback in caso di errore di upload
 *
 * Usa esclusivamente @capacitor-community/camera-preview.
 * Il vecchio @capacitor/camera (Camera.getPhoto) è stato rimosso di proposito — apriva
 * la fotocamera di sistema e imponeva una schermata di anteprima/conferma, violando il concetto analogico.
 */

import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ApiService } from './api.service';
import { ServizioStatoEvento } from './event-state.service';
import { ConfermaCaricamento } from '../models/index';
import { applyVintageFilter } from '../utils/vintage-filter';

export interface ShotResult { scatti_usati: number; scatti_totali: number; esauriti: boolean; }
export type ShotState = ShotResult;

export type CameraFacing = 'rear' | 'front';
export type FlashMode = 'off' | 'on' | 'auto' | 'torch' | 'red-eye';

@Injectable({ providedIn: 'root' })
export class ServizioFotocamera {
  private _shot$ = new BehaviorSubject<ShotResult>({ scatti_usati: 0, scatti_totali: 0, esauriti: false });
  readonly shot$ = this._shot$.asObservable();

  /** Quale obiettivo sta usando l'anteprima — commutato da flipCamera() e ri-applicato
   *  al successivo startPreview() così la scelta sopravvive a un ciclo deactivate/activate. */
  private facing: CameraFacing = 'rear';

  constructor(private api: ApiService, private eventState: ServizioStatoEvento) {}

  /** Chiamato dalla pagina fotocamera per inizializzare lo stato dai parametri di navigazione. */
  initState(usati: number, totali: number): void {
    this._shot$.next({ scatti_usati: usati, scatti_totali: totali, esauriti: usati >= totali });
  }

  /**
   * Avvia il feed live della fotocamera dietro la WebView.
   * toBack: true → viene renderizzato come layer nativo SOTTO il layer della WebView.
   * La WebView e tutti i componenti Ionic devono avere sfondi trasparenti perché si veda.
   *
   * Ritorna true una volta che la sessione nativa è effettivamente attiva. La chiamata
   * nativa start() può impiegare 1-3s (init HW della fotocamera, o un giro di dialog
   * permessi al primo avvio) — i chiamanti DEVONO attenderla e abilitare lo scatto in
   * base al risultato, altrimenti capture() fallisce con "Camera is not running" se
   * toccato troppo presto.
   *
   * Protetta con un timeout: su alcuni emulatori/dispositivi la chiamata nativa start()
   * può bloccarsi indefinitamente (es. un AVD senza fotocamera emulata) invece di
   * risolversi o rifiutarsi. Senza questo, la UI resterebbe per sempre nello stato
   * "avvio fotocamera".
   */
  async startPreview(): Promise<boolean> {
    try {
      const { CameraPreview } = await import('@capacitor-community/camera-preview');
      // Termina ogni sessione ancora attiva da un ciclo di vita precedente (es. crash dell'app,
      // bypass del back hardware, o un deactivate fallito). Chiamare start() su una sessione
      // viva rende il plugin non responsivo; stop() è sicuro da chiamare anche quando è inattivo.
      try { await CameraPreview.stop(); } catch { /* già fermato — ignora */ }
      await Promise.race([
        CameraPreview.start({
          position: this.facing,
          toBack: true,
          x: 0,
          y: 0,
          width: window.innerWidth,
          height: window.innerHeight,
          disableAudio: true,
          // Pinch-to-zoom nativo: l'UNICO meccanismo di zoom esposto da questa versione del
          // plugin (non esiste un metodo zoom() programmatico). Il rilevatore di gesti nativo
          // è limitato dall'hardware, quindi non serve clamping JS.
          enableZoom: true,
          lockAndroid: true,
          // AGGIUNGI QUESTA PROPRIETÀ PER FORZARE ANDROID A PRENDERE L'ORIENTAMENTO CORRETTO
          disableExifHeaderCorrection: false
        } as any),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('CAMERA_START_TIMEOUT')), 8000)
        ),
      ]);
      return true;
    } catch (e) {
      // Atteso in modalità dev browser — ricade con grazia su uno sfondo nero
      console.info('[ServizioFotocamera] CameraPreview unavailable (browser/dev mode):', e);
      return false;
    }
  }

  async stopPreview(): Promise<void> {
    try {
      const { CameraPreview } = await import('@capacitor-community/camera-preview');
      await CameraPreview.stop();
    } catch { /* ignora */ }
  }

  get currentFacing(): CameraFacing { return this.facing; }

  /**
   * Commuta l'obiettivo frontale/posteriore sull'anteprima live.
   * Usa stop + start invece della chiamata flip() del plugin perché flip() è
   * inaffidabile su diversi OEM Android e può far crashare a fondo il bridge Capacitor.
   * Ritorna il nuovo facing così la UI può aggiornarsi (es. nascondere il flash sulla frontale).
   */
  async flipCamera(): Promise<CameraFacing> {
    const newFacing = this.facing === 'rear' ? 'front' : 'rear';
    try {
      const { CameraPreview } = await import('@capacitor-community/camera-preview');
      await CameraPreview.stop();
      this.facing = newFacing;
      await Promise.race([
        CameraPreview.start({
          position: this.facing,
          toBack: true,
          x: 0,
          y: 0,
          width: window.innerWidth,
          height: window.innerHeight,
          disableAudio: true,
          enableZoom: true,   // pinch-to-zoom nativo (vedi startPreview)
          lockAndroid: true,
          // AGGIUNGI ANCHE QUI
          disableExifHeaderCorrection: false
        } as any),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('CAMERA_FLIP_TIMEOUT')), 8000)
        ),
      ]);
    } catch (e) {
      console.warn('[ServizioFotocamera] Camera switch failed:', e);
      // Ripristina il facing se la nuova sessione non è partita
      this.facing = this.facing === 'rear' ? 'front' : 'rear';
    }
    return this.facing;
  }

  /** Modalità flash realmente supportate dall'obiettivo attuale (es. le fotocamere frontali di
   *  solito riportano solo 'off'). Array vuoto se la query fallisce / nessun hardware flash. */
  async getSupportedFlashModes(): Promise<FlashMode[]> {
    try {
      const { CameraPreview } = await import('@capacitor-community/camera-preview');
      const { result } = await CameraPreview.getSupportedFlashModes();
      return (result ?? []) as FlashMode[];
    } catch {
      return [];
    }
  }

  async setFlashMode(mode: FlashMode): Promise<void> {
    try {
      const { CameraPreview } = await import('@capacitor-community/camera-preview');
      await CameraPreview.setFlashMode({ flashMode: mode });
    } catch (e) {
      console.warn('[ServizioFotocamera] setFlashMode failed:', e);
    }
  }

  /**
   * Cattura un fotogramma e lo carica.
   *
   * La differenza critica rispetto a Camera.getPhoto():
   *   - Nessuna app fotocamera nativa viene lanciata
   *   - Nessun dialog di anteprima/conferma di sistema appare
   *   - Il fotogramma è acquisito in silenzio dal feed CameraPreview già in esecuzione
   *   - Il pulsante di scatto si riabilita immediatamente (non dopo l'upload)
   */
  async captureAndUpload(id_evento: string): Promise<ShotResult> {
    const cur = this._shot$.getValue();
    if (cur.esauriti || cur.scatti_usati >= cur.scatti_totali) {
      throw new Error('SCATTI_ESAURITI');
    }

    // ── 1. Cattura silenziosa via CameraPreview, poi "stampa" il filtro vintage ──
    // Il fotogramma passa per il filtro vintage basato su Canvas (utils/vintage-filter)
    // PRIMA dell'upload, così il backend memorizza l'immagine già filtrata — il look analogico
    // è permanente, non un effetto di visualizzazione CSS reversibile.
    let blob: Blob;
    try {
      const { CameraPreview } = await import('@capacitor-community/camera-preview');
const result = await CameraPreview.capture({ quality: 85 }); // Lascialo così senza correctOrientation

if (!result.value) throw new Error('CAPTURE_EMPTY');

// Passiamo result.value e this.facing (che contiene 'front' o 'rear')
blob = await applyVintageFilter(result.value, this.facing);
    } catch (captureErr: unknown) {
      const msg = captureErr instanceof Error ? captureErr.message : String(captureErr);
      console.error('[ServizioFotocamera] Capture failed:', msg);
      throw new Error('CAPTURE_FAILED: ' + msg);
    }

    // ── 2. Aggiornamento UI ottimistico ───────────────────────────────────────────
    // I pallini si animano qui — prima ancora che la richiesta HTTP sia inviata.
    const newUsed = cur.scatti_usati + 1;
    const optimistic: ShotResult = {
      scatti_usati: newUsed,
      scatti_totali: cur.scatti_totali,
      esauriti: newUsed >= cur.scatti_totali,
    };
    this._shot$.next(optimistic);
    this.eventState.decrementShot();   // aggiorna anche il badge della tab

    // ── 3. Upload fire-and-forget ─────────────────────────────────────────
    // Lo scatto si riabilita nel blocco finally del componente prima che questo si risolva.
    this.api.uploadFoto(id_evento, blob).subscribe({
      next: (ack: ConfermaCaricamento) => {
        // Il server è la fonte di verità — riconcilia il contatore con l'ACK
        this._shot$.next({
          scatti_usati: ack.scatti_usati,
          scatti_totali: ack.scatti_totali,
          esauriti: ack.esauriti,
        });
        if (ack.esauriti) this.eventState.refresh();
      },
      error: (errore) => {
        // Annulla il pallino ottimistico — lo scatto non è mai stato realmente registrato
        console.error('[ServizioFotocamera] Upload failed, reverting optimistic state:', errore);
        this._shot$.next(cur);
        this.eventState.refresh();
      },
    });

    return optimistic;
  }
}
