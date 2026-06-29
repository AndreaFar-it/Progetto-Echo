import { Router, Response }  from 'express';
import multer                 from 'multer';
import path                   from 'path';
import fs                     from 'fs';
import bcrypt                  from 'bcryptjs';
import { v4 as uuid }          from 'uuid';
import { run, get, all, transaction } from '../db/database';
import { authMiddleware, RichiestaAutenticata } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

const SALT = 12;

// RAGGRUPPAMENTO DATI PROFILO
// Recupera le informazioni dell'utente, il conteggio degli eventi, i badge e lo storico.
router.get('/profilo', (richiesta: RichiestaAutenticata, risposta: Response) => {
  const idUtente = richiesta.user!.id_utente;
  const utente = get('SELECT nome,cognome,foto_profilo_url,data_registrazione,scatti_totali,voti_ricevuti FROM UTENTE WHERE id_utente=?', [idUtente]);
  if (!utente) return risposta.status(404).json({ error: 'Utente non trovato' });
  const eventi_count = get<{ cnt:number }>(
    `SELECT COUNT(DISTINCT e.id_evento) AS cnt FROM EVENTO e
     LEFT JOIN PARTECIPA p ON p.id_evento=e.id_evento AND p.id_utente=?
     WHERE e.id_organizzatore=? OR p.id_utente=?`, [idUtente, idUtente, idUtente])?.cnt ?? 0;
  const badge = all('SELECT id_badge,tipo,etichetta,data_emissione FROM BADGE WHERE id_utente=? ORDER BY data_emissione DESC', [idUtente]);
  const archivio = all(
    `SELECT DISTINCT e.id_evento,e.nome,e.data_inizio,e.stato FROM EVENTO e
     LEFT JOIN PARTECIPA p ON p.id_evento=e.id_evento AND p.id_utente=?
     WHERE e.id_organizzatore=? OR p.id_utente=? ORDER BY e.data_inizio DESC`, [idUtente, idUtente, idUtente]);
  return risposta.json({ utente, eventi_count, badge, archivio });
});

// GESTIONE CARICAMENTO IMMAGINI
// Configurazione di Multer per il salvataggio locale delle foto profilo (Max 15MB, JPEG/PNG/WEBP).
const profileStorage = multer.diskStorage({
  destination(_req, _f, cb) {
    const dir = path.join(__dirname, '../../uploads/profili');
    fs.mkdirSync(dir, { recursive: true }); cb(null, dir);
  },
  filename(_req, _f, cb) { cb(null, `${uuid()}.jpg`); },
});
const uploadProfilePic = multer({
  storage: profileStorage, limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(_r, f, cb) { cb(null, ['image/jpeg','image/png','image/webp'].includes(f.mimetype)); },
});

// AGGIORNAMENTO FOTO PROFILO
// Sostituisce l'immagine utente ed elimina il vecchio file dal server per risparmiare spazio.
router.post('/foto-profilo', uploadProfilePic.single('foto'), (richiesta: RichiestaAutenticata, risposta: Response) => {
  const idUtente = richiesta.user!.id_utente;
  if (!richiesta.file) return risposta.status(400).json({ error: 'Nessun file ricevuto' });

  const url_originale = `/uploads/profili/${richiesta.file.filename}`;

  const prev = get<{ foto_profilo_url: string | null }>('SELECT foto_profilo_url FROM UTENTE WHERE id_utente=?', [idUtente]);
  run('UPDATE UTENTE SET foto_profilo_url=? WHERE id_utente=?', [url_originale, idUtente]);

  if (prev?.foto_profilo_url?.startsWith('/uploads/profili/')) {
    const oldPath = path.join(__dirname, '../..', prev.foto_profilo_url);
    fs.unlink(oldPath, () => { /* Pulizia best-effort, ignora errori */ });
  }

  return risposta.json({ message: 'Immagine profilo aggiornata', foto_profilo_url: url_originale });
});

// REGISTRAZIONE TOKEN PUSH (FCM)
// Associa un token di notifica al singolo utente. Eventuali nuovi login sovrascrivono il precedente.
router.post('/push-token', (richiesta: RichiestaAutenticata, risposta: Response) => {
  const idUtente = richiesta.user!.id_utente;
  const { token } = richiesta.body;
  if (!token) return risposta.status(400).json({ error: 'Token mancante' });
  run('UPDATE UTENTE SET push_token=? WHERE id_utente=?', [token, idUtente]);
  return risposta.json({ message: 'Token registrato' });
});

// CAMBIO PASSWORD
// Valida la password corrente e aggiorna l'hash di sicurezza sul database.
router.post('/password', async (richiesta: RichiestaAutenticata, risposta: Response) => {
  const idUtente = richiesta.user!.id_utente;
  const { password_attuale, nuova_password } = richiesta.body;
  if (!password_attuale || !nuova_password)
    return risposta.status(400).json({ error: 'Password attuale e nuova password sono obbligatorie' });
  if (nuova_password.length < 8)
    return risposta.status(400).json({ error: 'La nuova password deve avere almeno 8 caratteri' });

  const user = get<{ password_hash: string }>('SELECT password_hash FROM UTENTE WHERE id_utente=?', [idUtente]);
  if (!user) return risposta.status(404).json({ error: 'Utente non trovato' });

  const valid = await bcrypt.compare(password_attuale, user.password_hash);
  // Usa lo status 400 invece di 401 per evitare che l'intercettore frontend forzi il logout per un semplice errore di battitura.
  if (!valid) return risposta.status(400).json({ error: 'Password attuale non corretta' });

  const newHash = await bcrypt.hash(nuova_password, SALT);
  run('UPDATE UTENTE SET password_hash=? WHERE id_utente=?', [newHash, idUtente]);
  return risposta.json({ message: 'Password aggiornata con successo' });
});

// ELIMINAZIONE ACCOUNT IN TRANSAZIONE
// Rimuove l'utente e pulisce a cascata tutte le sue dipendenze (voti, foto, eventi organizzati) per rispettare i vincoli FK del database.
router.delete('/account', (richiesta: RichiestaAutenticata, risposta: Response) => {
  const idUtente = richiesta.user!.id_utente;
  const user = get<{ id_utente: string; foto_profilo_url: string | null }>(
    'SELECT id_utente, foto_profilo_url FROM UTENTE WHERE id_utente=?', [idUtente]);
  if (!user) return risposta.status(404).json({ error: 'Utente non trovato' });

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

    return risposta.json({ message: 'Account eliminato definitivamente' });
  } catch (e) {
    console.error('[DELETE /utente/account]', e);
    return risposta.status(500).json({ error: 'Errore interno durante l\'eliminazione' });
  }
});

export default router;