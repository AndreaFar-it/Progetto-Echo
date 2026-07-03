import cron from 'node-cron'; // Libreria per la pianificazione di job periodici in Node.js.
import { all } from '../db/database';
import { nowNaive } from '../utils/time';
import {
  avviaEvento,
  avviaSviluppoFoto,
  sbloccaAlbum,
  chiudiEventoEAssegnaBadge,
  richiestaEstensione,
  rifiutoAutomaticoEstensione,
} from '../services/eventLifecycle.service';
import {
  MODALITA_SVILUPPO,
  calcolaMinutiVotazione,
  calcolaMinutiSviluppo,
  NOTIFICA_ESTENSIONE,
  NOTIFICA_ESTENSIONE_DEV,
  MINUTI_TIMEOUT_RISPOSTA_ESTENSIONE,
  TRASFORMA_IN_MINUTI
} from '../config';


//Inizializza i 6 worker cron per la gestione del ciclo di vita degli eventi.
export function avviaJobPeriodici(): void {
  console.log('[Cron] Avvio 6 worker del ciclo di vita eventi…');

//T1 — non_iniziata → in_corso
//Ogni minuto il nostro cron seleziona tutti gli id evento che hanno stato non iniziata e data_inizio <= adesso, e per ognuno chiama avviaEvento(id_evento).
  cron.schedule('* * * * *', async () => {
    const adesso = nowNaive();
    for (const e of all<{ id_evento:string }>(
      "SELECT id_evento FROM EVENTO WHERE stato='non_iniziata' AND data_inizio<=?", [adesso]
    ))
      await avviaEvento(e.id_evento).catch(err => console.error('[Cron T1]', err));
  });

//T1b — Prompt estensione evento
//Selezione l'id evento che ha stato in_corso e estensione_richiesta=0, e per ognuno calcola se la data_fine_calc è entro NOTIFICA_ESTENSIONE minuti da adesso.
// Se sì, chiama richiestaEstensione(id_evento).
  cron.schedule('* * * * *', async () => {
    const eventiNonNotificati = all<{ id_evento: string; data_fine_calc: string; dev_mode: number }>(
      `SELECT id_evento, data_fine_calc, dev_mode FROM EVENTO
       WHERE stato='in_corso' AND estensione_richiesta=0`
    );
    const adesso = Date.now();// ricontrollare se usare nowNaive() o Date.now() per coerenza con T2/T3/T4
    for (const evento of eventiNonNotificati) {
      const anticipoMs = evento.dev_mode === 1
        ? NOTIFICA_ESTENSIONE_DEV * TRASFORMA_IN_MINUTI
        : NOTIFICA_ESTENSIONE * TRASFORMA_IN_MINUTI;
      const millisecondiRimanenti = new Date(evento.data_fine_calc).getTime() - adesso;
      if (millisecondiRimanenti > 0 && millisecondiRimanenti <= anticipoMs)
        await richiestaEstensione(evento.id_evento).catch(err => console.error('[Cron T1b]', err));
    }
  });

//T1c — Rifiuto automatico estensione evento
//Seleziona l'id evento che ha stato in_corso e estensione_richiesta=1 e estensione_accettata IS NULL,
//e per ognuno calcola se sono passati i MINUTI_TIMEOUT_RISPOSTA_ESTENSIONE da estensione_richiesta_at.
//Se si sì, chiama rifiutoAutomaticoEstensione(id_evento).
  cron.schedule('* * * * *', async () => {
    const eventiNotificati = all<{ id_evento: string; estensione_richiesta_at: string; dev_mode: number }>(
      `SELECT id_evento, estensione_richiesta_at, dev_mode FROM EVENTO
      WHERE stato='in_corso' AND estensione_richiesta=1 AND estensione_accettata IS NULL`
    );
    const adesso = Date.now();
    for (const evento of eventiNotificati) {
      const millisecondiTrascorsi = adesso - new Date(evento.estensione_richiesta_at).getTime();
      const timeoutMs = evento.dev_mode === 1 ? 60_000 : MINUTI_TIMEOUT_RISPOSTA_ESTENSIONE * TRASFORMA_IN_MINUTI;
      if (millisecondiTrascorsi >= timeoutMs)
        await rifiutoAutomaticoEstensione(evento.id_evento).catch(err => console.error('[Cron T1c]', err));
    }
  });

//T2 — in_corso → sviluppo
//Avvia lo sviluppo delle foto esattamente dopo data_fine_calc (normalmente 24h, 3min in MODALITA_SVILUPPO).
  cron.schedule('* * * * *', async () => {
    const adesso = nowNaive();
    for (const evento of all<{ id_evento:string }>(
      `SELECT id_evento FROM EVENTO WHERE stato='in_corso' AND data_fine_calc<=?
       AND (estensione_richiesta=0 OR estensione_accettata IS NOT NULL)`, [adesso]
    ))
      await avviaSviluppoFoto(evento.id_evento).catch(err => console.error('[Cron T2]', err));
  });

//T3 — sviluppo → album_aperto
//Seleziona tutti gli id evento che o sono in fase di sviluppo o sono ancora in corso
//(OTTIMIZZAZZIONE calcolare direttamente sviluppo_ended_at in T2 e usare quello invece di data_fine_calc).
  cron.schedule('* * * * *', async () => {
    const eventoInSviluppo = all<{ id_evento: string; base_ts: string; dev_mode: number }>(
      `SELECT id_evento,
      COALESCE(sviluppo_started_at, data_fine_calc) AS base_ts, dev_mode FROM EVENTO 
      WHERE stato='sviluppo'`
      //COALESCE sceglie il primo valore non nullo tra sviluppo_started_at e data_fine_calc
    );
    const adesso = Date.now();
    for (const evento of eventoInSviluppo) {
      const minutiRitardo = calcolaMinutiSviluppo(evento.dev_mode === 1); // durata sviluppo in minuti, 0 se dev_mode=1, altrimenti 1440 (24h)
      const sbloccaAlleMs = new Date(evento.base_ts).getTime() + minutiRitardo * TRASFORMA_IN_MINUTI; // Prende l'inizio dell'evento e aggiunge i minuti di sviluppo calcolati in millisecondi
      const eventoScaduto = sbloccaAlleMs <= adesso;
      if (eventoScaduto) await sbloccaAlbum(evento.id_evento).catch(err => console.error('[Cron T3]', err));
    }
  });


//T4 — album_aperto → chiuso
//Seleziona tutti gli id evento che hanno stato album_aperto e album_sbloccato_at non nullo.
//(OTTIMIZZAZZIONE calcolare direttamente album_aperto_ended_at in T3 e usare quello invece di album_sbloccato_at).
  cron.schedule('* * * * *', async () => {
    const eventoInAlbumAperto = all<{ id_evento: string; album_sbloccato_at: string; durata_votazione: number; dev_mode: number }>(
      `SELECT id_evento, album_sbloccato_at, durata_votazione, dev_mode FROM EVENTO
      WHERE stato='album_aperto' AND album_sbloccato_at IS NOT NULL`
    );
    const adesso = Date.now();
    for (const evento of eventoInAlbumAperto) {
      const minutiVotazione  = calcolaMinutiVotazione(evento.durata_votazione, evento.dev_mode === 1);
      const fineVotazioneMs  = new Date(evento.album_sbloccato_at).getTime() + minutiVotazione * TRASFORMA_IN_MINUTI;
      const eventoScaduto = fineVotazioneMs <= adesso;
      if (eventoScaduto) await chiudiEventoEAssegnaBadge(evento.id_evento).catch(err => console.error('[Cron T4]', err));
    }
  });
}
