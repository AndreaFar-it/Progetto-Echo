import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { ServizioStatoEvento } from './event-state.service';

// Questo service serve a gestire l'app anche offline

interface ScattoInCoda {
  id: string;
  id_evento: string;
  blob: Blob;
  timestamp: number;
}

const NOME_DB = 'echo-offline';
const VERSIONE_DB = 1;
const STORE_SCATTI = 'scatti_in_attesa';

@Injectable({ providedIn: 'root' })
export class ServizioCodaUpload {
  // Promise dell'apertura del database
  private db: Promise<IDBDatabase> | null = null;
  // Impedisce due svuotamenti concorrenti
  private svuotamentoInCorso = false;

  constructor(private api: ApiService, private eventState: ServizioStatoEvento) {
    // Al ritorno della connettività riprova subito gli upload in sospeso.
    window.addEventListener('online', () => { void this.svuotaCoda(); });
    // All'avvio recupera eventuali scatti rimasti da una sessione precedente (es. app chiusa offline).
    void this.svuotaCoda();
  }

  /** Aggiunge uno scatto alla coda persistente. Rilancia l'errore se IndexedDB non è disponibile. */
  async accoda(id_evento: string, blob: Blob): Promise<void> {
    const db = await this.apriDb();
    const scatto: ScattoInCoda = { id: crypto.randomUUID(), id_evento, blob, timestamp: Date.now() };
    await this.attendi(db.transaction(STORE_SCATTI, 'readwrite').objectStore(STORE_SCATTI).put(scatto));
    // Se nel frattempo la rete è già tornata, prova subito.
    if (navigator.onLine) void this.svuotaCoda();
  }

  /** Tenta l'upload di tutti gli scatti in coda, in ordine di scatto. */
  async svuotaCoda(): Promise<void> {
    if (this.svuotamentoInCorso || !navigator.onLine) return;
    this.svuotamentoInCorso = true;
    let almenoUnoCaricato = false;
    try {
      const db = await this.apriDb();
      const scatti = await this.attendi(
        db.transaction(STORE_SCATTI, 'readonly').objectStore(STORE_SCATTI).getAll()
      ) as ScattoInCoda[];

      for (const scatto of scatti.sort((a, b) => a.timestamp - b.timestamp)) {
        try {
          await firstValueFrom(this.api.uploadFoto(scatto.id_evento, scatto.blob));
          await this.rimuovi(scatto.id);
          almenoUnoCaricato = true;
        } catch (errore: unknown) {
          const statoHttp = errore instanceof HttpErrorResponse ? errore.status : 0;
          // status 0 (Timeout)
          if (statoHttp === 0) return;
          // Il server ha risposto ma ha rifiutato: lo scatto non sarà mai più accettato.
          await this.rimuovi(scatto.id);
          void this.eventState.refresh(); // riallinea i contatori con la verità del server
        }
      }
    } catch {
      // IndexedDB non disponibile (browser molto vecchio / storage negato): nessuna coda,
      // il chiamante ha già gestito il fallback.
    } finally {
      this.svuotamentoInCorso = false;
      if (almenoUnoCaricato) void this.eventState.refresh();
    }
  }

  // ── IndexedDB — helper minimi (nessuna dipendenza esterna) ──────────────────────────

  private apriDb(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const richiesta = indexedDB.open(NOME_DB, VERSIONE_DB);
        richiesta.onupgradeneeded = () => {
          if (!richiesta.result.objectStoreNames.contains(STORE_SCATTI)) {
            richiesta.result.createObjectStore(STORE_SCATTI, { keyPath: 'id' });
          }
        };
        richiesta.onsuccess = () => resolve(richiesta.result);
        richiesta.onerror = () => reject(richiesta.error);
      });
    }
    return this.db;
  }

  // Converte una IDBRequest (API a callback) in una Promise attendibile con await.
  private attendi<T>(richiesta: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      richiesta.onsuccess = () => resolve(richiesta.result);
      richiesta.onerror = () => reject(richiesta.error);
    });
  }

  private async rimuovi(id: string): Promise<void> {
    const db = await this.apriDb();
    await this.attendi(db.transaction(STORE_SCATTI, 'readwrite').objectStore(STORE_SCATTI).delete(id));
  }
}
