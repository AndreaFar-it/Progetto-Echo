import 'dotenv/config';
import express    from 'express';
import cors       from 'cors';
import helmet     from 'helmet';
import path       from 'path';
import { avviaDatabase, chiudiDatabase } from './db/database';
import { avviaJobPeriodici }    from './cron/jobs';
import { MINUTI_RITARDO_SVILUPPO } from './config';
import authRoutes   from './routes/auth.routes';
import eventiRoutes from './routes/eventi.routes';
import fotoRoutes   from './routes/foto.routes';
import utenteRoutes from './routes/utente.routes';

const app  = express();
const PORT = process.env['PORT'] ?? 3000;

app.use(helmet());
app.use(cors({ origin: process.env['CORS_ORIGIN'] ?? '*' }));
app.use(express.json({ limit: '1mb' }));
// Il valore di default di helmet() (Cross-Origin-Resource-Policy: same-origin) impedisce
// ai tag <img> di mostrare questi file quando il frontend è su un'origine diversa dall'API
// — il caso normale qui (dev server web, dominio di produzione e il bridge 10.0.2.2
// dell'emulatore Android differiscono tutti dall'origine del backend). /uploads serve solo
// immagini pubbliche e non sensibili (foto evento, avatar) pensate per essere incorporate
// ovunque, quindi allentiamo solo questo header per questa rotta invece di indebolire i
// default di helmet a livello globale.
app.use('/uploads', (_req, risposta, prossimo) => {
  risposta.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  prossimo();
}, express.static(path.join(__dirname, '../uploads')));

// Download APK — risposta.download() imposta Content-Disposition e Content-Type in modo
// atomico e solo se il file esiste, evitando il problema della "pagina HTML di errore
// scaricata" che si verifica quando setHeader() viene chiamato prima di sendFile() e il
// file manca (l'error handler di Express eredita Content-Disposition: attachment, e il
// browser scarica il corpo HTML dell'errore invece di rifiutarlo inline).
app.get('/downloads/echo.apk', (_req, risposta) => {
  risposta.set('Cross-Origin-Resource-Policy', 'cross-origin');
  risposta.download(path.join(__dirname, '../downloads/echo.apk'), 'ECHO.apk', errore => {
    if (errore && !risposta.headersSent) risposta.status(404).json({ error: 'APK non disponibile' });
  });
});

app.use('/api/auth',   authRoutes);
app.use('/api/eventi', eventiRoutes);
app.use('/api/foto',   fotoRoutes);
app.use('/api/utente', utenteRoutes);
app.get('/health', (_req, risposta) => risposta.json({ status: 'ok', ts: new Date().toISOString(), developmentDelayMinutes: MINUTI_RITARDO_SVILUPPO }));

/**
 * Avvio del server: inizializza il DB (sql.js carica il WASM in modo asincrono, quindi
 * va atteso PRIMA di mettersi in ascolto), avvia i job periodici e apre la porta HTTP.
 * Registra anche gli handler di spegnimento ordinato (SIGTERM/SIGINT) e il keep-alive.
 */
async function avviaServer() {
  await avviaDatabase();
  avviaJobPeriodici();
  const server = app.listen(PORT, () =>
    console.log(`[Server] ECHO backend on port ${PORT} (${process.env['NODE_ENV'] ?? 'development'})`)
  );

  function spegniServer(sig: string) {
    console.log(`[Server] ${sig} — shutting down…`);
    server.close(() => { chiudiDatabase(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000);
  }
  process.on('SIGTERM', () => spegniServer('SIGTERM'));
  process.on('SIGINT',  () => spegniServer('SIGINT'));

  // Keep-alive: sul piano gratuito di Render l'istanza va in sleep dopo 15 min senza
  // traffico in ingresso. Un self-ping ogni 14 min conta come richiesta gestita e
  // azzera il timer di inattività, tenendo vivo il DB durante le sessioni attive.
  if (process.env['NODE_ENV'] === 'production') {
    const SELF_URL = `http://localhost:${PORT}/health`;
    setInterval(() => {
      import('http').then(({ default: http }) =>
        http.get(SELF_URL, risposta => risposta.resume()).on('error', () => {})
      );
    }, 14 * 60 * 1000);
  }
}

avviaServer().catch(errore => { console.error('[Server] Bootstrap failed:', errore); process.exit(1); });

export default app;
