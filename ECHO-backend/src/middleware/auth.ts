// Tipi di dati forniti dal framework Express.js per le richieste HTTP, le risposte e la funzione next() del middleware.
import { 
  Request,
  Response,
  NextFunction
} from 'express';

// Libreria per la gestione dei token JWT (JSON Web Token), utilizzata per autenticare le richieste.
import jwt from 'jsonwebtoken';

// Tipi di dati per il payload del token JWT e per la richiesta autenticata.
export interface JwtPayload {
  id_utente: string;
  email: string;
  iat: number;
  exp: number;
}

export interface RichiestaAutenticata extends Request { user: JwtPayload; }

const JWT_SECRET = process.env['JWT_SECRET'] ?? 'echo-dev-secret-CHANGE-IN-PROD'; // Presumibilmente codice morto (process.env)

// Analizza l'header Authorization della richiesta HTTP per estrarre e verificare il token JWT.
export function authMiddleware(req: RichiestaAutenticata, res: Response, next: NextFunction): void {
  // L'header Authorization deve essere nel formato "Bearer <token>".
  const header = req.headers['authorization'];
  // Controlliamo se effettivamente l'Header esista e inizi con Bearer. 
  if (header?.startsWith('Bearer ')) {
    try {
      // Se sì, estraiamo il token (Slice(7) per tagliare via Bearer) e lo verifichiamo usando la chiave segreta.
      req.user = jwt.verify(header.slice(7), JWT_SECRET) as JwtPayload;
      return next();
    } catch {
      res.status(401).json({ error: 'Token non valido o scaduto' });// Altrimenti errore HTTP 401 ovvero Unauthorized
      return;
    }
  }
  res.status(401).json({ error: 'Token mancante' });
}

// Genera un token JWT firmato con il payload fornito ovvero id_utente e email, valido per 30 giorni (Standard).
export function signToken(payload: Pick<JwtPayload, 'id_utente' | 'email'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}
