import {
  Component,
  Input
} from '@angular/core';


export type MedalTipo = 'oro' | 'argento' | 'bronzo';

//Costruiamo una medaglia in maniera generale, e ne definiamo i colori per ogni sua forma
@Component({
  selector: 'app-medal-badge',
  standalone: true,
  imports: [],
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
      box-shadow: 0 2px 4px rgba(var(--echo-on-light-rgb),0.35), inset 0 1px 0 rgba(var(--echo-hud-rgb),0.35);
      flex-shrink: 0;
    }
    .medal svg { width: 55%; height: 55%; }

    .medal--oro {
      background: radial-gradient(circle at 35% 30%, var(--echo-medal-gold-light), var(--echo-medal-gold) 65%);
      color: var(--echo-medal-gold-ink);
      border: 1px solid var(--echo-medal-gold-edge);
    }
    .medal--argento {
      background: radial-gradient(circle at 35% 30%, var(--echo-medal-silver-light), var(--echo-medal-silver) 65%);
      color: var(--echo-medal-silver-ink);
      border: 1px solid var(--echo-medal-silver-edge);
    }
    .medal--bronzo {
      background: radial-gradient(circle at 35% 30%, var(--echo-medal-bronze-light), var(--echo-medal-bronze) 65%);
      color: var(--echo-medal-bronze-ink);
      border: 1px solid var(--echo-medal-bronze-edge);
    }
  `],
})
export class ComponenteMedaglia {
  @Input() tipo: MedalTipo = 'bronzo';
  @Input() rotationDeg?: number;
}
