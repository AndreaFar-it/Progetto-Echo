<#
=====================================================================================
 ECHO — Script unico di build & avvio  (build-and-run.ps1)
=====================================================================================
 Consolida i tre vecchi script (build-and-publish.ps1, run-android.ps1, start-dev.ps1)
 in un solo entry point. Da eseguire dalla ROOT del repository.

 MODALITÀ (-Mode):

   Build  (default) : pipeline completa per generare/aggiornare l'APK di debug.
                      1. compila il backend (tsc) per verifica
                      2. applica le patch native (patch-package → fix Java de-zoom)
                      3. deep-clean delle cache web/native (saltabile con -SkipClean)
                      4. build web con l'URL backend di PRODUZIONE (Render)
                      5. cap sync + gradle clean + assembleDebug
                      6. aggiorna  echo-debug.apk  nella root del repo
                      Con -Publish aggiorna anche ECHO-backend/downloads/echo.apk
                      e fa commit + push (innesca il redeploy su Render).

   Dev              : ambiente di sviluppo locale.
                      Avvia l'emulatore + `ionic serve` (live reload su :8100).
                      -Backend User (default) → punta al backend Render (durate reali).
                      -Backend Dev            → avvia anche il backend LOCALE
                                                (DEVELOPMENT_MODE=true, timer a 3 minuti).

   Run              : deploya il build su un emulatore in esecuzione
                      (assembleDebug + adb install -r + launch). -SkipClean per
                      saltare la ricompilazione web.

 ESEMPI:
   .\build-and-run.ps1                          # APK debug → echo-debug.apk
   .\build-and-run.ps1 -Publish                 # + aggiorna server e push Render
   .\build-and-run.ps1 -Mode Dev                # dev locale, frontend → backend Render
   .\build-and-run.ps1 -Mode Dev -Backend Dev   # dev locale, backend locale 3 min
   .\build-and-run.ps1 -Mode Run                # installa sull'emulatore
=====================================================================================
#>

param(
  [ValidateSet('Build', 'Dev', 'Run')] [string]$Mode = 'Build',
  [ValidateSet('User', 'Dev')]         [string]$Backend = 'User',
  [switch]$Publish,
  [switch]$SkipClean
)

$ErrorActionPreference = 'Stop'

# --- Percorsi (relativi alla posizione dello script = root del repo) -----------------
$Root       = $PSScriptRoot
$Frontend   = Join-Path $Root 'ECHO-frontend'
$BackendDir = Join-Path $Root 'ECHO-backend'
$Android    = Join-Path $Frontend 'android'
$Gradlew    = Join-Path $Android 'gradlew.bat'
$ApkBuilt   = Join-Path $Android 'app\build\outputs\apk\debug\app-debug.apk'
$ApkRoot    = Join-Path $Root 'echo-debug.apk'
$ApkServed  = Join-Path $BackendDir 'downloads\echo.apk'
$ADB        = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$EMULATOR   = Join-Path $env:LOCALAPPDATA 'Android\Sdk\emulator\emulator.exe'

function Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Note($msg) { Write-Host "   $msg" -ForegroundColor DarkGray }
function Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Die($msg)  { Write-Host "[ERRORE] $msg" -ForegroundColor Red; exit 1 }

# Esegue un comando e interrompe lo script se l'exit code non è 0.
function Run($cmd) {
  & ([ScriptBlock]::Create($cmd))
  if ($LASTEXITCODE -ne 0) { Die "Comando fallito: $cmd" }
}

# ------------------------------------------------------------------------------------
# Garantisce che un emulatore sia in esecuzione; se non lo è, ne avvia uno e attende il boot.
# Nota GPU: si usa `-gpu angle_indirect` perché su questa AVD il path GPU hardware
# non inizializza una surface EGL con canale alfa (necessaria perché MainActivity rende
# trasparente lo sfondo della WebView per il layer camera-preview) → schermo nero.
# ------------------------------------------------------------------------------------
function Ensure-Emulator {
  Step 'Controllo emulatore...'
  if ((& $ADB devices 2>$null) -match 'emulator-\d+\s+device') { Note 'Emulatore già in esecuzione.'; return }

  $avd = & $EMULATOR -list-avds 2>$null | Where-Object { $_ -match '\S' } | Select-Object -First 1
  if (-not $avd) { Die 'Nessuna AVD trovata. Creane una in Android Studio (Pixel 6, API 34, fotocamere = Emulated).' }

  Note "Avvio emulatore: $avd"
  Start-Process $EMULATOR -ArgumentList '-avd', $avd.Trim(), '-gpu', 'angle_indirect'

  Note 'Attendo il boot (max 2 min)...'
  $elapsed = 0
  while ($elapsed -lt 120) {
    Start-Sleep -Seconds 4; $elapsed += 4
    if ((& $ADB devices 2>$null) -match 'emulator-\d+\s+device') {
      # Fuso orario italiano + tastiera software forzata (l'emulatore presenta una
      # tastiera "hardware" che altrimenti sopprime l'IME a schermo).
      & $ADB shell setprop persist.sys.timezone Europe/Rome | Out-Null
      & $ADB shell settings put secure show_ime_with_hard_keyboard 1 | Out-Null
      Ok 'Emulatore pronto.'; return
    }
    Note "  ...ancora in avvio ($elapsed s)"
  }
  Die 'Emulatore non avviato in tempo.'
}

# ------------------------------------------------------------------------------------
# MODE: Build — pipeline completa APK di debug.
# ------------------------------------------------------------------------------------
function Invoke-Build {
  # 1. Backend: compila per verifica (l'APK non lo usa, ma conferma che il backend è sano)
  Step 'Compilo il backend (tsc)...'
  Set-Location $BackendDir
  Run 'npm run build'

  # 2. Patch native: riapplica le patch in ECHO-frontend/patches/ a node_modules.
  #    Include il fix Java de-zoom di @capacitor-community/camera-preview (vedi README).
  Step 'Applico le patch native (patch-package)...'
  Set-Location $Frontend
  Run 'npx patch-package'

  # 3. Deep-clean delle cache che causano "APK con asset vecchi" (saltabile con -SkipClean)
  if (-not $SkipClean) {
    Step 'Pulizia cache web + native...'
    if (Test-Path $Gradlew) { & $Gradlew --stop 2>$null }
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue `
      (Join-Path $Frontend 'www'), (Join-Path $Frontend '.angular\cache'), (Join-Path $Frontend 'dist'), `
      (Join-Path $Android 'app\src\main\assets\public'), (Join-Path $Android 'app\build'), `
      (Join-Path $Android 'build'), (Join-Path $Android '.gradle'), `
      (Join-Path $Android 'capacitor-cordova-android-plugins\build')
  } else { Note 'Deep-clean saltata (-SkipClean).' }

  # 4. Build web con l'URL backend di PRODUZIONE (Render).
  #    ionic:build = "ng build --configuration capacitor" → environment.capacitor.ts
  #    (apiUrl = https://echo-backend-z9k5.onrender.com). Un "npm run build" semplice
  #    userebbe localhost:3000 e l'APK non raggiungerebbe il backend dal telefono.
  Step 'Build web (configurazione capacitor / URL Render)...'
  Set-Location $Frontend
  Run 'npm run ionic:build'

  Step 'Sincronizzo web + nativo (cap sync)...'
  Run 'npx cap sync android'

  # Ricrea sempre local.properties prima di gradle (viene ignorato da git e può mancare)
  $localProps = Join-Path $Android 'local.properties'
  $sdkPath = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
  [System.IO.File]::WriteAllText($localProps, "sdk.dir=$($sdkPath.Replace('\','\\'))`n")

  Step 'Gradle clean + assembleDebug...'
  Set-Location $Android
  Run '.\gradlew.bat clean'
  Run '.\gradlew.bat assembleDebug'
  if (-not (Test-Path $ApkBuilt)) { Die "APK non trovato in $ApkBuilt" }

  # 5. Aggiorna l'artefatto canonico nella root del repo.
  Step 'Aggiorno echo-debug.apk nella root...'
  Set-Location $Root
  Copy-Item $ApkBuilt $ApkRoot -Force
  Ok ("echo-debug.apk aggiornato ({0:N1} MB)" -f ((Get-Item $ApkRoot).Length / 1MB))

  # 6. (Opzionale) pubblica: aggiorna l'APK servito dal backend e fa push → redeploy Render.
  if ($Publish) {
    Step 'Pubblicazione: aggiorno l''APK servito dal backend...'
    Copy-Item $ApkBuilt $ApkServed -Force
    git -C $Root add ECHO-backend/downloads/echo.apk
    if (git -C $Root status --porcelain ECHO-backend/downloads/echo.apk) {
      $c = Read-Host 'Commit & push del nuovo APK (innesca redeploy Render)? (y/N)'
      if ($c -eq 'y') {
        git -C $Root commit -m 'chore: aggiornamento APK Android di debug'
        git -C $Root push
        Ok 'Push effettuato. Attendi la fine del deploy Render prima di scaricare.'
      } else { Note 'APK copiato localmente ma NON pushato.' }
    } else { Note 'APK identico a quello già committato — niente da pushare.' }
  }

  Write-Host "`n============================================================" -ForegroundColor Green
  Write-Host ' FATTO. Sul telefono, PRIMA di installare il nuovo build:' -ForegroundColor Green
  Write-Host '   1. Disinstalla ECHO (svuota la cache del service-worker)' -ForegroundColor Green
  Write-Host '   2. Reinstalla echo-debug.apk' -ForegroundColor Green
  Write-Host '============================================================' -ForegroundColor Green
}

# ------------------------------------------------------------------------------------
# MODE: Dev — emulatore + ionic serve (+ backend locale opzionale).
# ------------------------------------------------------------------------------------
function Invoke-Dev {
  if ($Backend -eq 'Dev') {
    Step 'Avvio backend LOCALE (DEVELOPMENT_MODE=true, timer a 3 minuti)...'
    Start-Process powershell -ArgumentList '-NoExit', '-Command', `
      "Set-Location '$BackendDir'; `$env:TZ='Europe/Rome'; `$env:DEVELOPMENT_MODE='true'; npm run dev"
  }
  Ensure-Emulator

  $serve = if ($Backend -eq 'Dev') { 'ionic:serve:dev' } else { 'ionic:serve:user' }
  Step "Avvio frontend (npm run $serve) su http://localhost:8100 ..."
  Start-Process powershell -ArgumentList '-NoExit', '-Command', `
    "Set-Location '$Frontend'; npm run $serve"

  Write-Host "`n[ECHO] Servizi avviati (Backend = $Backend)." -ForegroundColor Green
  Write-Host '  Browser  : http://localhost:8100'
  if ($Backend -eq 'Dev') { Write-Host '  Backend  : http://localhost:3000 (locale, 3 min)' }
  else                    { Write-Host '  Backend  : https://echo-backend-z9k5.onrender.com (online, durate reali)' }
}

# ------------------------------------------------------------------------------------
# MODE: Run — installa il build sull'emulatore.
# ------------------------------------------------------------------------------------
function Invoke-Run {
  Ensure-Emulator
  if (-not $SkipClean) {
    Step 'Build web + sync...'
    Set-Location $Frontend
    Run 'npx patch-package'
    Run 'npm run ionic:build'
    Run 'npx cap sync android'
  } else { Note 'Rebuild web saltato (-SkipClean).' }

  Step 'assembleDebug + install + launch...'
  Set-Location $Android
  Run '.\gradlew.bat assembleDebug'
  & $ADB install -r 'app\build\outputs\apk\debug\app-debug.apk'
  & $ADB shell monkey -p com.echo.app -c android.intent.category.LAUNCHER 1 | Out-Null
  Ok 'App installata e avviata sull''emulatore.'
}

# ------------------------------------------------------------------------------------
try {
  switch ($Mode) {
    'Build' { Invoke-Build }
    'Dev'   { Invoke-Dev }
    'Run'   { Invoke-Run }
  }
} finally {
  Set-Location $Root
}
