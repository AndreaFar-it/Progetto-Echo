import cron from 'node-cron';
import { all } from '../db/database';
import { nowNaive } from '../utils/time';
import {
  avviaEvento, avviaSviluppoFoto, sbloccaAlbum, chiudiEventoEAssegnaBadge,
  richiestaEstensione, rifiutoAutomaticoEstensione,
} from '../services/eventLifecycle.service';
import {
  MODALITA_SVILUPPO,
  calcolaMinutiVotazione,
  calcolaMinutiSviluppo,
  MINUTI_ANTICIPO_PROMPT,
  MINUTI_ANTICIPO_PROMPT_DEV,
} from '../config';

/** Minuti di attesa massima per la risposta al prompt di estensione prima che venga
 *  auto-rifiutato dal cron T1c, evitando che il cron T2 rimanga bloccato indefinitamente. */
const MINUTI_TIMEOUT_RISPOSTA_ESTENSIONE = 5;

/**
 * Inizializza i 6 worker cron per la gestione del ciclo di vita degli eventi.
 * Ogni worker viene eseguito ogni minuto e gestisce una specifica transizione di stato.
 *
 * Macchina a stati:
 *   non_iniziata → [T1] → in_corso → [T1b prompt, T1c auto-decline] → [T2] → sviluppo
 *   → [T3] → album_aperto → [T4] → chiusa
 */
export function avviaJobPeriodici(): void {
  console.log('[Cron] Avvio 6 worker del ciclo di vita eventi…');

  /**
   * T1 — non_iniziata → in_corso
   * Fa partire tutti gli eventi la cui data_inizio è passata.
   */
  cron.schedule('* * * * *', async () => {
    const adesso = nowNaive();
    for (const e of all<{ id_evento:string }>(
      "SELECT id_evento FROM EVENTO WHERE stato='non_iniziata' AND data_inizio<=?", [adesso]
    ))
      await avviaEvento(e.id_evento).catch(err => console.error('[Cron T1]', err));
  });

  /**
   * T1b — Prompt di estensione
   * Invia all'organizzatore la domanda "vuoi estendere l'evento di 2 ore?"
   * quando mancano MINUTI_ANTICIPO_PROMPT minuti dalla fine dell'evento (eventi normali)
   * oppure MINUTI_ANTICIPO_PROMPT_DEV minuti (eventi dev_mode, durata 3 min).
   * Usare soglie diverse evita che il prompt scatti immediatamente all'avvio per eventi
   * la cui durata totale è inferiore alla finestra di anticipo (3 min < 10 min).
   */
  cron.schedule('* * * * *', async () => {
    const righe = all<{ id_evento: string; data_fine_calc: string; dev_mode: number }>(
      `SELECT id_evento, data_fine_calc, dev_mode FROM EVENTO
       WHERE stato='in_corso' AND estensione_richiesta=0`
    );
    const adesso = Date.now();
    for (const r of righe) {
      const anticipoMs = r.dev_mode === 1
        ? MINUTI_ANTICIPO_PROMPT_DEV * 60_000
        : MINUTI_ANTICIPO_PROMPT * 60_000;
      const millisecondiRimanenti = new Date(r.data_fine_calc).getTime() - adesso;
      if (millisecondiRimanenti > 0 && millisecondiRimanenti <= anticipoMs)
        await richiestaEstensione(r.id_evento).catch(err => console.error('[Cron T1b]', err));
    }
  });

  /**
   * T1c — Auto-rifiuto estensione non risposta
   * Se l'organizzatore non risponde entro MINUTI_TIMEOUT_RISPOSTA_ESTENSIONE,
   * il prompt viene auto-rifiutato per non bloccare il cron T2 indefinitamente.
   */
  cron.schedule('* * * * *', async () => {
    const righe = all<{ id_evento: string; estensione_richiesta_at: string; dev_mode: number }>(
      "SELECT id_evento, estensione_richiesta_at, dev_mode FROM EVENTO WHERE stato='in_corso' AND estensione_richiesta=1 AND estensione_accettata IS NULL"
    );
    const adesso = Date.now();
    for (const r of righe) {
      const millisecondiTrascorsi = adesso - new Date(r.estensione_richiesta_at).getTime();
      // In dev_mode il timeout è 1 minuto (allineato con MINUTI_ANTICIPO_PROMPT_DEV): dà al
      // creator il tempo di rispondere prima della fine evento senza bloccare T2 a lungo.
      const timeoutMs = r.dev_mode === 1 ? 60_000 : MINUTI_TIMEOUT_RISPOSTA_ESTENSIONE * 60_000;
      if (millisecondiTrascorsi >= timeoutMs)
        await rifiutoAutomaticoEstensione(r.id_evento).catch(err => console.error('[Cron T1c]', err));
    }
  });

  /**
   * T2 — in_corso → sviluppo
   * Avvia la fase di sviluppo foto per gli eventi la cui data_fine_calc è passata.
   * Viene saltato mentre una decisione di estensione è in attesa (estensione_richiesta=1
   * AND estensione_accettata IS NULL) — il cron T1c garantisce che questa finestra
   * si risolva entro MINUTI_TIMEOUT_RISPOSTA_ESTENSIONE, quindi T2 non rimane mai bloccato.
   */
  cron.schedule('* * * * *', async () => {
    const adesso = nowNaive();
    for (const e of all<{ id_evento:string }>(
      `SELECT id_evento FROM EVENTO WHERE stato='in_corso' AND data_fine_calc<=?
       AND (estensione_richiesta=0 OR estensione_accettata IS NOT NULL)`, [adesso]
    ))
      await avviaSviluppoFoto(e.id_evento).catch(err => console.error('[Cron T2]', err));
  });

  /**
   * T3 — sviluppo → album_aperto
   * Sblocca la galleria esattamente dopo calcolaMinutiSviluppo() minuti dall'inizio
   * della fase sviluppo (normalmente 24h, 3min in MODALITA_SVILUPPO).
   * Usa sviluppo_started_at come riferimento (non data_fine_calc) perché una chiusura
   * anticipata deve ridurre l'attesa proporzionalmente.
   *
   * IMPORTANTE: il confronto viene fatto in JS con epoch milliseconds e NON con
   * datetime() di SQLite. datetime() produce "YYYY-MM-DD HH:MM:SS" (separatore spazio)
   * mentre i nostri timestamp naivi usano "YYYY-MM-DDTHH:MM:SS.sss" (separatore T).
   * Confrontare queste due stringhe con <= produce risultati errati nel caso in cui le
   * date cadano nello stesso giorno di calendario (il separatore diverso altera
   * l'ordinamento lessicografico prima del valore numerico temporale).
   */
  cron.schedule('* * * * *', async () => {
    const righe = all<{ id_evento: string; base_ts: string; dev_mode: number }>(
      `SELECT id_evento, COALESCE(sviluppo_started_at, data_fine_calc) AS base_ts, dev_mode FROM EVENTO WHERE stato='sviluppo'`
    );

    if (righe.length)
      console.log(`[Cron T3] tick @ ${nowNaive()} | MODALITA_SVILUPPO=${MODALITA_SVILUPPO} | ${righe.length} evento/i in 'sviluppo'`);

    const adesso = Date.now();
    for (const r of righe) {
      const minutiRitardo = calcolaMinutiSviluppo(r.dev_mode === 1);
      const sbloccaAlleMs = new Date(r.base_ts).getTime() + minutiRitardo * 60_000;
      const eScaduto = sbloccaAlleMs <= adesso;
      console.log(`[Cron T3]   ${r.id_evento}: base=${r.base_ts} dev=${r.dev_mode} ritardo=${minutiRitardo}min → sblocco=${new Date(sbloccaAlleMs).toISOString()} | scaduto=${eScaduto}`);
      if (eScaduto) await sbloccaAlbum(r.id_evento).catch(err => console.error('[Cron T3]', err));
    }
  });

  /**
   * T4 — album_aperto → chiusa
   * Chiude l'evento e assegna i badge dopo calcolaMinutiVotazione() minuti dall'apertura
   * della galleria (normalmente la durata configurata dall'organizzatore, 3min in MODALITA_SVILUPPO).
   * Stesso pattern di confronto JS-epoch del cron T3 (per le stesse ragioni di formato).
   */
  cron.schedule('* * * * *', async () => {
    const righe = all<{ id_evento: string; album_sbloccato_at: string; durata_votazione: number; dev_mode: number }>(
      `SELECT id_evento, album_sbloccato_at, durata_votazione, dev_mode FROM EVENTO WHERE stato='album_aperto' AND album_sbloccato_at IS NOT NULL`
    );

    if (righe.length)
      console.log(`[Cron T4] tick @ ${nowNaive()} | MODALITA_SVILUPPO=${MODALITA_SVILUPPO} | ${righe.length} evento/i in 'album_aperto'`);

    const adesso = Date.now();
    for (const r of righe) {
      const minutiVotazione  = calcolaMinutiVotazione(r.durata_votazione, r.dev_mode === 1);
      const fineVotazioneMs  = new Date(r.album_sbloccato_at).getTime() + minutiVotazione * 60_000;
      const eScaduto = fineVotazioneMs <= adesso;
      console.log(`[Cron T4]   ${r.id_evento}: album_sbloccato_at=${r.album_sbloccato_at} dev=${r.dev_mode} | configurato=${r.durata_votazione}h → effettivo=${minutiVotazione}min → fine=${new Date(fineVotazioneMs).toISOString()} | scaduto=${eScaduto}`);
      if (eScaduto) await chiudiEventoEAssegnaBadge(r.id_evento).catch(err => console.error('[Cron T4]', err));
    }
  });

  console.log('[Cron] Tutti i 6 worker schedulati con successo.');
}
