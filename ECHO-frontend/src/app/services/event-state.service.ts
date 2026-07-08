import {
  Injectable,
  OnDestroy,
  signal,
  Signal
} from '@angular/core';
import {
  BehaviorSubject,
  Subscription,
  interval,
  switchMap,
  catchError,
  of
} from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import {
  EventoCard,
  StatoEventoAttivo
} from '../models/index';
import {
  MS_PER_MINUTO,
  isoToMs
} from '../core/time.util';

export type { StatoEventoAttivo };

// CADENZA DI AGGIORNAMENTO
// Il servizio interrogherà il server ogni 30.000 ms (30 secondi) per cercare nuovi dati.
const POLLING_MS = 30_000;
// Ritmo dell'orologio interno usato per aggiornare i conti alla rovescia in UI (1.000 ms = 1 secondo).
const TICK_MS = 1000;

// Rende questo servizio un Singleton (un'unica istanza condivisa) e lo registra nel root injector di Angular.
@Injectable({ providedIn: 'root' })
export class ServizioStatoEvento implements OnDestroy {
  
  // conserva la lista grezza degli eventi scaricati dal server.
  // Inizializzato con array vuoto. Conserva e restituisce sempre l'ultimo valore ai nuovi iscritti.
  private _events$ = new BehaviorSubject<EventoCard[]>([]);
  
  // BehaviorSubject che conserva lo stato calcolato ed elaborato, partendo da uno stato vuoto.
  private _state$ = new BehaviorSubject<StatoEventoAttivo>(this.empty());

  // Segnale Angular reattivo con stato iniziale vuoto .
  private _stateSig = signal<StatoEventoAttivo>(this.empty());
  
  // Espone pubblicamente il Segnale in sola lettura. La UI lo leggerà, ma non potrà modificarlo direttamente.
  readonly segnaleStato: Signal<StatoEventoAttivo> = this._stateSig.asReadonly();

  // Contenitore di sottoscrizioni RxJS. Aggruppa le iscrizioni per poterle cancellare tutte assieme.
  private subs = new Subscription();
  // Tiene traccia in modo specifico della sottoscrizione per il timer dei secondi (countdown).
  private ticker?: Subscription;

  constructor(private http: HttpClient) {
    // All'avvio, esegue subito una prima chiamata per scaricare gli eventi e la salva in 'subs'.
    this.subs.add(this.fetch().subscribe());
    
    // Avvia il polling: ogni 30s esegue fetch(). Se una chiamata precedente è ancora in corso, switchMap la annulla.
    this.subs.add(interval(POLLING_MS).pipe(switchMap(() => this.fetch())).subscribe());
    
    // Avvia il timer che scatta ogni singolo secondo per aggiornare i countdown.
    this.ticker = interval(TICK_MS).subscribe(() => {
      // Legge lo stato attivo prima dell'aggiornamento.
      const prev = this._state$.getValue();
      
      // Ricalcola lo stato basandosi sull'elenco di eventi attuale e sull'orario corrente.
      this.push(this._events$.getValue());
      
      // Contrasto di fine tempo: se un secondo fa c'era tempo (>0) e ora è scaduto (<=0),
      // forza immediatamente un aggiornamento dal server chiamando refresh().
      if (prev.secondsToNext > 0 && this._state$.getValue().secondsToNext <= 0) this.refresh();
    });
  }

  // Invocato alla chiusura/distruzione del servizio. 
  // Cancella tutte le sottoscrizioni ai timer
  ngOnDestroy() { this.subs.unsubscribe(); this.ticker?.unsubscribe(); }

  // Metodo pubblico che i componenti possono chiamare per forzare il download dei dati.
  refresh() { this.subs.add(this.fetch().subscribe()); }

  // aggiorna la UI istantaneamente prima della risposta server.
  decrementShot() {
    const cur = this._state$.getValue();
    // Interrompe se non c'è un evento attivo o lo stato non è 'in_corso'.
    if (!cur.evento || cur.evento.stato !== 'in_corso') return;
    
    // Crea una copia dell'evento aumentando di 1 il contatore degli scatti usati in locale.
    const updated = { ...cur.evento, scatti_usati: cur.evento.scatti_usati + 1 };
    
    // Sostituisce l'evento modificato all'interno dell'array di tutti gli eventi memorizzati.
    const events = this._events$.getValue().map(e => e.id_evento === updated.id_evento ? updated : e);
    
    // Emette il nuovo array e ricalcola lo stato per aggiornare la UI all'istante.
    this._events$.next(events);
    this.push(events);
  }

  // GESTIONE DELLA CHIAMATA API
  private fetch() {
    return this.http.get<{ events: EventoCard[] }>(`${environment.apiUrl}/api/eventi/miei`).pipe(
      // Se la chiamata fallisce (es. rete assente), intercetta l'errore e restituisce l'ultimo elenco 
      // di eventi valido già in memoria, per evitare che l'app vada in crash.
      catchError(() => of({ events: this._events$.getValue() })),
      switchMap(res => { 
        // Aggiorna lo stream degli eventi grezzi.
        this._events$.next(res.events); 
        // Ricalcola lo stato attivo.
        this.push(res.events); 
        // Restituisce la risposta a chi ha chiamato subscribe.
        return of(res); 
      })
    );
  }

  // LOGICA DI BUSINESS E CALCOLO DELLE PRIORITÀ
  private derive(events: EventoCard[]): StatoEventoAttivo {
    const now = Date.now(); // Prende il timestamp attuale
    
    // Cerca la presenza di eventi nei vari stati previsti
    const inCorso = events.find(e => e.stato === 'in_corso');
    const albumAperto = events.find(e => e.stato === 'album_aperto');
    const sviluppo = events.find(e => e.stato === 'sviluppo');
    const chiusa = events.find(e => e.stato === 'chiusa');
    
    // Trova l'evento da usare per mostrare la galleria foto (dà priorità ad album_aperto, altrimenti chiusa).
    const galleryEvento = albumAperto ?? chiusa ?? null;

    // Se c'è un evento "in_corso"
    if (inCorso) {
      const rem = inCorso.scatti_per_utente - inCorso.scatti_usati; // Calcola scatti rimanenti
      const activeEnd = isoToMs(inCorso.data_inizio) + inCorso.durata_minuti * MS_PER_MINUTO;
      return {
        evento: inCorso, galleryEvento, 
        showCamera: rem > 0, // Mostra la fotocamera solo se ci sono ancora scatti
        showGallery: !!galleryEvento, scattiRimanenti: rem,
        secondsToNext: Math.max(0, Math.floor((activeEnd - now) / 1000)), // Tempo rimanente in secondi
        countdownLabel: 'Fine acquisizione'
      };
    }
    
    // Se c'è un evento in "sviluppo"
    if (sviluppo) {
      const devEnd = isoToMs(sviluppo.album_sbloccato_at);
      return {
        evento: sviluppo, galleryEvento, showCamera: false, showGallery: !!galleryEvento, scattiRimanenti: 0,
        secondsToNext: Math.max(0, Math.floor((devEnd - now) / 1000)), countdownLabel: 'Sblocco galleria'
      };
    }
    
    // Se c'è un "album_aperto"
    if (albumAperto) {
      const voteEnd = albumAperto.voting_end_at ? isoToMs(albumAperto.voting_end_at) : now;
      return {
        evento: albumAperto, galleryEvento, showCamera: false, showGallery: true, scattiRimanenti: 0,
        secondsToNext: Math.max(0, Math.floor((voteEnd - now) / 1000)), countdownLabel: 'Fine votazione'
      };
    }
    
    // PSe c'è un evento "chiusa"
    if (chiusa) return { evento: chiusa, galleryEvento, showCamera: false, showGallery: true, scattiRimanenti: 0, secondsToNext: 0, countdownLabel: '' };
    
    // Se non ricade in nessuna delle casistiche precedenti, restituisce lo stato vuoto di default.
    return this.empty();
  }

  // PONTE REATTIVO
  private push(events: EventoCard[]) {
    const d = this.derive(events);
    // Aggiorna simultaneamente sia il BehaviorSubject (ecosistema RxJS) che il Segnale (ecosistema Angular Signals).
    this._state$.next(d);
    this._stateSig.set(d);
  }

  // STATO DI DEFAULT
  private empty(): StatoEventoAttivo {
    // Restituisce un oggetto azzerato usato all'avvio o come fallback quando non ci sono eventi per l'utente.
    return { evento: null, galleryEvento: null, showCamera: false, showGallery: false, scattiRimanenti: 0, secondsToNext: 0, countdownLabel: '' };
  }
}