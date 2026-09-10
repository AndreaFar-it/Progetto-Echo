// Tipi di dati forniti dal framework Express.js per le richieste HTTP, le risposte,
// la funzione next() del middleware e la firma di un handler di rotta.
import {
  Request,
  Response,
  NextFunction,
  RequestHandler
} from 'express';

// Express 4 non intercetta le promise rejection: un handler async che lancia produce una
// unhandled rejection, che in Node >= 15 termina il processo. Qui la giriamo a next().
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };
}

// Rotta non montata: mantiene il contratto JSON dell'API invece della pagina HTML
// che Express restituirebbe per default.
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Risorsa non trovata' });
}

// Handler terminale. I quattro argomenti sono obbligatori: Express riconosce un error
// handler dalla lunghezza della firma. Va registrato DOPO tutti i router.
export function errorHandler(errore: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const dettagli = errore as { status?: number; statusCode?: number } | null;
  const statoClient = dettagli?.status ?? dettagli?.statusCode;

  // express.json e simili mettono uno status 4xx sull'errore quando la colpa è del client:
  // va rispettato, altrimenti un JSON malformato diventerebbe un 500.
  if (typeof statoClient === 'number' && statoClient >= 400 && statoClient < 500) {
    if (!res.headersSent) res.status(statoClient).json({ error: 'Richiesta non valida' });
    return;
  }

  console.error('[Errore non gestito]', errore);
  // Se la risposta è già iniziata lo status non è più modificabile.
  if (res.headersSent) return;
  res.status(500).json({ error: 'Errore interno' });
}
