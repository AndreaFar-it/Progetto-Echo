import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface JwtPayload { id_utente: string; email: string; iat: number; exp: number; }
export interface RichiestaAutenticata extends Request { user?: JwtPayload; }

const JWT_SECRET = process.env['JWT_SECRET'] ?? 'echo-dev-secret-CHANGE-IN-PROD';

const DEV_MOCK: JwtPayload = {
  id_utente: 'usr_andrea_test_id',
  email:     'andrea@echo.dev',
  iat:       Math.floor(Date.now() / 1000),
  exp:       Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
};

/**
 * Middleware di autenticazione JWT. Estrae il token dall'header `Authorization: Bearer ...`,
 * lo verifica e popola `richiesta.user` con il payload decodificato (vedi RichiestaAutenticata,
 * che estende Request con il campo `user`). In ambiente non-production, se il token manca,
 * inietta un utente fittizio (DEV_MOCK) per comodità di sviluppo. Risponde 401 se il token
 * è assente/non valido in produzione.
 */
export function authMiddleware(richiesta: RichiestaAutenticata, risposta: Response, prossimo: NextFunction): void {
  // --- Estrazione del token dall'header ---
  const header = richiesta.headers['authorization'];
  if (header?.startsWith('Bearer ')) {
    try {
      // Verifica firma + scadenza; lancia se il token è alterato o scaduto
      richiesta.user = jwt.verify(header.slice(7), JWT_SECRET) as JwtPayload;
      return prossimo();
    } catch {
      risposta.status(401).json({ error: 'Token non valido o scaduto' });
      return;
    }
  }
  // --- Fallback di sviluppo: nessun token → utente fittizio (mai in produzione) ---
  if (process.env['NODE_ENV'] !== 'production') {
    console.warn('[AUTH] No token — injecting DEV_MOCK_USER (disabled in production)');
    richiesta.user = { ...DEV_MOCK };
    return prossimo();
  }
  risposta.status(401).json({ error: 'Token mancante' });
}

/**
 * Firma un nuovo token JWT per l'utente dato (solo id_utente + email nel payload),
 * con scadenza a 30 giorni. Usato dalle rotte di login/registrazione.
 */
export function signToken(payload: Pick<JwtPayload, 'id_utente' | 'email'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}
