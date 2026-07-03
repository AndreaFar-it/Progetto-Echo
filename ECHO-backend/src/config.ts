//CONFIGURAZIONE LOGICA

// Se attivo, riduce i tempi lunghi a pochi minuti per testare rapidamente il ciclo di vita.
export const MODALITA_SVILUPPO = process.env['DEVELOPMENT_MODE'] === 'true'; // Presumibilmente codice morto (process.env)

// Durata standard (in minuti) delle fasi di votazione e fine evento in modalità rapida.
export const MINUTI_MODALITA_DEV = 3;

// Durata della fase di sviluppo foto in dev (0 = sblocco istantaneo dell'album).
export const MINUTI_SVILUPPO_DEV = 0;

// Ritardo reale (24 ore) o accelerato per la fase di sviluppo foto.
export const MINUTI_RITARDO_SVILUPPO = MODALITA_SVILUPPO ? MINUTI_SVILUPPO_DEV : 1440; // Presumibilmente codice morto (o errato nel file Server)

// Costante per convertire minuti in millisecondi (1 minuto = 60.000 ms)
export const TRASFORMA_IN_MINUTI = 60_000; 
export const TIMEOUT_OTP = 15 * TRASFORMA_IN_MINUTI; // 15 minuti in millisecondi


// Estensione dell'evento

// Minuti aggiuntivi concessi se l'organizzatore accetta l'estensione dell'evento.
export const MINUTI_ESTENSIONE = 120;

// Anticipo (in minuti) con cui inviare il prompt di estensione prima della fine reale.
export const NOTIFICA_ESTENSIONE = 10;

// Anticipo ridotto a 1 minuto per i test rapidi in modalità sviluppo.
export const NOTIFICA_ESTENSIONE_DEV = 1;

// Timeout per la risposta dell'organizzatore al prompt di estensione (in minuti)
export const MINUTI_TIMEOUT_RISPOSTA_ESTENSIONE = 5;


// --- FUNZIONI DI CALCOLO DEI TIMEOUT ---

// Calcola quanti minuti dura la fase di votazione prima di considerarla conclusa.
export function calcolaMinutiVotazione(durataVotazioneOre: number, modalitaRapidaEvento = false): number {
  return (MODALITA_SVILUPPO || modalitaRapidaEvento) ? MINUTI_MODALITA_DEV : durataVotazioneOre * 60;
}

// Calcola quanti minuti dura la fase di sviluppo foto prima di considerarla conclusa.
export function calcolaMinutiSviluppo(modalitaRapidaEvento = false): number {
  return (MODALITA_SVILUPPO || modalitaRapidaEvento) ? MINUTI_SVILUPPO_DEV : MINUTI_RITARDO_SVILUPPO;
}

// Calcola quanti minuti dura la fase di fine evento prima di considerarla conclusa.
export function calcolaOffsetFineEvento(durataMinuti: number, modalitaRapidaEvento = false): number {
  return (MODALITA_SVILUPPO || modalitaRapidaEvento) ? MINUTI_MODALITA_DEV : durataMinuti;
}