/**
 * ECHO — Configurazione Runtime
 *
 * La costante MODALITA_SVILUPPO riduce ogni attesa normalmente lunga a 3 minuti,
 * utile per i test rapidi del ciclo di vita degli eventi:
 *   - la durata dell'evento (impostata dall'organizzatore tramite durata_minuti) viene ignorata
 *   - il ritardo di 24h nella fase "sviluppo → album_aperto" diventa 3 minuti
 *   - la finestra di votazione (12-72h) configurata dall'organizzatore diventa 3 minuti
 *
 * Si applica SOLO al backend avviato con la variabile d'ambiente DEVELOPMENT_MODE=true
 * (backend locale, file .env). Il backend di produzione su Render non imposta mai questa
 * variabile, quindi gli utenti reali ricevono sempre eventi a durata piena.
 *
 * Viene letto una sola volta al caricamento del modulo (dopo dotenv/config in server.ts)
 * e condiviso dai job cron, dal controllo scadenza voti e dall'endpoint /health,
 * così tutti i componenti concordano sulle stesse tempistiche attive.
 */
export const MODALITA_SVILUPPO = process.env['DEVELOPMENT_MODE'] === 'true';

/** Minuti usati per le fasi VOTAZIONE e FINE EVENTO quando MODALITA_SVILUPPO è attiva. */
export const MINUTI_MODALITA_RAPIDA = 3;

/** DEBUG: minuti della sola fase di SVILUPPO foto in MODALITA_SVILUPPO.
 *  Impostato a 0 per aprire l'album all'istante; votazione/fine evento restano a
 *  MINUTI_MODALITA_RAPIDA (3 min). Riportare a 3 (o usare MINUTI_MODALITA_RAPIDA)
 *  dopo i test. */
export const MINUTI_SVILUPPO_DEV = 0;

/** Minuti di attesa della fase di sviluppo foto (sviluppo → album_aperto).
 *  Normalmente 1440 minuti (24 ore); MINUTI_SVILUPPO_DEV (0) in MODALITA_SVILUPPO.
 *  Usa lo STESSO valore di calcolaMinutiSviluppo() così l'album_unlock_at mostrato
 *  dal frontend (eventi.routes.ts) coincide con lo sblocco reale del cron. */
export const MINUTI_RITARDO_SVILUPPO = MODALITA_SVILUPPO ? MINUTI_SVILUPPO_DEV : 1440;

/** Minuti di estensione concessi all'evento quando l'organizzatore accetta il prompt "vuoi estendere?". */
export const MINUTI_ESTENSIONE = 120;

/** Quanti minuti prima di data_fine_calc viene inviato all'organizzatore il prompt di estensione
 *  (gestito dal cron T1b in cron/jobs.ts). */
export const MINUTI_ANTICIPO_PROMPT = 10;

/** Soglia anticipata del prompt di estensione per eventi in dev_mode (3 min totali).
 *  1 minuto: lascia al creator il tempo di rispondere senza scattare all'avvio. */
export const MINUTI_ANTICIPO_PROMPT_DEV = 1;

/**
 * Calcola la durata effettiva della finestra di votazione in minuti.
 * In MODALITA_SVILUPPO (globale o per singolo evento) ritorna MINUTI_MODALITA_RAPIDA,
 * ignorando la durata configurata dall'organizzatore (12-72h).
 */
export function calcolaMinutiVotazione(durataVotazioneOre: number, modalitaRapidaEvento = false): number {
  return (MODALITA_SVILUPPO || modalitaRapidaEvento) ? MINUTI_MODALITA_RAPIDA : durataVotazioneOre * 60;
}

/**
 * Calcola il ritardo effettivo della fase di sviluppo foto in minuti.
 * In MODALITA_SVILUPPO ritorna MINUTI_SVILUPPO_DEV (0 = album istantaneo, override
 * di debug) invece di 24 ore (1440 minuti). NB: a differenza di votazione/fine evento,
 * questa fase NON usa MINUTI_MODALITA_RAPIDA.
 */
export function calcolaMinutiSviluppo(modalitaRapidaEvento = false): number {
  return (MODALITA_SVILUPPO || modalitaRapidaEvento) ? MINUTI_SVILUPPO_DEV : MINUTI_RITARDO_SVILUPPO;
}

/**
 * Calcola l'offset in minuti da aggiungere all'orario di inizio per ottenere data_fine_calc.
 * In MODALITA_SVILUPPO vale 3 minuti flat; altrimenti corrisponde esattamente alla durata
 * impostata dall'organizzatore (durata_minuti), senza margini automatici aggiuntivi.
 *
 * Nota storica: il vecchio codice aggiungeva sempre +120min "per allineamento backend",
 * il che causava falsi conflitti temporali nella funzione verificaConflittoTemporale
 * (eventi.routes.ts). Ora quei 120min sono opzionali e attivabili solo tramite il
 * prompt "vuoi estendere?" (cron T1b → MINUTI_ESTENSIONE).
 */
export function calcolaOffsetFineEvento(durataMinuti: number, modalitaRapidaEvento = false): number {
  return (MODALITA_SVILUPPO || modalitaRapidaEvento) ? MINUTI_MODALITA_RAPIDA : durataMinuti;
}

// Conferma visibile a schermo del valore letto all'avvio — utile per verificare che la variabile
// d'ambiente sia stata correttamente trasmessa al processo (errore comune: start-dev.ps1 apre
// una nuova finestra PowerShell che NON eredita $env:DEVELOPMENT_MODE impostata nella sessione).
console.log(
  `[Config] Valore grezzo DEVELOPMENT_MODE = ${JSON.stringify(process.env['DEVELOPMENT_MODE'])} ` +
  `→ MODALITA_SVILUPPO=${MODALITA_SVILUPPO} | offset fine evento / ritardo sviluppo / finestra voto = ` +
  `${MODALITA_SVILUPPO ? `${MINUTI_MODALITA_RAPIDA} min fissi (override attivo)` : 'durate reali (durata_minuti organizzatore / 24h / durata_votazione organizzatore)'}`
);
