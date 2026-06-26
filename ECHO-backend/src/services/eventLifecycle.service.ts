import { v4 as uuid }              from 'uuid';
import { run, get, all, transaction } from '../db/database';
import { nowNaive } from '../utils/time';
import { sendFcmPush } from './push.service';

/**
 * Invia una notifica push FCM all'utente indicato, se ha un push_token registrato.
 * Logga sempre la notifica (utile in sviluppo); l'invio reale avviene solo quando l'utente
 * ha un token Firebase salvato. Gli errori di invio non vengono propagati al chiamante.
 */
export async function inviaPushNotifica(userId: string, payload: { title:string; body:string; data?: Record<string,unknown> }): Promise<void> {
  console.log(`[Push → ${userId}] ${payload.title}: ${payload.body}`);
  const user = get<{ push_token: string | null }>('SELECT push_token FROM UTENTE WHERE id_utente=?', [userId]);
  if (user?.push_token) await sendFcmPush(user.push_token, payload);
}

/**
 * Guardia di transizione ATOMICA dello stato evento: passa da `from` a `to` SOLO se lo
 * stato attuale è ancora `from` (clausola `WHERE stato=?`). Ritorna true se la transizione
 * è avvenuta. È il meccanismo che impedisce doppie transizioni quando più cron concorrenti
 * o un retry tentano lo stesso cambiamento di stato.
 */
function transizioneAtomicaStato(id_evento: string, from: string, to: string): boolean {
  const r = run('UPDATE EVENTO SET stato=? WHERE id_evento=? AND stato=?', [to, id_evento, from]);
  return (r as { changes:number }).changes > 0;
}

/**
 * Transizione `non_iniziata → in_corso`: avvia l'evento e notifica TUTTI i partecipanti
 * registrati (organizzatore incluso) che possono iniziare a scattare. No-op se l'evento
 * non era nello stato `non_iniziata` (guardia atomica).
 */
export async function avviaEvento(id_evento: string): Promise<void> {
  if (!transizioneAtomicaStato(id_evento, 'non_iniziata', 'in_corso')) return;
  console.log(`[Lifecycle] ${id_evento}: non_iniziata → in_corso`);
  // Tutti i partecipanti registrati (organizzatore incluso — scatta anche lui e non
  // riceve un messaggio separato per questa specifica transizione).
  const parts = all<{ id_utente:string }>('SELECT id_utente FROM PARTECIPA WHERE id_evento=?', [id_evento]);
  for (const p of parts)
    await inviaPushNotifica(p.id_utente, {
      title: 'ECHO', body: "Sei pronto per il grande evento? Vieni a scattare un po' di foto",
      data: { tipo: 'evento_iniziato', id_evento },
    }).catch(console.error);
}

/**
 * Transizione `in_corso → sviluppo`: chiude la finestra di scatto, disattiva il codice
 * evento, approva le foto ancora in attesa e avvia il "rullino in sviluppo". Registra
 * `sviluppo_started_at` (vedi sotto) e notifica il solo organizzatore.
 */
export async function avviaSviluppoFoto(id_evento: string): Promise<void> {
  // sviluppo_started_at è l'inizio reale del conto alla rovescia dello sviluppo — sia che
  // questa transizione scatti puntuale (cron T2, raggiunto data_fine_calc) sia in anticipo
  // (scatti di tutti esauriti, vedi chiusuraAnticipataSeEsaurito). T3 conta il ritardo di
  // sviluppo da QUESTO timestamp, non da data_fine_calc, così un trigger anticipato accorcia
  // davvero l'attesa invece di aspettare comunque fino al data_fine_calc originale.
  const now = nowNaive();
  const r = run("UPDATE EVENTO SET stato='sviluppo', sviluppo_started_at=? WHERE id_evento=? AND stato='in_corso'", [now, id_evento]);
  if ((r as { changes: number }).changes === 0) return;
  console.log(`[Lifecycle] ${id_evento}: in_corso → sviluppo (sviluppo_started_at=${now})`);
  run("UPDATE CODICE_EVENTO SET attivato=0 WHERE id_evento=?", [id_evento]);
  run("UPDATE FOTO SET stato_moderazione='approvata' WHERE id_evento=? AND stato_moderazione='in_attesa'", [id_evento]);

  // Solo l'organizzatore — i partecipanti vengono avvisati più tardi, quando l'album apre.
  const evento = get<{ id_organizzatore:string }>('SELECT id_organizzatore FROM EVENTO WHERE id_evento=?', [id_evento]);
  if (evento) {
    await inviaPushNotifica(evento.id_organizzatore, {
      title: 'ECHO', body: 'Stiamo sviluppando le foto. Vieni a guardare il report del tuo evento intanto!',
      data: { tipo: 'sviluppo_iniziato', id_evento },
    }).catch(console.error);
  }
}

/**
 * Transizione `sviluppo → album_aperto`: rende visibili le foto approvate e apre la
 * votazione. Eseguita in transazione (visibilità foto + cambio stato insieme). Notifica
 * tutti i partecipanti che il rullino è pronto da votare. No-op se non era in `sviluppo`.
 */
export async function sbloccaAlbum(id_evento: string): Promise<void> {
  const now = nowNaive();
  const moved = transaction(() => {
    run("UPDATE FOTO SET visibile=1 WHERE id_evento=? AND stato_moderazione='approvata'", [id_evento]);
    const r = run("UPDATE EVENTO SET stato='album_aperto',album_sbloccato_at=? WHERE id_evento=? AND stato='sviluppo'", [now, id_evento]);
    return (r as { changes:number }).changes > 0;
  });
  if (!moved) return;
  console.log(`[Lifecycle] ${id_evento}: sviluppo → album_aperto`);
  const parts = all<{ id_utente:string }>('SELECT id_utente FROM PARTECIPA WHERE id_evento=?', [id_evento]);
  for (const p of parts)
    await inviaPushNotifica(p.id_utente, {
      title: 'ECHO', body: "Il rullino è pronto! Vai a dare un'occhiata e vota la tua preferita",
      data: { tipo: 'album_aperto', id_evento },
    }).catch(console.error);
}

/**
 * Transizione `album_aperto → chiusa`: calcola la classifica, assegna i badge oro/argento/
 * bronzo ai primi 3 autori (in transazione con il cambio di stato) e invia le notifiche
 * — ai vincitori il badge, agli altri partecipanti il "risultati pronti", e all'organizzatore
 * il "report pronto" (mai doppia notifica allo stesso utente). No-op se non era in `album_aperto`.
 */
export async function chiudiEventoEAssegnaBadge(id_evento: string): Promise<void> {
  const evento = get<{ nome:string; data_inizio:string; stato:string; id_organizzatore:string }>(
    'SELECT nome,data_inizio,stato,id_organizzatore FROM EVENTO WHERE id_evento=?', [id_evento]);
  if (!evento || evento.stato !== 'album_aperto') return;

  /**
   * ALGORITMO DI CLASSIFICA:
   * SOMMA i voti per autore → ORDER BY totale DESC → a parità, primo scatto ASC.
   * Sommare premia la costanza su tutte le foto, non un singolo fotogramma fortunato.
   */
  const ranking = all<{ id_autore:string; total_score:number; first_shot:string }>(
    `SELECT f.id_autore, SUM(f.punteggio_voti) AS total_score, MIN(f.timestamp_scatto) AS first_shot
     FROM FOTO f WHERE f.id_evento=? AND f.visibile=1 AND f.stato_moderazione='approvata'
     GROUP BY f.id_autore ORDER BY total_score DESC, first_shot ASC LIMIT 3`, [id_evento]);

  const TYPES = ['oro','argento','bronzo'] as const;
  const date  = new Date(evento.data_inizio).toLocaleDateString('it-IT');

  transaction(() => {
    ranking.forEach((w, i) => {
      const tipo = TYPES[i];
      const label = tipo.charAt(0).toUpperCase() + tipo.slice(1);
      run('INSERT INTO BADGE (id_badge,id_utente,id_evento,tipo,posizione,etichetta) VALUES (?,?,?,?,?,?)',
        [uuid(), w.id_autore, id_evento, tipo, i+1, `ECHO ${label} — ${evento.nome} — ${date}`]);
    });
    run("UPDATE EVENTO SET stato='chiusa' WHERE id_evento=? AND stato='album_aperto'", [id_evento]);
  });

  console.log(`[Lifecycle] ${id_evento}: album_aperto → chiusa`);
  for (const [i, w] of ranking.entries()) {
    const label = TYPES[i].charAt(0).toUpperCase() + TYPES[i].slice(1);
    await inviaPushNotifica(w.id_autore, { title: `🏆 Badge ${label} conquistato!`, body: `Hai vinto per "${evento.nome}"!`, data: { tipo:'badge_assegnato', id_evento, badge_tipo: TYPES[i] } }).catch(console.error);
  }

  // Tutti gli altri ricevono il messaggio generico "risultati pronti" — l'organizzatore
  // riceve invece il suo messaggio dedicato "report pronto", non entrambi (per evitare di
  // notificare due volte la stessa persona che già riceve una notifica per questa transizione).
  const parts = all<{ id_utente:string }>('SELECT id_utente FROM PARTECIPA WHERE id_evento=?', [id_evento]);
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

/**
 * Scatta una volta per evento, ~10 minuti prima di data_fine_calc (vedi cron T1b), e chiede
 * all'organizzatore se estendere l'evento di EXTENSION_MINUTES. estensione_richiesta viene
 * impostato PRIMA così un crash/retry non invia mai due volte. L'estensione vera avviene solo
 * se l'organizzatore risponde via POST /eventi/:id/estendi — questa funzione si limita a chiedere.
 */
export async function richiestaEstensione(id_evento: string): Promise<void> {
  const now = nowNaive();
  const r = run("UPDATE EVENTO SET estensione_richiesta=1, estensione_richiesta_at=? WHERE id_evento=? AND estensione_richiesta=0", [now, id_evento]);
  if ((r as { changes: number }).changes === 0) return;
  const evento = get<{ id_organizzatore:string; nome:string; dev_mode:number }>('SELECT id_organizzatore,nome,dev_mode FROM EVENTO WHERE id_evento=?', [id_evento]);
  if (!evento) return;
  const durata = evento.dev_mode === 1 ? '3 minuti' : '2 ore';
  console.log(`[Lifecycle] ${id_evento}: extension prompt sent to organiser (dev_mode=${evento.dev_mode})`);
  await inviaPushNotifica(evento.id_organizzatore, {
    title: 'ECHO', body: `"${evento.nome}" sta per finire — vuoi estenderlo di ${durata}?`,
    data: { tipo: 'richiesta_estensione', id_evento },
  }).catch(console.error);
}

/**
 * L'organizzatore non ha risposto entro la finestra di tolleranza dopo richiestaEstensione —
 * rifiuto automatico, così T2 non resta bloccato all'infinito in attesa di una risposta che
 * potrebbe non arrivare mai (push persa, app chiusa, ecc). Stesso effetto di un "no" esplicito.
 */
export async function rifiutoAutomaticoEstensione(id_evento: string): Promise<void> {
  const r = run(
    "UPDATE EVENTO SET estensione_accettata=0 WHERE id_evento=? AND estensione_richiesta=1 AND estensione_accettata IS NULL",
    [id_evento]
  );
  if ((r as { changes: number }).changes > 0)
    console.log(`[Lifecycle] ${id_evento}: extension prompt timed out — auto-declined`);
}

/**
 * Trigger anticipato `in_corso → sviluppo`. Richiede ENTRAMBE le condizioni:
 *   1. L'evento è pieno — partecipanti registrati === max_partecipanti. Un evento non ancora
 *      pieno deve sempre attendere la scadenza temporale standard (T2/data_fine_calc), perché
 *      altre persone potrebbero ancora iscriversi e scattare.
 *   2. Ogni partecipante registrato ha esaurito i propri scatti.
 * Una sola condizione non basta — iscrizione parziale con tutti i presenti esauriti NON deve
 * far scattare la chiusura anticipata.
 */
export async function chiusuraAnticipataSeEsaurito(id_evento: string): Promise<void> {
  const ev = get<{ stato:string; scatti_per_utente:number; max_partecipanti:number }>(
    'SELECT stato,scatti_per_utente,max_partecipanti FROM EVENTO WHERE id_evento=?', [id_evento]);
  if (!ev || ev.stato !== 'in_corso') return;

  const counts = get<{ totale:number; non_esauriti:number }>(
    'SELECT COUNT(*) AS totale, SUM(CASE WHEN scatti_usati<? THEN 1 ELSE 0 END) AS non_esauriti FROM PARTECIPA WHERE id_evento=?',
    [ev.scatti_per_utente, id_evento]);

  const isFull        = (counts?.totale ?? 0) === ev.max_partecipanti;
  const allExhausted   = (counts?.non_esauriti ?? 0) === 0;

  if (isFull && allExhausted) {
    console.log(`[Lifecycle] ${id_evento}: full (${counts?.totale}/${ev.max_partecipanti}) and all shots exhausted — early closure`);
    await avviaSviluppoFoto(id_evento);
  }
}
