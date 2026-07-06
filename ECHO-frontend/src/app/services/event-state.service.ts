import { Injectable, OnDestroy, signal, computed, Signal } from '@angular/core';
import { BehaviorSubject, Subscription, interval, switchMap, catchError, of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { EventoCard, StatoEventoAttivo } from '../models/index';

export type { EventoCard, StatoEventoAttivo };

@Injectable({ providedIn: 'root' })
export class ServizioStatoEvento implements OnDestroy {
  private _events$ = new BehaviorSubject<EventoCard[]>([]);
  readonly events$ = this._events$.asObservable();
  private _state$  = new BehaviorSubject<StatoEventoAttivo>(this.empty());
  readonly state$  = this._state$.asObservable();

  private _stateSig = signal<StatoEventoAttivo>(this.empty());
  readonly segnaleStato: Signal<StatoEventoAttivo> = this._stateSig.asReadonly();
  readonly scattiRimanenti = computed(() => this._stateSig().scattiRimanenti);
  readonly showCamera      = computed(() => this._stateSig().showCamera);
  readonly showGallery     = computed(() => this._stateSig().showGallery);

  private subs   = new Subscription();
  private ticker?: Subscription;

  constructor(private http: HttpClient) {
    this.subs.add(this.fetch().subscribe());
    this.subs.add(interval(30_000).pipe(switchMap(() => this.fetch())).subscribe());
    this.ticker = interval(1000).subscribe(() => {
      const prev = this._state$.getValue();
      this.push(this._events$.getValue());
      if (prev.secondsToNext > 0 && this._state$.getValue().secondsToNext <= 0) this.refresh();
    });
  }

  ngOnDestroy() { this.subs.unsubscribe(); this.ticker?.unsubscribe(); }

  refresh() { this.subs.add(this.fetch().subscribe()); }

  decrementShot() {
    const cur = this._state$.getValue();
    if (!cur.evento || cur.evento.stato !== 'in_corso') return;
    const updated = { ...cur.evento, scatti_usati: cur.evento.scatti_usati + 1 };
    const events  = this._events$.getValue().map(e => e.id_evento === updated.id_evento ? updated : e);
    this._events$.next(events); this.push(events);
  }

  private fetch() {
    return this.http.get<{ events: EventoCard[] }>(`${environment.apiUrl}/api/eventi/miei`).pipe(
      catchError(() => of({ events: this._events$.getValue() })),
      switchMap(res => { this._events$.next(res.events); this.push(res.events); return of(res); })
    );
  }

  private derive(events: EventoCard[]): StatoEventoAttivo {
    const now = Date.now();
    const inCorso     = events.find(e => e.stato === 'in_corso');
    const albumAperto = events.find(e => e.stato === 'album_aperto');
    const sviluppo    = events.find(e => e.stato === 'sviluppo');
    const chiusa      = events.find(e => e.stato === 'chiusa');

    // Risolto indipendentemente dall'evento fotocamera/in corso sotto: un utente può star
    // scattando per un evento mentre la galleria di un evento completamente diverso è pronta,
    // e la tab Galleria deve riflettere QUELL'evento, non quello che vince la gara di priorità
    // della fotocamera (prima condividevano un unico puntatore e la tab restava disabilitata
    // ogni volta che esisteva un evento non correlato a priorità più alta).
    const galleryEvento = albumAperto ?? chiusa ?? null;

    if (inCorso) {
      const rem = inCorso.scatti_per_utente - inCorso.scatti_usati;
      // "Attivamente in corso" termina a data_inizio + durata_minuti — il margine backend di
      // +120min (data_fine_calc) è un buffer di pianificazione interno e non deve trapelare in
      // ciò che viene comunicato all'utente sulla finestra di acquisizione live.
      const activeEnd = new Date(inCorso.data_inizio).getTime() + inCorso.durata_minuti * TRASFORMA_IN_MINUTI;
      return { evento: inCorso, galleryEvento, showCamera: rem > 0, showGallery: !!galleryEvento, scattiRimanenti: rem,
        secondsToNext: Math.max(0, Math.floor((activeEnd - now) / 1000)),
        countdownLabel: 'Fine acquisizione' };
    }
    if (sviluppo) {
      // album_unlock_at è calcolato lato server da sviluppo_started_at (il momento reale in
      // cui è iniziato lo sviluppo, sia puntuale sia via trigger di esaurimento anticipato) più
      // il ritardo di sviluppo attivo del server — riflette automaticamente DEVELOPMENT_MODE.
      const devEnd = new Date(sviluppo.album_unlock_at).getTime();
      return { evento: sviluppo, galleryEvento, showCamera: false, showGallery: !!galleryEvento, scattiRimanenti: 0,
        secondsToNext: Math.max(0, Math.floor((devEnd - now) / 1000)), countdownLabel: 'Sblocco galleria' };
    }
    if (albumAperto) {
      // voting_end_at è calcolato lato server da album_sbloccato_at più la durata di votazione
      // attiva del server — normalmente la durata_votazione_ore reale dell'organizzatore, forzata
      // a 3min in dev_mode. Ricade su "ora" solo nella breve finestra prima che
      // album_sbloccato_at/voting_end_at siano popolati.
      const voteEnd = albumAperto.voting_end_at ? new Date(albumAperto.voting_end_at).getTime() : now;
      return { evento: albumAperto, galleryEvento, showCamera: false, showGallery: true, scattiRimanenti: 0,
        secondsToNext: Math.max(0, Math.floor((voteEnd - now) / 1000)), countdownLabel: 'Fine votazione' };
    }
    if (chiusa) return { evento: chiusa, galleryEvento, showCamera: false, showGallery: true, scattiRimanenti: 0, secondsToNext: 0, countdownLabel: '' };
    return this.empty();
  }

  private push(events: EventoCard[]) {
    const d = this.derive(events);
    this._state$.next(d); this._stateSig.set(d);
  }

  private empty(): StatoEventoAttivo {
    return { evento: null, galleryEvento: null, showCamera: false, showGallery: false, scattiRimanenti: 0, secondsToNext: 0, countdownLabel: '' };
  }
}
