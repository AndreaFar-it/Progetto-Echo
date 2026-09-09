import { Injectable } from '@angular/core';
import { Platform } from '@ionic/angular/common';

@Injectable({ providedIn: 'root' })
export class ServizioPiattaforma {
  /** Vero su Android e iOS dentro l'app; falso nel browser. */
  readonly isNativa: boolean;

  constructor(platform: Platform) {
    this.isNativa = platform.is('capacitor');
  }
}
