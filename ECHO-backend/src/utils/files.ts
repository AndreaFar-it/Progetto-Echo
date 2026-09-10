import fs from 'fs';
import path from 'path';

// Radice degli upload: la stessa cartella servita staticamente da server.ts.
const RADICE_UPLOAD = path.resolve(__dirname, '../../uploads');

// Contenimento del percorso: qualunque cancellazione deve restare dentro uploads/.
// È la stessa difesa applicata in fase di scrittura dal controllo UUID di foto.routes.
function dentroUpload(assoluto: string): boolean {
  return assoluto.startsWith(RADICE_UPLOAD + path.sep);
}

// Cancella la cartella foto di un evento. Best-effort, e da invocare DOPO il commit:
// il filesystem non partecipa alla transazione.
export function rimuoviCartellaEvento(idEvento: string): void {
  const assoluto = path.resolve(RADICE_UPLOAD, idEvento);
  if (!dentroUpload(assoluto)) return;
  fs.rm(assoluto, { recursive: true, force: true }, () => { /* pulizia best-effort */ });
}

// Cancella un singolo file a partire dall'URL pubblico salvato sul database
// (es. /uploads/<id_evento>/<uuid>.jpg oppure /uploads/profili/<uuid>.jpg).
export function rimuoviFileUpload(urlPubblico: string): void {
  if (!urlPubblico.startsWith('/uploads/')) return;
  const assoluto = path.resolve(RADICE_UPLOAD, '.' + urlPubblico.slice('/uploads'.length));
  if (!dentroUpload(assoluto)) return;
  fs.unlink(assoluto, () => { /* pulizia best-effort */ });
}
