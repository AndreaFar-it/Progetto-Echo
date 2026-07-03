import { Router, Response }          from 'express';
import { v4 as uuid }               from 'uuid';
import multer                        from 'multer';
import path                          from 'path';
import fs                            from 'fs';
import { run, get, all, transaction } from '../db/database';
import { authMiddleware, RichiestaAutenticata } from '../middleware/auth';
import { chiusuraAnticipataSeEsaurito } from '../services/eventLifecycle.service';
import { calcolaMinutiVotazione } from '../config';
import { addMinutesNaive } from '../utils/time';

const router = Router();
router.use(authMiddleware);

/**
 * Configurazione multer per il salvataggio delle foto su disco.
 * Le foto vengono organizzate in sottocartelle per evento: uploads/<id_evento>/<uuid>.jpg
 * Limite di 15MB per file; solo JPEG, PNG e WebP sono accettati.
 */
const archivioFile = multer.diskStorage({
  destination(richiesta: RichiestaAutenticata, _f, cb) {
    // Crea la cartella per l'evento se non esiste ancora
    const cartella = path.join(__dirname, '../../uploads', richiesta.body.id_evento ?? 'unknown');
    fs.mkdirSync(cartella, { recursive: true });
    cb(null, cartella);
  },
  filename(_req, _f, cb) {
    // Nome univoco basato su UUID per evitare collisioni
    cb(null, `${uuid()}.jpg`);
  },
});

const caricaFile = multer({
  storage: archivioFile,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(_r, f, cb) {
    // Accetta solo formati immagine comuni (no PDF, no GIF, no video)
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(f.mimetype));
  },
});

/**
 * POST /foto/upload
 * Riceve e salva la foto scattata dall'utente.
 * Verifica che l'evento sia in corso, che l'utente sia un partecipante,
 * e che non abbia esaurito il proprio budget di scatti.
 * Se lo scatto esaurisce il budget, attiva un controllo di chiusura anticipata
 * (nel caso in cui tutti i partecipanti abbiano terminato i propri scatti).
 */
router.post('/upload', caricaFile.single('foto'), async (richiesta: RichiestaAutenticata, risposta: Response) => {
  const idUtente  = richiesta.user!.id_utente;
  const { id_evento } = richiesta.body;

  if (!richiesta.file || !id_evento) return risposta.status(400).json({ error: 'Dati mancanti' });

  const evento = get<{ stato:string; scatti_per_utente:number }>(
    'SELECT stato,scatti_per_utente FROM EVENTO WHERE id_evento=?', [id_evento]);
  if (!evento) {
    fs.unlinkSync(richiesta.file.path); // Rimuove il file già salvato se l'evento non esiste
    return risposta.status(404).json({ error: 'Evento non trovato' });
  }
  if (evento.stato !== 'in_corso') {
    fs.unlinkSync(richiesta.file.path);
    return risposta.status(409).json({ error: 'Acquisizione non attiva' });
  }

  const partecipazione = get<{ scatti_usati:number }>(
    'SELECT scatti_usati FROM PARTECIPA WHERE id_utente=? AND id_evento=?', [idUtente, id_evento]);
  if (!partecipazione) {
    fs.unlinkSync(richiesta.file.path);
    return risposta.status(403).json({ error: 'Non sei un partecipante' });
  }
  if (partecipazione.scatti_usati >= evento.scatti_per_utente) {
    fs.unlinkSync(richiesta.file.path);
    return risposta.status(409).json({ error: 'Scatti esauriti', redirect: '/eventi/miei' });
  }

  // Percorso relativo usato come URL pubblico dalla frontend (senza host)
  const url_originale = `/uploads/${id_evento}/${richiesta.file.filename}`;

  transaction(() => {
    run(`INSERT INTO FOTO (id_foto,id_evento,id_autore,url_originale,stato_moderazione,visibile) VALUES (?,?,?,?,'approvata',0)`,
      [uuid(), id_evento, idUtente, url_originale]);
    run('UPDATE PARTECIPA SET scatti_usati=scatti_usati+1 WHERE id_utente=? AND id_evento=?', [idUtente, id_evento]);
    run('UPDATE UTENTE SET scatti_totali=scatti_totali+1 WHERE id_utente=?', [idUtente]);
  });

  const partecipazioneAggiornata = get<{ scatti_usati:number }>(
    'SELECT scatti_usati FROM PARTECIPA WHERE id_utente=? AND id_evento=?', [idUtente, id_evento]);
  const scattiUsati = partecipazioneAggiornata?.scatti_usati ?? partecipazione.scatti_usati + 1;
  const scattiEsauriti = scattiUsati >= evento.scatti_per_utente;

  // Controlla se tutti i partecipanti hanno finito gli scatti → chiusura anticipata
  if (scattiEsauriti) chiusuraAnticipataSeEsaurito(id_evento).catch(console.error);

  return risposta.json({
    message: 'Scatto ricevuto',
    scatti_usati: scattiUsati,
    scatti_totali: evento.scatti_per_utente,
    esauriti: scattiEsauriti,
    ...(scattiEsauriti && { redirect: '/eventi/miei' }),
  });
});

/**
 * POST /foto/vota
 * Registra il voto dell'utente per una foto.
 * Regole:
 *  - L'evento deve essere in stato 'album_aperto'
 *  - La finestra di votazione non deve essere scaduta
 *  - L'utente non può votare le proprie foto
 *  - Ogni partecipante dispone di un solo voto per evento
 */
router.post('/vota', (richiesta: RichiestaAutenticata, risposta: Response) => {
  const idUtente  = richiesta.user!.id_utente;
  const { id_foto } = richiesta.body;

  if (!id_foto) return risposta.status(400).json({ error: 'id_foto mancante' });

  const foto = get<{ id_foto:string; id_evento:string; id_autore:string; visibile:number; stato_moderazione:string }>(
    'SELECT * FROM FOTO WHERE id_foto=?', [id_foto]);
  if (!foto) return risposta.status(404).json({ error: 'Foto non trovata' });
  if (!foto.visibile || foto.stato_moderazione !== 'approvata')
    return risposta.status(409).json({ error: 'Foto non disponibile' });

  const evento = get<{ stato:string; album_sbloccato_at:string|null; durata_votazione:number }>(
    'SELECT stato,album_sbloccato_at,durata_votazione FROM EVENTO WHERE id_evento=?', [foto.id_evento]);
  if (!evento) return risposta.status(404).json({ error: 'Evento non trovato' });
  if (evento.stato !== 'album_aperto') return risposta.status(409).json({ error: 'Finestra di votazione non attiva' });
  if (!evento.album_sbloccato_at) return risposta.status(409).json({ error: 'Album non sbloccato' });

  // Verifica che la finestra di votazione non sia scaduta (calcolo in JS per coerenza dei formati)
  const fineVotazioneMs = new Date(evento.album_sbloccato_at).getTime() + calcolaMinutiVotazione(evento.durata_votazione) * TRASFORMA_IN_MINUTI;
  if (Date.now() > fineVotazioneMs) return risposta.status(410).json({ error: 'Finestra di votazione scaduta' });

  // Prevenzione auto-voto (controllo cross-table, non gestibile con CHECK di SQLite)
  if (foto.id_autore === idUtente) return risposta.status(403).json({ error: 'Non puoi votare le tue foto' });

  const partecipazione = get<{ ha_votato:number }>(
    'SELECT ha_votato FROM PARTECIPA WHERE id_utente=? AND id_evento=?', [idUtente, foto.id_evento]);
  if (!partecipazione) return risposta.status(403).json({ error: 'Non sei un partecipante' });
  if (partecipazione.ha_votato) return risposta.status(409).json({ error: 'Hai già votato per questo evento' });

  try {
    transaction(() => {
      run('INSERT INTO VOTO (id_voto,id_votante,id_foto,id_evento) VALUES (?,?,?,?)', [uuid(), idUtente, id_foto, foto.id_evento]);
      run('UPDATE FOTO SET punteggio_voti=punteggio_voti+1 WHERE id_foto=?', [id_foto]);
      run('UPDATE UTENTE SET voti_ricevuti=voti_ricevuti+1 WHERE id_utente=?', [foto.id_autore]);
      run('UPDATE PARTECIPA SET ha_votato=1 WHERE id_utente=? AND id_evento=?', [idUtente, foto.id_evento]);
    });
    return risposta.json({ message: 'Voto registrato', voto_espresso: true });
  } catch (e: unknown) {
    // Il vincolo UNIQUE su VOTO(id_votante, id_foto) impedisce voti duplicati a livello DB
    if ((e as { message?:string }).message?.includes('UNIQUE'))
      return risposta.status(409).json({ error: 'Hai già votato per questo evento' });
    console.error('[POST /foto/vota]', e);
    return risposta.status(500).json({ error: 'Errore interno' });
  }
});

/**
 * GET /foto/galleria/:id_evento
 * Restituisce le foto di un evento (solo dopo la fase di sviluppo).
 * Include:
 *  - Tutte le foto approvate e visibili con i dati dell'autore
 *  - Flag is_own_photo e user_has_voted_this per personalizzare la UI
 *  - La classifica finale top-3 (solo quando l'evento è chiuso)
 *  - La scadenza della finestra di votazione (calcolata in JS)
 */
router.get('/galleria/:id_evento', (richiesta: RichiestaAutenticata, risposta: Response) => {
  const idUtente  = richiesta.user!.id_utente;
  const { id_evento } = richiesta.params;

  const evento = get<{ stato:string; album_sbloccato_at:string|null; durata_votazione:number }>(
    'SELECT stato,album_sbloccato_at,durata_votazione FROM EVENTO WHERE id_evento=?', [id_evento]);
  if (!evento) return risposta.status(404).json({ error: 'Evento non trovato' });

  // La galleria è accessibile solo dopo lo sviluppo (album_aperto o chiusa)
  if (!['album_aperto', 'chiusa'].includes(evento.stato)) {
    const messaggioNonDisponibile = evento.stato === 'sviluppo'
      ? "L'album è ancora in sviluppo. Torna tra qualche ora!"
      : 'La galleria non è ancora disponibile.';
    return risposta.status(403).json({ error: messaggioNonDisponibile });
  }

  const foto = all(
    `SELECT f.id_foto,f.url_originale,f.punteggio_voti,f.timestamp_scatto,
     u.id_utente AS id_autore,u.nome,u.cognome,u.foto_profilo_url,
     CASE WHEN f.id_autore=? THEN 1 ELSE 0 END AS is_own_photo,
     CASE WHEN v.id_voto IS NOT NULL THEN 1 ELSE 0 END AS user_has_voted_this
     FROM FOTO f JOIN UTENTE u ON u.id_utente=f.id_autore
     LEFT JOIN VOTO v ON v.id_foto=f.id_foto AND v.id_votante=?
     WHERE f.id_evento=? AND f.visibile=1 AND f.stato_moderazione='approvata'
     ORDER BY f.timestamp_scatto ASC`,
    [idUtente, idUtente, id_evento]
  );

  const partecipazione = get<{ ha_votato:number }>(
    'SELECT ha_votato FROM PARTECIPA WHERE id_utente=? AND id_evento=?', [idUtente, id_evento]);

  // voting_end_at calcolata in JS per coerenza del formato timestamp (no datetime() di SQLite)
  const fineVotazioneAt = evento.album_sbloccato_at
    ? addMinutesNaive(evento.album_sbloccato_at, calcolaMinutiVotazione(evento.durata_votazione))
    : null;

  // La classifica top-3 è visibile a tutti i partecipanti solo dopo la chiusura definitiva.
  // La foto mostrata per ogni autore è quella con il maggior numero di voti (in caso di
  // parità, la più vecchia), non una foto casuale — SQLite non garantisce quale riga viene
  // restituita quando l'aggregazione GROUP BY non include tutte le colonne SELECT.
  const classifica = evento.stato === 'chiusa'
    ? all(
        `SELECT u.nome, u.cognome, u.foto_profilo_url,
           (SELECT f2.id_foto FROM FOTO f2
            WHERE f2.id_autore=f.id_autore AND f2.id_evento=? AND f2.visibile=1
            ORDER BY f2.punteggio_voti DESC, f2.timestamp_scatto ASC LIMIT 1) AS id_foto,
           (SELECT f2.url_originale FROM FOTO f2
            WHERE f2.id_autore=f.id_autore AND f2.id_evento=? AND f2.visibile=1
            ORDER BY f2.punteggio_voti DESC, f2.timestamp_scatto ASC LIMIT 1) AS url_originale,
           SUM(f.punteggio_voti) AS punteggio_voti
         FROM FOTO f JOIN UTENTE u ON u.id_utente=f.id_autore
         WHERE f.id_evento=? AND f.visibile=1
         GROUP BY f.id_autore
         ORDER BY punteggio_voti DESC, MIN(f.timestamp_scatto) ASC LIMIT 3`,
        [id_evento, id_evento, id_evento]
      )
    : []; // Nascosta durante la votazione per non influenzare i voti

  return risposta.json({
    foto,
    ha_votato: !!partecipazione?.ha_votato,
    stato: evento.stato,
    album_sbloccato_at: evento.album_sbloccato_at,
    durata_votazione: evento.durata_votazione,
    voting_end_at: fineVotazioneAt,
    classifica,
  });
});

export default router;
