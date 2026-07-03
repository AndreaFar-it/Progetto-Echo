import initSqlJs, { Database, QueryExecResult } from 'sql.js'; // Libreria che implementa SQLite in WebAssembly per Node.js e browser.
import fs   from 'fs';// Modulo nativo di Node.js per leggere/scrivere file su disco.
import path from 'path';

// Istanza singleton del database in memoria (null finché avviaDatabase() non viene chiamato).
let _istanzaDb: Database | null = null;

// Percorso assoluto del file database su disco. Configurabile tramite variabile d'ambiente DB_PATH.
const percorsoDb = process.env['DB_PATH'] ?? path.join(__dirname, '../../echo.db'); // Presumibilmente codice morto (process.env) — non viene mai impostata la variabile d'ambiente DB_PATH, quindi usa il percorso di default.

// Salva su disco il database in memoria (_istanzaDb) nel file percorsoDb. Viene chiamata dopo ogni scrittura diretta per garantire la persistenza dei dati.
function salvasuDisco(): void {
  if (!_istanzaDb) return;
  const datiDb = _istanzaDb.export();
// Utilizziamo un Buffer.from() per convertire l'ArrayBuffer in un Buffer di Node.js, necessario per fs.writeFileSync().
  fs.writeFileSync(percorsoDb, Buffer.from(datiDb));
}

// Avvia il database SQLite in memoria, caricando il file esistente da disco se presente,
// altrimenti creando un nuovo database vuoto. Applica lo schema SQL.
export async function avviaDatabase(): Promise<void> {
  if (_istanzaDb) return; // Già inizializzato — evita doppia inizializzazione

  const SQL = await initSqlJs(); // Inizializza la libreria sql.js (WebAssembly) e ottiene l'oggetto SQL per creare il database.

  if (fs.existsSync(percorsoDb)) {
    // Carica il database esistente dal file su disco
    const bufferFile = fs.readFileSync(percorsoDb);
    _istanzaDb = new SQL.Database(bufferFile);
  } else {
    // Prima avvio: crea un database vuoto in memoria
    _istanzaDb = new SQL.Database();
  }

  // Applica lo schema SQL
  const percorsoSchema = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(percorsoSchema)) {
    // Legge il contenuto del file schema.sql e lo esegue per creare le tabelle e gli indici
    const ddl = fs.readFileSync(percorsoSchema, 'utf-8');
    _istanzaDb.run(ddl);
  } else {
    throw new Error(`[DB] schema.sql non trovato in ${percorsoSchema}`);
  }

  salvasuDisco(); // Salva su disco dopo la creazione dello schema e le migrazioni
}

// Restituisce l'istanza del database in memoria. Lancia un errore se il database non è stato inizializzato.
function ottieniDb(): Database {
  if (!_istanzaDb) throw new Error('[DB] Database non inizializzato. Chiamare avviaDatabase() prima di qualsiasi query.');
  return _istanzaDb;
}


// Destruttura il risultato di una SELECT sql in un array di oggetti tipizzati T.
// es: columns = ['id','nome'] e riga = [1, 'Mario'], produce { id: 1, nome: 'Mario' }.
function righedalRisultato<T>(risultato: QueryExecResult[]): T[] {
  if (!risultato.length) return [];
  const { columns, values } = risultato[0];
  // Iteriamo sulle righe (values) e creiamo un oggetto per ciascuna riga, mappando le colonne ai valori corrispondenti.
  return values.map((riga: unknown[]) => {
    const oggetto: Record<string, unknown> = {};
    columns.forEach((col: string, i: number) => { oggetto[col] = riga[i]; });
    return oggetto as T;
  });
}

// Esegue una query di scrittura (INSERT, UPDATE, DELETE) e ritorna il numero di righe modificate.
export function run(sql: string, params: unknown[] = []): { changes: number } {
  const db = ottieniDb();
  db.run(sql, params as any[]);
  const righeModificate = (db.exec('SELECT changes()')[0]?.values[0]?.[0] as number) ?? 0;
  salvasuDisco(); // Persistiamo dopo ogni scrittura diretta (le transazioni gestiscono il proprio persist)
  return { changes: righeModificate };
}

// Esegue una SELECT e ritorna la PRIMA riga corrispondente come oggetto tipizzato T, oppure undefined se non ci sono risultati.
export function get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  const righe = righedalRisultato<T>(ottieniDb().exec(sql, params as any[]));
  return righe[0];
}

// Esegue una SELECT e ritorna TUTTE le righe corrispondenti come array di oggetti tipizzati T.
export function all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  return righedalRisultato<T>(ottieniDb().exec(sql, params as any[]));
}

// Dovrebbe funzionare come salvataggi sincroni globali, ma in realtà è scritta male RIVEDERE
export function transaction<T>(fn: () => T): T {
  const risultato = fn();
  salvasuDisco();
  return risultato;
}

/** Salva il database su disco e chiude la connessione in memoria. */
export function chiudiDatabase(): void {
  if (_istanzaDb) {
    salvasuDisco();
    _istanzaDb.close();
    _istanzaDb = null;
  }
}
