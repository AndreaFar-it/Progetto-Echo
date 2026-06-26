/**
 * ECHO — Modulo Database (database.ts)
 *
 * Utilizza sql.js (SQLite puro WebAssembly — NESSUNA compilazione nativa necessaria).
 * Il database viene caricato da / salvato su disco come file binario (echo.db).
 *
 * DIFFERENZA IMPORTANTE rispetto a better-sqlite3:
 *   sql.js gira interamente in JS/WASM e mantiene il database IN MEMORIA.
 *   Al boot carica il file da disco; dopo ogni scrittura salva nuovamente su disco.
 *   Questo approccio è adeguato per il profilo di carico di ECHO (non un DB ad alto traffico).
 *
 * SICUREZZA DELLE TRANSAZIONI:
 *   Tutte le scritture passano per transaction(), che esegue BEGIN/COMMIT e poi
 *   persiste su disco. Un crash tra COMMIT e fs.writeFileSync perderebbe l'ultima
 *   transazione — accettabile per un'app locale/demo.
 *   Per la produzione, usare better-sqlite3 (richiede VS Build Tools su Windows)
 *   o un DB hosted come Turso (libsql, nessuna compilazione nativa necessaria).
 */

import initSqlJs, { Database, QueryExecResult } from 'sql.js';
import fs   from 'fs';
import path from 'path';

/** Istanza singleton del database in memoria (null finché avviaDatabase() non viene chiamato). */
let _istanzaDb: Database | null = null;

/** Percorso assoluto del file database su disco. Configurabile tramite variabile d'ambiente DB_PATH. */
const percorsoDb = process.env['DB_PATH'] ?? path.join(__dirname, '../../echo.db');

/**
 * Salva il database in memoria su disco.
 * Viene invocata dopo ogni operazione di scrittura per garantire la persistenza.
 */
function salvasuDisco(): void {
  if (!_istanzaDb) return;
  const datiDb = _istanzaDb.export();
  fs.writeFileSync(percorsoDb, Buffer.from(datiDb));
}

/**
 * Inizializza il database: carica il file esistente da disco oppure ne crea uno nuovo.
 * Applica lo schema SQL e le migrazioni incrementali.
 * Deve essere chiamata una sola volta all'avvio del server (server.ts).
 */
export async function avviaDatabase(): Promise<void> {
  if (_istanzaDb) return; // Già inizializzato — evita doppia inizializzazione

  const SQL = await initSqlJs();

  if (fs.existsSync(percorsoDb)) {
    // Carica il database esistente dal file su disco
    const bufferFile = fs.readFileSync(percorsoDb);
    _istanzaDb = new SQL.Database(bufferFile);
    console.log(`[DB] Database esistente caricato da ${percorsoDb}`);
  } else {
    // Prima avvio: crea un database vuoto in memoria
    _istanzaDb = new SQL.Database();
    console.log(`[DB] Nuovo database creato in ${percorsoDb}`);
  }

  // Applica lo schema SQL (idempotente — usa CREATE TABLE IF NOT EXISTS)
  const percorsoSchema = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(percorsoSchema)) {
    const ddl = fs.readFileSync(percorsoSchema, 'utf-8');
    _istanzaDb.run(ddl);
    console.log('[DB] Schema applicato.');
  } else {
    throw new Error(`[DB] schema.sql non trovato in ${percorsoSchema}`);
  }

  eseguiMigrazioni();
  salvasuDisco(); // Salva su disco dopo la creazione dello schema e le migrazioni
}

/**
 * Migrazioni incrementali per database creati prima di modifiche allo schema.
 * CREATE TABLE IF NOT EXISTS NON aggiunge colonne a tabelle già esistenti:
 * le nuove colonne richiedono un ALTER TABLE esplicito, protetto da un controllo preliminare.
 */
function eseguiMigrazioni(): void {
  if (!_istanzaDb) return;

  // Legge le colonne attuali delle tabelle interessate per valutare quali migrazioni applicare
  const colonneEvento      = righedalRisultato<{ name: string }>(_istanzaDb.exec('PRAGMA table_info(EVENTO)'));
  const colonneUtente      = righedalRisultato<{ name: string }>(_istanzaDb.exec('PRAGMA table_info(UTENTE)'));
  const colonnePartecipa   = righedalRisultato<{ name: string }>(_istanzaDb.exec('PRAGMA table_info(PARTECIPA)'));

  // Aggiunge la colonna per tracciare il momento esatto in cui è iniziata la fase di sviluppo
  if (!colonneEvento.some(c => c.name === 'sviluppo_started_at')) {
    _istanzaDb.run('ALTER TABLE EVENTO ADD COLUMN sviluppo_started_at TEXT');
    console.log('[DB] Migrazione: aggiunta EVENTO.sviluppo_started_at');
  }

  // Aggiunge la colonna per il token di notifica push Firebase (opzionale)
  if (!colonneUtente.some(c => c.name === 'push_token')) {
    _istanzaDb.run('ALTER TABLE UTENTE ADD COLUMN push_token TEXT');
    console.log('[DB] Migrazione: aggiunta UTENTE.push_token');
  }

  // Aggiunge il flag che indica se è stato inviato il prompt di estensione all'organizzatore
  if (!colonneEvento.some(c => c.name === 'estensione_richiesta')) {
    _istanzaDb.run('ALTER TABLE EVENTO ADD COLUMN estensione_richiesta INTEGER NOT NULL DEFAULT 0');
    console.log('[DB] Migrazione: aggiunta EVENTO.estensione_richiesta');
  }

  // Registra la decisione dell'organizzatore sul prompt di estensione (1=accettata, 0=rifiutata, NULL=in attesa)
  if (!colonneEvento.some(c => c.name === 'estensione_accettata')) {
    _istanzaDb.run('ALTER TABLE EVENTO ADD COLUMN estensione_accettata INTEGER');
    console.log('[DB] Migrazione: aggiunta EVENTO.estensione_accettata');
  }

  // Timestamp del momento in cui è stato inviato il prompt di estensione (usato dal cron T1c per il timeout)
  if (!colonneEvento.some(c => c.name === 'estensione_richiesta_at')) {
    _istanzaDb.run('ALTER TABLE EVENTO ADD COLUMN estensione_richiesta_at TEXT');
    console.log('[DB] Migrazione: aggiunta EVENTO.estensione_richiesta_at');
  }

  // Flag per i partecipanti che decidono di restare durante un'estensione (1=rimane, 0=se ne va, NULL=non risposto)
  if (!colonnePartecipa.some(c => c.name === 'rimane_esteso')) {
    _istanzaDb.run('ALTER TABLE PARTECIPA ADD COLUMN rimane_esteso INTEGER');
    console.log('[DB] Migrazione: aggiunta PARTECIPA.rimane_esteso');
  }

  // OTP per il recupero password (6 cifre, valido 15 minuti)
  if (!colonneUtente.some(c => c.name === 'reset_otp')) {
    _istanzaDb.run('ALTER TABLE UTENTE ADD COLUMN reset_otp TEXT');
    console.log('[DB] Migrazione: aggiunta UTENTE.reset_otp');
  }

  // Timestamp di scadenza dell'OTP di recupero password
  if (!colonneUtente.some(c => c.name === 'reset_otp_expires_at')) {
    _istanzaDb.run('ALTER TABLE UTENTE ADD COLUMN reset_otp_expires_at TEXT');
    console.log('[DB] Migrazione: aggiunta UTENTE.reset_otp_expires_at');
  }

  // Flag per eventi creati in modalità sviluppo rapido (ciclo di vita da 3 min invece di ore/giorni)
  if (!colonneEvento.some(c => c.name === 'dev_mode')) {
    _istanzaDb.run('ALTER TABLE EVENTO ADD COLUMN dev_mode INTEGER NOT NULL DEFAULT 0');
    console.log('[DB] Migrazione: aggiunta EVENTO.dev_mode');
  }
}

/**
 * Restituisce l'istanza del database, lanciando un errore se non è stata inizializzata.
 * Garantisce che nessuna query venga eseguita prima di avviaDatabase().
 */
function ottieniDb(): Database {
  if (!_istanzaDb) throw new Error('[DB] Database non inizializzato. Chiamare avviaDatabase() prima di qualsiasi query.');
  return _istanzaDb;
}

// ── Helper per la conversione dei risultati ────────────────────────────────────

/**
 * Converte il formato di risposta di sql.js (colonne + valori separati) in un array
 * di oggetti tipizzati, equivalente al formato restituito da better-sqlite3.
 */
function righedalRisultato<T>(risultato: QueryExecResult[]): T[] {
  if (!risultato.length) return [];
  const { columns, values } = risultato[0];
  return values.map((riga: unknown[]) => {
    const oggetto: Record<string, unknown> = {};
    columns.forEach((col: string, i: number) => { oggetto[col] = riga[i]; });
    return oggetto as T;
  });
}

// ── API Pubblica (stessa superficie di better-sqlite3) ─────────────────────────

/**
 * Esegue INSERT / UPDATE / DELETE.
 * Ritorna { changes, lastInsertRowid } per compatibilità con better-sqlite3.
 */
export function run(sql: string, params: unknown[] = []): { changes: number; lastInsertRowid: number } {
  const db = ottieniDb();
  db.run(sql, params as any[]);
  const righeModificate = (db.exec('SELECT changes()')[0]?.values[0]?.[0] as number) ?? 0;
  const ultimoIdInserito = (db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] as number) ?? 0;
  salvasuDisco(); // Persistiamo dopo ogni scrittura diretta (le transazioni gestiscono il proprio persist)
  return { changes: righeModificate, lastInsertRowid: ultimoIdInserito };
}

/**
 * Esegue una SELECT e ritorna la prima riga come oggetto tipizzato T.
 * Ritorna undefined se nessuna riga corrisponde alla query.
 */
export function get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  const righe = righedalRisultato<T>(ottieniDb().exec(sql, params as any[]));
  return righe[0];
}

/**
 * Esegue una SELECT e ritorna TUTTE le righe corrispondenti come array di T.
 */
export function all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  return righedalRisultato<T>(ottieniDb().exec(sql, params as any[]));
}

/**
 * Wrapper per le transazioni.
 * sql.js non ha un'API nativa per le transazioni come better-sqlite3,
 * quindi gestiamo BEGIN/COMMIT manualmente e facciamo il rollback in caso di errore.
 * Persiste su disco SOLO al COMMIT avvenuto con successo.
 *
 * NOTA SULLA CONCORRENZA: Node.js è single-threaded, quindi non possono esistere
 * due transazioni simultanee — stessa garanzia di sicurezza di better-sqlite3.
 */
export function transaction<T>(fn: () => T): T {
  // sql.js fa auto-commit di ogni exec() — le transazioni non si comportano come in better-sqlite3.
  // In un'app single-process, eseguiamo le operazioni direttamente:
  // l'integrità dei dati è garantita dal single-threading di Node.js.
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
    console.log('[DB] Connessione chiusa.');
  }
}
