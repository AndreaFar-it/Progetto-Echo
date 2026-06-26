// ── evento.model.ts ──────────────────────────────────────────────────────────
export type EventoStato = 'non_iniziata' | 'in_corso' | 'sviluppo' | 'album_aperto' | 'chiusa';

export interface EventoCard {
  id_evento: string; id_organizzatore: string; nome: string; luogo: string;
  data_inizio: string; durata_minuti: number; data_fine_calc: string;
  max_partecipanti: number; scatti_per_utente: number; durata_votazione: number;
  stato: EventoStato; album_sbloccato_at: string | null;
  scatti_usati: number; ha_votato: 0|1; is_organiser: 0|1;
}

export interface StatoEventoAttivo {
  evento: EventoCard | null;
  showCamera: boolean; showGallery: boolean;
  scattiRimanenti: number; secondsToNext: number; countdownLabel: string;
}

// ── foto.model.ts ─────────────────────────────────────────────────────────────
export interface FotoGalleria {
  id_foto: string; url_originale: string; punteggio_voti: number;
  timestamp_scatto: string; id_autore: string; nome: string; cognome: string;
  foto_profilo_url: string | null; is_own_photo: boolean; user_has_voted_this: boolean;
}

export interface ConfermaCaricamento {
  message: string; scatti_usati: number; scatti_totali: number;
  esauriti: boolean; redirect?: string;
}

// ── utente.model.ts ───────────────────────────────────────────────────────────
export interface EchoUser { id_utente: string; nome: string; cognome: string; email: string; }

export interface Badge { id_badge: string; tipo: 'oro'|'argento'|'bronzo'; etichetta: string; data_emissione: string; }

export interface ProfiloResponse {
  utente: { nome:string; cognome:string; foto_profilo_url:string|null; data_registrazione:string; scatti_totali:number; voti_ricevuti:number };
  eventi_count: number; badge: Badge[];
  archivio: { id_evento:string; nome:string; data_inizio:string; stato:string }[];
}

// ── analytics.model.ts ────────────────────────────────────────────────────────
export interface AnalyticsData {
  partecipanti: { totale:number; con_scatti:number };
  foto:         { totale:number; media:number; rimanenti:number };
  voti:         { totale_voti:number };
  classifica:   { nome:string; cognome:string; foto_profilo_url:string|null; id_foto:string; url_originale:string; punteggio_voti:number }[];
}

export interface RankEntry {
  posizione: 1|2|3; nome:string; cognome:string;
  foto_profilo_url:string|null; url_originale:string;
  punteggio_voti:number; badge:'oro'|'argento'|'bronzo';
}
