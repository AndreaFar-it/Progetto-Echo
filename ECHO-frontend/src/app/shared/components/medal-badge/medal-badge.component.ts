import {
  Component,
  Input
} from '@angular/core';
import { CommonModule } from '@angular/common';

export type MedalTipo = 'oro' | 'argento' | 'bronzo';

//Costruiamo una medaglia in maniera generale, e ne definiamo i colori per ogni sua forma
@Component({
  selector: 'app-medal-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="medal" [class]="'medal--' + tipo" [style.transform]="rotationDeg ? 'rotate(' + rotationDeg + 'deg)' : null">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
    </div>
  `,
  styles: [`
    .medal {
      width: var(--medal-size, 44px);
      height: var(--medal-size, 44px);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 4px rgba(42,26,14,0.35), inset 0 1px 0 rgba(255,255,255,0.35);
      flex-shrink: 0;
    }
    .medal svg { width: 55%; height: 55%; }

    .medal--oro {
      background: radial-gradient(circle at 35% 30%, #f0d27a, #D4AF37 65%);
      color: #6b4f0f;
      border: 1px solid #b8932c;
    }
    .medal--argento {
      background: radial-gradient(circle at 35% 30%, #e6e6e8, #A8A9AD 65%);
      color: #5a5a5d;
      border: 1px solid #8d8e92;
    }
    .medal--bronzo {
      background: radial-gradient(circle at 35% 30%, #e3a571, #CD7F32 65%);
      color: #6b3e14;
      border: 1px solid #a8651f;
    }
  `],
})
export class ComponenteMedaglia {
  @Input() tipo: MedalTipo = 'bronzo';
  @Input() rotationDeg?: number;
}
