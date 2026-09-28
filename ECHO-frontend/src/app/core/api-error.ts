import { HttpErrorResponse } from '@angular/common/http';

// Forma dell'errore del backend: { error: string } dentro il corpo della risposta.
interface BodyError {
  error?: string;
}

// Estrae il messaggio del server, con un ripiego se non ne fornisce uno.
export function messaggioErrore(error: unknown, fallback: string): string {
  const body = error instanceof HttpErrorResponse
    ? error.error
    : (error as { error?: unknown } | null)?.error;

  // Solo corpo.error: un corpo stringa e' di solito la pagina HTML di un proxy.
  const messaggio = (body as BodyError | null)?.error;
  return typeof messaggio === 'string' && messaggio.trim() ? messaggio : fallback;
}
