//CONFIGURAZIONE LOGICA

// Esponente del numero di giri di hashing bcrypt. Più alto è il numero, più sicuro è l'hash,
// ma più tempo richiede la generazione e la verifica. 12 è un buon compromesso sicurezza/prestazioni.
export const GIRI_BCRYPT = 12;

// Limite di dimensione per i file caricati (foto evento e foto profilo).
// Per cambiarlo basta modificare LIMITE_UPLOAD_MB: il valore in byte si aggiorna da solo.
export const LIMITE_UPLOAD_MB = 15;
export const LIMITE_UPLOAD_BYTE = LIMITE_UPLOAD_MB * 1024 * 1024;

// Durata standard (in minuti) delle fasi di votazione e fine evento per un evento in modalità rapida (dev_mode).
export const MINUTI_MODALITA_DEV = 3;

// Durata della fase di sviluppo foto per un evento in modalità rapida (0 = sblocco istantaneo dell'album).
export const MINUTI_SVILUPPO_DEV = 0;

// Ritardo reale (24 ore) per la fase di sviluppo foto di un evento normale.
export const MINUTI_RITARDO_SVILUPPO = 1440;

// Costante di conversione minuti -> millisecondi (1 minuto = 60.000 ms), per le API native (setInterval/setTimeout).
export const MS_PER_MINUTO = 60_000;

// Validità del codice OTP per il reset password (in minuti).
export const MINUTI_TIMEOUT_OTP = 15;


// Estensione dell'evento

// Minuti aggiuntivi concessi se l'organizzatore accetta l'estensione dell'evento.
export const MINUTI_ESTENSIONE = 120;

// Anticipo (in minuti) con cui inviare il prompt di estensione prima della fine reale.
export const NOTIFICA_ESTENSIONE = 10;

// Anticipo ridotto a 1 minuto per un evento in modalità rapida (dev_mode).
export const NOTIFICA_ESTENSIONE_DEV = 1;

// Timeout per la risposta dell'organizzatore al prompt di estensione (in minuti)
export const MINUTI_TIMEOUT_RISPOSTA_ESTENSIONE = 5;


// --- FUNZIONI DI CALCOLO DEI TIMEOUT ---

// Calcola quanti minuti dura la fase di votazione prima di considerarla conclusa.
export function calcolaMinutiVotazione(durataVotazioneOre: number, modalitaRapidaEvento = false): number {
  return modalitaRapidaEvento ? MINUTI_MODALITA_DEV : durataVotazioneOre * 60;
}

// Calcola quanti minuti dura la fase di sviluppo foto prima di considerarla conclusa.
export function calcolaMinutiSviluppo(modalitaRapidaEvento = false): number {
  return modalitaRapidaEvento ? MINUTI_SVILUPPO_DEV : MINUTI_RITARDO_SVILUPPO;
}

// Calcola quanti minuti dura la fase di fine evento prima di considerarla conclusa.
export function calcolaOffsetFineEvento(durataMinuti: number, modalitaRapidaEvento = false): number {
  return modalitaRapidaEvento ? MINUTI_MODALITA_DEV : durataMinuti;
}