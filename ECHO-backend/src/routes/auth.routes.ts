import {
  Router,
  Request,
  Response
} from 'express';

import { MINUTI_TIMEOUT_OTP, GIRI_BCRYPT } from '../config';
import { v4 as uuid } from 'uuid'; //Importiamo L'identificatore univoco universale di quarta generazione formato da 36 caratteri alfanumerici.
import bcrypt from 'bcryptjs';// Libreria bcryptjs fornisce funzioni per l'hashing sicuro delle password e la verifica degli hash.

import {
  run,
  get
} from '../db/database';
import { signToken } from '../middleware/auth';
import { adessoUTC, aggiungiMinutiUTC } from '../utils/time';

const router = Router();

// Hash fittizio per prevenire attacchi di timing durante il login.
const falsoHash = bcrypt.hashSync('echo-password-fittizia-anti-timing', GIRI_BCRYPT);

//Richiesta di registrazione di un nuovo utente.
//La password viene hashata con bcrypt prima di essere salvata nel database.
router.post('/registrazione', async (req: Request, res: Response) => {
  const { nome, cognome, email, password } = req.body;

  // Validazione campi obbligatori (HTTP 400 Bad Request se mancano campi)
  if (!nome || !cognome || !email || !password)
    return res.status(400).json({ error: 'Tutti i campi sono obbligatori' });
  if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password))
    return res.status(400).json({ error: 'Password non soddisfa i criteri di sicurezza. Deve contenere almeno un carattere maiuscolo, uno minuscolo, un numero e un simbolo speciale.' });

  // Verifica che l'email non sia già registrata
  if (get('SELECT 1 FROM UTENTE WHERE email=?', [email]))
    return res.status(409).json({ error: 'Email già registrata' });// HTTP 409 Conflict se esiste già un utente con la stessa email

  const hashPassword = await bcrypt.hash(password, GIRI_BCRYPT);
  const idUtente = uuid();

  run('INSERT INTO UTENTE (id_utente,nome,cognome,email,password_hash,data_registrazione) VALUES (?,?,?,?,?,?)',
    [idUtente, nome.trim(), cognome.trim(), email.toLowerCase().trim(), hashPassword, adessoUTC()]);

  // Restituisce un token JWT firmato con l'id_utente e l'email appena registrati, insieme ai dati dell'utente. (HTTP 201 Created)
  return res.status(201).json({ token: signToken({ id_utente: idUtente, email }), id_utente: idUtente, nome, cognome });
});

// Controlla se un'email è già registrata (usato per dare feedback anticipato in fase di
// registrazione, prima di far compilare il resto del form). La duplicazione è comunque
// bloccata "sul serio" da /registrazione, che risponde 409 se l'email esiste già.
router.post('/check-email', (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email obbligatoria' });

  const emailNormalizzata = String(email).toLowerCase().trim();
  const exists = !!get('SELECT 1 FROM UTENTE WHERE email=?', [emailNormalizzata]);

  return res.json({ exists });
});

//Richiesta di login di un utente esistente.
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: 'Email e password sono obbligatorie' });

  const utente = get<{ id_utente: string; email: string; password_hash: string; nome: string; cognome: string }>(
    'SELECT * FROM UTENTE WHERE email=?', [email.toLowerCase().trim()]
  );

  // Eseguito sempre per evitare timing attack: senza questo, un'email inesistente
  // impiegherebbe meno tempo di bcrypt, rivelando l'esistenza dell'account.
  const hash = utente ? utente.password_hash : falsoHash;
  const passwordValida = await bcrypt.compare(password, hash);

  if (!utente || !passwordValida) return res.status(401).json({ error: 'Credenziali non valide' });

  return res.json({
    token: signToken({ id_utente: utente.id_utente, email: utente.email }),
    id_utente: utente.id_utente,
    nome: utente.nome,
    cognome: utente.cognome,
  });
});


router.post('/forgot-password', (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email obbligatoria' });

  const emailNormalizzata = email.toLowerCase().trim();
  const utente = get<{ id_utente: string; reset_otp: string | null; reset_otp_expires_at: string | null }>(
    'SELECT id_utente, reset_otp, reset_otp_expires_at FROM UTENTE WHERE email=?', [emailNormalizzata]
  );

  if (utente) {
    const adesso = adessoUTC();
    const otpAncorValido = utente.reset_otp && utente.reset_otp_expires_at && adesso < utente.reset_otp_expires_at;
    if (otpAncorValido)
      return res.status(429).json({ error: 'Hai già richiesto un OTP. Potrai richiederne uno nuovo alle ' + utente.reset_otp_expires_at });

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const scadenzaOtp = aggiungiMinutiUTC(adesso, MINUTI_TIMEOUT_OTP);
    run('UPDATE UTENTE SET reset_otp=?, reset_otp_expires_at=? WHERE id_utente=?', [otp, scadenzaOtp, utente.id_utente]);
    console.log(`[Auth] OTP recupero password per ${emailNormalizzata}: ${otp} (scade alle ${scadenzaOtp})`);
  }

  // Risposta generica: non rivela se l'email esiste (anti-enumerazione).
  // Nota: il 429 sopra rompe questa garanzia per utenti con OTP attivo — trade-off accettato per il rate limiting.
  return res.json({ message: 'Se l\'email è registrata, riceverai il codice OTP.' });
});

// Richiesta di verifica OTP e reset della password.
// L'OTP viene invalidato immediatamente dopo la verifica per prevenire replay.
router.post('/verify-reset-otp', async (req: Request, res: Response) => {
  const { email, otp, nuova_password } = req.body;

  if (!email || !otp || !nuova_password)
    return res.status(400).json({ error: 'Email, OTP e nuova password sono obbligatori' });
  if (nuova_password.length < 8 || !/[A-Z]/.test(nuova_password) || !/[a-z]/.test(nuova_password) || !/[0-9]/.test(nuova_password) || !/[^A-Za-z0-9]/.test(nuova_password))
    return res.status(400).json({ error: 'Password non soddisfa i criteri di sicurezza. Deve contenere almeno un carattere maiuscolo, uno minuscolo, un numero e un simbolo speciale.' });

  const emailNormalizzata = email.toLowerCase().trim();
  const utente = get<{ id_utente: string; reset_otp: string | null; reset_otp_expires_at: string | null }>(
    'SELECT id_utente, reset_otp, reset_otp_expires_at FROM UTENTE WHERE email=?', [emailNormalizzata]
  );

  if (!utente || !utente.reset_otp)
    return res.status(400).json({ error: 'OTP non valido o scaduto' });
  if (adessoUTC() > utente.reset_otp_expires_at!)
    return res.status(400).json({ error: 'OTP scaduto. Richiedi un nuovo codice.' });

  // OTP brucia al primo tentativo — cancella subito per bloccare brute-force e replay
  if (utente.reset_otp !== String(otp).trim()) {
    run('UPDATE UTENTE SET reset_otp=NULL, reset_otp_expires_at=NULL WHERE id_utente=?', [utente.id_utente]);
    return res.status(400).json({ error: 'OTP non corretto' });
  }

  const nuovoHash = await bcrypt.hash(nuova_password, GIRI_BCRYPT);
  run('UPDATE UTENTE SET password_hash=?, reset_otp=NULL, reset_otp_expires_at=NULL WHERE id_utente=?', [nuovoHash, utente.id_utente]);

  return res.json({ message: 'Password aggiornata con successo!' });
});

export default router;
