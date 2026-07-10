# ECHO — The Persistence of the Moment

Applicazione mobile di fotografia condivisa per eventi, in stile fotocamera usa e getta: scatti limitati,
nessuna anteprima, sviluppo del rullino dopo 24 ore e votazione collettiva della foto migliore.

## Indice

- [ECHO — The Persistence of the Moment](#echo--the-persistence-of-the-moment)
  - [Indice](#indice)
  - [Informazioni sul progetto](#informazioni-sul-progetto)
  - [Struttura della repository](#struttura-della-repository)
  - [Tecnologie utilizzate](#tecnologie-utilizzate)
  - [Installazione](#installazione)
  - [Utilizzo](#utilizzo)
  - [Crediti](#crediti)

## Informazioni sul progetto

I partecipanti si uniscono a un evento con un codice a 5 cifre e dispongono di 1–5 scatti ciascuno. A evento concluso le foto entrano in "sviluppo" (24 ore); all'apertura dell'album ogni partecipante esprime un voto e i primi tre classificati ricevono badge oro, argento e bronzo. L'app è distribuita come PWA (web) e come APK Android.

## Struttura della repository

```
Progetto-Echo/
├── ECHO-backend/                  API REST — Node.js + Express + TypeScript + SQLite (sql.js/WASM)
│   ├── src/routes/                auth, eventi, foto, utente
│   ├── src/services/              ciclo di vita eventi, push FCM
│   ├── src/cron/                  worker periodici (transizioni di stato)
│   └── src/db/                    schema SQL + wrapper del database
├── ECHO-frontend/                 Angular 17 standalone + Ionic 8 + Capacitor 8
│   ├── src/app/pages/             pagine (eventi, camera, galleria, profilo, …)
│   ├── src/app/services/          api, auth, stato evento, fotocamera, coda offline, notifiche
│   ├── src/app/core/              guardie, interceptor HTTP, utilità
│   ├── ngsw-config.json           configurazione del Service Worker (PWA)
│   └── src/manifest.webmanifest   Web App Manifest
├── render.yaml                    Deploy su Render (2 web service)
├── build-and-run.ps1              Script unico: build APK, dev locale, deploy emulatore
├── install-sdk.ps1                Installazione componenti Android SDK
└── echo-debug.apk                 APK di debug 
```

## Tecnologie utilizzate

Frontend:

- Angular 17 (componenti standalone, Signals)
- Ionic 8
- Capacitor 8 (`@capgo/camera-preview`, filesystem, share, haptics, push-notifications)
- `@angular/service-worker` (PWA)

Backend:

- Node.js + Express (TypeScript)
- sql.js — SQLite in WebAssembly, persistito su file
- JWT, bcryptjs, multer, node-cron
- firebase-admin (notifiche push, opzionale)

Deploy: Render (Blueprint `render.yaml`).

## Installazione

Prerequisiti: Node.js ≥ 18. Solo per la parte Android: JDK 17 e Android Studio (poi `.\install-sdk.ps1`).

```bash
# Clonare la repository
git clone https://github.com/AndreaFar-it/Progetto-Echo.git

# Entrare nella cartella
cd Progetto-Echo

# Installare le dipendenze
cd ECHO-backend && npm install
cd ../ECHO-frontend && npm install
```

## Utilizzo

```bash
# Frontend web con live reload — http://localhost:8100 (backend online su Render)
cd ECHO-frontend
npm run ionic:serve

# Backend locale (opzionale) — richiede un file .env con JWT_SECRET
cd ECHO-backend
npm run dev
```

Pipeline Android (dalla root del repo, PowerShell):

```powershell
.\build-and-run.ps1              # compila l'APK e lo copia in root + ECHO-backend/downloads/
.\build-and-run.ps1 -Mode Dev    # emulatore + live reload
.\build-and-run.ps1 -Mode Run    # installa il build sull'emulatore
```

La pubblicazione dell'APK e del codice avviene con commit + push su `main` (redeploy automatico su Render).

## Crediti

Andrea Farina e Martina Taormina studenti presso UNIPA
Progetto universitario (UNIPA — Programmazione Web & Mobile, A.A. 2025/2026).
