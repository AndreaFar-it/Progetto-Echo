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

const router = Router();
router.use(authMiddleware);

// Recupera le informazioni dell'utente, il conteggio degli eventi, i badge e lo storico.
router.get('/profilo', (req: reqAuth, res: Response) => {
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
router.post('/foto-profilo', uploadProfilePic.single('foto'), (req: reqAuth, res: Response) => {
  const idUtente = req.user.id_utente;
  if (!req.file) return res.status(400).json({ error: 'Nessun file ricevuto' });

  const url_originale = `/uploads/profili/${req.file.filename}`;

  const prev = get<{ foto_profilo_url: string | null }>('SELECT foto_profilo_url FROM UTENTE WHERE id_utente=?', [idUtente]);
  run('UPDATE UTENTE SET foto_profilo_url=? WHERE id_utente=?', [url_originale, idUtente]);

  if (prev?.foto_profilo_url?.startsWith('/uploads/profili/')) {
    const oldPath = path.join(__dirname, '../..', prev.foto_profilo_url);
    fs.unlink(oldPath, () => { /* Pulizia best-effort, ignora errori */ });
  }

  return res.json({ message: 'Immagine profilo aggiornata', foto_profilo_url: url_originale });
});

// Associa un token di notifica al singolo utente. Eventuali nuovi login sovrascrivono il precedente.
router.post('/push-token', (req: reqAuth, res: Response) => {
  const idUtente = req.user.id_utente;
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token mancante' });
  run('UPDATE UTENTE SET push_token=? WHERE id_utente=?', [token, idUtente]);
  return res.json({ message: 'Token registrato' });
});

// CAMBIO PASSWORD
// Valida la password corrente e aggiorna l'hash di sicurezza sul database.
router.post('/password', async (req: reqAuth, res: Response) => {
  const idUtente = req.user.id_utente;
  const { password_attuale, nuova_password } = req.body;
  if (!password_attuale || !nuova_password)
    return res.status(400).json({ error: 'Password attuale e nuova password sono obbligatorie' });
  if (nuova_password.length < 8 || !/[A-Z]/.test(nuova_password) || !/[a-z]/.test(nuova_password) || !/[0-9]/.test(nuova_password) || !/[^A-Za-z0-9]/.test(nuova_password))
    return res.status(400).json({ error: 'Password non soddisfa i criteri di sicurezza. Deve contenere almeno un carattere maiuscolo, uno minuscolo, un numero e un simbolo speciale.' });

  const user = get<{ password_hash: string }>('SELECT password_hash FROM UTENTE WHERE id_utente=?', [idUtente]);
  if (!user) return res.status(404).json({ error: 'Utente non trovato' });

  const valid = await bcrypt.compare(password_attuale, user.password_hash);
  // Usa lo status 400 invece di 401 per evitare che l'intercettore frontend forzi il logout per un semplice errore di battitura.
  if (!valid) return res.status(400).json({ error: 'Password attuale non corretta' });

  const newHash = await bcrypt.hash(nuova_password, GIRI_BCRYPT);
  run('UPDATE UTENTE SET password_hash=? WHERE id_utente=?', [newHash, idUtente]);
  return res.json({ message: 'Password aggiornata con successo' });
});

// Rimuove l'utente e pulisce a cascata tutte le sue dipendenze (voti, foto, eventi organizzati) per rispettare i vincoli FK del database.
router.delete('/account', (req: reqAuth, res: Response) => {
  const idUtente = req.user.id_utente;
  const user = get<{ id_utente: string; foto_profilo_url: string | null }>(
    'SELECT id_utente, foto_profilo_url FROM UTENTE WHERE id_utente=?', [idUtente]);
  if (!user) return res.status(404).json({ error: 'Utente non trovato' });

  try {
    transaction(() => {
      // 1. Elimina completamente tutti gli eventi organizzati da questo utente e i relativi dati collegati.
      const organized = all<{ id_evento: string }>('SELECT id_evento FROM EVENTO WHERE id_organizzatore=?', [idUtente]);
      for (const ev of organized) {
        run('DELETE FROM BADGE         WHERE id_evento=?', [ev.id_evento]);
        run('DELETE FROM VOTO          WHERE id_evento=?', [ev.id_evento]);
        run('DELETE FROM FOTO          WHERE id_evento=?', [ev.id_evento]);
        run('DELETE FROM PARTECIPA     WHERE id_evento=?', [ev.id_evento]);
        run('DELETE FROM CODICE_EVENTO WHERE id_evento=?', [ev.id_evento]);
        run('DELETE FROM EVENTO        WHERE id_evento=?', [ev.id_evento]);
      }

      // 2. Rimuove i voti inseriti dall'utente negli eventi altrui, aggiornando i punteggi delle foto coinvolte.
      const myVotes = all<{ id_foto: string }>('SELECT id_foto FROM VOTO WHERE id_votante=?', [idUtente]);
      for (const v of myVotes) run('UPDATE FOTO SET punteggio_voti = punteggio_voti - 1 WHERE id_foto=?', [v.id_foto]);
      run('DELETE FROM VOTO WHERE id_votante=?', [idUtente]);

      // 3. Cancella le foto caricate dall'utente negli eventi altrui e i voti che tali foto avevano ricevuto.
      const myPhotos = all<{ id_foto: string }>('SELECT id_foto FROM FOTO WHERE id_autore=?', [idUtente]);
      for (const f of myPhotos) run('DELETE FROM VOTO WHERE id_foto=?', [f.id_foto]);
      run('DELETE FROM FOTO WHERE id_autore=?', [idUtente]);

      // 4. Rimuove i badge personali e i record di partecipazione.
      run('DELETE FROM BADGE     WHERE id_utente=?', [idUtente]);
      run('DELETE FROM PARTECIPA WHERE id_utente=?', [idUtente]);

      // 5. Scollega l'utente dallo storico dei codici di attivazione usati, senza eliminare i codici stessi.
      run('UPDATE CODICE_EVENTO SET id_utente_uso=NULL WHERE id_utente_uso=?', [idUtente]);

      // 6. Elimina definitivamente la riga dell'utente.
      run('DELETE FROM UTENTE WHERE id_utente=?', [idUtente]);
    });

    if (user.foto_profilo_url?.startsWith('/uploads/profili/')) {
      fs.unlink(path.join(__dirname, '../..', user.foto_profilo_url), () => { /* Pulizia best-effort */ });
    }

    return res.json({ message: 'Account eliminato definitivamente' });
  } catch (e) {
    console.error('[DELETE /utente/account]', e);
    return res.status(500).json({ error: 'Errore interno durante l\'eliminazione' });
  }
});

export default router;