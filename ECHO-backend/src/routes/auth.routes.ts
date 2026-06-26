import { Router, Request, Response } from 'express';
import { v4 as uuid }               from 'uuid';
import bcrypt                        from 'bcryptjs';
import { run, get }                  from '../db/database';
import { signToken }                 from '../middleware/auth';

const router = Router();

/** Numero di giri di bcrypt per l'hashing delle password.
 *  12 è il minimo raccomandato per la sicurezza in produzione. */
const GIRI_BCRYPT = 12;

/**
 * POST /registrazione
 * Registra un nuovo utente con nome, cognome, email e password.
 * Ritorna un token JWT e i dati essenziali dell'utente appena creato.
 */
router.post('/registrazione', async (richiesta: Request, risposta: Response) => {
  const { nome, cognome, email, password } = richiesta.body;

  // Validazione campi obbligatori
  if (!nome || !cognome || !email || !password)
    return risposta.status(400).json({ error: 'Tutti i campi sono obbligatori' });
  if (password.length < 8)
    return risposta.status(400).json({ error: 'Password minimo 8 caratteri' });

  // Verifica che l'email non sia già registrata
  if (get('SELECT 1 FROM UTENTE WHERE email=?', [email]))
    return risposta.status(409).json({ error: 'Email già registrata' });

  const hashPassword = await bcrypt.hash(password, GIRI_BCRYPT);
  const idUtente = uuid();

  run('INSERT INTO UTENTE (id_utente,nome,cognome,email,password_hash) VALUES (?,?,?,?,?)',
    [idUtente, nome.trim(), cognome.trim(), email.toLowerCase().trim(), hashPassword]);

  return risposta.status(201).json({ token: signToken({ id_utente: idUtente, email }), id_utente: idUtente, nome, cognome });
});

/**
 * POST /check-email
 * Controlla se un'email è già registrata nel sistema.
 * Usato dal flusso di registrazione per bloccare l'avanzamento con email duplicate.
 * Non rappresenta un vettore di enumerazione aggiuntivo rispetto al 409 di /registrazione.
 */
router.post('/check-email', (richiesta: Request, risposta: Response) => {
  const { email } = richiesta.body;
  if (!email) return risposta.status(400).json({ error: 'Email obbligatoria' });

  const esisteGia = !!get('SELECT 1 FROM UTENTE WHERE email=?', [String(email).toLowerCase().trim()]);
  return risposta.json({ exists: esisteGia });
});

/**
 * POST /login
 * Autentica un utente tramite email e password.
 * Usa bcrypt.compare() con un hash fittizio per i tentativi con email inesistente,
 * in modo da prevenire attacchi a tempo (timing attack) sull'esistenza dell'account.
 */
router.post('/login', async (richiesta: Request, risposta: Response) => {
  const { email, password } = richiesta.body;

  const utente = get<{ id_utente:string; email:string; password_hash:string; nome:string; cognome:string }>(
    'SELECT * FROM UTENTE WHERE email=?', [email?.toLowerCase().trim()]
  );

  // Compara sempre (anche se l'utente non esiste) per evitare timing attack
  const passwordValida = await bcrypt.compare(
    password ?? '',
    utente?.password_hash ?? '$2b$12$invalidhashpadding00000000000000000'
  );

  if (!utente || !passwordValida) return risposta.status(401).json({ error: 'Credenziali non valide' });

  return risposta.json({
    token: signToken({ id_utente: utente.id_utente, email: utente.email }),
    id_utente: utente.id_utente,
    nome: utente.nome,
    cognome: utente.cognome,
  });
});

/**
 * POST /forgot-password
 * Avvia il flusso di recupero password generando un OTP a 6 cifre valido 15 minuti.
 * NOTA: non invia email reali — l'OTP viene stampato su console (solo per demo/sviluppo).
 * Risponde sempre con lo stesso messaggio indipendentemente dall'esistenza dell'email
 * (anti-enumerazione: impedisce di scoprire quali email sono registrate).
 */
router.post('/forgot-password', (richiesta: Request, risposta: Response) => {
  const { email } = richiesta.body;
  if (!email) return risposta.status(400).json({ error: 'Email obbligatoria' });

  const emailNormalizzata = String(email).toLowerCase().trim();
  const utente = get<{ id_utente: string }>('SELECT id_utente FROM UTENTE WHERE email=?', [emailNormalizzata]);

  if (utente) {
    // Genera OTP casuale a 6 cifre e imposta la scadenza a 15 minuti da adesso
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const scadeAlle = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    run('UPDATE UTENTE SET reset_otp=?, reset_otp_expires_at=? WHERE id_utente=?',
      [otp, scadeAlle, utente.id_utente]);

    // In produzione questo log verrebbe sostituito da un invio email reale
    console.log(`[Auth] OTP recupero password per ${emailNormalizzata}: ${otp} (scade alle ${scadeAlle})`);
  }

  // Risposta generica per non rivelare se l'email esiste nel sistema
  return risposta.json({ message: 'Se l\'email è registrata, riceverai il codice OTP.' });
});

/**
 * POST /verify-reset-otp
 * Verifica l'OTP di recupero e aggiorna la password dell'utente.
 * L'OTP viene cancellato immediatamente alla prima verifica (valida o meno)
 * per prevenire attacchi brute-force e replay.
 */
router.post('/verify-reset-otp', async (richiesta: Request, risposta: Response) => {
  const { email, otp, nuova_password } = richiesta.body;

  if (!email || !otp || !nuova_password)
    return risposta.status(400).json({ error: 'Email, OTP e nuova password sono obbligatori' });
  if (nuova_password.length < 8)
    return risposta.status(400).json({ error: 'La nuova password deve avere almeno 8 caratteri' });

  const emailNormalizzata = String(email).toLowerCase().trim();
  const utente = get<{ id_utente: string; reset_otp: string | null; reset_otp_expires_at: string | null }>(
    'SELECT id_utente, reset_otp, reset_otp_expires_at FROM UTENTE WHERE email=?', [emailNormalizzata]
  );

  // Cancella immediatamente l'OTP per impedire brute-force e replay, anche se la verifica fallisce
  if (utente) run('UPDATE UTENTE SET reset_otp=NULL, reset_otp_expires_at=NULL WHERE id_utente=?', [utente.id_utente]);

  if (!utente || !utente.reset_otp)
    return risposta.status(400).json({ error: 'OTP non valido o scaduto' });
  if (!utente.reset_otp_expires_at || Date.now() > new Date(utente.reset_otp_expires_at).getTime())
    return risposta.status(400).json({ error: 'OTP scaduto. Richiedi un nuovo codice.' });
  if (utente.reset_otp !== String(otp).trim())
    return risposta.status(400).json({ error: 'OTP non corretto' });

  const nuovoHash = await bcrypt.hash(nuova_password, GIRI_BCRYPT);
  run('UPDATE UTENTE SET password_hash=? WHERE id_utente=?', [nuovoHash, utente.id_utente]);

  return risposta.json({ message: 'Password aggiornata con successo!' });
});

export default router;
