import { Router, Response }          from 'express';
import { v4 as uuid } from 'uuid';
import { run, get, all, transaction } from '../db/database';
import { authMiddleware, RichiestaAutenticata } from '../middleware/auth';
import { nowNaive, addMinutesNaive, toNaive } from '../utils/time';
import { MINUTI_RITARDO_SVILUPPO, calcolaMinutiVotazione, calcolaOffsetFineEvento, MINUTI_ESTENSIONE, MINUTI_MODALITA_DEV, NOTIFICA_ESTENSIONE, NOTIFICA_ESTENSIONE_DEV } from '../config';
import { inviaPushNotifica } from '../services/eventLifecycle.service';

const router = Router();
router.use(authMiddleware);

/**
 * Genera un codice evento univoco a 5 cifre (con zero-padding).
 * Riprova fino a 500 volte prima di lanciare un errore, per gestire collisioni
 * nel caso di molti eventi attivi contemporaneamente.
 */
function generaCodiceUnico(): string {
  let codice: string;
  let tentativi = 0;
  do {
    codice = String(Math.floor(Math.random() * 100_000)).padStart(5, '0');
    tentativi++;
    if (tentativi > 500) throw new Error('Impossibile generare codice univoco');
  } while (get('SELECT 1 FROM CODICE_EVENTO WHERE codice=?', [codice]));
  return codice;
}

/**
 * CONTROLLO DI CONCOMITANZA TEMPORALE (spec §4.2)
 * Algoritmo di sovrapposizione intervalli: A.start < B.end AND B.start < A.end
 * Controlla sia il ruolo ORGANIZZATORE che quello PARTECIPANTE.
 * DEVE essere chiamata dentro transaction() per essere race-condition safe.
 *
 * Solo gli eventi 'in_corso' sono considerati ATTIVI per i conflitti.
 * Gli stati 'non_iniziata' (futuri) e tutti gli stati terminali (sviluppo, album_aperto,
 * chiusa) sono esclusi — un evento futuro non occupa il tempo dell'utente fino a che
 * non inizia effettivamente, e gli stati terminali indicano che le riprese sono già terminate.
 *
 * data_fine_calc cresce oltre durata_minuti SOLO se l'organizzatore ha accettato
 * esplicitamente un'estensione di +120min (estensione_accettata=1). Un partecipante
 * che decide di non restare (rimane_esteso=0) viene valutato rispetto alla fine originale
 * (data_inizio + durata_minuti), liberandolo durante la finestra di estensione.
 */
function verificaConflittoTemporale(idUtente: string, inizio: string, fine: string): boolean {
  const inizioMs = new Date(inizio).getTime();
  const fineMs   = new Date(fine).getTime();

  // Solo eventi in corso generano conflitto (non quelli futuri o conclusi)
  const STATI_ATTIVI = "('in_corso')";

  // Conflitto come organizzatore
  const comeOrganizzatore = all<{ data_inizio: string; data_fine_calc: string }>(
    `SELECT data_inizio, data_fine_calc FROM EVENTO WHERE id_organizzatore=? AND stato IN ${STATI_ATTIVI}`, [idUtente]
  );
  if (comeOrganizzatore.some(e => new Date(e.data_inizio).getTime() < fineMs && inizioMs < new Date(e.data_fine_calc).getTime()))
    return true;

  // Conflitto come partecipante (considera la scelta di rimane_esteso)
  const comePartecipante = all<{ data_inizio: string; data_fine_calc: string; durata_minuti: number; rimane_esteso: number | null }>(
    `SELECT e.data_inizio, e.data_fine_calc, e.durata_minuti, p.rimane_esteso FROM PARTECIPA p
     JOIN EVENTO e ON e.id_evento=p.id_evento WHERE p.id_utente=? AND e.stato IN ${STATI_ATTIVI}`, [idUtente]
  );
  return comePartecipante.some(e => {
    // Se il partecipante ha rifiutato l'estensione, usa la fine originale (senza i +120min)
    const fineEffettiva = e.rimane_esteso === 0
      ? addMinutesNaive(e.data_inizio, e.durata_minuti)
      : e.data_fine_calc;
    return new Date(e.data_inizio).getTime() < fineMs && inizioMs < new Date(fineEffettiva).getTime();
  });
}

/**
 * POST /eventi/crea
 * Crea un nuovo evento fotografico con tutti i parametri specificati.
 * Controlla i conflitti temporali prima di inserire (via transazione).
 * Supporta una modalità sviluppo rapido (3 min) per i test end-to-end.
 */
router.post('/crea', (richiesta: RichiestaAutenticata, risposta: Response) => {
  const idUtente = richiesta.user.id_utente;
  const { nome, luogo, data_inizio, durata_minuti, max_partecipanti, scatti_per_utente, durata_votazione, dev_mode } = richiesta.body;

  if (!nome || !luogo || !data_inizio)
    return risposta.status(400).json({ error: 'Campi obbligatori mancanti' });

  // La modalità rapida richiede esattamente 3 minuti come durata (bypass del limite 1h-6h)
  const modalitaRapida = dev_mode === true && durata_minuti === 3;

  const eIntero = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

  if (!modalitaRapida) {
    if (!eIntero(durata_minuti) || durata_minuti < 60 || durata_minuti > 360)
      return risposta.status(400).json({ error: 'Durata non valida: deve essere tra 1h e 6h' });
  }
  if (!eIntero(scatti_per_utente) || scatti_per_utente < 1 || scatti_per_utente > 5)
    return risposta.status(400).json({ error: 'Scatti per partecipante non validi: tra 1 e 5' });
  if (!eIntero(durata_votazione) || durata_votazione < 12 || durata_votazione > 72)
    return risposta.status(400).json({ error: 'Finestra di votazione non valida: tra 12h e 72h' });
  if (!eIntero(max_partecipanti) || max_partecipanti < 1 || max_partecipanti > 500)
    return risposta.status(400).json({ error: 'Numero partecipanti non valido: tra 1 e 500' });
  if (Number.isNaN(new Date(data_inizio).getTime()))
    return risposta.status(400).json({ error: 'Data di inizio non valida' });

  const inizioNaivo    = toNaive(new Date(data_inizio));
  const data_fine_calc = addMinutesNaive(inizioNaivo, calcolaOffsetFineEvento(durata_minuti, modalitaRapida));

  try {
    const risultato = transaction(() => {
      // Verifica conflitti temporali prima di creare (operazione atomica)
      if (verificaConflittoTemporale(idUtente, inizioNaivo, data_fine_calc))
        throw Object.assign(new Error('CONFLICT'), { status: 409, msg: 'Sei già impegnato in un evento in questa fascia oraria' });

      const idEvento = uuid();
      const codice   = generaCodiceUnico();
      const stato    = inizioNaivo > nowNaive() ? 'non_iniziata' : 'in_corso';
      const anticipoMin = modalitaRapida ? NOTIFICA_ESTENSIONE_DEV : NOTIFICA_ESTENSIONE;
      const estensione_notifica_at = addMinutesNaive(data_fine_calc, -anticipoMin);

      run(`INSERT INTO EVENTO (id_evento,id_organizzatore,nome,luogo,data_inizio,durata_minuti,
           data_fine_calc,max_partecipanti,scatti_per_utente,durata_votazione,stato,dev_mode,estensione_notifica_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [idEvento, idUtente, nome, luogo, inizioNaivo, durata_minuti, data_fine_calc, max_partecipanti,
         scatti_per_utente, durata_votazione, stato, modalitaRapida ? 1 : 0, estensione_notifica_at]);

      // Crea il codice di invito valido fino alla fine dell'evento
      run(`INSERT INTO CODICE_EVENTO (id_codice,id_evento,codice,tipo,data_scadenza,attivato)
           VALUES (?,?,?,?,?,1)`, [uuid(), idEvento, codice, 'generale', data_fine_calc]);

      // L'organizzatore è automaticamente il primo partecipante
      run(`INSERT INTO PARTECIPA (id_utente,id_evento,scatti_usati,ha_votato) VALUES (?,?,0,0)`,
        [idUtente, idEvento]);

      return { eventoId: idEvento, codice, data_fine_calc, stato };
    });

    if (modalitaRapida) console.log(`[Crea] Evento ${risultato.eventoId} creato in MODALITÀ RAPIDA (ciclo di vita 3 min)`);
    return risposta.status(201).json({ message: 'Evento creato!', ...risultato });
  } catch (e: unknown) {
    const errore = e as { message?: string; status?: number; msg?: string };
    if (errore.message === 'CONFLICT') return risposta.status(errore.status!).json({ error: errore.msg });
    console.error('[POST /eventi/crea]', e);
    return risposta.status(500).json({ error: 'Errore interno' });
  }
});

/**
 * POST /eventi/partecipa
 * Aggiunge l'utente autenticato a un evento tramite codice a 5 cifre.
 * Verifica che il codice esista, sia attivo, non sia scaduto, e che non ci siano
 * conflitti temporali con altri eventi dell'utente.
 */
router.post('/partecipa', (richiesta: RichiestaAutenticata, risposta: Response) => {
  const idUtente = richiesta.user.id_utente;
  const { codice } = richiesta.body;

  if (!codice || String(codice).length !== 5)
    return risposta.status(400).json({ error: 'Codice deve essere di 5 cifre' });

  const rigaCodice = get<{ id_codice:string; id_evento:string; data_scadenza:string; attivato:number }>(
    'SELECT * FROM CODICE_EVENTO WHERE codice=?', [String(codice)]);
  if (!rigaCodice)          return risposta.status(404).json({ error: 'Codice non trovato' });
  if (!rigaCodice.attivato) return risposta.status(410).json({ error: 'Codice non più attivo' });
  if (nowNaive() > rigaCodice.data_scadenza) return risposta.status(410).json({ error: 'Codice scaduto' });

  const evento = get<{ id_evento:string; stato:string; data_inizio:string; data_fine_calc:string; max_partecipanti:number; scatti_per_utente:number }>(
    'SELECT * FROM EVENTO WHERE id_evento=?', [rigaCodice.id_evento]);
  if (!evento) return risposta.status(404).json({ error: 'Evento non trovato' });
  if (evento.stato === 'chiusa') return risposta.status(410).json({ error: 'Evento già chiuso' });
  if (get('SELECT 1 FROM PARTECIPA WHERE id_utente=? AND id_evento=?', [idUtente, rigaCodice.id_evento]))
    return risposta.status(409).json({ error: 'Sei già iscritto' });

  try {
    transaction(() => {
      // Controlla conflitti e capienza nella stessa transazione (race-condition safe)
      if (verificaConflittoTemporale(idUtente, evento.data_inizio, evento.data_fine_calc))
        throw Object.assign(new Error('CONFLICT'), { status: 409, msg: 'Sei già impegnato in un evento in questa fascia oraria' });

      const conteggioPartecipanti = get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM PARTECIPA WHERE id_evento=?', [rigaCodice.id_evento]);
      if (conteggioPartecipanti && conteggioPartecipanti.cnt >= evento.max_partecipanti)
        throw Object.assign(new Error('FULL'), { status: 409, msg: 'Evento al completo' });

      run('INSERT INTO PARTECIPA (id_utente,id_evento,scatti_usati,ha_votato) VALUES (?,?,0,0)', [idUtente, rigaCodice.id_evento]);
    });

    const messaggio = evento.stato === 'non_iniziata'
      ? "Preparati all'evento! Ricordati di portare con te il telefono per scattare le foto."
      : 'Accesso immediato — buone foto!';

    return risposta.json({ message: messaggio, evento: { id_evento: evento.id_evento, stato: evento.stato, scatti_per_utente: evento.scatti_per_utente } });
  } catch (e: unknown) {
    const errore = e as { message?: string; status?: number; msg?: string };
    if (errore.message === 'CONFLICT' || errore.message === 'FULL') return risposta.status(errore.status!).json({ error: errore.msg });
    console.error('[POST /eventi/partecipa]', e);
    return risposta.status(500).json({ error: 'Errore interno' });
  }
});

/**
 * GET /eventi/miei
 * Restituisce tutti gli eventi a cui l'utente è collegato (come organizzatore o partecipante).
 * Calcola in JS i campi derivati (album_unlock_at, voting_end_at, needs_*_response)
 * invece di usare datetime() di SQLite, perché il formato "YYYY-MM-DD HH:MM:SS" di SQLite
 * non combacia con il formato naivo "YYYY-MM-DDTHH:MM:SS.sss" usato ovunque nel progetto.
 */
router.get('/miei', (richiesta: RichiestaAutenticata, risposta: Response) => {
  const idUtente = richiesta.user.id_utente;

  const eventi = all<{
    data_fine_calc: string; sviluppo_started_at: string | null;
    album_sbloccato_at: string | null; durata_votazione: number;
    is_organiser: number; estensione_richiesta: number; estensione_accettata: number | null;
    rimane_esteso: number | null;
    [key: string]: unknown;
  }>(
    `SELECT DISTINCT e.*, COALESCE(p.scatti_usati,0) AS scatti_usati, COALESCE(p.ha_votato,0) AS ha_votato,
     p.rimane_esteso, CASE WHEN e.id_organizzatore=? THEN 1 ELSE 0 END AS is_organiser, c.codice
     FROM EVENTO e LEFT JOIN PARTECIPA p ON p.id_evento=e.id_evento AND p.id_utente=?
     LEFT JOIN CODICE_EVENTO c ON c.id_evento=e.id_evento
     WHERE e.id_organizzatore=? OR p.id_utente=? ORDER BY e.data_inizio DESC`,
    [idUtente, idUtente, idUtente, idUtente]
  ).map(e => ({
    ...e,
    // Calcola quando si sblocca la galleria (24h dopo la fine delle riprese, o 3min in modalità rapida)
    album_unlock_at: addMinutesNaive(e.sviluppo_started_at ?? e.data_fine_calc, MINUTI_RITARDO_SVILUPPO),
    // Vero solo per l'organizzatore mentre attende la sua risposta al prompt di estensione
    needs_estensione_response: !!(e.is_organiser && e.estensione_richiesta && e.estensione_accettata === null),
    // Vero solo per i partecipanti non-organizzatori dopo che l'organizzatore ha accettato l'estensione
    needs_permanenza_response: !!(!e.is_organiser && e.estensione_accettata === 1 && e.rimane_esteso === null),
    // Scadenza della finestra di votazione (calcolata in JS per coerenza del formato timestamp)
    voting_end_at: e.album_sbloccato_at ? addMinutesNaive(e.album_sbloccato_at, calcolaMinutiVotazione(e.durata_votazione)) : null,
  }));

  return risposta.json({ events: eventi });
});

/**
 * POST /eventi/:id/estendi
 * L'organizzatore risponde al prompt "vuoi estendere l'evento di 2 ore?"
 * inviato dal cron T1b circa 10 minuti prima di data_fine_calc.
 * - Accettando: posticipa data_fine_calc di MINUTI_ESTENSIONE e notifica i partecipanti
 * - Rifiutando: registra la decisione e permette al cron T2 di procedere normalmente
 */
router.post('/:id/estendi', (richiesta: RichiestaAutenticata, risposta: Response) => {
  const idUtente = richiesta.user.id_utente;
  const { id }   = richiesta.params;
  const { accetta } = richiesta.body;

  if (typeof accetta !== 'boolean') return risposta.status(400).json({ error: 'Campo "accetta" mancante' });

  const evento = get<{ id_organizzatore:string; stato:string; nome:string; data_fine_calc:string; estensione_richiesta:number; estensione_accettata:number|null; dev_mode:number }>(
    'SELECT id_organizzatore,stato,nome,data_fine_calc,estensione_richiesta,estensione_accettata,dev_mode FROM EVENTO WHERE id_evento=?', [id]);

  if (!evento) return risposta.status(404).json({ error: 'Evento non trovato' });
  if (evento.id_organizzatore !== idUtente) return risposta.status(403).json({ error: "Solo l'organizzatore può rispondere" });
  if (evento.stato !== 'in_corso') return risposta.status(409).json({ error: 'Evento non più in corso' });
  if (!evento.estensione_richiesta) return risposta.status(409).json({ error: 'Nessuna richiesta di estensione in sospeso' });
  if (evento.estensione_accettata !== null) return risposta.status(409).json({ error: 'Hai già risposto' });

  let nuovaDataFine = evento.data_fine_calc;

  // In dev_mode gli eventi durano 3 min: aggiungere 120 min di estensione non avrebbe
  // senso. Si usa MINUTI_MODALITA_DEV (3 min) per mantenere il ciclo rapido testabile.
  const minutiEst = evento.dev_mode === 1 ? MINUTI_MODALITA_DEV : MINUTI_ESTENSIONE;

  transaction(() => {
    run('UPDATE EVENTO SET estensione_accettata=? WHERE id_evento=?', [accetta ? 1 : 0, id]);
    if (accetta) {
      nuovaDataFine = addMinutesNaive(evento.data_fine_calc, minutiEst);
      run('UPDATE EVENTO SET data_fine_calc=? WHERE id_evento=?', [nuovaDataFine, id]);
      run('UPDATE CODICE_EVENTO SET data_scadenza=? WHERE id_evento=?', [nuovaDataFine, id]);
    }
  });

  if (accetta) {
    // Notifica push a tutti i partecipanti (eccetto l'organizzatore) per chiedere se restano
    const altriPartecipanti = all<{ id_utente:string }>('SELECT id_utente FROM PARTECIPA WHERE id_evento=? AND id_utente<>?', [id, idUtente]);
    for (const p of altriPartecipanti)
      inviaPushNotifica(p.id_utente, {
        title: 'ECHO',
        body: evento.dev_mode === 1
          ? `"${evento.nome}" è stato esteso di 3 minuti — desideri rimanere all'evento?`
          : `"${evento.nome}" è stato esteso di 2 ore — desideri rimanere all'evento?`,
        data: { tipo: 'conferma_permanenza', id_evento: id },
      }).catch(console.error);
  }

  const labelEst = evento.dev_mode === 1 ? '3 minuti' : '2 ore';
  return risposta.json({ message: accetta ? `Evento esteso di ${labelEst}` : 'Estensione rifiutata', data_fine_calc: nuovaDataFine, esteso: accetta });
});

/**
 * POST /eventi/:id/rimani
 * Il partecipante risponde al prompt "desideri rimanere all'evento?" dopo che
 * l'organizzatore ha accettato un'estensione.
 * Rispondere "no" non rimuove il partecipante né annulla le foto già scattate —
 * serve solo a liberarlo dal controllo dei conflitti temporali durante l'estensione
 * (vedi verificaConflittoTemporale).
 */
router.post('/:id/rimani', (richiesta: RichiestaAutenticata, risposta: Response) => {
  const idUtente = richiesta.user.id_utente;
  const { id }   = richiesta.params;
  const { rimane } = richiesta.body;

  if (typeof rimane !== 'boolean') return risposta.status(400).json({ error: 'Campo "rimane" mancante' });

  const evento = get<{ estensione_accettata: number | null }>('SELECT estensione_accettata FROM EVENTO WHERE id_evento=?', [id]);
  if (!evento) return risposta.status(404).json({ error: 'Evento non trovato' });
  if (evento.estensione_accettata !== 1) return risposta.status(409).json({ error: "L'evento non è stato esteso" });

  const risultatoAggiornamento = run(
    'UPDATE PARTECIPA SET rimane_esteso=? WHERE id_utente=? AND id_evento=?',
    [rimane ? 1 : 0, idUtente, id]
  );
  if ((risultatoAggiornamento as { changes: number }).changes === 0)
    return risposta.status(404).json({ error: 'Non sei iscritto a questo evento' });

  return risposta.json({ message: rimane ? "Bene, ci vediamo all'evento!" : 'Va bene, sei libero per altri impegni' });
});

/**
 * DELETE /eventi/:id
 * Elimina un evento e tutti i dati collegati (foto, voti, badge, codici, partecipazioni).
 * Solo l'organizzatore può eliminare il proprio evento.
 * L'ordine di cancellazione rispetta i vincoli di chiave esterna (figli prima del padre).
 */
router.delete('/:id', (richiesta: RichiestaAutenticata, risposta: Response) => {
  const idUtente = richiesta.user.id_utente;
  const { id }   = richiesta.params;

  const evento = get<{ id_organizzatore: string; stato: string }>(
    'SELECT id_organizzatore, stato FROM EVENTO WHERE id_evento=?', [id]
  );
  if (!evento) return risposta.status(404).json({ error: 'Evento non trovato' });
  if (evento.id_organizzatore !== idUtente)
    return risposta.status(403).json({ error: "Solo l'organizzatore può eliminare l'evento" });

  try {
    transaction(() => {
      // I record figli vanno eliminati prima del record padre per rispettare i vincoli FK
      run('DELETE FROM BADGE         WHERE id_evento=?', [id]);
      run('DELETE FROM VOTO          WHERE id_evento=?', [id]);
      run('DELETE FROM FOTO          WHERE id_evento=?', [id]);
      run('DELETE FROM PARTECIPA     WHERE id_evento=?', [id]);
      run('DELETE FROM CODICE_EVENTO WHERE id_evento=?', [id]);
      run('DELETE FROM EVENTO        WHERE id_evento=?', [id]);
    });
    return risposta.json({ message: 'Evento eliminato' });
  } catch (e) {
    console.error('[DELETE /eventi/:id]', e);
    return risposta.status(500).json({ error: 'Errore interno' });
  }
});

/**
 * GET /eventi/:id/analytics
 * Restituisce le statistiche aggregate dell'evento (solo per l'organizzatore).
 * Include: partecipanti, scatti totali/media/rimanenti, voti, top 3 classifica e codice.
 */
router.get('/:id/analytics', (richiesta: RichiestaAutenticata, risposta: Response) => {
  const { id }   = richiesta.params;
  const idUtente = richiesta.user.id_utente;

  const evento = get<{ id_organizzatore:string; stato:string; max_partecipanti:number; scatti_per_utente:number }>(
    'SELECT id_organizzatore,stato,max_partecipanti,scatti_per_utente FROM EVENTO WHERE id_evento=?', [id]);
  if (!evento) return risposta.status(404).json({ error: 'Evento non trovato' });
  if (evento.id_organizzatore !== idUtente) return risposta.status(403).json({ error: 'Accesso negato' });

  const partecipanti = get(
    'SELECT COUNT(*) AS totale, SUM(CASE WHEN scatti_usati>0 THEN 1 ELSE 0 END) AS con_scatti FROM PARTECIPA WHERE id_evento=?',
    [id]
  );

  // Usa SUM(scatti_usati) per il conteggio reale degli scatti (non COUNT(*) che conta partecipanti)
  const foto = get(
    `SELECT COALESCE(SUM(p.scatti_usati),0) AS totale, ROUND(AVG(p.scatti_usati),1) AS media,
     SUM(e.scatti_per_utente-p.scatti_usati) AS rimanenti
     FROM PARTECIPA p JOIN EVENTO e ON e.id_evento=p.id_evento WHERE p.id_evento=?`,
    [id]
  );

  const voti = get('SELECT COUNT(*) AS totale_voti FROM VOTO WHERE id_evento=?', [id]);

  // Top 3 per voti — alimenta la classifica finale (visibile solo quando stato === 'chiusa')
  const classifica = all(
    `SELECT u.nome,u.cognome,u.foto_profilo_url,f.id_foto,f.url_originale,SUM(f.punteggio_voti) AS punteggio_voti
     FROM FOTO f JOIN UTENTE u ON u.id_utente=f.id_autore
     WHERE f.id_evento=? AND f.visibile=1 GROUP BY f.id_autore ORDER BY punteggio_voti DESC,MIN(f.timestamp_scatto) ASC LIMIT 3`,
    [id]
  );

  const rigaCodice = get<{ codice: string }>('SELECT codice FROM CODICE_EVENTO WHERE id_evento=?', [id]);

  return risposta.json({
    stato: evento.stato,
    max_partecipanti: evento.max_partecipanti,
    scatti_per_utente: evento.scatti_per_utente,
    codice: rigaCodice?.codice ?? '',
    partecipanti, foto, voti, classifica,
  });
});

export default router;
