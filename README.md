# ECHO — La persistenza del momento

**ECHO** è una piattaforma di fotografia per eventi in stile *fotocamera usa e getta digitale*.
Gli utenti partecipano a un evento, scattano un numero limitato di foto durante la sua durata,
poi — a evento concluso — il "rullino si sviluppa" e i partecipanti votano la foto migliore.
I vincitori ricevono badge oro / argento / bronzo.

L'esperienza è volutamente *analogica*: nessuna anteprima, nessuna modifica, nessuna
eliminazione. Si scatta e basta; il risultato si scopre solo dopo lo sviluppo.

---

## 1. Architettura e struttura del progetto

Monorepo con due applicazioni indipendenti più la configurazione di deploy.

```
Echo/
├── ECHO-backend/        Node.js + Express + TypeScript + SQLite (sql.js / WASM)
├── ECHO-frontend/       Angular 17 + Ionic 8 + Capacitor 6 (PWA web + APK Android)
├── .gitignore
├── .gitattributes
├── render.yaml          Configurazione di deploy su Render (2 web service)
├── build-and-run.ps1    UNICO script: build APK, dev locale, deploy emulatore
├── echo-debug.apk       APK di debug più recente (artefatto generato dallo script)
├── Relazione_ECHO.docx  Relazione tecnica del progetto
└── README.md            Questo file
```

**Stack backend:** Express · sql.js (SQLite in WebAssembly) · bcryptjs · JWT · node-cron ·
multer · firebase-admin (notifiche push, opzionale).

**Stack frontend:** Angular 17 standalone · Ionic · Capacitor · jsPDF · @capacitor/* (camera-preview,
filesystem, share, haptics, push-notifications, preferences).

### Macchina a stati degli eventi

```
non_iniziata → [T1] → in_corso → [T1b prompt estensione, T1c auto-rifiuto]
             → [T2] → sviluppo → [T3] → album_aperto → [T4] → chiusa
```

- **Modalità sviluppo (dev mode)** — un evento creato con durata `0h 3min` salta il prompt T1b
  e completa l'intero ciclo in ~9 minuti (3 min per fase). Utile per i test.
- I tempi (durata evento, ritardo sviluppo, finestra di voto) sono calcolati lato server in
  `ECHO-backend/src/config.ts`; con `DEVELOPMENT_MODE=true` collassano tutti a 3 minuti.

---

## 2. Prerequisiti

| Strumento | Perché | Note |
|---|---|---|
| **Node.js** (LTS v18 o v20) | Build di backend e frontend | Verifica con `node -v` / `npm -v` |
| **Git** | Clonare / aggiornare il repo | |
| **JDK 17** | Build Android (Android Gradle Plugin 8.2.1 richiede JDK 17) | Il JDK incluso in Android Studio va benissimo |
| **Android Studio** | Android SDK, `adb`, emulatore, AVD Manager | Installa *Android SDK*, *Platform-Tools* ed *Emulator* |

I CLI di Angular/Ionic/Capacitor sono installati **localmente** da `npm install` — non serve
installarli globalmente (`npx ng`, `npx cap`, `npm run …` funzionano da soli).

### Variabili d'ambiente (Windows / PowerShell)

```powershell
# Imposta una sola volta (adatta i percorsi alla tua installazione):
[Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Android\Android Studio\jbr", "User")
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
# Aggiungi adb ed emulator al PATH:
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:LOCALAPPDATA\Android\Sdk\emulator", "User")
# Riavvia il terminale dopo aver impostato queste variabili.
```

---

## 3. Setup di sviluppo (fullstack)

### Installazione dipendenze

```powershell
cd ECHO-backend  ; npm install
cd ..\ECHO-frontend ; npm install   # esegue anche patch-package (postinstall) → patch native
```

> Il frontend usa **patch-package**: lo script `postinstall` riapplica automaticamente le patch
> presenti in `ECHO-frontend/patches/` a `node_modules` dopo ogni `npm install` (vedi §6).

### Avvio rapido con lo script unico (consigliato)

Dalla **root del repository**:

```powershell
# Ambiente di sviluppo locale: emulatore + frontend con live reload.
# Il frontend punta al backend Render (durate reali, come un utente vero).
.\build-and-run.ps1 -Mode Dev

# Variante "developer": avvia anche un backend LOCALE con timer a 3 minuti.
.\build-and-run.ps1 -Mode Dev -Backend Dev
```

### Avvio manuale (equivalente, senza script)

```powershell
# Backend (in una finestra)
cd ECHO-backend
$env:TZ = "Europe/Rome"           # OBBLIGATORIO: senza, le date slittano di 1-2h
$env:DEVELOPMENT_MODE = "true"    # opzionale: collassa tutti i timer a 3 minuti
npm run dev                       # hot-reload su http://localhost:3000

# Frontend (in un'altra finestra)
cd ECHO-frontend
npm run ionic:serve:dev           # live reload su http://localhost:8100, backend = localhost:3000
# (npm run ionic:serve:user punta invece al backend Render)
```

### Emulatore Android

Crea un'AVD in Android Studio → **Device Manager** (es. Pixel 6, API 34). Imposta
**Back Camera** e **Front Camera** su `Emulated` (non `None`), altrimenti il mirino resta
bloccato su *"Avvio fotocamera…"*.

```powershell
emulator -list-avds
emulator -avd Pixel_6
adb devices                       # deve mostrare "emulator-5554   device"
```

---

## 4. Build e aggiornamento dell'APK di debug

Tutta la pipeline Android è gestita dall'**unico script** `build-and-run.ps1`. Da eseguire
sempre dalla root del repository.

```powershell
# Pipeline completa → genera/aggiorna echo-debug.apk nella root.
# (backend tsc → patch native → deep-clean → build web URL Render → cap sync →
#  gradle clean + assembleDebug → copia in echo-debug.apk)
.\build-and-run.ps1

# Come sopra, ma aggiorna anche l'APK servito dal backend
# (ECHO-backend/downloads/echo.apk) e fa commit + push → redeploy su Render.
.\build-and-run.ps1 -Publish

# Installa il build su un emulatore in esecuzione (assembleDebug + adb install + launch).
.\build-and-run.ps1 -Mode Run

# Salta la deep-clean delle cache (build più veloce, usare solo se non hai cambiato gli asset).
.\build-and-run.ps1 -SkipClean
```

| Modalità | Cosa fa |
|---|---|
| `-Mode Build` (default) | Pipeline completa APK → `echo-debug.apk` |
| `-Mode Build -Publish` | + aggiorna l'APK servito dal backend e push (redeploy Render) |
| `-Mode Dev` | Emulatore + `ionic serve` (frontend → backend Render) |
| `-Mode Dev -Backend Dev` | + backend locale con timer a 3 minuti |
| `-Mode Run` | Compila e installa sull'emulatore |
| `-SkipClean` | Salta la deep-clean (Build/Run) |

> **Importante — cache su dispositivo.** Il frontend registra un service worker (`ngsw`) che
> mette in cache gli asset. Dopo aver installato un nuovo APK, **disinstalla prima la vecchia app**
> (Impostazioni → App → ECHO → Disinstalla), altrimenti la WebView continua a servire il
> codice JS vecchio dalla cache e sembrerà che le modifiche non abbiano effetto.

> **Nota.** L'APK è una *debug build*: Android chiederà di abilitare "Installa da fonti sconosciute".

---

## 5. Deploy (Render)

Il deploy è descritto in `render.yaml` (due web service: `echo-backend` e `echo-frontend`).
Un **push su `main`** innesca automaticamente il redeploy.

| Servizio | URL |
|---|---|
| Backend | `https://echo-backend-wsl2.onrender.com` |
| Frontend | `https://echo-frontend.onrender.com` |

**Variabili d'ambiente da impostare nel pannello Render** (Backend → Environment):
`JWT_SECRET` (segreto, mai nel codice), `FIREBASE_SERVICE_ACCOUNT_JSON` (opzionale, push),
`CORS_ORIGIN`, `NODE_ENV=production`, `TZ=Europe/Rome`.

**Note sul piano gratuito di Render:**
- Il backend va in *sleep* dopo 15 minuti di inattività; il primo accesso successivo richiede
  30-60 s (cold start). Il frontend fa un *prewarm* (`/health`) all'avvio e il backend si auto-pinga
  ogni 14 minuti per restare sveglio durante l'uso.
- ⚠️ **Database effimero:** il file SQLite (`echo.db`) è su filesystem non persistente — i dati
  (utenti, eventi) si perdono a ogni redeploy/restart. Per una demo: registrarsi all'inizio e
  procedere senza lunghe interruzioni. Soluzione definitiva non implementata: Turso/libsql o un
  Persistent Disk di Render.

---

## 6. Ultime correzioni critiche applicate

Due fix nativi/di pipeline recenti, importanti da conoscere prima di toccare la fotocamera:

### 6.1 Patch nativa Java — schermo grigio in *de-zoom* (patch-package)

Il plugin `@capacitor-community/camera-preview` gestisce il pinch-zoom nativamente
(`enableZoom: true`). Il suo handler `handleZoom` (API Camera1) chiamava
`cancelAutoFocus()` + `setParameters()` a **ogni** evento di tocco, anche quando lo zoom era
già al minimo (floor `0`) e quindi **non cambiava**. Questo martellamento della Camera1 faceva
"sfarfallare" la superficie nativa → comparsa momentanea dello sfondo grigio della WebView
durante il de-zoom.

**Fix:** una patch a `CameraActivity.java` che applica `setParameters()` **solo quando il
valore di zoom cambia davvero**. La patch è versionata in
`ECHO-frontend/patches/@capacitor-community+camera-preview+6.0.1.patch` e viene riapplicata
automaticamente da **patch-package** (hook `postinstall`, e in modo esplicito dallo script di
build). Essendo codice in `node_modules`, **non** è modificabile direttamente: va sempre
mantenuta tramite la patch.

### 6.2 Orientamento dinamico EXIF — fotocamera posteriore (filtro vintage)

Il filtro vintage (`ECHO-frontend/src/app/utils/vintage-filter.ts`, funzione
`applyVintageFilter`) "stampa" l'effetto analogico nell'immagine via Canvas prima dell'upload,
e si occupa anche del raddrizzamento dell'orientamento — gestito in modo **dinamico per
obiettivo**, in base ai metadati reali del fotogramma:

- **Frontale (selfie):** il sensore consegna un fotogramma orizzontale **senza tag EXIF**
  (`orientation === 1`). Viene raddrizzato con una rotazione di 90° **e** specchiato
  orizzontalmente (per corrispondere all'anteprima live specchiata).
- **Posteriore:** il sensore consegna il fotogramma con tag **EXIF 6** (90° orari) che il passo
  EXIF lascia orizzontale; una rotazione di 90° aggiuntiva lo raddrizza in verticale.

Le due rotazioni sono regolate da costanti dedicate (`FRONT_ROTATION_DEG`, `REAR_ROTATION_DEG`):
se un obiettivo dovesse uscire capovolto, basta invertire il segno (90 ↔ -90) della relativa
costante. La logica è basata sui metadati del singolo frame, così ogni obiettivo è gestito in
modo indipendente.

---

## 7. Debugging — scheda rapida `adb`

```powershell
# L'app è viva e in primo piano?
adb shell dumpsys window | Select-String "mCurrentFocus"

# Log puliti attorno a una repro: pulisci → riproduci il bug → leggi
adb logcat -c
# ... riproduci ora il bug sul dispositivo/emulatore ...
adb logcat -d | Select-String -Pattern "Camera|Fragment|AndroidRuntime|Capacitor"

# Reinstallazione pulita (cap sync NON reinstalla l'app già presente sul device)
adb uninstall com.echo.app
adb install ECHO-frontend\android\app\build\outputs\apk\debug\app-debug.apk
```

**Problemi noti:**
- **`adb` / `emulator` "non riconosciuto"** → cartelle non nel PATH (vedi §2) o usa il percorso
  completo `& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"`.
- **Mirino bloccato su "Avvio fotocamera…"** → fotocamera virtuale dell'AVD impostata su `None`.
- **Vecchio comportamento dopo un fix** → hai fatto solo `cap sync` (non reinstalla): fai un
  uninstall/install completo, oppure disinstalla l'app prima di reinstallare l'APK.
- **Schermo nero sull'emulatore** (app in focus, `mWakefulness=Awake`) → bug GPU/EGL: la WebView
  è volutamente trasparente (richiesto dal layer camera-preview) e alcuni backend GPU
  dell'emulatore non la compongono. Soluzione: avviare l'emulatore con un backend `-gpu` diverso
  (`build-and-run.ps1` usa già `angle_indirect`); se ricompare, cicla
  `angle_indirect` → `swiftshader_indirect` → `host` → `auto`.

---

## 8. Convenzioni del codice

A seguito della rifattorizzazione globale (giugno 2026), **identificatori e commenti del codice
sono in italiano** (variabili, funzioni, classi, servizi, guardie). Restano invariati per
contratto: nomi di colonne/tabelle SQL, chiavi delle variabili d'ambiente, percorsi delle rotte
API (`/api/...`), i `selector` Angular e i nomi dei pacchetti npm.
