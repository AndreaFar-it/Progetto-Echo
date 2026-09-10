import {
  Router,
  Response
} from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
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
  GIRI_BCRYPT,
  LIMITE_UPLOAD_BYTE
} from '../config';
import { asyncHandler } from '../middleware/errors';// Protegge gli handler async dalle rejection non gestite.
import {
  passwordRobusta,
  ERRORE_PASSWORD
} from '../utils/validation';
import {
  rimuoviCartellaEvento,
  rimuoviFileUpload
} from '../utils/files';

const router = Router();
router.use(authMiddleware);

// Recupera le informazioni dell'utente, il conteggio degli eventi, i badge e lo storico.
router.get('/', (req: reqAuth, res: Response) => {
  const idUtente = req.user.id_utente;
  const utente = get<{ nome: string; cognome: string; foto_profilo_url: string | null; data_registrazione: string; scatti_totali: number; voti_ricevuti: number }>(
    'SELECT nome,cognome,foto_profilo_url,data_registrazione,scatti_totali,voti_ricevuti FROM UTENTE WHERE id_utente=?', [idUtente]);
  if (!utente) return res.status(404).json({ error: 'Utente non trovato' });
  const eventi_count = get<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM PARTECIPA WHERE id_utente=?', [idUtente])?.cnt ?? 0;
  const badge = all<{ id_badge: string; tipo: string; etichetta: string; data_emissione: string }>(
    'SELECT id_badge,tipo,etichetta,data_emissione FROM BADGE WHERE id_utente=? ORDER BY data_emissione DESC', [idUtente]);
  const archivio = all<{ id_evento: string; nome: string; data_inizio: string; stato: string }>(
    `SELECT e.id_evento,e.nome,e.data_inizio,e.stato FROM PARTECIPA p
     JOIN EVENTO e ON e.id_evento=p.id_evento
     WHERE p.id_utente=? ORDER BY e.data_inizio DESC`, [idUtente]);

  return res.json({ utente, eventi_count, badge, archivio });
});

// Configurazione di Multer per il salvataggio locale delle foto profilo (Max 15MB, JPEG/PNG/WEBP).
const profileStorage = multer.diskStorage({
  destination(_req, _f, cb) {
    const dir = path.join(__dirname, '../../uploads/profili');
    fs.mkdirSync(dir, { recursive: true }); cb(null, dir);
  },
  filename(_req, _f, cb) { cb(null, `${uuid()}.jpg`); },
});
const uploadProfilePic = multer({
  storage: profileStorage, limits: { fileSize: LIMITE_UPLOAD_BYTE },
  fileFilter(_r, f, cb) { cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(f.mimetype)); },
});

// Sostituisce l'immagine utente ed elimina il vecchio file dal server per risparmiare spazio.
router.put('/photo', uploadProfilePic.single('foto'), (req: reqAuth, res: Response) => {
  const idUtente = req.user.id_utente;
  if (!req.file) return res.status(400).json({ error: 'Nessun file ricevuto' });

  const url_originale = `/uploads/profili/${req.file.filename}`;

  const prev = get<{ foto_profilo_url: string | null }>('SELECT foto_profilo_url FROM UTENTE WHERE id_utente=?', [idUtente]);
  run('UPDATE UTENTE SET foto_profilo_url=? WHERE id_utente=?', [url_originale, idUtente]);

  // Pulizia best-effort del file precedente: l'helper verifica il contenimento in uploads/.
  if (prev?.foto_profilo_url) rimuoviFileUpload(prev.foto_profilo_url);

  return res.json({ message: 'Immagine profilo aggiornata', foto_profilo_url: url_originale });
});

// Associa un token di notifica al singolo utente. Eventuali nuovi login sovrascrivono il precedente.
router.put('/push-token', (req: reqAuth, res: Response) => {
  const idUtente = req.user.id_utente;
  const token: unknown = req.body.token;
  // Controllo di tipo: un token non stringa arriverebbe al bind di sql.js, che lo rifiuterebbe
  // con un errore interno invece di un onesto 400.
  if (typeof token !== 'string' || !token) return res.status(400).json({ error: 'Token mancante' });
  run('UPDATE UTENTE SET push_token=? WHERE id_utente=?', [token, idUtente]);
  return res.json({ message: 'Token registrato' });
});

// CAMBIO PASSWORD
// Valida la password corrente e aggiorna l'hash di sicurezza sul database.
router.patch('/password', asyncHandler(async (req: reqAuth, res: Response) => {
  const idUtente = req.user.id_utente;
  // Verifica di tipo: bcrypt.compare su un numero solleva "Illegal arguments", non false.
  const password_attuale: unknown = req.body.password_attuale;
  const nuova_password: unknown = req.body.nuova_password;
  if (typeof password_attuale !== 'string' || !password_attuale || !nuova_password)
    return res.status(400).json({ error: 'Password attuale e nuova password sono obbligatorie' });
  // I criteri di robustezza vivono in utils/validation.ts, in un unico punto.
  if (!passwordRobusta(nuova_password))
    return res.status(400).json({ error: ERRORE_PASSWORD });

  const user = get<{ password_hash: string }>('SELECT password_hash FROM UTENTE WHERE id_utente=?', [idUtente]);
  if (!user) return res.status(404).json({ error: 'Utente non trovato' });

  const valid = await bcrypt.compare(password_attuale, user.password_hash);
  // Usa lo status 400 invece di 401 per evitare che l'intercettore frontend forzi il logout per un semplice errore di battitura.
  if (!valid) return res.status(400).json({ error: 'Password attuale non corretta' });

  const newHash = await bcrypt.hash(nuova_password, GIRI_BCRYPT);
  run('UPDATE UTENTE SET password_hash=? WHERE id_utente=?', [newHash, idUtente]);
  return res.json({ message: 'Password aggiornata con successo' });
}));

// Rimuove l'utente e pulisce a cascata tutte le sue dipendenze (voti, foto, eventi organizzati) per rispettare i vincoli FK del database.
router.delete('/', (req: reqAuth, res: Response) => {
  const idUtente = req.user.id_utente;
  const user = get<{ id_utente: string; foto_profilo_url: string | null }>(
    'SELECT id_utente, foto_profilo_url FROM UTENTE WHERE id_utente=?', [idUtente]);
  if (!user) return res.status(404).json({ error: 'Utente non trovato' });

  // Lette una volta sola qui perché servono sia in transazione sia dopo il commit, per la
  // pulizia dei file. Sicuro: sql.js è sincrono, nulla si inserisce prima della transazione.
  const eventiOrganizzati = all<{ id_evento: string }>('SELECT id_evento FROM EVENTO WHERE id_organizzatore=?', [idUtente]);
  const mieFoto = all<{ id_foto: string; url_originale: string }>(
    'SELECT id_foto, url_originale FROM FOTO WHERE id_autore=?', [idUtente]);
  const mieiVoti = all<{ id_foto: string; id_autore: string }>(
    'SELECT v.id_foto, f.id_autore FROM VOTO v JOIN FOTO f ON f.id_foto=v.id_foto WHERE v.id_votante=?', [idUtente]);

  try {
    transaction(() => {
      // 1. Elimina completamente tutti gli eventi organizzati da questo utente e i relativi dati collegati.
      for (const ev of eventiOrganizzati) {
        // I contatori su UTENTE sono denormalizzati, quindi vanno riallineati a mano prima di
        // cancellare le righe che li alimentano. MAX(0,…) è la scalare SQLite, non l'aggregato.
        for (const a of all<{ id_autore: string; n: number }>(
          'SELECT id_autore, COUNT(*) AS n FROM FOTO WHERE id_evento=? GROUP BY id_autore', [ev.id_evento]))
          run('UPDATE UTENTE SET scatti_totali = MAX(0, scatti_totali - ?) WHERE id_utente=?', [a.n, a.id_autore]);
        for (const a of all<{ id_autore: string; n: number }>(
          'SELECT f.id_autore, COUNT(*) AS n FROM VOTO v JOIN FOTO f ON f.id_foto=v.id_foto WHERE v.id_evento=? GROUP BY f.id_autore', [ev.id_evento]))
          run('UPDATE UTENTE SET voti_ricevuti = MAX(0, voti_ricevuti - ?) WHERE id_utente=?', [a.n, a.id_autore]);

        run('DELETE FROM BADGE         WHERE id_evento=?', [ev.id_evento]);
        run('DELETE FROM VOTO          WHERE id_evento=?', [ev.id_evento]);
        run('DELETE FROM FOTO          WHERE id_evento=?', [ev.id_evento]);
        run('DELETE FROM PARTECIPA     WHERE id_evento=?', [ev.id_evento]);
        run('DELETE FROM CODICE_EVENTO WHERE id_evento=?', [ev.id_evento]);
        run('DELETE FROM EVENTO        WHERE id_evento=?', [ev.id_evento]);
      }

      // 2. Rimuove i voti dell'utente negli eventi altrui, scalando sia FOTO.punteggio_voti
      //    sia UTENTE.voti_ricevuti dell'autore: quel voto non esiste più per nessuno.
      for (const v of mieiVoti) {
        run('UPDATE FOTO SET punteggio_voti = MAX(0, punteggio_voti - 1) WHERE id_foto=?', [v.id_foto]);
        run('UPDATE UTENTE SET voti_ricevuti = MAX(0, voti_ricevuti - 1) WHERE id_utente=?', [v.id_autore]);
      }
      run('DELETE FROM VOTO WHERE id_votante=?', [idUtente]);

      // 3. Cancella le foto dell'utente e i voti che avevano ricevuto. Chi le aveva votate
      //    torna a ha_votato=0, altrimenti resterebbe bloccato con un voto ormai cancellato.
      for (const f of mieFoto) {
        run('UPDATE PARTECIPA SET ha_votato=0 WHERE (id_utente, id_evento) IN (SELECT id_votante, id_evento FROM VOTO WHERE id_foto=?)', [f.id_foto]);
        run('DELETE FROM VOTO WHERE id_foto=?', [f.id_foto]);
      }
      run('DELETE FROM FOTO WHERE id_autore=?', [idUtente]);

      // 4. Rimuove i badge personali e i record di partecipazione.
      run('DELETE FROM BADGE     WHERE id_utente=?', [idUtente]);
      run('DELETE FROM PARTECIPA WHERE id_utente=?', [idUtente]);

      // 5. Scollega l'utente dallo storico dei codici di attivazione usati, senza eliminare i codici stessi.
      run('UPDATE CODICE_EVENTO SET id_utente_uso=NULL WHERE id_utente_uso=?', [idUtente]);

      // 6. Elimina definitivamente la riga dell'utente.
      run('DELETE FROM UTENTE WHERE id_utente=?', [idUtente]);
    });

    // I file vanno rimossi DOPO il commit: il filesystem non partecipa alla transazione,
    // quindi cancellarli prima significherebbe perderli in caso di ROLLBACK.
    for (const ev of eventiOrganizzati) rimuoviCartellaEvento(ev.id_evento);
    for (const f of mieFoto) rimuoviFileUpload(f.url_originale);
    if (user.foto_profilo_url) rimuoviFileUpload(user.foto_profilo_url);

    return res.json({ message: 'Account eliminato definitivamente' });
  } catch (e) {
    console.error('[DELETE /utente/account]', e);
    return res.status(500).json({ error: 'Errore interno durante l\'eliminazione' });
  }
});

export default router;