
// FORMATO ISO STRING == 2026-07-06T17:36:03.123Z
// 2026: L'anno (formato a 4 cifre)
// -07: Il mese (07 = Luglio).
// -06: Il giorno del mese.
// T: È solo un separatore standard che sta per Time 
// 17: L'ora (formato 24 ore).
// 36: I minuti.
// 03: I secondi.
// 123: I millisecondi (tre cifre decimali dopo il secondo).
// Z: Sta per Zero offset (chiamato anche Tempo del meridiano di Greenwich o UTC)

//Ritorna la data odierna  in ISO string 
export function adessoUTC(): string {
  return new Date().toISOString();
}

//Funzione per aggiungere i minuti ad una data
export function aggiungiMinutiUTC(iso: string, m: number): string {
  const d = new Date(iso);
  d.setUTCMinutes(d.getUTCMinutes() + m);
  return d.toISOString();
}
