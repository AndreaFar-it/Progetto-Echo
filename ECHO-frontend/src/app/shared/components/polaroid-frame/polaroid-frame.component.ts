import {
  Component,
  Input
} from '@angular/core';


// Da un template per le foto che vediamo nella classifica in stile polaroid
@Component({
  selector: 'app-polaroid-frame',
  standalone: true,
  imports: [],
  template: `
    <div class="polaroid" [style.transform]="'rotate(' + rotationDeg + 'deg)'">
      <div class="photo"><ng-content></ng-content></div>
    </div>
  `,
  styles: [`
    .polaroid {
      display: inline-block;
      background: var(--echo-surface-paper);
      padding: 8px 8px 22px;
      box-shadow: 0 4px 10px rgba(var(--echo-scrim-rgb),0.35);
    }
    .photo {
      /* Sempre un'area di ritaglio rigorosamente quadrata, qualunque sia il vero rapporto
         d'aspetto dell'immagine proiettata.*/
      width: 100%;
      aspect-ratio: 1 / 1;
      overflow: hidden;
      background: var(--echo-film-edge);
    }
    ::ng-deep .photo img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;        /* riempi il quadrato, ritagliando l'eccesso — non distorcere mai */
      object-position: center;  /* ritaglia uniformemente dal centro */
    }
  `],
})
export class ComponenteCornicePolaroid {
  @Input() rotationDeg = -4;
}
