import cron from 'node-cron'; // Libreria per la pianificazione di job periodici in Node.js.
import { all } from '../db/database';
import { adessoUTC } from '../utils/time';
import {
  avviaEvento,
  avviaSviluppoFoto,
  sbloccaAlbum,
  chiudiEventoEAssegnaBadge,
  richiestaEstensione,
  rifiutoAutomaticoEstensione,
} from '../services/eventLifecycle.service';


//Inizializza i 6 worker cron per la gestione del ciclo di vita degli eventi.
export function avviaJobPeriodici(): void {
  console.log('[Cron] Avvio 6 worker del ciclo di vita eventi…');

//T1 — non_iniziata → in_corso
//Ogni minuto il nostro cron seleziona tutti gli id evento che hanno stato non iniziata e data_inizio <= adesso, e per ognuno chiama avviaEvento(id_evento).
  cron.schedule('* * * * *', async () => {
    const adesso = adessoUTC();
    for (const e of all<{ id_evento:string }>(
      "SELECT id_evento FROM EVENTO WHERE stato='non_iniziata' AND data_inizio<=?", [adesso]
    ))
      await avviaEvento(e.id_evento).catch(err => console.error('[Cron T1]', err));
  });

//T1b — Prompt estensione evento
//Ogni minuto il nostro cron seleziona tutti gli id evento che hanno stato in_corso, estensione_richiesta=0,
//e l'orario adesso compreso tra estensione_notifica_at e data_fine_calc , e per ognuno chiama richiestaEstensione(id_evento).
  cron.schedule('* * * * *', async () => {
    const adesso = adessoUTC();
    for (const e of all<{ id_evento: string }>(
      `SELECT id_evento FROM EVENTO
       WHERE stato='in_corso' AND estensione_richiesta=0
         AND estensione_notifica_at<=? AND data_fine_calc>?`,
      [adesso, adesso]
    ))
      await richiestaEstensione(e.id_evento).catch(err => console.error('[Cron T1b]', err));
  });

//T1c — Rifiuto automatico estensione evento
//Ogni minuto il nostro cron seleziona tutti gli id evento che hanno stato in_corso, ai quali
//è già stata richiesta un'estensione, ma non è stata accettata entro il timeout, e per ognuno chiama rifiutoAutomaticoEstensione(id_evento).
  cron.schedule('* * * * *', async () => {
    const adesso = adessoUTC();
    for (const e of all<{ id_evento: string }>(
      `SELECT id_evento FROM EVENTO
       WHERE stato='in_corso' AND estensione_richiesta=1
         AND estensione_accettata IS NULL AND estensione_timeout_at<=?`,
      [adesso]
    ))
      await rifiutoAutomaticoEstensione(e.id_evento).catch(err => console.error('[Cron T1c]', err));
  });

//T2 — in_corso → sviluppo
//Avvia lo sviluppo delle foto esattamente dopo data_fine_calc (normalmente 24h, 3min per un evento in dev_mode).
  cron.schedule('* * * * *', async () => {
    const adesso = adessoUTC();
    for (const evento of all<{ id_evento:string }>(
      `SELECT id_evento FROM EVENTO WHERE stato='in_corso' AND data_fine_calc<=?
       AND (estensione_richiesta=0 OR estensione_accettata IS NOT NULL)`, [adesso]
    ))
      await avviaSviluppoFoto(evento.id_evento).catch(err => console.error('[Cron T2]', err));
  });

//T3 — sviluppo → album_aperto
//Ogni minuto il nostro cron seleziona tutti gli id evento che hanno stato sviluppo,
//e sviluppo_ended_at <= adesso, e per ognuno chiama sbloccaAlbum(id_evento).
  cron.schedule('* * * * *', async () => {
    const adesso = adessoUTC();
    for (const e of all<{ id_evento: string }>(
      "SELECT id_evento FROM EVENTO WHERE stato='sviluppo' AND sviluppo_ended_at<=?",
      [adesso]
    ))
      await sbloccaAlbum(e.id_evento).catch(err => console.error('[Cron T3]', err));
  });


//T4 — album_aperto → chiusa
//Ogni minuto il nostro cron seleziona tutti gli id evento che hanno stato album_aperto,
//e album_aperto_ended_at <= adesso, e per ognuno chiama chiudiEventoEAssegnaBadge(id_evento).
  cron.schedule('* * * * *', async () => {
    const adesso = adessoUTC();
    for (const e of all<{ id_evento: string }>(
      "SELECT id_evento FROM EVENTO WHERE stato='album_aperto' AND album_aperto_ended_at<=?",
      [adesso]
    ))
      await chiudiEventoEAssegnaBadge(e.id_evento).catch(err => console.error('[Cron T4]', err));
  });
}
