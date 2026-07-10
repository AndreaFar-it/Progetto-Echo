<#
=====================================================================================
 ECHO — Installazione componenti Android SDK  (install-sdk.ps1)
=====================================================================================
 Installa i pacchetti SDK richiesti dal progetto (allineati a variables.gradle:
 compileSdk/targetSdk = 36) su una macchina nuova. Da eseguire una sola volta.

 PREREQUISITO: gli "Android SDK Command-line Tools" devono essere già presenti
 (Android Studio → SDK Manager → scheda SDK Tools → spunta "Android SDK
 Command-line Tools (latest)" → Apply). Questo script installa il resto.
=====================================================================================
#>

# Interrompe lo script al primo errore di un cmdlet PowerShell
$ErrorActionPreference = 'Stop'

# --- Individua la cartella dell'SDK ---------------------------------------------------
# Usa ANDROID_HOME se impostata, altrimenti il percorso standard per l'utente corrente
$SdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }

# Percorso completo di sdkmanager.bat (lo strumento a riga di comando che scarica i pacchetti)
$SdkManager = Join-Path $SdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat'

# Se sdkmanager non esiste, spiega esattamente come ottenerlo e termina
if (-not (Test-Path $SdkManager)) {
  Write-Host "[ERRORE] sdkmanager non trovato in: $SdkManager" -ForegroundColor Red
  Write-Host '  Installa i Command-line Tools da Android Studio:' -ForegroundColor Yellow
  Write-Host '  SDK Manager -> SDK Tools -> "Android SDK Command-line Tools (latest)" -> Apply' -ForegroundColor Yellow
  exit 1
}

Write-Host ">> SDK trovato in: $SdkRoot" -ForegroundColor Cyan

# --- Accetta le licenze -----------------------------------------------------------------
# Invia una serie di "y" a sdkmanager --licenses: senza licenze accettate ogni build Gradle fallisce
Write-Host '>> Accetto le licenze SDK...' -ForegroundColor Cyan
1..10 | ForEach-Object { 'y' } | & $SdkManager --licenses | Out-Null

# --- Installa i pacchetti richiesti dal progetto ---------------------------------------
Write-Host '>> Installo i pacchetti (platform-tools, emulator, android-36, build-tools 36)...' -ForegroundColor Cyan
& $SdkManager `
  'platform-tools'         <# adb e strumenti di comunicazione col dispositivo #> `
  'emulator'               <# emulatore Android, usato da build-and-run.ps1 -Mode Dev/Run #> `
  'platforms;android-36'   <# piattaforma richiesta da variables.gradle (compileSdk 36) #> `
  'build-tools;36.0.0'     <# strumenti di compilazione allineati alla piattaforma #>
if ($LASTEXITCODE -ne 0) { Write-Host '[ERRORE] Installazione pacchetti fallita.' -ForegroundColor Red; exit 1 }

# --- Verifica finale --------------------------------------------------------------------
# Controlla che adb esista davvero dove build-and-run.ps1 se lo aspetta
$Adb = Join-Path $SdkRoot 'platform-tools\adb.exe'
if (Test-Path $Adb) {
  Write-Host "[OK] Installazione completata. adb: $Adb" -ForegroundColor Green
  Write-Host '     Ricorda le variabili d''ambiente (JAVA_HOME, ANDROID_HOME, PATH) - vedi README, sezione 2.' -ForegroundColor Green
} else {
  Write-Host '[ERRORE] platform-tools non risulta installato.' -ForegroundColor Red; exit 1
}
