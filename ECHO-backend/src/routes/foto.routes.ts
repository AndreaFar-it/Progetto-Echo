import {
  Router,
  Response
} from 'express';
import { v4 as uuid } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
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
import { chiusuraAnticipataSeEsaurito } from '../services/eventLifecycle.service';
import {
  calcolaMinutiVotazione,
  MS_PER_MINUTO,
  LIMITE_UPLOAD_BYTE
} from '../config';
import {
  adessoUTC,
  aggiungiMinutiUTC
} from '../utils/time';

const router = Router();
router.use(authMiddleware);

// Formato UUID v4
const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Configurazione di multer per la gestione del caricamento dei file (foto).
const archivioFile = multer.diskStorage({
  destination(req: reqAuth, _f, cb) {
    const idEvento = String(req.body.id_evento ?? '');
    // Valida l'id evento sul nascere
    if (!FORMATO_UUID.test(idEvento)) {
      cb(new Error('ID_EVENTO_NON_VALIDO'), '');
      return;
    }
    // Crea la cartella per l'evento se non esiste ancora
    const cartella = path.join(__dirname, '../../uploads', idEvento);
    fs.mkdirSync(cartella, { recursive: true });
    // callback con il percorso della cartella dove salvare il file
    cb(null, cartella);
  },
  filename(_req, _f, cb) {
    // Nome univoco basato su UUID per evitare collisioni
    cb(null, `${uuid()}.jpg`);
  },
});

const caricaFile = multer({
  storage: archivioFile,
  limits: { fileSize: LIMITE_UPLOAD_BYTE },
  fileFilter(_r, f, cb) {
    // Accetta solo formati immagine comuni (no PDF, no GIF, no video)
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(f.mimetype));
  },
});
// Aiuta a gestire correttamente gli errori
function gestisciUploadFoto(req: reqAuth, res: Response, next: () => void): void {
  caricaFile.single('foto')(req, res, (err: unknown) => {
    if (err) {
      const msg = err instanceof Error && err.message === 'ID_EVENTO_NON_VALIDO'
        ? 'id_evento non valido'
        : 'Upload non valido';
      res.status(400).json({ error: msg });
      return;
    }
    next();
  });
}

// Gestisce il caricamento di una foto da parte di un partecipante.
// Controlla che l'evento sia in corso, che il partecipante non abbia esaurito gli scatti e registra la foto nel database.
router.post('/upload', gestisciUploadFoto, async (req: reqAuth, res: Response) => {
  const idUtente = req.user.id_utente;
  const { id_evento } = req.body;

  if (!req.file || !id_evento) return res.status(400).json({ error: 'Dati mancanti' });

  const evento = get<{ stato: string; scatti_per_utente: number }>(
    'SELECT stato,scatti_per_utente FROM EVENTO WHERE id_evento=?', [id_evento]);
  if (!evento) {
    fs.unlinkSync(req.file.path); // Rimuove il file già salvato se l'evento non esiste
    return res.status(404).json({ error: 'Evento non trovato' });
  }
  if (evento.stato !== 'in_corso') {
    fs.unlinkSync(req.file.path);
    return res.status(409).json({ error: 'Acquisizione non attiva' });
  }

  const partecipazione = get<{ scatti_usati: number }>(
    'SELECT scatti_usati FROM PARTECIPA WHERE id_utente=? AND id_evento=?', [idUtente, id_evento]);
  if (!partecipazione) {
    fs.unlinkSync(req.file.path);
    return res.status(403).json({ error: 'Non sei un partecipante' });
  }
  if (partecipazione.scatti_usati >= evento.scatti_per_utente) {
    fs.unlinkSync(req.file.path);
    return res.status(409).json({ error: 'Scatti esauriti', redirect: '/eventi/miei' });
  }

  // Percorso relativo usato come URL pubblico dalla frontend (senza host)
  const url_originale = `/uploads/${id_evento}/${req.file.filename}`;

  transaction(() => {
    run(`INSERT INTO FOTO (id_foto,id_evento,id_autore,url_originale,stato_moderazione,visibile,timestamp_scatto) VALUES (?,?,?,?,'approvata',0,?)`,
      [uuid(), id_evento, idUtente, url_originale, adessoUTC()]);
    run('UPDATE PARTECIPA SET scatti_usati=scatti_usati+1 WHERE id_utente=? AND id_evento=?', [idUtente, id_evento]);
    run('UPDATE UTENTE SET scatti_totali=scatti_totali+1 WHERE id_utente=?', [idUtente]);
  });

  const partecipazioneAggiornata = get<{ scatti_usati: number }>(
    'SELECT scatti_usati FROM PARTECIPA WHERE id_utente=? AND id_evento=?', [idUtente, id_evento]);
  const scattiUsati = partecipazioneAggiornata?.scatti_usati ?? partecipazione.scatti_usati + 1;
  const scattiEsauriti = scattiUsati >= evento.scatti_per_utente;

  // Controlla se tutti i partecipanti hanno finito gli scatti → chiusura anticipata
  if (scattiEsauriti) chiusuraAnticipataSeEsaurito(id_evento).catch(console.error);

  return res.json({
    message: 'Scatto ricevuto',
    scatti_usati: scattiUsati,
    scatti_totali: evento.scatti_per_utente,
    esauriti: scattiEsauriti,
    ...(scattiEsauriti && { redirect: '/eventi/miei' }),
  });
});

// Gestisce la votazione di una foto da parte di un partecipante.
router.post('/vota', (req: reqAuth, res: Response) => {
  const idUtente = req.user.id_utente;
  const { id_foto } = req.body;

  if (!id_foto) return res.status(400).json({ error: 'id_foto mancante' });

  const foto = get<{ id_foto: string; id_evento: string; id_autore: string; visibile: number; stato_moderazione: string }>(
    'SELECT * FROM FOTO WHERE id_foto=?', [id_foto]);
  if (!foto) return res.status(404).json({ error: 'Foto non trovata' });
  if (!foto.visibile || foto.stato_moderazione !== 'approvata')
    return res.status(409).json({ error: 'Foto non disponibile' });

  const evento = get<{ stato: string; album_sbloccato_at: string | null; durata_votazione_ore: number }>(
    'SELECT stato,album_sbloccato_at,durata_votazione_ore FROM EVENTO WHERE id_evento=?', [foto.id_evento]);
  if (!evento) return res.status(404).json({ error: 'Evento non trovato' });
  if (evento.stato !== 'album_aperto') return res.status(409).json({ error: 'Finestra di votazione non attiva' });
  if (!evento.album_sbloccato_at) return res.status(409).json({ error: 'Album non sbloccato' });

  // Verifica che la finestra di votazione non sia scaduta (calcolo in JS per coerenza dei formati)
  const fineVotazioneMs = new Date(evento.album_sbloccato_at).getTime() + calcolaMinutiVotazione(evento.durata_votazione_ore) * MS_PER_MINUTO;
  if (Date.now() > fineVotazioneMs) return res.status(410).json({ error: 'Finestra di votazione scaduta' });

  // Prevenzione auto-voto (controllo cross-table, non gestibile con CHECK di SQLite)
  if (foto.id_autore === idUtente) return res.status(403).json({ error: 'Non puoi votare le tue foto' });

  const partecipazione = get<{ ha_votato: number }>(
    'SELECT ha_votato FROM PARTECIPA WHERE id_utente=? AND id_evento=?', [idUtente, foto.id_evento]);
  if (!partecipazione) return res.status(403).json({ error: 'Non sei un partecipante' });
  if (partecipazione.ha_votato) return res.status(409).json({ error: 'Hai già votato per questo evento' });

  try {
    transaction(() => {
      run('INSERT INTO VOTO (id_voto,id_votante,id_foto,id_evento,timestamp_voto) VALUES (?,?,?,?,?)', [uuid(), idUtente, id_foto, foto.id_evento, adessoUTC()]);
      run('UPDATE FOTO SET punteggio_voti=punteggio_voti+1 WHERE id_foto=?', [id_foto]);
      run('UPDATE UTENTE SET voti_ricevuti=voti_ricevuti+1 WHERE id_utente=?', [foto.id_autore]);
      run('UPDATE PARTECIPA SET ha_votato=1 WHERE id_utente=? AND id_evento=?', [idUtente, foto.id_evento]);
    });
    return res.json({ message: 'Voto registrato', voto_espresso: true });
  } catch (e: unknown) {
    // Il vincolo UNIQUE su VOTO(id_votante, id_foto) impedisce voti duplicati a livello DB
    if ((e as { message?: string }).message?.includes('UNIQUE'))
      return res.status(409).json({ error: 'Hai già votato per questo evento' });
    console.error('[POST /foto/vota]', e);
    return res.status(500).json({ error: 'Errore interno' });
  }
});

// Gestisce la richiesta della galleria fotografica di un evento da parte di un partecipante.
router.get('/galleria/:id_evento', (req: reqAuth, res: Response) => {
  const idUtente = req.user.id_utente;
  const { id_evento } = req.params;

  const evento = get<{ dev_mode: Number; stato: string; album_sbloccato_at: string | null; durata_votazione_ore: number}>(
    'SELECT dev_mode,stato,album_sbloccato_at,durata_votazione_ore FROM EVENTO WHERE id_evento=?', [id_evento]);
  if (!evento) return res.status(404).json({ error: 'Evento non trovato' });

  // La galleria è accessibile solo dopo lo sviluppo (album_aperto o chiusa)
  if (!['album_aperto', 'chiusa'].includes(evento.stato)) {
    const messaggioNonDisponibile = evento.stato === 'sviluppo'
      ? "L'album è ancora in sviluppo. Torna tra qualche ora!"
      : 'La galleria non è ancora disponibile.';
    return res.status(403).json({ error: messaggioNonDisponibile });
  }

  const foto = all(
    `SELECT
      f.id_foto,
      f.url_originale,
      f.punteggio_voti,
      f.timestamp_scatto,
      u.id_utente AS id_autore, u.nome, u.cognome, u.foto_profilo_url,
      (f.id_autore = ?) AS is_own_photo,
      (v.id_foto IS NOT NULL) AS user_has_voted_this
    FROM FOTO f 
    JOIN UTENTE u ON u.id_utente = f.id_autore
    LEFT JOIN VOTO v ON v.id_foto = f.id_foto AND v.id_votante = ?
    WHERE f.id_evento = ? AND f.visibile = 1 AND f.stato_moderazione = 'approvata'
    ORDER BY f.timestamp_scatto ASC`,
    [idUtente, idUtente, id_evento]
  );

  const partecipazione = get<{ ha_votato: number }>(
    'SELECT ha_votato FROM PARTECIPA WHERE id_utente=? AND id_evento=?', [idUtente, id_evento]);

  // voting_end_at calcolata in JS (i timestamp coinvolti sono già ISO assoluti)
  const fineVotazioneAt = evento.album_sbloccato_at
    ? aggiungiMinutiUTC(evento.album_sbloccato_at, calcolaMinutiVotazione(evento.durata_votazione_ore, evento.dev_mode === 1))
    : null;

  const classifica = evento.stato === 'chiusa'
    ? all(
      `SELECT u.nome, u.cognome, u.foto_profilo_url, f.id_foto, f.url_originale, f.punteggio_voti
       FROM FOTO f JOIN UTENTE u ON u.id_utente=f.id_autore
       WHERE f.id_evento=? AND f.visibile=1
       ORDER BY f.punteggio_voti DESC, f.timestamp_scatto ASC
       LIMIT 3`,
      [id_evento]
    )
    : []; // Nascosta durante la votazione per non influenzare i voti

  return res.json({
    foto,
    ha_votato: !!partecipazione?.ha_votato,
    stato: evento.stato,
    album_sbloccato_at: evento.album_sbloccato_at,
    durata_votazione_ore: evento.durata_votazione_ore,
    voting_end_at: fineVotazioneAt,
    classifica,
  });
});

export default router;
