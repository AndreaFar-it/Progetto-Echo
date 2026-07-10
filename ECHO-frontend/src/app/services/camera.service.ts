import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject } from 'rxjs';
import { ApiService } from './api.service';
import { ServizioStatoEvento } from './event-state.service';
import { ServizioCodaUpload } from './upload-queue.service';
import { ConfermaCaricamento } from '../models/index';

export interface ShotResult { scatti_usati: number; scatti_totali: number; esauriti: boolean; }
export type ShotState = ShotResult;

export type CameraFacing = 'rear' | 'front';
export type FlashMode = 'off' | 'on' | 'auto';

@Injectable({ providedIn: 'root' })
export class ServizioFotocamera {
  private _shot$ = new BehaviorSubject<ShotResult>({ scatti_usati: 0, scatti_totali: 0, esauriti: false });
  readonly shot$ = this._shot$.asObservable();

  //inizializzazione facing della fotocamera
  private facing: CameraFacing = 'rear';

  constructor(
    private api: ApiService,
    private eventState: ServizioStatoEvento,
    private codaUpload: ServizioCodaUpload,
  ) { }

  // Chiamato dalla pagina per inizializzare lo stato della fotocamera
  initState(usati: number, totali: number): void {
    this._shot$.next({ scatti_usati: usati, scatti_totali: totali, esauriti: usati >= totali });
  }

  async startPreview(): Promise<boolean> {
    try {
      //Importa il plugin capgo
      const { CameraPreview } = await import('@capgo/camera-preview');
      try { await CameraPreview.stop(); } catch { }
      await Promise.race([
        CameraPreview.start({
          position: this.facing, //inizializza il facing della fotocamera
          toBack: true, // Disegna la fotocamera dietro l'interfaccia HTML
          x: 0,
          y: 0,
          width: window.innerWidth, // legge la larghezza esatta del display dello smartphone
          height: window.innerHeight, // leggendo l'altezza esatta del display dello smartphone
          aspectMode: 'cover', // Riempie tutto lo schermo ritagliando l'immagine, invece di lasciare bordi vuoti (letterbox)
          disableAudio: true,
          lockAndroidOrientation: true,
          storeToFile: false,
          disableExifHeaderStripping: false // Questa opzione forza i dispositivi Android a incorporare correttamente i dati di orientamento nell'immagine.
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('CAMERA_START_TIMEOUT')), 8000) // Evita che telefoni vecchi si freezzino aspettano la cam
        ),
      ]);
      return true;
    } catch (error) {
      return false;
    }
  }

  async stopPreview(): Promise<void> {
    try {
      const { CameraPreview } = await import('@capgo/camera-preview');
      await CameraPreview.stop();
    } catch { }
  }

  // Serve a tenere a mente la direzione attuale della fotocamera
  get currentFacing(): CameraFacing { return this.facing; }


  async flipCamera(): Promise<CameraFacing> {
  const newFacing = this.facing === 'rear' ? 'front' : 'rear';
  try {
    const { CameraPreview } = await import('@capgo/camera-preview');
    await CameraPreview.flip();
    this.facing = newFacing;
  } catch (error) {
  }
  return this.facing;
}


  async getSupportedFlashModes(): Promise<FlashMode[]> {
    try {
      const { CameraPreview } = await import('@capgo/camera-preview');
      const { result } = await CameraPreview.getSupportedFlashModes(); // Metodo del plugin, restituisce i tipo diversi di flashmodes supportati dalla camera
      return (result ?? []).filter((m): m is FlashMode => m !== 'torch'); // Prendiamo tutte le flash modes ma filtriamo torch che non ci serve
    } catch {
      return [];
    }
  }

  // Metodo per settare una tra le modalità flash
  async setFlashMode(mode: FlashMode): Promise<void> {
    try {
      const { CameraPreview } = await import('@capgo/camera-preview');
      await CameraPreview.setFlashMode({ flashMode: mode });
    } catch (error) {
    }
  }

  // Metodo che ritorna gli zoom supportati
  async getZoomButtonValues(): Promise<number[]> {
    try {
      const { CameraPreview } = await import('@capgo/camera-preview');
      const { values } = await CameraPreview.getZoomButtonValues();
      return values ?? [];
    } catch {
      return [];
    }
  }

  // Metodo per settare una tra le modalità zoom disponibili
  async setZoom(level: number): Promise<void> {
    try {
      const { CameraPreview } = await import('@capgo/camera-preview');
      await CameraPreview.setZoom({ level });
    } catch (error) {
    }
  }

  // Metodo per Catturare e Caricare la foto
  async captureAndUpload(id_evento: string): Promise<ShotResult> {
    const cur = this._shot$.getValue();
    // Controllo scatti disponibili
    if (cur.esauriti || cur.scatti_usati >= cur.scatti_totali) {
      throw new Error('SCATTI_ESAURITI');
    }

    // Come sempre utilizziamo blob per l'efficienza nelle immagini
    let blob: Blob;
    try {
      const { CameraPreview } = await import('@capgo/camera-preview');
      // Catturiamo il fotogramma (qualità 85 è standard)
      const { value } = await CameraPreview.capture({ quality: 85 });

      // Controllo se esiste ciò che abbiamo preso
      if (!value) throw new Error('CAPTURE_EMPTY');

      // Prende l'immagine da locale e la converte in blob; l'orientamento è gestito
      // dal plugin nativo (disableExifHeaderStripping incorpora i metadati EXIF corretti).
      blob = await fetch(`data:image/jpeg;base64,${value}`).then(r => r.blob());
    } catch (captureErr: unknown) {
      throw new Error('CAPTURE_FAILED');
    }

    // Considerando che c'è delay tra una richiesta di scatto HTTP ed un altra, l'utente potrebbe scattare più foto
    // Perciò aggiorniamo immediatamente il valore di scatti usati.
    const newUsed = cur.scatti_usati + 1;
    const optimistic: ShotResult = {
      scatti_usati: newUsed,
      scatti_totali: cur.scatti_totali,
      esauriti: newUsed >= cur.scatti_totali,
    };
    this._shot$.next(optimistic);
    this.eventState.decrementShot();   // aggiorna anche il badge della tab

    // Qui effettivamente andiamo a controllare che il server abbia le nostre stesse info locali
    // Se combaciano allora refresha lo stato, altrimenti ha un fall back nei numeri precedenti
    this.api.uploadFoto(id_evento, blob).subscribe({
      next: (ack: ConfermaCaricamento) => {
        this._shot$.next({
          scatti_usati: ack.scatti_usati,
          scatti_totali: ack.scatti_totali,
          esauriti: ack.esauriti,
        });
        if (ack.esauriti) void this.eventState.refresh();
      },
      error: (errore: unknown) => {
        const statoHttp = errore instanceof HttpErrorResponse ? errore.status : 0;
        const problemaDiRete = statoHttp === 0 || !navigator.onLine;

        if (problemaDiRete) {
          // Rete assente o instabile: lo scatto è prezioso e NON va perso — finisce nella
          // coda offline (IndexedDB) e verrà caricato automaticamente al ritorno della rete.
          this.codaUpload.accoda(id_evento, blob).catch(() => {
            // IndexedDB non disponibile: ripiega sul vecchio comportamento (annulla lo scatto)
            console.error('[ServizioFotocamera] Coda offline non disponibile, ripristino lo stato');
            this._shot$.next(cur);
            void this.eventState.refresh();
          });
          return;
        }

        // Il server ha risposto ma ha rifiutato (evento chiuso, scatti esauriti…):
        // annulla il pallino ottimistico — lo scatto non è mai stato realmente registrato.
        console.error('[ServizioFotocamera] Upload rifiutato dal server, ripristino lo stato:', errore);
        this._shot$.next(cur);
        void this.eventState.refresh();
      },
    });

    return optimistic;
  }
}
