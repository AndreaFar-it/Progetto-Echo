import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonContent } from '@ionic/angular/standalone';
import { markTutorialSeen } from '../../core/tutorial.storage';

interface OnboardingSlide {
  illustration: string;
  title: string;
  lead: string;
  body: string;
}

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule, IonContent],
  template: `
    <div class="onboarding-wrap">

      <!-- Slide area -->
      <div class="slide-area">
        <div class="slide" *ngFor="let s of slides; let i = index"
             [class.active]="i === current"
             [class.prev]="i < current">

          <!-- Dark card con illustrazione arch (identica alle card web) -->
          <div class="slide-card">
            <img [src]="s.illustration" [alt]="s.title" class="slide-arch">
          </div>

          <h2 class="slide-title">{{ s.title }}</h2>

          <!-- Lead (teal) + corpo testo (cream/ink-soft) — come sul web -->
          <p class="slide-body">
            <span class="slide-lead">{{ s.lead }}</span>
            {{ s.body }}
          </p>
        </div>
      </div>

      <!-- Progress dots -->
      <div class="progress-dots">
        <span class="dot"
              *ngFor="let s of slides; let i = index"
              [class.active]="i === current">
        </span>
      </div>

      <!-- Navigation -->
      <div class="slide-nav">
        <button class="echo-btn-ghost nav-btn" (click)="skip()" *ngIf="current < slides.length - 1">
          Salta
        </button>
        <button class="echo-btn nav-btn-primary" (click)="next()">
          {{ current < slides.length - 1 ? 'Avanti' : 'Inizia' }}
        </button>
      </div>

    </div>
  `,
  styles: [`
    .onboarding-wrap {
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: var(--echo-bg);
      padding: 0 24px 48px;
      overflow: hidden;
    }

    /* Slide area */
    .slide-area {
      flex: 1;
      position: relative;
      display: flex;
      align-items: center;
    }

    .slide {
      position: absolute;
      width: 100%;
      opacity: 0;
      transform: translateX(40px);
      transition: opacity 300ms ease-in-out, transform 300ms ease-in-out;
      pointer-events: none;
      text-align: center;
      padding-top: 24px;

      &.active {
        opacity: 1;
        transform: translateX(0);
        pointer-events: auto;
      }
      &.prev {
        opacity: 0;
        transform: translateX(-40px);
      }
    }

    .slide-card {
      background: transparent;
      border-radius: var(--echo-radius-lg);
      padding: 12px;
      margin: 0 auto 28px;
      max-width: 220px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .slide-arch {
      width: 100%;
      max-height: 260px;
      object-fit: contain;
    }

    .slide-title {
      font-family: var(--echo-font-serif);
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 0.03em;
      color: var(--echo-ink);
      margin: 0 0 12px;
    }

    .slide-body {
      font-size: 14px;
      line-height: 1.7;
      color: var(--echo-ink-soft);
      margin: 0;
      max-width: 300px;
      margin-inline: auto;
      font-family: var(--echo-font-mono);
    }

    .slide-lead {
      color: var(--echo-teal);
      font-weight: 700;
    }

    /* Progress dots */
    .progress-dots {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-bottom: 28px;
    }

    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: rgba(42,26,14,0.15);
      border: 0.5px solid rgba(42,26,14,0.25);
      transition: background 150ms ease-in-out, width 150ms ease-in-out;

      &.active {
        background: var(--echo-rust);
        width: 20px;
        border-radius: 3px;
        border-color: transparent;
      }
    }

    /* Nav buttons */
    .slide-nav {
      display: flex;
      gap: 12px;
      align-items: center;
    }

    .nav-btn { flex: 1; }
    .nav-btn-primary { flex: 2; }
  `],
})
export class ComponenteOnboarding {
  current = 0;

  constructor(private router: Router) {}

  slides: OnboardingSlide[] = [
    {
      illustration: 'assets/process-arch-1.svg',
      title: 'Il Momento è Tutto',
      lead: 'Vivi l\'evento senza distrazioni:',
      body: 'punta e scatta. Hai a disposizione un rullino limitato. Non ci sono filtri e non puoi cancellare le foto. Fai in modo che ogni scatto conti.',
    },
    {
      illustration: 'assets/process-arch-2.svg',
      title: 'La Magia dell\'Attesa',
      lead: 'Dimentica la fretta.',
      body: 'Al termine dell\'evento, le foto entrano in fase di sviluppo per 24 ore. Rilassati: riceverai una notifica quando i ricordi saranno pronti per essere svelati.',
    },
    {
      illustration: 'assets/process-arch-3-blank.svg',
      title: 'Sblocca, Esplora e Premia',
      lead: 'Allo scadere del timer,',
      body: 'l\'album collettivo prende vita. Scopri l\'evento attraverso gli occhi degli altri partecipanti e usa il tuo unico, preziosissimo voto per far vincere lo scatto migliore.',
    },
  ];

  next() {
    if (this.current < this.slides.length - 1) {
      this.current++;
    } else {
      this.finish();
    }
  }

  skip() { this.finish(); }

  private async finish() {
    await markTutorialSeen();
    this.router.navigate(['/benvenuto']);
  }
}
