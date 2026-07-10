import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-echo-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="echo-header">
      <div class="row">
        <div class="brand">
          <img class="hero-logo" src="assets/echo-hero.svg" alt="ECHO — The Persistance of the Moment">
        </div>
        <div class="actions"><ng-content></ng-content></div>
      </div>
    </header>
  `,
  styles: [`
    .echo-header {
      position: relative;
      overflow: hidden;
      background: var(--echo-surface-dark);
      padding: 18px 20px 22px;
    }

    .row {
      position: relative;
      z-index: 1;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .hero-logo {
      height: 44px;
      object-fit: contain;
    }

    .actions {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
  `],
})
export class ComponenteIntestazione {}
