/**
 * ECHO — Pagina Autenticazione (Analog Dark)
 * Login + Registrazione. (Il tutorial di primo avvio è una pagina instradata a parte —
 * /onboarding, protetta da guardOnBoarding — non più mostrata da qui.)
 */

import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, ToastController, AlertController } from '@ionic/angular/standalone';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent],
  template: `
    <ion-content>
      <div class="auth-shell">

        <!-- Logo block -->
        <header class="auth-header">
          <svg class="corner-camera" viewBox="0 0 100 70">
            <rect x="6" y="18" width="88" height="46" rx="4" fill="#2A1A0E"/>
            <rect x="30" y="6" width="22" height="14" rx="2" fill="#2A1A0E"/>
            <circle cx="50" cy="42" r="19" fill="#F5EFE6"/>
            <circle cx="50" cy="42" r="13" fill="#2A1A0E"/>
          </svg>
          <div class="logo">ECHO</div>
          <p class="tagline">The Persistence of the Moment</p>
        </header>

        <!-- ════════════════════════════════════════════════════════════
             STEP 1 — credentials (both login & register use this view)
             ════════════════════════════════════════════════════════════ -->
        <ng-container *ngIf="step === 'credentials'">
          <div class="reel-label">
            <svg class="reel-icon" viewBox="0 0 24 32">
              <rect x="2" y="2" width="20" height="28" rx="2" fill="none" stroke="#2A1A0E" stroke-width="1.5"/>
              <circle cx="7" cy="9" r="2" fill="none" stroke="#2A1A0E" stroke-width="1.2"/>
              <circle cx="17" cy="9" r="2" fill="none" stroke="#2A1A0E" stroke-width="1.2"/>
              <circle cx="7" cy="23" r="2" fill="none" stroke="#2A1A0E" stroke-width="1.2"/>
              <circle cx="17" cy="23" r="2" fill="none" stroke="#2A1A0E" stroke-width="1.2"/>
            </svg>
            <span>{{ mode === 'login' ? 'Accedi' : 'Registrati' }}</span>
          </div>

          <div class="auth-form">
            <div class="field-group">
              <label class="field-label">Email</label>
              <input class="field-input" [(ngModel)]="form.email"
                     type="email" autocomplete="email" placeholder="Inserisci la tua email..." />
            </div>

            <div class="field-group">
              <label class="field-label">Password</label>
              <input class="field-input" [(ngModel)]="form.password"
                     type="password" autocomplete="current-password"
                     (keyup.enter)="onCredentialsSubmit()" placeholder="Inserisci la tua password..." />
            </div>

            <button class="forgot-link forgot-link--right" *ngIf="mode === 'login'" (click)="openForgotPassword()">
              Password dimenticata?
            </button>

            <!-- Inline error -->
            <p class="auth-error" *ngIf="errorMsg">{{ errorMsg }}</p>

            <button class="auth-submit echo-btn" [class.loading]="caricamento"
                    (click)="onCredentialsSubmit()" [disabled]="caricamento">
              <span *ngIf="!caricamento">Inizia</span>
              <span class="spinner" *ngIf="caricamento"></span>
            </button>

            <p class="mode-switch">
              <ng-container *ngIf="mode === 'login'">
                Non hai un account? <a (click)="switchMode('register')">Registrati</a>
              </ng-container>
              <ng-container *ngIf="mode === 'register'">
                Hai già un account? <a (click)="switchMode('login')">Accedi</a>
              </ng-container>
            </p>
          </div>
        </ng-container>

        <!-- ════════════════════════════════════════════════════════════
             STEP 2 — profile (register only): avatar + nome/cognome
             ════════════════════════════════════════════════════════════ -->
        <ng-container *ngIf="step === 'profile'">
          <div class="reel-label">
            <svg class="reel-icon" viewBox="0 0 24 32">
              <rect x="2" y="2" width="20" height="28" rx="2" fill="none" stroke="#2A1A0E" stroke-width="1.5"/>
              <circle cx="7" cy="9" r="2" fill="none" stroke="#2A1A0E" stroke-width="1.2"/>
              <circle cx="17" cy="9" r="2" fill="none" stroke="#2A1A0E" stroke-width="1.2"/>
              <circle cx="7" cy="23" r="2" fill="none" stroke="#2A1A0E" stroke-width="1.2"/>
              <circle cx="17" cy="23" r="2" fill="none" stroke="#2A1A0E" stroke-width="1.2"/>
            </svg>
            <span>Registrazione</span>
          </div>

          <div class="avatar-picker">
            <label class="avatar-circle" for="avatarInput">
              <img [src]="avatarPreview || 'assets/default-avatar.svg'" alt="" />
            </label>
            <input id="avatarInput" type="file" accept="image/*" hidden (change)="onAvatarSelected($event)" />
            <label for="avatarInput" class="avatar-link">Carica la tua immagine (Opzionale)</label>
          </div>

          <div class="auth-form">
            <div class="field-group">
              <label class="field-label">Nome</label>
              <input class="field-input" [(ngModel)]="form.nome"
                     type="text" autocomplete="given-name" placeholder="Nome..." />
            </div>
            <div class="field-group">
              <label class="field-label">Cognome</label>
              <input class="field-input" [(ngModel)]="form.cognome"
                     type="text" autocomplete="family-name" (keyup.enter)="submit()" placeholder="Cognome..." />
            </div>

            <p class="auth-error" *ngIf="errorMsg">{{ errorMsg }}</p>

            <button class="auth-submit echo-btn" [class.loading]="caricamento"
                    (click)="submit()" [disabled]="caricamento">
              <span *ngIf="!caricamento">Inizia</span>
              <span class="spinner" *ngIf="caricamento"></span>
            </button>

            <button class="back-link" (click)="backToCredentials()" [disabled]="caricamento">Torna indietro</button>
          </div>
        </ng-container>

        <!-- Footer rule -->
        <div class="auth-footer">
          <span class="footer-rule"></span>
          <span class="footer-text">ECHO &copy; 2025–2026</span>
          <span class="footer-rule"></span>
        </div>

      </div>
    </ion-content>
  `,
  styles: [`
    ion-content { --background: var(--echo-bg); }

    .auth-shell {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 32px;
      max-width: 420px;
      margin: 0 auto;
      position: relative;
    }

    /* ── Logo ── */
    .auth-header { text-align: center; margin-bottom: 32px; position: relative; width: 100%; }

    .corner-camera {
      position: absolute;
      top: -16px;
      right: 0;
      width: 64px;
      opacity: 0.9;
    }

    .logo {
      font-family: var(--echo-font-display);
      font-size: 44px;
      color: var(--echo-ink);
      line-height: 1;
    }

    .tagline {
      margin-top: 4px;
      font-family: var(--echo-font-mono);
      font-size: 10px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--echo-ink-soft);
    }

    /* ── Avatar picker (registration) ── */
    .reel-label {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 18px;
    }
    .reel-icon { width: 18px; height: 24px; }
    .reel-label span {
      font-family: var(--echo-font-mono);
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--echo-ink);
    }

    .avatar-picker {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 24px;
    }
    .avatar-circle {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      overflow: hidden;
      border: 1px solid var(--echo-ink);
      cursor: pointer;
      flex-shrink: 0;
      display: block;
    }
    .avatar-circle img { width: 100%; height: 100%; object-fit: cover; }
    .avatar-link {
      font-family: var(--echo-font-mono);
      font-size: 12px;
      text-decoration: underline;
      color: var(--echo-ink);
      cursor: pointer;
    }

    /* ── Form ── */
    .auth-form { width: 100%; }

    .field-group { margin-bottom: 18px; }

    .field-label {
      display: block;
      font-family: var(--echo-font-mono);
      font-size: 10px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--echo-ink-soft);
      margin-bottom: 6px;
    }

    .field-input {
      width: 100%;
      background: transparent;
      border: 1.5px solid var(--echo-ink);
      border-radius: var(--echo-radius-sm);
      color: var(--echo-ink);
      font-family: var(--echo-font-mono);
      font-size: 15px;
      padding: 12px 14px;
      outline: none;
      transition: border-color 150ms;

      &::placeholder { color: var(--echo-surface-muted); }
      &:focus { border-color: var(--echo-rust); }
    }

    .auth-error {
      font-family: var(--echo-font-mono);
      font-size: 12px;
      color: #8A3F23;
      margin: -6px 0 16px;
      padding: 8px 12px;
      background: rgba(184,92,56,0.10);
      border-left: 2px solid var(--echo-rust);
      border-radius: 0 2px 2px 0;
    }

    /* Submit button — reuses .echo-btn's dark-pill + pressed-shadow look */
    .auth-submit {
      width: 100%;
      margin-top: 8px;
      &[disabled] { opacity: 0.5; cursor: not-allowed; }
    }

    .forgot-link {
      display: block;
      width: 100%;
      margin-top: 16px;
      background: transparent;
      border: none;
      font-family: var(--echo-font-mono);
      color: var(--echo-ink-soft);
      font-size: 11px;
      letter-spacing: 0.08em;
      text-align: center;
      cursor: pointer;
      padding: 4px;
      transition: color 150ms;
      &:active { color: var(--echo-rust); }
    }
    .forgot-link--right { width: auto; margin: -8px 0 16px auto; text-align: right; padding: 0; }

    .mode-switch {
      margin: 18px 0 0;
      text-align: center;
      font-family: var(--echo-font-mono);
      font-size: 12px;
      color: var(--echo-ink-soft);
      a { color: var(--echo-ink); text-decoration: underline; cursor: pointer; }
    }

    /* "Torna indietro" secondario sotto il submit dello step profilo — solo testo, riporta
       allo step credenziali così l'utente non resta mai intrappolato nel completamento profilo. */
    .back-link {
      display: block;
      width: 100%;
      margin-top: 14px;
      background: transparent;
      border: none;
      font-family: var(--echo-font-mono);
      color: var(--echo-ink-soft);
      font-size: 12px;
      letter-spacing: 0.06em;
      text-align: center;
      cursor: pointer;
      padding: 4px;
      text-decoration: underline;
      transition: color 150ms;
      &:active { color: var(--echo-rust); }
      &[disabled] { opacity: 0.5; cursor: not-allowed; }
    }

    /* Loading spinner */
    .spinner {
      width: 16px;
      height: 16px;
      border: 1.5px solid rgba(245,239,230,0.3);
      border-top-color: var(--echo-cream);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Footer */
    .auth-footer {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 40px;
      width: 100%;
    }
    .footer-rule { flex: 1; height: 1px; background: var(--echo-ink); opacity: 0.2; }
    .footer-text { font-family: var(--echo-font-mono); font-size: 10px; color: var(--echo-surface-muted); letter-spacing: 0.1em; white-space: nowrap; }
  `],
})
export class PaginaAutenticazione implements OnInit {
  mode: 'login' | 'register' = 'login';
  caricamento = false;
  errorMsg = '';
  form = { nome: '', cognome: '', email: '', password: '' };
  avatarFile: File | null = null;
  avatarPreview: string | null = null;

  /** 'credentials' (email+password, sia login che registrazione) → 'profile' (solo
   *  registrazione: avatar+nome+cognome). Il login non avanza mai oltre 'credentials'. */
  step: 'credentials' | 'profile' = 'credentials';

  constructor(
    private auth: AuthService,
    private api: ApiService,
    private router: Router,
    private route: ActivatedRoute,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
  ) {}

  /** Impostato da guardAuth quando rimbalza a /auth una visita non autenticata/scaduta da un
   *  deep link specifico (es. /profilo) — login() sotto rimanda l'utente lì invece di atterrare
   *  sempre su /eventi/miei, così un re-login forzato non perde la pagina che stava
   *  effettivamente cercando di raggiungere. */
  private returnUrl: string | null = null;

  ngOnInit() {
    // Se il token è ancora valido, salta il form — l'utente è già autenticato.
    // Il replaceUrl:true nelle navigate verso /auth (guard + landing) garantisce che non
    // ci sia la vecchia pagina profilo nello stack, quindi questo redirect è sicuro.
    if (this.auth.isLoggedIn) {
      const dest = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/eventi/miei';
      this.router.navigateByUrl(dest.startsWith('/auth') ? '/eventi/miei' : dest, { replaceUrl: true });
      return;
    }
    if (this.route.snapshot.queryParamMap.get('mode') === 'register') this.mode = 'register';
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    if (returnUrl && !returnUrl.startsWith('/auth')) this.returnUrl = returnUrl;
  }

  switchMode(mode: 'login' | 'register') {
    this.mode = mode;
    this.step = 'credentials';
    this.errorMsg = '';
  }

  /** "Torna indietro" sullo step profilo → ritorno allo step credenziali. Non esiste ancora un
   *  account e nessun token viene emesso finché submit() non riesce sullo step profilo, quindi
   *  non c'è sessione/token parziale da pulire qui — solo lo stato del form in memoria, che
   *  manteniamo intenzionalmente (email/password preservate) così l'utente può correggere un
   *  errore senza riscrivere tutto. */
  backToCredentials() {
    this.step = 'credentials';
    this.errorMsg = '';
  }

  /** Submit dello step 1. Il login autentica subito; la registrazione valida email e password
   *  PRIMA di avanzare allo step 2 — l'utente non deve raggiungere il completamento del profilo
   *  con un'email già registrata o una password non valida (altrimenti fallirebbero solo alla
   *  fine, dopo aver inserito nome/avatar). */
  async onCredentialsSubmit() {
    this.errorMsg = '';
    if (!this.form.email || !this.form.password) {
      this.errorMsg = 'Email e password sono obbligatorie.';
      return;
    }
    if (this.mode === 'login') {
      this.submit();
      return;
    }

    // ── Registrazione: regola l'avanzamento allo step profilo ──
    const email = this.form.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.errorMsg = 'Inserisci un indirizzo email valido.';
      return;
    }
    if (this.form.password.length < 8) {
      this.errorMsg = 'La password deve avere almeno 8 caratteri.';
      return;
    }

    this.caricamento = true;
    try {
      const { exists } = await firstValueFrom(this.api.checkEmail(email));
      if (exists) {
        this.errorMsg = 'Questa email è già registrata. Accedi invece.';
        return;
      }
    } catch {
      // checkEmail è una scorciatoia UX — se irraggiungibile, procedi comunque.
      // L'endpoint /registrazione impone l'unicità con un 409.
    } finally {
      this.caricamento = false;
    }
    this.step = 'profile';
  }

  async submit() {
    this.errorMsg = '';
    this.caricamento = true;
    try {
      if (this.mode === 'login') {
        await firstValueFrom(this.auth.login(this.form.email, this.form.password));
        this.router.navigateByUrl(this.returnUrl ?? '/eventi/miei');
      } else {
        await firstValueFrom(this.auth.register(
          this.form.nome, this.form.cognome, this.form.email, this.form.password
        ));
        // L'avatar è opzionale ed era stato acquisito solo lato client (non esisteva ancora un
        // account a cui allegarlo) — register() sopra autentica già la nuova sessione, quindi
        // l'endpoint foto-profilo esistente può essere chiamato subito. Best-effort:
        // un upload fallito non deve bloccare il resto del flusso di registrazione.
        if (this.avatarFile) {
          try { await firstValueFrom(this.api.uploadFotoProfilo(this.avatarFile)); } catch { /* ignore */ }
        }
        this.router.navigate(['/eventi/miei']);
      }
    } catch (errore: unknown) {
      const he = errore as { status?: number; error?: { error?: string } | string; message?: string };
      const serverMsg = typeof he?.error === 'object' ? he?.error?.error : undefined;
      const status = he?.status ?? 0;
      this.errorMsg = serverMsg ?? `Errore ${status}: ${he?.message ?? 'connessione fallita'}`;
      if (this.mode === 'register') this.step = 'credentials';
    } finally {
      this.caricamento = false;
    }
  }

  onAvatarSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.avatarFile = file;
    const reader = new FileReader();
    reader.onload = () => { this.avatarPreview = reader.result as string; };
    reader.readAsDataURL(file);
  }

  async openForgotPassword() {
    // Step 1: ask for email, send OTP
    const step1 = await this.alertCtrl.create({
      header: 'Password dimenticata?',
      message: 'Inserisci la tua email per ricevere il codice OTP.',
      cssClass: 'echo-alert',
      inputs: [{ name: 'email', type: 'email', placeholder: 'giulia@example.com', value: this.form.email }],
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: 'Invia OTP',
          handler: async (data: { email?: string }) => {
            const email = data.email?.trim();
            if (!email) return false;
            try {
              await firstValueFrom(this.api.forgotPassword(email));
              // Step 2: ask for OTP + new password
              setTimeout(() => this.openOtpStep(email), 300);
            } catch {
              this.toast('Errore durante l\'invio. Riprova più tardi.', 'danger');
            }
            return true;
          },
        },
      ],
    });
    await step1.present();
  }

  private async openOtpStep(email: string) {
    const step2 = await this.alertCtrl.create({
      header: 'Inserisci il codice OTP',
      message: `Controlla la console (in demo) o la tua email per il codice a 6 cifre inviato a ${email}.`,
      cssClass: 'echo-alert',
      inputs: [
        { name: 'otp', type: 'number', placeholder: 'Codice OTP (6 cifre)' },
        { name: 'password', type: 'password', placeholder: 'Nuova password (min. 8 caratteri)' },
      ],
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: 'Conferma',
          handler: async (data: { otp?: string; password?: string }) => {
            const otp = String(data.otp ?? '').trim();
            const nuova_password = data.password ?? '';
            if (!otp || nuova_password.length < 8) {
              this.toast('Inserisci OTP e una password di almeno 8 caratteri.', 'danger');
              return false;
            }
            try {
              const res = await firstValueFrom(this.api.verifyResetOtp(email, otp, nuova_password));
              this.toast(res.message);
            } catch (errore: unknown) {
              const msg = (errore as { error?: { error?: string } })?.error?.error ?? 'OTP non valido o scaduto.';
              this.toast(msg, 'danger');
            }
            return true;
          },
        },
      ],
    });
    await step2.present();
  }

  private async toast(message: string, color: 'success' | 'danger' = 'success') {
    const t = await this.toastCtrl.create({ message, duration: 2800, color, position: 'top' });
    t.present();
  }
}
