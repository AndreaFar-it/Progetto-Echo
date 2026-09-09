import { HttpErrorResponse } from '@angular/common/http';

// Forma dell'errore del backend: { error: string } dentro il corpo della risposta.
interface CorpoErrore {
  error?: string;
}

// Estrae il messaggio del server, con un ripiego se non ne fornisce uno.
export function messaggioErrore(errore: unknown, ripiego: string): string {
  const corpo = errore instanceof HttpErrorResponse
    ? errore.error
    : (errore as { error?: unknown } | null)?.error;

  // Solo corpo.error: un corpo stringa e' di solito la pagina HTML di un proxy.
  const messaggio = (corpo as CorpoErrore | null)?.error;
  return typeof messaggio === 'string' && messaggio.trim() ? messaggio : ripiego;
}
