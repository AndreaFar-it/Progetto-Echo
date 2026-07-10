import {
  Router,
  Response
} from 'express';

import { v4 as uuid } from 'uuid';
import {
  run,
  get,
  all,
  transaction
} from '../db/database';
import {
  authMiddleware,
  reqAuth
} from '../middleware/auth';
import {
  adessoUTC,
  aggiungiMinutiUTC
} from '../utils/time';
import {
  MINUTI_SVILUPPO_DEV,
  MINUTI_RITARDO_SVILUPPO,
  calcolaMinutiVotazione,
  calcolaOffsetFineEvento,
  MINUTI_ESTENSIONE,
  MINUTI_MODALITA_DEV,
  NOTIFICA_ESTENSIONE,
  NOTIFICA_ESTENSIONE_DEV
} from '../config';
import { inviaPushNotifica } from '../services/eventLifecycle.service';

const router = Router();
router.use(authMiddleware);

// Funzione ausiliaria per generare un codice univoco a 5 cifre per l'invito all'evento.
function generaCodiceEvento(): string {
  let codice: string;
  let tentativi = 0;
  do {
    codice = String(Math.floor(Math.random() * 100_000)).padStart(5, '0');
    tentativi++;
    if (tentativi > 500) throw new Error('Impossibile generare codice univoco');
  } while (get('SELECT 1 FROM CODICE_EVENTO WHERE codice=?', [codice]));
  return codice;
}

// Funzione che verifica i conflitti temporali tra un nuovo evento e gli eventi esistenti dell'utente.
function verificaConflittoTemporale(idUtente: string, inizio: string, fine: string): boolean {
  const inizioMs = new Date(inizio).getTime();
  const fineMs = new Date(fine).getTime();

  // Solo eventi in corso generano conflitto (non quelli futuri o conclusi)
  const eventiUtente = all<{ data_inizio: string; data_fine_calc: string; durata_minuti: number; rimane_esteso: number | null }>(
    `SELECT e.data_inizio, e.data_fine_calc, e.durata_minuti, p.rimane_esteso FROM PARTECIPA p
     JOIN EVENTO e ON e.id_evento=p.id_evento WHERE p.id_utente=? AND e.stato='in_corso'`, [idUtente]
  );

  return eventiUtente.some(evento => {
    // Se il partecipante ha rifiutato l'estensione, usa la fine originale (senza i +120min)
    const fineEffettiva = evento.rimane_esteso === 0
      ? aggiungiMinutiUTC(evento.data_inizio, evento.durata_minuti)
      : evento.data_fine_calc;
    return new Date(evento.data_inizio).getTime() < fineMs && inizioMs < new Date(fineEffettiva).getTime();
  });
}

// Crea un evento gestendo gli input degli utenti
router.post('/crea', (req: reqAuth, res: Response) => {
  const idUtente = req.user.id_utente;
  const { nome, luogo, data_inizio, durata_minuti, max_partecipanti, scatti_per_utente, durata_votazione_ore, dev_mode } = req.body;

  if (!nome || !luogo || !data_inizio)
    return res.status(400).json({ error: 'Campi obbligatori mancanti' });

  // La modalità rapida richiede esattamente 3 minuti come durata (bypass del limite 1h-6h)
  const modalitaRapida = dev_mode === true && durata_minuti === 3;

  const eIntero = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

  if (!modalitaRapida) {
    if (!eIntero(durata_minuti) || durata_minuti < 60 || durata_minuti > 360)
      return res.status(400).json({ error: 'Durata non valida: deve essere tra 1h e 6h' });
  }
  if (!eIntero(scatti_per_utente) || scatti_per_utente < 1 || scatti_per_utente > 5)
    return res.status(400).json({ error: 'Scatti per partecipante non validi: tra 1 e 5' });
  if (!eIntero(durata_votazione_ore) || durata_votazione_ore < 12 || durata_votazione_ore > 72)
    return res.status(400).json({ error: 'Finestra di votazione non valida: tra 12h e 72h' });
  if (!eIntero(max_partecipanti) || max_partecipanti < 1 || max_partecipanti > 500)
    return res.status(400).json({ error: 'Numero partecipanti non valido: tra 1 e 500' });
  if (Number.isNaN(new Date(data_inizio).getTime()))
    return res.status(400).json({ error: 'Data di inizio non valida' });

  const data_inizio_iso = new Date(data_inizio).toISOString();
  if (data_inizio_iso <= adessoUTC())
    return res.status(400).json({ error: 'La data di inizio deve essere nel futuro' });

  const data_fine_calc = aggiungiMinutiUTC(data_inizio_iso, calcolaOffsetFineEvento(durata_minuti, modalitaRapida));

  try {
    const risultato = transaction(() => {
      // Verifica conflitti temporali prima di creare (operazione atomica)
      if (verificaConflittoTemporale(idUtente, data_inizio_iso, data_fine_calc))
        throw Object.assign(new Error('CONFLICT'), { status: 409, msg: 'Sei già impegnato in un evento in questa fascia oraria' }); // HTTP 409 Conflict

      const idEvento = uuid();
      const codice = generaCodiceEvento();
      const stato = data_inizio_iso > adessoUTC() ? 'non_iniziata' : 'in_corso';
      const anticipoMin = modalitaRapida ? NOTIFICA_ESTENSIONE_DEV : NOTIFICA_ESTENSIONE;
      const estensione_notifica_at = aggiungiMinutiUTC(data_fine_calc, -anticipoMin);

      // Memorizza l'evento con tutti i valori
      run(`INSERT INTO EVENTO (id_evento,id_organizzatore,nome,luogo,data_inizio,durata_minuti,
           data_fine_calc,max_partecipanti,scatti_per_utente,durata_votazione_ore,stato,dev_mode,estensione_notifica_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [idEvento, idUtente, nome, luogo, data_inizio_iso, durata_minuti, data_fine_calc, max_partecipanti,
          scatti_per_utente, durata_votazione_ore, stato, modalitaRapida ? 1 : 0, estensione_notifica_at]);

      // Crea il codice di invito valido fino alla fine dell'evento
      run(`INSERT INTO CODICE_EVENTO (id_codice,id_evento,codice,tipo,data_scadenza,attivato)
           VALUES (?,?,?,?,?,1)`, [uuid(), idEvento, codice, 'generale', data_fine_calc]);

      // L'organizzatore è automaticamente il primo partecipante
      run(`INSERT INTO PARTECIPA (id_utente,id_evento,scatti_usati,ha_votato,data_iscrizione) VALUES (?,?,0,0,?)`,
        [idUtente, idEvento, adessoUTC()]);

      return { eventoId: idEvento, codice, data_fine_calc, stato };
    });

    return res.status(201).json({ message: 'Evento creato!', ...risultato });
  } catch (e: unknown) {
    const errore = e as { message?: string; status?: number; msg?: string };
    if (errore.message === 'CONFLICT') return res.status(errore.status!).json({ error: errore.msg });
    console.error('[POST /eventi/crea]', e);
    return res.status(500).json({ error: 'Errore interno' });
  }
});

// Partecipa ad un evento se possibile
router.post('/partecipa', (req: reqAuth, res: Response) => {
  const idUtente = req.user.id_utente;
  const { codice } = req.body;

  if (!codice || String(codice).length !== 5)
    return res.status(400).json({ error: 'Codice deve essere di 5 cifre' });

  const infoCodice = get<{ id_codice: string; id_evento: string; data_scadenza: string; attivato: number }>(
    'SELECT * FROM CODICE_EVENTO WHERE codice=?', [String(codice)]);
  if (!infoCodice) return res.status(404).json({ error: 'Codice non trovato' }); // HTTP 404 Not Found
  if (!infoCodice.attivato) return res.status(410).json({ error: 'Codice non più attivo' });// HTTP 410 Gone
  if (adessoUTC() > infoCodice.data_scadenza) return res.status(410).json({ error: 'Codice scaduto' });

  const evento = get<{ id_evento: string; stato: string; data_inizio: string; data_fine_calc: string; max_partecipanti: number; scatti_per_utente: number }>(
    'SELECT * FROM EVENTO WHERE id_evento=?', [infoCodice.id_evento]);
  if (!evento) return res.status(404).json({ error: 'Evento non trovato' }); // HTTP 404 Not Found
  if (evento.stato === 'chiusa') return res.status(410).json({ error: 'Evento già chiuso' });
  if (get('SELECT 1 FROM PARTECIPA WHERE id_utente=? AND id_evento=?', [idUtente, infoCodice.id_evento]))
    return res.status(409).json({ error: 'Sei già iscritto' });

  try {
    transaction(() => {
      // Controlla conflitti e capienza nella stessa transazione (race-condition safe)
      if (verificaConflittoTemporale(idUtente, evento.data_inizio, evento.data_fine_calc))
        throw Object.assign(new Error('CONFLICT'), { status: 409, msg: 'Sei già impegnato in un evento in questa fascia oraria' });

      const conteggioPartecipanti = get<{ count: number }>('SELECT COUNT(*) AS count FROM PARTECIPA WHERE id_evento=?', [infoCodice.id_evento]);
      if (conteggioPartecipanti && conteggioPartecipanti.count >= evento.max_partecipanti)
        throw Object.assign(new Error('FULL'), { status: 409, msg: 'Evento al completo' });

      run('INSERT INTO PARTECIPA (id_utente,id_evento,scatti_usati,ha_votato,data_iscrizione) VALUES (?,?,0,0,?)', [idUtente, infoCodice.id_evento, adessoUTC()]);
    });

    const messaggio = evento.stato === 'non_iniziata'
      ? "Preparati all'evento! Ricordati di portare con te il telefono per scattare le foto."
      : 'Accesso immediato — buone foto!';

    return res.json({ message: messaggio, evento: { id_evento: evento.id_evento, stato: evento.stato, scatti_per_utente: evento.scatti_per_utente } });
  } catch (e: unknown) {
    const errore = e as { message?: string; status?: number; msg?: string };
    if (errore.message === 'CONFLICT' || errore.message === 'FULL') return res.status(errore.status!).json({ error: errore.msg });
    console.error('[POST /eventi/partecipa]', e);
    return res.status(500).json({ error: 'Errore interno' });
  }
});

// Prende tutti gli eventi a cui l'utente partecipa o che ha creato, con informazioni aggiuntive per il front-end.
router.get('/miei', (req: reqAuth, res: Response) => {
  const idUtente = req.user.id_utente;

  const eventi = all<{
    data_fine_calc: string; 
    sviluppo_started_at: string | null;
    album_sbloccato_at: string | null; 
    durata_votazione_ore: number;
    is_organiser: number; 
    estensione_richiesta: number; 
    estensione_accettata: number | null;
    rimane_esteso: number | null;
    [key: string]: unknown;
  }>(
    `SELECT DISTINCT 
      e.*, 
      p.scatti_usati, 
      p.ha_votato, 
      p.rimane_esteso, 
      CASE WHEN e.id_organizzatore = ? THEN 1 ELSE 0 END AS is_organiser, 
      c.codice
    FROM EVENTO e
    INNER JOIN PARTECIPA p ON p.id_evento = e.id_evento AND p.id_utente = ?
    LEFT JOIN CODICE_EVENTO c ON c.id_evento = e.id_evento
    ORDER BY e.data_inizio DESC`,
    [idUtente, idUtente]
  ).map(e => ({
    ...e,
    // Valore reale se la galleria si è già sbloccata, altrimenti la stima corrente di quando
    // succederà (24h dopo la fine delle riprese, o 3min in modalità rapida) — un solo campo,
    // sempre valorizzato, che diventa "definitivo" non appena il vero sblocco avviene.
    album_sbloccato_at: e.dev_mode == 1 
  ? aggiungiMinutiUTC(e.sviluppo_started_at ?? e.data_fine_calc, MINUTI_SVILUPPO_DEV)
  : (e.album_sbloccato_at ?? aggiungiMinutiUTC(e.sviluppo_started_at ?? e.data_fine_calc, MINUTI_RITARDO_SVILUPPO)),
    // Vero solo per l'organizzatore mentre attende la sua res al prompt di estensione
    needs_estensione_response: !!(e.is_organiser && e.estensione_richiesta && e.estensione_accettata === null),
    // Vero solo per i partecipanti non-organizzatori dopo che l'organizzatore ha accettato l'estensione
    needs_permanenza_response: !!(!e.is_organiser && e.estensione_accettata === 1 && e.rimane_esteso === null),
    // Scadenza della finestra di votazione
    voting_end_at: e.album_sbloccato_at ? aggiungiMinutiUTC(e.album_sbloccato_at, calcolaMinutiVotazione(e.durata_votazione_ore)) : null,
  }));

  return res.json({ events: eventi });
});

// Gestisce la richiesta di estensione dell'evento da parte dell'organizzatore.
router.post('/:id/estendi', (req: reqAuth, res: Response) => {
  const idUtente = req.user.id_utente;
  const { id } = req.params;
  const { accetta } = req.body;

  if (typeof accetta !== 'boolean') return res.status(400).json({ error: 'Campo "accetta" mancante' });

  const evento = get<{ id_organizzatore: string; stato: string; nome: string; data_fine_calc: string; estensione_richiesta: number; estensione_accettata: number | null; dev_mode: number }>(
    'SELECT id_organizzatore,stato,nome,data_fine_calc,estensione_richiesta,estensione_accettata,dev_mode FROM EVENTO WHERE id_evento=?', [id]);

  if (!evento) return res.status(404).json({ error: 'Evento non trovato' });
  if (evento.id_organizzatore !== idUtente) return res.status(403).json({ error: "Solo l'organizzatore può rispondere" });
  if (evento.stato !== 'in_corso') return res.status(409).json({ error: 'Evento non più in corso' });
  if (!evento.estensione_richiesta) return res.status(409).json({ error: 'Nessuna richiesta di estensione in sospeso' });
  if (evento.estensione_accettata !== null) return res.status(409).json({ error: 'Hai già risposto' });

  let nuovaDataFine = evento.data_fine_calc;

 // in dev mode l'estensione è di 3 minuti, altrimenti di 2 ore (120 minuti)
  const minutiEst = evento.dev_mode === 1 ? MINUTI_MODALITA_DEV : MINUTI_ESTENSIONE;

  transaction(() => {
    run('UPDATE EVENTO SET estensione_accettata=? WHERE id_evento=?', [accetta ? 1 : 0, id]);
    if (accetta) {
      nuovaDataFine = aggiungiMinutiUTC(evento.data_fine_calc, minutiEst);
      run('UPDATE EVENTO SET data_fine_calc=? WHERE id_evento=?', [nuovaDataFine, id]);
      run('UPDATE CODICE_EVENTO SET data_scadenza=? WHERE id_evento=?', [nuovaDataFine, id]);
    }
  });

  if (accetta) {
    // Notifica push a tutti i partecipanti (eccetto l'organizzatore) per chiedere se restano
    const altriPartecipanti = all<{ id_utente: string }>('SELECT id_utente FROM PARTECIPA WHERE id_evento=? AND id_utente<>?', [id, idUtente]);
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
  return res.json({ message: accetta ? `Evento esteso di ${labelEst}` : 'Estensione rifiutata', data_fine_calc: nuovaDataFine, esteso: accetta });
});

// Gestisce la risposta dei partecipanti all'estensione dell'evento (rimane o lascia).
router.post('/:id/rimani', (req: reqAuth, res: Response) => {
  const idUtente = req.user.id_utente;
  const { id } = req.params;
  const { rimane } = req.body;

  if (typeof rimane !== 'boolean') return res.status(400).json({ error: 'Campo "rimane" mancante' });

  const evento = get<{ estensione_accettata: number | null }>('SELECT estensione_accettata FROM EVENTO WHERE id_evento=?', [id]);
  if (!evento) return res.status(404).json({ error: 'Evento non trovato' });
  if (evento.estensione_accettata !== 1) return res.status(409).json({ error: "L'evento non è stato esteso" });

  const risultatoAggiornamento = run(
    'UPDATE PARTECIPA SET rimane_esteso=? WHERE id_utente=? AND id_evento=?',
    [rimane ? 1 : 0, idUtente, id]
  );
  if ((risultatoAggiornamento as { changes: number }).changes === 0)
    return res.status(404).json({ error: 'Non sei iscritto a questo evento' });

  return res.json({ message: rimane ? "Bene! Continua a scattare!" : 'Va bene, sei libero per altri impegni' });
});

// Elimina un evento (solo l'organizzatore può farlo)
router.delete('/:id', (req: reqAuth, res: Response) => {
  const idUtente = req.user.id_utente;
  const { id } = req.params;

  const evento = get<{ id_organizzatore: string; stato: string }>(
    'SELECT id_organizzatore, stato FROM EVENTO WHERE id_evento=?', [id]
  );
  if (!evento) return res.status(404).json({ error: 'Evento non trovato' });
  if (evento.id_organizzatore !== idUtente)
    return res.status(403).json({ error: "Solo l'organizzatore può eliminare l'evento" });

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
    return res.json({ message: 'Evento eliminato' });
  } catch (e) {
    console.error('[DELETE /eventi/:id]', e);
    return res.status(500).json({ error: 'Errore interno' }); // HTTP 500 Internal Server Error
  }
});

// Gestisce la richiesta delle analytics dell'evento da parte dell'organizzatore, restituendo statistiche e classifica finale.
router.get('/:id/analytics', (req: reqAuth, res: Response) => {
  const { id } = req.params;
  const idUtente = req.user.id_utente;

  const evento = get<{ id_organizzatore: string; stato: string; max_partecipanti: number; scatti_per_utente: number }>(
    'SELECT id_organizzatore,stato,max_partecipanti,scatti_per_utente FROM EVENTO WHERE id_evento=?', [id]);
  if (!evento) return res.status(404).json({ error: 'Evento non trovato' });
  if (evento.id_organizzatore !== idUtente) return res.status(403).json({ error: 'Accesso negato' }); // HTTP 403 Forbidden

  const partecipanti = get('SELECT COUNT(*) AS totale FROM PARTECIPA WHERE id_evento=?', [id]);

  // Usa SUM(scatti_usati) per il conteggio reale degli scatti (non COUNT(*) che conta partecipanti)
  const foto = get('SELECT SUM(scatti_usati) AS totale FROM PARTECIPA WHERE id_evento=?', [id]);

  const voti = get('SELECT COUNT(*) AS totale_voti FROM VOTO WHERE id_evento=?', [id]);

  const classifica = all(
    `SELECT u.nome, u.cognome, u.foto_profilo_url, f.url_originale, f.punteggio_voti
     FROM FOTO f JOIN UTENTE u ON u.id_utente=f.id_autore
     WHERE f.id_evento=? AND f.visibile=1
     ORDER BY f.punteggio_voti DESC, f.timestamp_scatto ASC
     LIMIT 3`,
    [id]
  );

  const infoCodice = get<{ codice: string }>('SELECT codice FROM CODICE_EVENTO WHERE id_evento=?', [id]);

  return res.json({
    stato: evento.stato,
    max_partecipanti: evento.max_partecipanti,
    scatti_per_utente: evento.scatti_per_utente,
    codice: infoCodice?.codice ?? '',
    partecipanti, foto, voti, classifica,
  });
});

export default router;
