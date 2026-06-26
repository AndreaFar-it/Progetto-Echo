PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS UTENTE (
  id_utente         TEXT    PRIMARY KEY,
  nome              TEXT    NOT NULL,
  cognome           TEXT    NOT NULL,
  email             TEXT    NOT NULL UNIQUE,
  password_hash     TEXT    NOT NULL,
  foto_profilo_url  TEXT,
  data_registrazione TEXT   NOT NULL DEFAULT (datetime('now')),
  scatti_totali     INTEGER NOT NULL DEFAULT 0,
  voti_ricevuti     INTEGER NOT NULL DEFAULT 0,
  push_token        TEXT
);

CREATE TABLE IF NOT EXISTS EVENTO (
  id_evento          TEXT    PRIMARY KEY,
  id_organizzatore   TEXT    NOT NULL REFERENCES UTENTE(id_utente),
  nome               TEXT    NOT NULL,
  luogo              TEXT    NOT NULL,
  data_inizio        TEXT    NOT NULL,
  durata_minuti      INTEGER NOT NULL CHECK (durata_minuti = 3 OR durata_minuti BETWEEN 60 AND 360),
  data_fine_calc     TEXT    NOT NULL,
  max_partecipanti   INTEGER NOT NULL CHECK (max_partecipanti > 0),
  scatti_per_utente  INTEGER NOT NULL CHECK (scatti_per_utente BETWEEN 1 AND 5),
  durata_votazione   INTEGER NOT NULL CHECK (durata_votazione BETWEEN 12 AND 72),
  stato              TEXT    NOT NULL DEFAULT 'non_iniziata'
                     CHECK (stato IN ('non_iniziata','in_corso','sviluppo','album_aperto','chiusa')),
  album_sbloccato_at TEXT,
  sviluppo_started_at TEXT,
  -- Extension flow (organiser opt-in, replaces the old always-on +120min margin):
  --   estensione_richiesta: 0/1, set by the cron job once the 10-min-before-end
  --     prompt has been sent to the organiser (dedupe guard, never reset).
  --   estensione_accettata: NULL = not yet decided, 1 = accepted (+120min applied,
  --     all participants asked to confirm), 0 = declined (event ends as scheduled).
  estensione_richiesta INTEGER NOT NULL DEFAULT 0,
  estensione_richiesta_at TEXT,
  estensione_accettata INTEGER,
  -- Evento creato in modalità rapida (0h 3min): tutte le fasi durano 3 minuti
  dev_mode INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_evento_stato_timing ON EVENTO(stato, data_inizio, data_fine_calc);

CREATE TABLE IF NOT EXISTS CODICE_EVENTO (
  id_codice      TEXT    PRIMARY KEY,
  id_evento      TEXT    NOT NULL REFERENCES EVENTO(id_evento),
  codice         VARCHAR(5) NOT NULL UNIQUE,
  tipo           TEXT    NOT NULL DEFAULT 'generale' CHECK (tipo IN ('generale')),
  data_scadenza  TEXT    NOT NULL,
  attivato       INTEGER NOT NULL DEFAULT 1,
  id_utente_uso  TEXT    REFERENCES UTENTE(id_utente),
  data_attivazione TEXT
);

CREATE INDEX IF NOT EXISTS idx_codice_codice ON CODICE_EVENTO(codice);

CREATE TABLE IF NOT EXISTS PARTECIPA (
  id_utente      TEXT    NOT NULL REFERENCES UTENTE(id_utente),
  id_evento      TEXT    NOT NULL REFERENCES EVENTO(id_evento),
  data_iscrizione TEXT   NOT NULL DEFAULT (datetime('now')),
  scatti_usati   INTEGER NOT NULL DEFAULT 0,
  ha_votato      INTEGER NOT NULL DEFAULT 0,
  -- "Desideri rimanere all'evento?" response after the organiser accepts a +2h
  -- extension. NULL = not asked yet / no response. 1 = staying (counts as busy
  -- for the full extended window in the temporal-conflict check). 0 = declined
  -- — frees this participant up for other events starting during the extension,
  -- without affecting what they already did in the original event window.
  rimane_esteso  INTEGER,
  PRIMARY KEY (id_utente, id_evento)
);

CREATE INDEX IF NOT EXISTS idx_partecipa_evento ON PARTECIPA(id_evento);
CREATE INDEX IF NOT EXISTS idx_partecipa_utente ON PARTECIPA(id_utente);

CREATE TABLE IF NOT EXISTS FOTO (
  id_foto           TEXT    PRIMARY KEY,
  id_evento         TEXT    NOT NULL REFERENCES EVENTO(id_evento),
  id_autore         TEXT    NOT NULL REFERENCES UTENTE(id_utente),
  url_originale     TEXT    NOT NULL,
  timestamp_scatto  TEXT    NOT NULL DEFAULT (datetime('now')),
  stato_moderazione TEXT    NOT NULL DEFAULT 'in_attesa'
                    CHECK (stato_moderazione IN ('in_attesa','approvata','rifiutata')),
  punteggio_voti    INTEGER NOT NULL DEFAULT 0,
  visibile          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_foto_evento_vis ON FOTO(id_evento, visibile, stato_moderazione);
CREATE INDEX IF NOT EXISTS idx_foto_ranking ON FOTO(id_evento, punteggio_voti DESC);

CREATE TABLE IF NOT EXISTS VOTO (
  id_voto        TEXT    PRIMARY KEY,
  id_votante     TEXT    NOT NULL REFERENCES UTENTE(id_utente),
  id_foto        TEXT    NOT NULL REFERENCES FOTO(id_foto),
  id_evento      TEXT    NOT NULL REFERENCES EVENTO(id_evento),
  timestamp_voto TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (id_votante, id_evento)
);

CREATE INDEX IF NOT EXISTS idx_voto_evento ON VOTO(id_evento);

CREATE TABLE IF NOT EXISTS BADGE (
  id_badge       TEXT    PRIMARY KEY,
  id_utente      TEXT    NOT NULL REFERENCES UTENTE(id_utente),
  id_evento      TEXT    NOT NULL REFERENCES EVENTO(id_evento),
  tipo           TEXT    NOT NULL CHECK (tipo IN ('oro','argento','bronzo')),
  posizione      INTEGER NOT NULL CHECK (posizione BETWEEN 1 AND 3),
  data_emissione TEXT    NOT NULL DEFAULT (datetime('now')),
  etichetta      TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_badge_utente ON BADGE(id_utente);
