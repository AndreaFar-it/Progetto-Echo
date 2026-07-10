// Costante di conversione minuti -> millisecondi, stessa convenzione del backend (config.ts).
export const MS_PER_MINUTO = 60_000;

// Converte una stringa ISO assoluta in epoch ms.
export function isoToMs(iso: string): number {
  return new Date(iso).getTime();
}

// Converte un valore in una stringa ISO UTC assoluta e univoca..
export function localDatetimeToIsoUtc(localDatetime: string): string {
  return new Date(localDatetime).toISOString();
}
