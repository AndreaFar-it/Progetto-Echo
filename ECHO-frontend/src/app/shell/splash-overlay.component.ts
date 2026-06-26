import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-splash-overlay',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="splash-root" [class.shown]="shown">
      <div class="hero-wrap">
        <img class="hero-img" src="assets/echo-hero.svg" alt="ECHO">
      </div>

      <div class="tagline">The Persistance of the Moment</div>

      <div class="loading">
        <svg class="reel" viewBox="0 0 24 32">
          <rect x="2" y="2" width="20" height="28" rx="2" fill="none" stroke="#F5EFE6" stroke-width="1.5"/>
          <circle cx="7" cy="9" r="2" fill="none" stroke="#F5EFE6" stroke-width="1.2"/>
          <circle cx="17" cy="9" r="2" fill="none" stroke="#F5EFE6" stroke-width="1.2"/>
          <circle cx="7" cy="23" r="2" fill="none" stroke="#F5EFE6" stroke-width="1.2"/>
          <circle cx="17" cy="23" r="2" fill="none" stroke="#F5EFE6" stroke-width="1.2"/>
          <circle cx="12" cy="16" r="2" fill="none" stroke="#F5EFE6" stroke-width="1.2"/>
        </svg>
        <span>Caricamento pellicola</span>
      </div>
    </div>
  `,
  styles: [`
    .splash-root {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 18px;
      background: #2A1A0E;
      opacity: 0;
      transition: opacity 450ms ease;
      pointer-events: none;
    }
    .splash-root.shown { opacity: 1; }

    .hero-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .hero-img {
      width: 220px;
      object-fit: contain;
    }

    .tagline {
      font-family: var(--echo-font-mono);
      font-size: 11px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: #F5EFE6;
    }

    .loading {
      margin-top: 28px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .reel {
      width: 26px;
      height: 34px;
      animation: reel-spin 2.4s linear infinite;
      transform-origin: 12px 16px;
    }
    .loading span {
      font-family: var(--echo-font-mono);
      font-size: 12px;
      color: rgba(245,239,230,0.65);
    }

    @keyframes reel-spin {
      to { transform: rotate(360deg); }
    }
  `],
})
export class ComponenteSplash implements OnInit {
  /** Emesso una volta che l'intera sequenza (dissolvenza in → pausa → dissolvenza out) è finita,
   *  così il genitore può rimuovere questo componente dal DOM (es. via *ngIf). */
  @Output() done = new EventEmitter<void>();

  shown = false;

  ngOnInit(): void {
    requestAnimationFrame(() => { this.shown = true; });
    setTimeout(() => { this.shown = false; }, 1500);
    setTimeout(() => { this.done.emit(); }, 1500 + 480);
  }
}
