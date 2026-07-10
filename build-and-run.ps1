<#
=====================================================================================
 ECHO — Script unico di build & avvio  (build-and-run.ps1)
=====================================================================================
 Da eseguire dalla ROOT del repository.

 MODALITÀ (-Mode):
   Build (default) : compila l'APK di debug e lo copia SIA in echo-debug.apk (root)
                     SIA in ECHO-backend/downloads/echo.apk (quello scaricato dagli
                     utenti dal sito). La PUBBLICAZIONE resta manuale: commit + push
                     da GitHub Desktop → redeploy Render → APK nuovo online.
   Dev             : emulatore + ionic serve con live reload (frontend → backend Render).
   Run             : compila e installa l'APK su un emulatore già in esecuzione.

 OPZIONI:
   -SkipClean      : salta la pulizia delle cache (build più veloce, usare solo se
                     non sono cambiati gli asset).

 ESEMPI:
   .\build-and-run.ps1              # APK → root + downloads (poi push da GitHub Desktop)
   .\build-and-run.ps1 -Mode Dev    # sviluppo locale con live reload
   .\build-and-run.ps1 -Mode Run    # installa il build sull'emulatore
=====================================================================================
#>

param(
  # Modalità operativa dello script (Build, Dev o Run)
  [ValidateSet('Build', 'Dev', 'Run')] [string]$Mode = 'Build',
  # Se presente, salta la deep-clean delle cache web/native
  [switch]$SkipClean
)

# Interrompe lo script al primo errore di un cmdlet PowerShell
$ErrorActionPreference = 'Stop'

# --- Percorsi (relativi alla posizione dello script = root del repo) -----------------
$Root       = $PSScriptRoot                                                      # cartella root del repository
$Frontend   = Join-Path $Root 'ECHO-frontend'                                    # progetto Angular/Ionic
$BackendDir = Join-Path $Root 'ECHO-backend'                                     # progetto Express
$Android    = Join-Path $Frontend 'android'                                      # progetto nativo Android
$Gradlew    = Join-Path $Android 'gradlew.bat'                                   # wrapper Gradle del progetto
$ApkBuilt   = Join-Path $Android 'app\build\outputs\apk\debug\app-debug.apk'     # APK prodotto da Gradle
$ApkRoot    = Join-Path $Root 'echo-debug.apk'                                   # copia di comodo nella root
$ApkServed  = Join-Path $BackendDir 'downloads\echo.apk'                         # APK servito dal sito (/downloads/echo.apk)
$ADB        = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'   # strumento di comunicazione col device
$EMULATOR   = Join-Path $env:LOCALAPPDATA 'Android\Sdk\emulator\emulator.exe'    # launcher dell'emulatore Android

# --- Helper di stampa colorata --------------------------------------------------------
function Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }     # titolo di un passaggio
function Note($msg) { Write-Host "   $msg" -ForegroundColor DarkGray }   # nota secondaria
function Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }    # conferma di successo
function Die($msg)  { Write-Host "[ERRORE] $msg" -ForegroundColor Red; exit 1 }  # errore fatale: stampa e termina

# Esegue un comando esterno e interrompe lo script se l'exit code non è 0
function Run($cmd) {
  & ([ScriptBlock]::Create($cmd))                                # esegue la stringa come comando
  if ($LASTEXITCODE -ne 0) { Die "Comando fallito: $cmd" }       # controlla l'esito del comando nativo
}

# ------------------------------------------------------------------------------------
# Garantisce che un emulatore sia in esecuzione; se non lo è, ne avvia uno e attende il boot.
# GPU: `-gpu angle_indirect` evita lo schermo nero (la WebView trasparente del layer
# camera-preview richiede una surface EGL con canale alfa che il path hardware non dà).
# ------------------------------------------------------------------------------------
function Ensure-Emulator {
  Step 'Controllo emulatore...'
  # Se adb vede già un emulatore attivo, non serve fare altro
  if ((& $ADB devices 2>$null) -match 'emulator-\d+\s+device') { Note 'Emulatore già in esecuzione.'; return }

  # Prende la prima AVD configurata sul sistema
  $avd = & $EMULATOR -list-avds 2>$null | Where-Object { $_ -match '\S' } | Select-Object -First 1
  if (-not $avd) { Die 'Nessuna AVD trovata. Creane una in Android Studio (Pixel 6, API 34, fotocamere = Emulated).' }

  Note "Avvio emulatore: $avd"
  # Lancia l'emulatore in un processo separato con il backend GPU compatibile
  Start-Process $EMULATOR -ArgumentList '-avd', $avd.Trim(), '-gpu', 'angle_indirect'

  Note 'Attendo il boot (max 2 min)...'
  $elapsed = 0
  while ($elapsed -lt 120) {
    Start-Sleep -Seconds 4; $elapsed += 4                        # attende 4 secondi tra un controllo e l'altro
    if ((& $ADB devices 2>$null) -match 'emulator-\d+\s+device') {
      & $ADB shell setprop persist.sys.timezone Europe/Rome | Out-Null            # imposta il fuso orario italiano
      & $ADB shell settings put secure show_ime_with_hard_keyboard 1 | Out-Null   # forza la tastiera a schermo
      Ok 'Emulatore pronto.'; return
    }
    Note "  ...ancora in avvio ($elapsed s)"
  }
  Die 'Emulatore non avviato in tempo.'
}

# ------------------------------------------------------------------------------------
# MODE: Build — pipeline completa dell'APK di debug.
# ------------------------------------------------------------------------------------
function Invoke-Build {
  # 1. Compila il backend: l'APK non lo usa, ma conferma che il codice server è sano
  Step 'Compilo il backend (tsc)...'
  Set-Location $BackendDir                                       # entra nella cartella del backend
  Run 'npm run build'                                            # transpila TypeScript → dist/

  # 2. Deep-clean delle cache che causano "APK con asset vecchi" (saltabile con -SkipClean)
  if (-not $SkipClean) {
    Step 'Pulizia cache web + native...'
    if (Test-Path $Gradlew) { & $Gradlew --stop 2>$null }        # ferma i daemon Gradle che bloccano i file
    # Cancella build web, cache Angular e output nativi per ripartire da zero
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue `
      (Join-Path $Frontend 'www'), (Join-Path $Frontend '.angular\cache'), (Join-Path $Frontend 'dist'), `
      (Join-Path $Android 'app\src\main\assets\public'), (Join-Path $Android 'app\build'), `
      (Join-Path $Android 'build'), (Join-Path $Android '.gradle'), `
      (Join-Path $Android 'capacitor-cordova-android-plugins\build')
  } else { Note 'Deep-clean saltata (-SkipClean).' }

  # 3. Build web ottimizzata per l'APK (configurazione capacitor, URL backend Render)
  Step 'Build web (configurazione capacitor / URL Render)...'
  Set-Location $Frontend                                         # entra nella cartella del frontend
  Run 'npm run ionic:build'                                      # ng build --configuration capacitor → www/

  Step 'Sincronizzo web + nativo (cap sync)...'
  Run 'npx cap sync android'                                     # copia www/ negli asset Android e allinea i plugin

  # Ricrea local.properties (ignorato da git, quindi può mancare): dice a Gradle dov'è l'SDK
  $localProps = Join-Path $Android 'local.properties'
  $sdkPath = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
  [System.IO.File]::WriteAllText($localProps, "sdk.dir=$($sdkPath.Replace('\','\\'))`n")

  # 4. Compilazione nativa
  Step 'Gradle clean + assembleDebug...'
  Set-Location $Android                                          # entra nel progetto Android
  Run '.\gradlew.bat clean'                                      # pulisce i residui della build precedente
  Run '.\gradlew.bat assembleDebug'                              # compila l'APK di debug
  if (-not (Test-Path $ApkBuilt)) { Die "APK non trovato in $ApkBuilt" }  # verifica che l'APK esista davvero

  # 5. Copia l'APK in ENTRAMBE le destinazioni: root (test locale) + downloads (sito)
  Step 'Copio l''APK nella root e in ECHO-backend/downloads...'
  Set-Location $Root                                             # torna alla root del repo
  Copy-Item $ApkBuilt $ApkRoot   -Force                          # aggiorna echo-debug.apk (artefatto di test)
  Copy-Item $ApkBuilt $ApkServed -Force                          # aggiorna l'APK che il sito serve agli utenti
  Ok ("APK aggiornato in entrambe le destinazioni ({0:N1} MB)" -f ((Get-Item $ApkRoot).Length / 1MB))

  # Promemoria finale: la pubblicazione online resta un'azione manuale e consapevole
  Write-Host "`n============================================================" -ForegroundColor Green
  Write-Host ' FATTO. L''APK è già al posto giusto (ECHO-backend/downloads).' -ForegroundColor Green
  Write-Host ' Per PUBBLICARLO online: commit + push da GitHub Desktop' -ForegroundColor Green
  Write-Host ' (innesca il redeploy Render → il sito servirà il nuovo APK).' -ForegroundColor Green
  Write-Host '' -ForegroundColor Green
  Write-Host ' Sul telefono, PRIMA di installare il nuovo build:' -ForegroundColor Green
  Write-Host '   1. Disinstalla ECHO (svuota le cache della WebView)' -ForegroundColor Green
  Write-Host '   2. Reinstalla echo-debug.apk' -ForegroundColor Green
  Write-Host '============================================================' -ForegroundColor Green
}

# ------------------------------------------------------------------------------------
# MODE: Dev — emulatore + ionic serve, frontend puntato al backend online (Render).
# ------------------------------------------------------------------------------------
function Invoke-Dev {
  Ensure-Emulator                                                # si assicura che un emulatore sia attivo

  Step 'Avvio frontend (npm run ionic:serve) su http://localhost:8100 ...'
  # Apre una nuova finestra PowerShell dedicata al dev server con live reload
  Start-Process powershell -ArgumentList '-NoExit', '-Command', `
    "Set-Location '$Frontend'; npm run ionic:serve"

  Write-Host "`n[ECHO] Servizi avviati." -ForegroundColor Green
  Write-Host '  Browser  : http://localhost:8100'
  Write-Host '  Backend  : https://echo-backend-z9k5.onrender.com (online, durate reali)'
}

# ------------------------------------------------------------------------------------
# MODE: Run — compila e installa il build su un emulatore in esecuzione.
# ------------------------------------------------------------------------------------
function Invoke-Run {
  Ensure-Emulator                                                # si assicura che un emulatore sia attivo
  if (-not $SkipClean) {
    Step 'Build web + sync...'
    Set-Location $Frontend                                       # entra nella cartella del frontend
    Run 'npm run ionic:build'                                    # ricompila la parte web
    Run 'npx cap sync android'                                   # riallinea gli asset nativi
  } else { Note 'Rebuild web saltato (-SkipClean).' }

  Step 'assembleDebug + install + launch...'
  Set-Location $Android                                          # entra nel progetto Android
  Run '.\gradlew.bat assembleDebug'                              # compila l'APK di debug
  & $ADB install -r 'app\build\outputs\apk\debug\app-debug.apk'  # installa sull'emulatore sovrascrivendo (-r)
  & $ADB shell monkey -p com.echo.app -c android.intent.category.LAUNCHER 1 | Out-Null  # avvia l'app appena installata
  Ok 'App installata e avviata sull''emulatore.'
}

# ------------------------------------------------------------------------------------
# Smista la modalità scelta e, in ogni caso, riporta il terminale nella root a fine corsa
try {
  switch ($Mode) {
    'Build' { Invoke-Build }   # pipeline APK completa
    'Dev'   { Invoke-Dev }     # ambiente di sviluppo con live reload
    'Run'   { Invoke-Run }     # deploy sull'emulatore
  }
} finally {
  Set-Location $Root           # non lasciare mai il terminale in una sottocartella
}
