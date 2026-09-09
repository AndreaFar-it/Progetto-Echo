import {
  Component,
  Input
} from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';


export type MedalTipo = 'oro' | 'argento' | 'bronzo';

//Costruiamo una medaglia in maniera generale, e ne definiamo i colori per ogni sua forma
@Component({
  selector: 'app-medal-badge',
  standalone: true,
  imports: [IonIcon],
  template: `
    <div class="medal" [class]="'medal--' + tipo" [style.transform]="rotationDeg ? 'rotate(' + rotationDeg + 'deg)' : null">
      <ion-icon name="camera-outline"></ion-icon>
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
      box-shadow: 0 2px 4px rgba(var(--echo-espresso-rgb),0.35), inset 0 1px 0 rgba(var(--echo-white-rgb),0.35);
      flex-shrink: 0;
    }
    .medal svg { width: 55%; height: 55%; }

    .medal--oro {
      background: radial-gradient(circle at 35% 30%, var(--echo-gold-light), var(--echo-gold) 65%);
      color: var(--echo-gold-ink);
      border: 1px solid var(--echo-gold-edge);
    }
    .medal--argento {
      background: radial-gradient(circle at 35% 30%, var(--echo-silver-light), var(--echo-silver) 65%);
      color: var(--echo-silver-ink);
      border: 1px solid var(--echo-silver-edge);
    }
    .medal--bronzo {
      background: radial-gradient(circle at 35% 30%, var(--echo-bronze-light), var(--echo-bronze) 65%);
      color: var(--echo-bronze-ink);
      border: 1px solid var(--echo-bronze-edge);
    }
  `],
})
export class ComponenteMedaglia {
  @Input() tipo: MedalTipo = 'bronzo';
  @Input() rotationDeg?: number;
}
