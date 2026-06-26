/**
 * ECHO — Pagina Landing Pubblica (Analog Dark · layout "Digital Film Roll")
 *
 * Pagina di presentazione pubblica mostrata su WEB/PWA ad ogni visita su '/'
 * (vedi guardiaAutenticazione in core/guards/guards.ts), sia per utenti loggati che non.
 * Il guardiaLanding la esclude dall'app nativa — l'APK Android non la mostra mai.
 *
 * Struttura grafica fedele al mockup marketing 1:1:
 *   - Navbar con logo e CTA
 *   - Hero con viewfinder HUD (fotocamera vintage)
 *   - Sezione "come funziona" a 3 passi con bordo pellicola scallop
 *   - CTA download app
 *   - Footer completo
 *
 * I link di navigazione senza destinazione reale (FAQ, About, social, newsletter, legal)
 * sono renderizzati per fedeltà visiva ma sono inattivi — scelta deliberata, non dimenticanza.
 */

import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonContent } from '@ionic/angular/standalone';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';

/** Struttura dati per ogni passo del processo "come funziona". */
interface PassoProcesso {
  /** Colore CSS dell'evidenziazione testuale (variabile CSS custom). */
  accent: string;
  /** Testo in evidenza (colorato) all'inizio del corpo del testo. */
  lead: string;
  /** Corpo principale del testo descrittivo. */
  body: string;
  /** Titolo del passo. */
  title: string;
  /** Percorso all'illustrazione SVG del passo. */
  illustration: string;
}

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, IonContent],
  template: `
    <ion-content [fullscreen]="true" class="landing-content">

      <!-- ── Navbar ── -->
      <header class="nav">
        <div class="nav-inner">
          <div class="nav-brand">
            <img src="assets/echo-wordmark-wide.svg" alt="echo — The Persistance of the Moment" class="brand-logo">
          </div>

          <nav class="nav-links">
            <button type="button" class="nav-link" (click)="scorriAlProcesso()">Come funziona</button>
          </nav>

          <button class="nav-cta" *ngIf="!auth.isLoggedIn; else navUtenteCorrected" (click)="vaiAllAutenticazione('login')">Accedi/Registrati</button>
          <ng-template #navUtenteCorrected>
            <button class="nav-cta" (click)="entraInApp()">Entra nel darkroom</button>
          </ng-template>
        </div>
      </header>

      <!-- ── Hero ── -->
      <section class="hero">
        <div class="hero-grid">
          <div class="hero-copy-col">
            <div class="hero-wordmark">
              <div class="hero-logo-frame">
                <img class="hero-logo" src="assets/echo-hero.svg" alt="ECHO">
              </div>
            </div>
            <p class="hero-tagline-eyebrow">The Persistance of the Moment</p>
            <div class="hero-rule"></div>
            <p class="hero-copy">
              Un rullino digitale condiviso per i tuoi eventi. Scattate insieme,
              aspettate 24 ore lo sviluppo, rivivete il momento come un'unica
              memoria collettiva.
            </p>
          </div>

          <div class="hero-photo-col">
            <div class="hero-photo" [style.background-image]="'url(assets/pexels-cottonbro-3171815.jpg)'">
              <div class="hero-photo-glow"></div>
              <!-- HUD stile fotocamera vintage (batteria, ISO, RAW, esposizione) -->
              <div class="hud-row hud-top">
                <span class="hud-chip hud-batt">
                  <svg viewBox="0 0 24 12" class="batt-icon" aria-hidden="true">
                    <rect x="1" y="1" width="19" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
                    <rect x="21" y="4" width="2" height="4" fill="currentColor"/>
                    <rect x="3.5" y="3.5" width="12" height="5" fill="currentColor"/>
                  </svg>
                </span>
                <span class="hud-chip">ISO 200</span>
                <span class="hud-chip hud-raw">RAW</span>
              </div>
              <div class="hud-row hud-bottom">
                <span class="hud-exposure">1/100&nbsp;&nbsp;f/2.8</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ── Processo "come funziona" ── -->
      <section class="process" id="echo-process">
        <p class="process-eyebrow">Il processo</p>
        <h2 class="process-heading">Come funziona?</h2>

        <div class="process-grid">
          <article class="process-card" *ngFor="let passo of passi; let i = index">
            <img [src]="passo.illustration" [alt]="passo.title" class="card-illustration-img">
            <h3 class="step-title">{{ passo.title }}</h3>
            <p class="step-body">
              <span class="step-lead" [style.color]="passo.accent">{{ passo.lead }}</span>
              {{ passo.body }}
            </p>
          </article>
        </div>

        <!-- Bordo pellicola scallop che separa la sezione scura da quella chiara.
             L'URL dell'immagine è legato via style binding nel template (non in CSS)
             perché il resolver esbuild tratta url() nei component styles come percorsi
             file a build-time e non riesce a trovarli; i binding di template sono stringhe
             runtime e non vengono toccati dal resolver. -->
        <div class="scallop-seam" aria-hidden="true">
          <div class="scallop-piece scallop-light" [style.background-image]="'url(assets/scallop-light-tile.svg)'"></div>
          <div class="scallop-piece scallop-dark" [style.background-image]="'url(assets/scallop-dark-tile.svg)'"></div>
        </div>
      </section>

      <!-- ── CTA Download ── -->
      <section class="download">
        <p class="download-eyebrow">Scarica l'app · È gratis</p>
        <h2 class="download-heading">Inizia a collezionare momenti</h2>
        <p class="download-tagline">The Persistance of the Moment</p>
        <div class="download-actions">
          <button type="button" class="cta-primary store-btn store-btn--ios" disabled>
            Scarica per iOS
            <span class="store-btn-sub">Presto disponibile</span>
          </button>
          <a class="cta-secondary store-btn" [href]="apkUrl">Scarica per Android</a>
        </div>
      </section>

      <!-- ── Footer ── -->
      <footer class="site-footer">
        <div class="footer-top">
          <div class="footer-brand">
            <img src="assets/echo-wordmark-stacked.svg" alt="echo — The Persistance of the Moment" class="footer-logo">
          </div>

          <div class="footer-col">
            <p class="footer-col-title">Esplora</p>
            <button type="button" class="footer-link" (click)="scorriAlProcesso()">Come funziona</button>
          </div>

          <div class="footer-col">
            <p class="footer-col-title">Account</p>
            <button type="button" class="footer-link" (click)="vaiAllAutenticazione('login')">Accedi</button>
            <button type="button" class="footer-link" (click)="vaiAllAutenticazione('register')">Registrati</button>
          </div>
        </div>

        <div class="footer-bottom">
          <span>&copy; 2026 ECHO &mdash; Tutti i momenti riservati.</span>
          <span>Digital Film Roll &middot; v1.0</span>
        </div>
      </footer>

    </ion-content>
  `,
  styles: [`
    ion-content.landing-content { --background: var(--echo-bg); --overflow: auto; overflow-x: hidden; }

    /* Limita l'espansione su schermi larghissimi (4K, dezoom browser).
       Applicato agli INNER container per non troncare i bg full-width delle sezioni. */
    .nav-inner, .hero-grid, .process-grid, .download-section > *, .footer-top, .footer-bottom {
      max-width: 1180px;
      margin-left: auto;
      margin-right: auto;
    }

    button { font: inherit; -webkit-tap-highlight-color: transparent; }
    button[inert] { cursor: default; }

    /* ── Navbar ── */
    .nav {
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--echo-bg);
      border-bottom: 1px solid rgba(42,26,14,0.12);
    }
    .nav-inner {
      padding: 14px clamp(20px, 4vw, 64px);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .nav-brand { display: flex; align-items: center; flex: 1; min-width: 0; }
    /* Logo wordmark — rapporto originale 440.88x109.5 */
    .brand-logo { height: 48px; width: auto; aspect-ratio: 440.88 / 109.5; object-fit: contain; }
    .nav-links { display: none; gap: 28px; }
    .nav-link {
      background: none; border: none; padding: 0; cursor: pointer;
      font-family: var(--echo-font-mono);
      font-size: 12px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--echo-ink);
    }
    .nav-cta {
      background: var(--echo-surface-dark);
      color: var(--echo-cream);
      border: none;
      border-radius: var(--echo-radius-pill);
      padding: 10px 18px;
      font-family: var(--echo-font-mono);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      cursor: pointer;
      white-space: nowrap;
    }

    /* ── Hero — sfondo marrone scuro, uguale alle sezioni process/footer ── */
    .hero { background: var(--echo-surface-dark); padding: 40px clamp(20px, 4vw, 64px) 64px; }
    .hero-grid { display: flex; flex-direction: column; gap: 36px; }

    .hero-wordmark { display: flex; align-items: center; }
    /* Il file echo-hero.svg ha ~14% di spazio vuoto integrato nel bordo sinistro prima del
       glifo "E" (il padding dell'icona camera sposta l'artwork fuori centro). Il frame
       ritaglia quello spazio morto allineando il "E" visibile con il "T" del tagline sottostante. */
    .hero-logo-frame { position: relative; width: 500px; max-width: 100%; aspect-ratio: 1.8579; overflow: hidden; }
    .hero-logo { position: absolute; top: 0; left: -9.93%; width: 110.38%; height: 100%; }

    .hero-tagline-eyebrow {
      font-family: var(--echo-font-mono);
      font-size: clamp(13px, 2.2vw, 20px);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--echo-cream);
      margin: 18px 0 0;
    }
    .hero-rule { width: 64px; height: 2px; background: var(--echo-cream); opacity: 0.3; margin: 18px 0 20px; }

    .hero-copy {
      font-family: var(--echo-font-mono);
      font-size: 14px;
      line-height: 1.8;
      color: rgba(245,239,230,0.75);
      max-width: 440px;
      margin: 0;
    }

    .hero-actions { display: flex; flex-direction: column; gap: 14px; max-width: 280px; }
    .cta-primary, .cta-secondary {
      padding: 15px;
      font-family: var(--echo-font-mono);
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      border-radius: var(--echo-radius-pill);
      cursor: pointer;
      transition: transform 150ms, box-shadow 150ms, opacity 150ms;
    }
    .cta-primary {
      background: var(--echo-surface-dark);
      color: var(--echo-cream);
      border: none;
      box-shadow: 0 4px 0 #1E1209;
      &:active { transform: translateY(2px); box-shadow: 0 2px 0 #1E1209; }
    }
    .cta-secondary {
      background: transparent;
      color: var(--echo-ink);
      border: 1.5px solid var(--echo-ink);
      &:active { background: rgba(42,26,14,0.06); }
    }

    /* Foto hero con HUD viewfinder vintage sovrapposto */
    .hero-photo-col { width: 100%; }
    .hero-photo {
      position: relative;
      width: 100%;
      aspect-ratio: 4 / 3;
      border-radius: var(--echo-radius-lg);
      overflow: hidden;
      background-size: cover;
      background-position: center;
      box-shadow: 0 8px 24px rgba(42,26,14,0.25);
    }
    .hero-photo-glow {
      position: absolute; inset: 0;
      background: linear-gradient(180deg, rgba(42,26,14,0.15) 0%, transparent 30%, transparent 65%, rgba(42,26,14,0.45) 100%);
    }
    .hud-row {
      position: absolute;
      left: 14px; right: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: var(--echo-font-mono);
      color: var(--echo-cream);
    }
    .hud-top { top: 14px; }
    .hud-bottom { bottom: 14px; justify-content: flex-end; }
    .hud-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      letter-spacing: 0.06em;
      padding: 3px 8px;
      border-radius: var(--echo-radius-sm);
      background: rgba(42,26,14,0.45);
      backdrop-filter: blur(2px);
    }
    .hud-raw { margin-left: auto; font-weight: 700; }
    .batt-icon { width: 18px; height: 9px; }
    .hud-exposure {
      font-size: 11px;
      letter-spacing: 0.06em;
      padding: 3px 8px;
      border-radius: var(--echo-radius-sm);
      background: rgba(42,26,14,0.45);
    }

    /* ── Sezione Processo (sfondo scuro) ── */
    .process {
      position: relative;
      background: var(--echo-surface-dark);
      padding: 56px clamp(20px, 4vw, 64px) 72px;
      text-align: center;
    }
    .process-eyebrow {
      font-family: var(--echo-font-mono);
      font-size: 11px;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      color: var(--echo-teal);
      margin: 0 0 10px;
    }
    .process-heading {
      font-family: var(--echo-font-serif);
      font-size: 28px;
      color: var(--echo-cream);
      margin: 0 0 48px;
    }
    .process-grid {
      display: flex;
      flex-direction: column;
      gap: 48px;
    }
    .process-card { display: flex; flex-direction: column; align-items: center; }

    .card-illustration {
      width: 100%;
      max-width: 220px;
      height: 230px;
      border-radius: 50% 50% 10px 10px / 38% 38% 10px 10px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 18px;
      padding-bottom: 8px;
    }
    .step-icon { width: 76px; height: 96px; }
    /* Le tre illustrazioni SVG condividono la stessa altezza intrinseca (317.25) e differiscono
       solo in larghezza: sizing per altezza (non per larghezza) le allinea visivamente. */
    .card-illustration-img { height: 260px; width: auto; max-width: 100%; }
    .step-dots { display: flex; gap: 8px; }
    .step-dot {
      width: 9px; height: 9px; border-radius: 50%;
      border: 1.5px solid var(--echo-cream);
      background: transparent;
      &.filled { background: var(--echo-cream); }
    }

    .step-title {
      font-family: var(--echo-font-serif);
      font-size: 17px;
      color: var(--echo-cream);
      margin: 22px 0 10px;
    }
    .step-body {
      font-family: var(--echo-font-mono);
      font-size: 13px;
      line-height: 1.7;
      color: var(--echo-cream);
      opacity: 0.75;
      max-width: 280px;
      margin: 0;
    }
    .step-lead { font-weight: 700; opacity: 1; }

    /* Bordo scallop al margine tra la sezione scura e quella chiara.
       Ogni pezzo è ritagliato esattamente a un dente + un gap (65px + 65px a questa background-size)
       per permettere la ripetizione seamless con repeat-x. */
    .scallop-seam { position: absolute; left: 0; right: 0; bottom: 0; height: 0; }
    .scallop-piece {
      position: absolute;
      left: 0; right: 0;
      height: 45px;
      background-repeat: repeat-x;
      background-position: left top;
      background-size: 130px 45px;
    }
    .scallop-dark { top: 0; }
    .scallop-light { bottom: 0; }

    /* ── CTA Download (sfondo crema) ── */
    .download {
      text-align: center;
      padding: 72px clamp(20px, 4vw, 64px) 64px;
    }
    .download-eyebrow {
      font-family: var(--echo-font-mono);
      font-size: 11px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--echo-rust);
      max-width: 640px;
      margin: 0 auto 14px;
    }
    .download-heading {
      font-family: var(--echo-font-serif);
      font-size: 26px;
      color: var(--echo-ink);
      max-width: 640px;
      margin: 0 auto 10px;
    }
    .download-tagline {
      font-family: var(--echo-font-mono);
      font-style: italic;
      font-size: 13px;
      color: var(--echo-rust);
      max-width: 640px;
      margin: 0 auto 36px;
    }
    .download-actions { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; }
    .store-btn { white-space: nowrap; }
    .store-btn[disabled] { opacity: 0.55; cursor: not-allowed; }
    a.store-btn { display: inline-block; text-decoration: none; line-height: 1; }
    .store-btn--ios {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      line-height: 1;
    }
    .store-btn-sub {
      font-size: 9px;
      letter-spacing: 0.1em;
      opacity: 0.7;
      font-weight: 400;
      text-transform: uppercase;
    }

    /* ── Footer (sfondo chiaro, speculare rispetto al dark) ── */
    .site-footer {
      background: var(--echo-bg);
      color: var(--echo-ink);
      padding: 56px clamp(20px, 4vw, 64px) 0;
      border-top: 1px solid rgba(42,26,14,0.15);
    }
    .footer-top {
      display: flex;
      flex-direction: column;
      gap: 40px;
      padding-bottom: 40px;
    }
    .footer-brand { display: flex; flex-direction: column; align-items: center; gap: 16px; }
    /* Logo stacked — rapporto originale 212.88x153 */
    .footer-logo { width: 180px; height: auto; aspect-ratio: 212.88 / 153; object-fit: contain; }
    .footer-copy {
      font-family: var(--echo-font-mono);
      font-size: 11px;
      color: var(--echo-ink-soft);
      margin: 0 0 16px;
    }
    .footer-col-title {
      font-family: var(--echo-font-mono);
      font-size: 11px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--echo-teal);
      margin: 0 0 16px;
    }
    .footer-col { display: flex; flex-direction: column; gap: 12px; }
    .footer-link {
      background: none; border: none; padding: 0; text-align: left; cursor: pointer;
      font-family: var(--echo-font-mono);
      font-size: 13px;
      color: var(--echo-ink);
    }

    .footer-bottom {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 20px 0 24px;
      border-top: 1px solid rgba(42,26,14,0.15);
      font-family: var(--echo-font-mono);
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--echo-ink-soft);
    }

    /* ── Tablet / Desktop ── */
    @media (min-width: 768px) {
      .nav-links { display: flex; }

      .hero-grid { flex-direction: row; align-items: center; gap: 56px; }
      .hero-copy-col { flex: 1; }
      .hero-photo-col { flex: 1; }

      .process-grid { flex-direction: row; align-items: flex-start; gap: 32px; }
      .process-card { flex: 1; }

      .download-heading { font-size: 32px; }
      .download-actions { flex-direction: row; }

      .footer-top { flex-direction: row; justify-content: space-between; }
      .footer-brand { flex: 1.4; }
      .footer-col { flex: 1; }
      .footer-bottom { flex-direction: row; justify-content: space-between; }
    }

    @media (min-width: 1024px) {
      .hero { padding-top: 56px; }
    }
  `],
})
export class PaginaBenvenuto {
  readonly apkUrl = `${environment.apiUrl}/downloads/echo.apk`;

  constructor(public auth: AuthService, private router: Router) {}

  /** I 3 passi del processo "come funziona", con illustrazioni e testi marketing. */
  readonly passi: PassoProcesso[] = [
    {
      accent: 'var(--echo-teal)',
      title: 'Il Momento è Tutto',
      lead: "Vivi l'evento senza distrazioni:",
      body: 'punta e scatta. Hai a disposizione un rullino limitato. Non ci sono filtri e non puoi cancellare le foto. Fai in modo che ogni scatto conti.',
      illustration: 'assets/process-arch-1.svg',
    },
    {
      accent: 'var(--echo-rust)',
      title: "La Magia dell'Attesa",
      lead: 'Dimentica la fretta.',
      body: "Al termine dell'evento, le foto entrano in fase di sviluppo per 24 ore. Rilassati: riceverai una notifica quando i ricordi saranno pronti per essere svelati.",
      illustration: 'assets/process-arch-2.svg',
    },
    {
      accent: 'var(--echo-teal)',
      title: 'Sblocca, Esplora e Premia',
      lead: 'Allo scadere del timer,',
      body: "l'album collettivo prende vita. Scopri l'evento attraverso gli occhi degli altri partecipanti e usa il tuo unico, preziosissimo voto per far vincere lo scatto migliore.",
      illustration: 'assets/process-arch-3-blank.svg',
    },
  ];

  /** Naviga alla pagina di autenticazione nella modalità specificata (login o registrazione). */
  vaiAllAutenticazione(modalita: 'login' | 'register') {
    this.router.navigate(['/auth'], { queryParams: { mode: modalita } });
  }

  /** Naviga a /auth con replaceUrl per azzerare lo stack Ionic (evita che il back button
   *  o la cache del router outlet ripristini la pagina precedente della sessione vecchia). */
  entraInApp() {
    this.router.navigateByUrl('/auth', { replaceUrl: true });
  }

  /** Scrolla con animazione fluida alla sezione "come funziona". */
  scorriAlProcesso() {
    document.getElementById('echo-process')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
