// Gemello di ECHO-backend/src/utils/validation.ts. Le due copie esistono perché i due
// progetti hanno build separate e nessun modulo condiviso: questa dà la risposta subito
// all'utente, quella è l'unica che conta davvero, perché un client si aggira.
// Se cambi una regola qui, cambiala anche là.

// Stessa regex del backend: almeno due caratteri dopo l'ultimo punto.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function emailValida(valore: string): boolean {
  return EMAIL.test(valore.trim().toLowerCase());
}

// Otto caratteri, una maiuscola, una minuscola, una cifra e un simbolo.
export function passwordRobusta(valore: string): boolean {
  return valore.length >= 8
    && /[A-Z]/.test(valore)
    && /[a-z]/.test(valore)
    && /[0-9]/.test(valore)
    && /[^A-Za-z0-9]/.test(valore);
}

// Messaggio unico associato al criterio sopra, così testo e regola restano allineati.
export const ERRORE_PASSWORD = 'Password non soddisfa i criteri di sicurezza. Deve contenere almeno un carattere maiuscolo, uno minuscolo, un numero e un simbolo speciale.';

export const ERRORE_EMAIL = 'Inserisci un indirizzo email valido.';
