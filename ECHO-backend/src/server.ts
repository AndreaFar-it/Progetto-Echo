import 'dotenv/config'; // Carica automaticamente il file .env nella variabile process.env prima di qualsiasi altra cosa, //Presumibilmente codice morto
// così da poter usare le variabili d'ambiente in tutto il codice senza dover importare dotenv in ogni file.
import express from 'express';// Framework HTTP che gestisce routing, middleware, e richieste/risposte
import cors from 'cors';// Permette al browser di fare richieste di origine diversa (CORS) verso il backend, senza di esso il browser bloccherebbe le richieste da domini diversi da quello del backend.
import helmet from 'helmet';// Aggiunge una serie di Header HTTP di sicurezza per proteggere l'applicazione da alcune vulnerabilità web comuni.
import path from 'path';// Modulo nativo di Node.js per gestire percorsi di file in modo cross-platform.
import { avviaDatabase, chiudiDatabase } from './db/database';
import { avviaJobPeriodici } from './cron/jobs';
import { MINUTI_RITARDO_SVILUPPO } from './config';
import authRoutes from './routes/auth.routes';
import eventiRoutes from './routes/eventi.routes';
import fotoRoutes from './routes/foto.routes';
import utenteRoutes from './routes/utente.routes';
import { TRASFORMA_IN_MINUTI } from './config';

//Setup App
const app = express(); // Crea un'istanza dell'applicazione Express
const PORT = process.env['PORT'] ?? 3000; // Imposta la porta del server, prendendola dalla variabile d'ambiente PORT se definita, altrimenti usa 3000 come default.//Presumibilmente codice morto

app.use(helmet()); // Attiva le protezioni di base.
app.use(cors({ origin: process.env['CORS_ORIGIN'] ?? '*' })); //Presumibilmente codice morto
app.use(express.json({ limit: '1mb' })); // Express legge il body json nelle richieste e lo mette in req.body, limitando la dimensione a 1 MB.


//Middleware
//catena di montaggio per le immagini 
app.use('/uploads', (_req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(__dirname, '../uploads')));

//gestione del download dell'apk
app.get('/downloads/echo.apk', (_req, res) => {
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.download(path.join(__dirname, '../downloads/echo.apk'), 'ECHO.apk', error => {
    if (error && !res.headersSent) res.status(404).json({ error: 'APK non disponibile' });
  });
});

// Costruzione dei percorsi API: tutte le richieste a /api/auth, /api/eventi, /api/foto e /api/utente vengono gestite dai rispettivi router importati sopra.
app.use('/api/auth', authRoutes);
app.use('/api/eventi', eventiRoutes);
app.use('/api/foto', fotoRoutes);
app.use('/api/utente', utenteRoutes);
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString(), developmentDelayMinutes: MINUTI_RITARDO_SVILUPPO }));//Presumibilmente codice morto

// funzione asincrona che avvia il server, il database e i job periodici.
async function avviaServer() {
  await avviaDatabase(); //Inizializza il database prima di avviare il server e i job periodici
  avviaJobPeriodici(); // Avvia i job periodici definiti in cron/jobs.ts


  //Apriamo la porta HTTP e iniziamo ad ascoltare le richieste in arrivo
  const server = app.listen(PORT, () =>
    console.log(`[Server] ECHO backend on port ${PORT} (${process.env['NODE_ENV'] ?? 'development'})`) // Presumibilmente codice morto (process.env)
  );

  //Smettiamo di ascoltare le richieste e chiudiamo il database. forza l'uscita del processo dopo 10 secondi se il server non si chiude correttamente.
  function spegniServer(sig: string) {
    console.log(`[Server] ${sig} — shutting down…`);
    server.close(() => { chiudiDatabase(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000);
  }

  //process.on si mette in ascolto di segnali inviati dal sistema operativo e dal server
  process.on('SIGTERM', () => spegniServer('SIGTERM')); // È il segnale standard di spegnimento inviato da servizi cloud (nel nostro caso Render)
  process.on('SIGINT', () => spegniServer('SIGINT')); // È il segnale inviato quando si preme Ctrl+C nel terminale per interrompere il processo.

  //AutoPing del server ogni 14 minuti per evitare che il server si spenga da solo (Render spegne i server inattivi dopo 15 minuti)
  if (process.env['NODE_ENV'] === 'production') {
    const SELF_URL = `http://localhost:${PORT}/health`; // CAMBIARE URL
    setInterval(() => {
      //importa il modulo http base di Node in modo dinamico 
      // e invia una richiesta GET a SELF_URL per mantenere il server attivo. Se c'è un errore, viene ignorato.
      import('http').then(({ default: http }) =>
        http.get(SELF_URL, res => res.resume()).on('error', () => { })
      );
    }, 14 * TRASFORMA_IN_MINUTI); // calcola 14 minuti in millisecondi
  }
}

// Avvia il server e gestisce eventuali errori di bootstrap, stampando l'errore e terminando il processo con codice 1.
avviaServer().catch(errore => { console.error('[Server] Bootstrap failed:', errore); process.exit(1); });

// Esporta l'istanza dell'app Express per poterla usare in altri moduli, ad esempio per i test.
export default app;
