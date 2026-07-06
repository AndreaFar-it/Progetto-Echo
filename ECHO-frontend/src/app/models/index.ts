export type EventoStato = 'non_iniziata' | 'in_corso' | 'sviluppo' | 'album_aperto' | 'chiusa';

export interface EventoCard {
  id_evento: string; id_organizzatore: string; nome: string; luogo: string;
  data_inizio: string; durata_minuti: number; data_fine_calc: string;
  max_partecipanti: number; scatti_per_utente: number; durata_votazione_ore: number;
  stato: EventoStato; album_sbloccato_at: string | null;
  /** Miglior stima corrente di quando si sblocca la galleria — sviluppo_started_at (o, prima
   *  che sia impostato, data_fine_calc) più il ritardo di sviluppo attivo del server. Sempre un
   *  valore fresco e live: riflette DEVELOPMENT_MODE e ogni trigger di esaurimento anticipato. */
  album_unlock_at: string;
  /** album_sbloccato_at + la durata di votazione attiva del server (normalmente la
   *  durata_votazione_ore reale dell'organizzatore, forzata a 3min in dev_mode). null finché
   *  l'album non si sblocca davvero. */
  voting_end_at: string | null;
  scatti_usati: number; ha_votato: 0 | 1; is_organiser: 0 | 1;
  /** Il codice di accesso a 5 cifre, incluso per ogni evento che questo utente può vedere — esposto
   *  nella UI solo per gli eventi propri dell'organizzatore ("Mostra codice"). */
  codice: string;
  /** True solo per l'organizzatore, una sola volta, mentre un prompt "vuoi estendere l'evento di 2
   *  ore?" (inviato ~10min prima di data_fine_calc) attende la sua decisione. */
  needs_estensione_response: boolean;
  /** True solo per i partecipanti non organizzatori, solo una volta che l'organizzatore ha accettato
   *  l'estensione e questo partecipante non ha ancora risposto a "vuoi rimanere?". */
  needs_permanenza_response: boolean;
  /** 1 se l'organizzatore ha accettato l'estensione, 0 se rifiutata, null se nessun prompt ancora. */
  estensione_accettata: 0 | 1 | null;
}

export interface StatoEventoAttivo {
  evento: EventoCard | null;
  /** Risolto indipendentemente da `evento` — l'evento fotocamera/in corso e l'evento con
   *  galleria pronta possono essere due eventi diversi quando un utente ha più di un evento
   *  rilevante contemporaneamente (es. ne organizza uno mentre un altro si è appena chiuso). */
  galleryEvento: EventoCard | null;
  showCamera: boolean; showGallery: boolean;
  scattiRimanenti: number; secondsToNext: number; countdownLabel: string;
}

export interface FotoGalleria {
  id_foto: string; url_originale: string; punteggio_voti: number;
  timestamp_scatto: string; id_autore: string; nome: string; cognome: string;
  foto_profilo_url: string | null; is_own_photo: boolean; user_has_voted_this: boolean;
}

export interface GalleriaResponse {
  foto: FotoGalleria[]; ha_votato: boolean; stato: EventoStato;
  album_sbloccato_at: string; durata_votazione_ore: number; voting_end_at: string | null;
  /** Top 3 per voti — popolato solo quando stato === 'chiusa', vuoto altrimenti così il
   *  risultato non può essere svelato mentre la votazione è ancora aperta. */
  classifica: { nome: string; cognome: string; foto_profilo_url: string | null; id_foto: string; url_originale: string; punteggio_voti: number }[];
}

export interface ConfermaCaricamento {
  message: string; scatti_usati: number; scatti_totali: number;
  esauriti: boolean; redirect?: string;
}

export interface Badge { id_badge: string; tipo: 'oro' | 'argento' | 'bronzo'; etichetta: string; data_emissione: string; }

export interface ProfiloResponse {
  utente: { nome: string; cognome: string; foto_profilo_url: string | null; data_registrazione: string; scatti_totali: number; voti_ricevuti: number };
  eventi_count: number; badge: Badge[];
  archivio: { id_evento: string; nome: string; data_inizio: string; stato: string }[];
}

export interface AnalyticsData {
  stato: EventoStato;
  max_partecipanti: number;
  scatti_per_utente: number;
  codice: string;
  partecipanti: { totale: number; con_scatti: number };
  foto: { totale: number; media: number; rimanenti: number };
  voti: { totale_voti: number };
  classifica: { nome: string; cognome: string; foto_profilo_url: string | null; id_foto: string; url_originale: string; punteggio_voti: number }[];
}

export interface RankEntry {
  posizione: 1 | 2 | 3; nome: string; cognome: string;
  foto_profilo_url: string | null; url_originale: string;
  punteggio_voti: number; badge: 'oro' | 'argento' | 'bronzo';
}
