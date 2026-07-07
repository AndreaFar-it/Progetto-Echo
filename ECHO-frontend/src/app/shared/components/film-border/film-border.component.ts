import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

// Crea il bordo su cui applicare le foto nella galleria
@Component({
  selector: 'app-film-border',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="film-border" [class.film-border--rounded]="rounded">
      <div class="rail rail--left"></div>
      <div class="content"><ng-content></ng-content></div>
      <div class="rail rail--right"></div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
    .film-border {
      position: relative;
      display: flex;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    .film-border--rounded { border-radius: var(--echo-radius-md, 4px); }

    .rail {
      flex: 0 0 9px;
      background: var(--echo-ink, #2A1A0E);
      -webkit-mask-image: radial-gradient(circle at center, transparent 34%, black 35%);
      mask-image: radial-gradient(circle at center, transparent 34%, black 35%);
      -webkit-mask-size: 100% 14px;
      mask-size: 100% 14px;
      -webkit-mask-repeat: repeat-y;
      mask-repeat: repeat-y;
      z-index: 1;
    }

    .content {
      flex: 1;
      min-width: 0;
      position: relative;
      overflow: hidden;
    }
    ::ng-deep .content img,
    ::ng-deep .content > * {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `],
})
export class FilmBorderComponent {
  @Input() rounded = true;
}
