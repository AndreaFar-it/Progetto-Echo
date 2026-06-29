// --- CONFIGURAZIONE LOGICA DI SVILUPPO (DEV MODE) ---

// Se attivo, riduce i tempi lunghi a pochi minuti per testare rapidamente il ciclo di vita.
export const MODALITA_SVILUPPO = process.env['DEVELOPMENT_MODE'] === 'true';

// Durata standard (in minuti) delle fasi di votazione e fine evento in modalità rapida.
export const MINUTI_MODALITA_RAPIDA = 3;

// Durata della fase di sviluppo foto in dev (0 = sblocco istantaneo dell'album).
export const MINUTI_SVILUPPO_DEV = 0;

// Ritardo reale (24 ore) o accelerato per la fase di sviluppo foto.
export const MINUTI_RITARDO_SVILUPPO = MODALITA_SVILUPPO ? MINUTI_SVILUPPO_DEV : 1440;


// --- GESTIONE DELLE TEMPISTICHE E DEI PROMPT ---

// Minuti aggiuntivi concessi se l'organizzatore accetta l'estensione dell'evento.
export const MINUTI_ESTENSIONE = 120;

// Anticipo (in minuti) con cui inviare il prompt di estensione prima della fine reale.
export const MINUTI_ANTICIPO_PROMPT = 10;

// Anticipo ridotto a 1 minuto per i test rapidi in modalità sviluppo.
export const MINUTI_ANTICIPO_PROMPT_DEV = 1;


// --- FUNZIONI DI CALCOLO DEI TIMEOUT ---

/**
 * Ritorna la durata della finestra di votazione.
 * Forza 3 minuti se in modalità rapida, altrimenti converte le ore impostate in minuti.
 */
export function calcolaMinutiVotazione(durataVotazioneOre: number, modalitaRapidaEvento = false): number {
  return (MODALITA_SVILUPPO || modalitaRapidaEvento) ? MINUTI_MODALITA_RAPIDA : durataVotazioneOre * 60;
}

/**
 * Ritorna il tempo di attesa per lo sviluppo delle foto.
 * Forza i minuti di dev (0) se in modalità rapida, altrimenti usa il valore standard.
 */
export function calcolaMinutiSviluppo(modalitaRapidaEvento = false): number {
  return (MODALITA_SVILUPPO || modalitaRapidaEvento) ? MINUTI_SVILUPPO_DEV : MINUTI_RITARDO_SVILUPPO;
}

/**
 * Calcola quanti minuti dura l'evento prima di considerare concluso il caricamento.
 * Forza 3 minuti se in modalità rapida, altrimenti usa la durata scelta dall'organizzatore.
 */
export function calcolaOffsetFineEvento(durataMinuti: number, modalitaRapidaEvento = false): number {
  return (MODALITA_SVILUPPO || modalitaRapidaEvento) ? MINUTI_MODALITA_RAPIDA : durataMinuti;
}


// --- VERIFICA STATO DI AVVIO ---

// Stampa di controllo per verificare la corretta lettura delle variabili d'ambiente.
console.log(
  `[Config] Valore grezzo DEVELOPMENT_MODE = ${JSON.stringify(process.env['DEVELOPMENT_MODE'])} ` +
  `→ MODALITA_SVILUPPO=${MODALITA_SVILUPPO} | offset fine evento / ritardo sviluppo / finestra voto = ` +
  `${MODALITA_SVILUPPO ? `${MINUTI_MODALITA_RAPIDA} min fissi (override attivo)` : 'durate reali (durata_minuti organizzatore / 24h / durata_votazione organizzatore)'}`
);