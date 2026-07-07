import {
  Component,
  Input
} from '@angular/core';
import { CommonModule } from '@angular/common';

// Da un template per le foto che vediamo nella classifica in stile polaroid
@Component({
  selector: 'app-polaroid-frame',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="polaroid" [style.transform]="'rotate(' + rotationDeg + 'deg)'">
      <div class="photo"><ng-content></ng-content></div>
    </div>
  `,
  styles: [`
    .polaroid {
      display: inline-block;
      background: #FBF8F2;
      padding: 8px 8px 22px;
      box-shadow: 0 4px 10px rgba(0,0,0,0.35);
    }
    .photo {
      /* Sempre un'area di ritaglio rigorosamente quadrata, qualunque sia il vero rapporto
         d'aspetto dell'immagine proiettata.*/
      width: 100%;
      aspect-ratio: 1 / 1;
      overflow: hidden;
      background: #ddd3c0;
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
