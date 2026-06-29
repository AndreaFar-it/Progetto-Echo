/**
 * Utility per la gestione delle date "naive" (senza fuso orario).
 * Tutte le date sono trattate come stringhe ISO locali, coerenti con il fuso orario del server.
 */

// Funzioni helper per il padding dei numeri (es. 9 -> '09')
function pad2(n: number): string { return String(n).padStart(2, '0'); }
function pad3(n: number): string { return String(n).padStart(3, '0'); }

/** Converte un oggetto Date in una stringha ISO locale (es. "2026-06-18T17:30:00.000"). */
export function toNaive(d: Date): string {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`
  );
}

/** Ritorna l'orario attuale del server come stringa ISO locale. */
export function nowNaive(): string {
  return toNaive(new Date());
}

// Verifica del fuso orario all'avvio. 
// Il server DEVE essere configurato su "Europe/Rome" (es. tramite TZ=Europe/Rome), 
// altrimenti i confronti temporali del cron e degli eventi risulteranno sfalsati di 1-2 ore.
const resolvedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
console.log(
  `[Config] Server timezone = ${resolvedTz} (process.env.TZ=${JSON.stringify(process.env['TZ'])}) ` +
  `— MUST be Europe/Rome or naive datetime comparisons (event start/end, cron) will be wrong.`
);

/**
 * Aggiunge un numero specificato di minuti a una stringa ISO locale.
 * Sfrutta il parsing locale di V8 per mantenere l'aritmetica allineata al fuso orario del server.
 */
export function addMinutesNaive(naiveIso: string, m: number): string {
  const d = new Date(naiveIso);
  d.setMinutes(d.getMinutes() + m);
  return toNaive(d);
}