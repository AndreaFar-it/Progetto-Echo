import { Injectable } from '@angular/core';
import { Platform } from '@ionic/angular/common';

@Injectable({ providedIn: 'root' })
export class ServizioPiattaforma {
  readonly isNativa: boolean;

  constructor(platform: Platform) {
    this.isNativa = platform.is('capacitor');
  }
}
