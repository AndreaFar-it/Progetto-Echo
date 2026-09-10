// Normalizzazione e validazione del body. Il controllo di TIPO è la parte essenziale:
// req.body viene da JSON.parse, quindi un campo può non essere una stringa.

// Ritorna la stringa normalizzata (senza spazi ai bordi), oppure null se il valore
// non è una stringa utilizzabile o supera la lunghezza massima consentita.
export function normalizzaTesto(valore: unknown, lunghezzaMax = 200): string | null {
  if (typeof valore !== 'string') return null;
  const pulito = valore.trim();
  return pulito.length === 0 || pulito.length > lunghezzaMax ? null : pulito;
}

// Email in minuscolo e senza spazi, null se non è plausibile. Restituire sempre la forma
// normalizzata evita di confrontarla in un formato e salvarla in un altro.
export function normalizzaEmail(valore: unknown): string | null {
  const pulito = normalizzaTesto(valore, 254);
  if (!pulito) return null;
  const normalizzata = pulito.toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizzata) ? normalizzata : null;
}

// Criteri di robustezza della password, in un unico punto: la stessa catena di regex
// era ripetuta in tre handler diversi (registrazione, reset via OTP, cambio password).
export function passwordRobusta(valore: unknown): valore is string {
  return typeof valore === 'string'
    && valore.length >= 8
    && /[A-Z]/.test(valore) // lettera maiuscola
    && /[a-z]/.test(valore) // lettera minuscola
    && /[0-9]/.test(valore) // numero
    && /[^A-Za-z0-9]/.test(valore); // tutto tranne lettere e numeri (carattere speciale)
}

// Messaggio unico associato al criterio sopra, così testo e regola restano allineati.
export const ERRORE_PASSWORD = 'Password non soddisfa i criteri di sicurezza. Deve contenere almeno un carattere maiuscolo, uno minuscolo, un numero e un simbolo speciale.';
