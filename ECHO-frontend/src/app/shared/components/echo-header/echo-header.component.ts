import {
  Component,
  Input
} from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-echo-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="echo-header">
      <div class="paint paint--rust"></div>
      <div class="paint paint--teal"></div>
      <div class="row">
        <div class="brand">
          <div class="wordmark">ECHO</div>
          <div class="tagline" *ngIf="showTagline">The Persistance of the Moment</div>
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

    .paint {
      position: absolute;
      pointer-events: none;
    }
    .paint--rust {
      top: -38px;
      left: -38px;
      width: 110px;
      height: 110px;
      border-radius: 50%;
      background: var(--echo-rust);
      opacity: 0.9;
    }
    .paint--teal {
      bottom: -22px;
      left: 4px;
      width: 130px;
      height: 38px;
      background: var(--echo-teal);
      border-radius: 50% 60% 40% 70% / 60% 40% 70% 40%;
      transform: rotate(-8deg);
      opacity: 0.9;
    }

    .row {
      position: relative;
      z-index: 1;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .wordmark {
      font-family: var(--echo-font-display);
      font-size: 34px;
      color: var(--echo-cream);
      line-height: 1;
    }
    .tagline {
      margin-top: 4px;
      font-family: var(--echo-font-mono);
      font-size: 9px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--echo-cream);
      opacity: 0.85;
    }

    .actions {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
  `],
})
export class ComponenteIntestazione {
  @Input() showTagline = true;
}
