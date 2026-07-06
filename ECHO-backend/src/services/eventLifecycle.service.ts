import { v4 as uuid } from 'uuid';
import {
  run,
  get,
  all,
  transaction
} from '../db/database';
import {
  adessoUTC,
  aggiungiMinutiUTC
} from '../utils/time';
import {
  calcolaMinutiSviluppo,
  calcolaMinutiVotazione,
  MINUTI_TIMEOUT_RISPOSTA_ESTENSIONE
} from '../config';
import { sendFcmPush } from './push.service';

// Invia una notifica push ad un utente
export async function inviaPushNotifica(userId: string, payload: { title: string; body: string; data?: Record<string, unknown> }): Promise<void> {
  const user = get<{ push_token: string | null }>('SELECT push_token FROM UTENTE WHERE id_utente=?', [userId]);
  if (user?.push_token) await sendFcmPush(user.push_token, payload);
}

// Funzione per avviare un evento
export async function avviaEvento(id_evento: string): Promise<void> {
  const r = run("UPDATE EVENTO SET stato='in_corso' WHERE id_evento=? AND stato='non_iniziata'", [id_evento]);
  if ((r as { changes: number }).changes === 0) return; // Controlla che effettivamente sono state effettuate delle changes e in caso procede
  // Tutti i partecipanti registrati (organizzatore incluso — scatta anche lui e non
  // riceve un messaggio separato per questa specifica transizione).
  const parts = all<{ id_utente: string }>('SELECT id_utente FROM PARTECIPA WHERE id_evento=?', [id_evento]);
  for (const p of parts)// per ogni utente manda una notifica
    await inviaPushNotifica(p.id_utente, {
      title: 'ECHO', body: "Sei pronto per il grande evento? Vieni a scattare un po' di foto",
      data: { tipo: 'evento_iniziato', id_evento },
    }).catch(console.error);
}

// Funzione di transizione da 'in_corso' a 'sviluppo'
export async function avviaSviluppoFoto(id_evento: string): Promise<void> {
  const now = adessoUTC();
  const meta = get<{ dev_mode: number }>('SELECT dev_mode FROM EVENTO WHERE id_evento=?', [id_evento]);
  if (!meta) return;
  const sviluppo_ended_at = aggiungiMinutiUTC(now, calcolaMinutiSviluppo(meta.dev_mode === 1));
  const r = run(
    "UPDATE EVENTO SET stato='sviluppo', sviluppo_started_at=?, sviluppo_ended_at=? WHERE id_evento=? AND stato='in_corso'",
    [now, sviluppo_ended_at, id_evento]
  );
  if ((r as { changes: number }).changes === 0) return;
  run("UPDATE CODICE_EVENTO SET attivato=0 WHERE id_evento=?", [id_evento]);
  run("UPDATE FOTO SET stato_moderazione='approvata' WHERE id_evento=? AND stato_moderazione='in_attesa'", [id_evento]);// Per ora non è presente nessuna moderazione

  // Solo l'organizzatore — i partecipanti vengono avvisati più tardi, quando l'album apre.
  const evento = get<{ id_organizzatore: string }>('SELECT id_organizzatore FROM EVENTO WHERE id_evento=?', [id_evento]);
  if (evento) {
    await inviaPushNotifica(evento.id_organizzatore, {
      title: 'ECHO', body: 'Stiamo sviluppando le foto. Vieni a guardare il report del tuo evento intanto!',
      data: { tipo: 'sviluppo_iniziato', id_evento },
    }).catch(console.error);
  }
}

// Gestisce l'apertura dell'album
export async function sbloccaAlbum(id_evento: string): Promise<void> {
  const now = adessoUTC();
  const meta = get<{ durata_votazione_ore: number; dev_mode: number }>(
    'SELECT durata_votazione_ore, dev_mode FROM EVENTO WHERE id_evento=?', [id_evento]
  );
  if (!meta) return;
  const album_aperto_ended_at = aggiungiMinutiUTC(now, calcolaMinutiVotazione(meta.durata_votazione_ore, meta.dev_mode === 1));
  const moved = transaction(() => {
    run("UPDATE FOTO SET visibile=1 WHERE id_evento=? AND stato_moderazione='approvata'", [id_evento]);
    const r = run(
      "UPDATE EVENTO SET stato='album_aperto', album_sbloccato_at=?, album_aperto_ended_at=? WHERE id_evento=? AND stato='sviluppo'",
      [now, album_aperto_ended_at, id_evento]
    );
    return (r as { changes: number }).changes > 0;
  });
  if (!moved) return;
  const parts = all<{ id_utente: string }>('SELECT id_utente FROM PARTECIPA WHERE id_evento=?', [id_evento]);
  for (const p of parts)
    await inviaPushNotifica(p.id_utente, {
      title: 'ECHO', body: "Il rullino è pronto! Vai a dare un'occhiata e vota la tua preferita",
      data: { tipo: 'album_aperto', id_evento },
    }).catch(console.error);
}

// Gestione della chiusura evento e della classifica
export async function chiudiEventoEAssegnaBadge(id_evento: string): Promise<void> {
  const evento = get<{ nome: string; data_inizio: string; stato: string; id_organizzatore: string }>(
    'SELECT nome,data_inizio,stato,id_organizzatore FROM EVENTO WHERE id_evento=?', [id_evento]);
  if (!evento || evento.stato !== 'album_aperto') return;
  const ranking = all<{ id_autore: string }>(
    `SELECT f.id_autore
     FROM FOTO f WHERE f.id_evento=? AND f.visibile=1 AND f.stato_moderazione='approvata'
     ORDER BY f.punteggio_voti DESC, f.timestamp_scatto ASC LIMIT 3`, [id_evento]);

  const TYPES = ['oro', 'argento', 'bronzo'] as const;
  const date = new Date(evento.data_inizio).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
  
  //assegnazione badge e chiusura evento
  transaction(() => {
    ranking.forEach((winner, i) => {
      const tipo = TYPES[i];
      const label = tipo.charAt(0).toUpperCase() + tipo.slice(1);
      run('INSERT INTO BADGE (id_badge,id_utente,id_evento,tipo,posizione,etichetta,data_emissione) VALUES (?,?,?,?,?,?,?)',
        [uuid(), winner.id_autore, id_evento, tipo, i + 1, `ECHO ${label} — ${evento.nome} — ${date}`, adessoUTC()]);
    });
    run("UPDATE EVENTO SET stato='chiusa' WHERE id_evento=? AND stato='album_aperto'", [id_evento]);
  });

  // Notifiche per i vincitori
  for (const [i, w] of ranking.entries()) {
    const label = TYPES[i].charAt(0).toUpperCase() + TYPES[i].slice(1);
    await inviaPushNotifica(w.id_autore, { title: `🏆 Badge ${label} conquistato!`, body: `Hai vinto per "${evento.nome}"!`, data: { tipo: 'badge_assegnato', id_evento, badge_tipo: TYPES[i] } }).catch(console.error);
  }

  // Tutti gli altri ricevono il messaggio generico "risultati pronti" — l'organizzatore
  // riceve invece il suo messaggio dedicato "report pronto"
  const parts = all<{ id_utente: string }>('SELECT id_utente FROM PARTECIPA WHERE id_evento=?', [id_evento]);
  for (const p of parts) {
    if (p.id_utente === evento.id_organizzatore) continue;
    await inviaPushNotifica(p.id_utente, {
      title: 'ECHO', body: 'Le votazioni sono terminate! Scopri se sei stato uno dei vincitori',
      data: { tipo: 'votazioni_chiuse', id_evento },
    }).catch(console.error);
  }
  await inviaPushNotifica(evento.id_organizzatore, {
    title: 'ECHO', body: 'Il tuo report è completo',
    data: { tipo: 'report_pronto', id_evento },
  }).catch(console.error);
}

// Gestione richiesta estensioni
export async function richiestaEstensione(id_evento: string): Promise<void> {
  const now = adessoUTC();
  const evento = get<{ id_organizzatore: string; nome: string; dev_mode: number }>(
    'SELECT id_organizzatore,nome,dev_mode FROM EVENTO WHERE id_evento=?', [id_evento]
  );
  if (!evento) return;
  const timeoutMin = evento.dev_mode === 1 ? 1 : MINUTI_TIMEOUT_RISPOSTA_ESTENSIONE;
  const estensione_timeout_at = aggiungiMinutiUTC(now, timeoutMin);
  const r = run(
    "UPDATE EVENTO SET estensione_richiesta=1, estensione_richiesta_at=?, estensione_timeout_at=? WHERE id_evento=? AND estensione_richiesta=0",
    [now, estensione_timeout_at, id_evento]
  );
  if ((r as { changes: number }).changes === 0) return;
  const durata = evento.dev_mode === 1 ? '3 minuti' : '2 ore';
  await inviaPushNotifica(evento.id_organizzatore, {
    title: 'ECHO', body: `"${evento.nome}" sta per finire — vuoi estenderlo di ${durata}?`,
    data: { tipo: 'richiesta_estensione', id_evento },
  }).catch(console.error);
}

// Gestione risposta mancata
export async function rifiutoAutomaticoEstensione(id_evento: string): Promise<void> {
  const r = run(
    "UPDATE EVENTO SET estensione_accettata=0 WHERE id_evento=? AND estensione_richiesta=1 AND estensione_accettata IS NULL",
    [id_evento]
  );
  if ((r as { changes: number }).changes > 0) return;
}

// Gestione Scatti esauriti
export async function chiusuraAnticipataSeEsaurito(id_evento: string): Promise<void> {
  const evento = get<{ stato: string; scatti_per_utente: number; max_partecipanti: number }>(
    'SELECT stato,scatti_per_utente,max_partecipanti FROM EVENTO WHERE id_evento=?', [id_evento]);
  if (!evento || evento.stato !== 'in_corso') return;

  const counts = get<{ totale: number; non_esauriti: number }>(
    'SELECT COUNT(*) AS totale, SUM(CASE WHEN scatti_usati<? THEN 1 ELSE 0 END) AS non_esauriti FROM PARTECIPA WHERE id_evento=?',
    [evento.scatti_per_utente, id_evento]);

  const isFull = (counts?.totale ?? 0) === evento.max_partecipanti;
  const allExhausted = (counts?.non_esauriti ?? 0) === 0;

  if (isFull && allExhausted) {
    await avviaSviluppoFoto(id_evento);
  }
}
