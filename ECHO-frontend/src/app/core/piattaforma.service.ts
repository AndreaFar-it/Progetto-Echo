import { Injectable } from '@angular/core';
import { Platform } from '@ionic/angular/common';

/**
 * Risponde a una sola domanda: l'app sta girando nel contenitore nativo?
 *
 * Prima la stessa domanda veniva posta in due modi diversi — `platform.is('hybrid')`
 * in sette punti e `platform.is('capacitor')` in due — usati come sinonimi. Non lo
 * sono: `hybrid` vale per Capacitor OPPURE Cordova. In questo progetto coincidono
 * sempre, perche' Cordova non c'e', ma due nomi per la stessa condizione sono un
 * invito a divergere.
 *
 * Si usa `capacitor`, il predicato piu' preciso: e' l'unico contenitore nativo
 * che ECHO usa davvero.
 */
@Injectable({ providedIn: 'root' })
export class ServizioPiattaforma {
  /** Vero su Android e iOS dentro l'app; falso nel browser. */
  readonly isNativa: boolean;

  constructor(platform: Platform) {
    this.isNativa = platform.is('capacitor');
  }
}
