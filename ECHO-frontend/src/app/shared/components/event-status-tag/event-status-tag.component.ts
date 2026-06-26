/**
 * ECHO — Etichetta Stato Evento
 *
 * Piccolo badge a pillola maiuscolo che mostra a colpo d'occhio la fase del ciclo di vita di
 * un evento (IN ARRIVO / IN CORSO / SVILUPPO / VOTAZIONE / CHIUSO), con codice colore così lo
 * stato si legge istantaneamente in una lista senza dover interpretare la frase descrittiva
 * accanto.
 */

import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EventoStato } from '../../../models/index';

const LABELS: Record<EventoStato, string> = {
  non_iniziata: 'In arrivo',
  in_corso:     'In corso',
  sviluppo:     'Sviluppo',
  album_aperto: 'Votazione',
  chiusa:       'Chiuso',
};

@Component({
  selector: 'app-event-status-tag',
  standalone: true,
  imports: [CommonModule],
  template: `<span class="status-tag" [class]="'status-tag--' + stato">{{ LABELS[stato] }}</span>`,
  styles: [`
    .status-tag {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: var(--echo-radius-pill);
      font-family: var(--echo-font-mono);
      font-weight: 700;
      font-size: 9.5px;
      letter-spacing: .08em;
      text-transform: uppercase;
      line-height: 1.6;
      white-space: nowrap;
      flex-shrink: 0;
    }
    /* non_iniziata — neutral, nothing happening yet */
    .status-tag--non_iniziata { background: rgba(140,123,110,.18); color: var(--echo-ink-soft); border: 1px solid rgba(140,123,110,.4); }
    /* in_corso — live, l'accento teal già usato per "attivo" altrove nell'app */
    .status-tag--in_corso { background: var(--echo-teal); color: var(--echo-cream); }
    /* sviluppo — warm rust, photos "developing" */
    .status-tag--sviluppo { background: var(--echo-rust); color: var(--echo-cream); }
    /* album_aperto — pillola ink scura, in linea con i pulsanti CTA primari (attira l'occhio: serve un'azione) */
    .status-tag--album_aperto { background: var(--echo-surface-dark); color: var(--echo-cream); }
    /* chiusa — done, quiet gold-ish outline */
    .status-tag--chiusa { background: transparent; color: var(--echo-ink-soft); border: 1px solid var(--echo-medal-gold); }
  `],
})
export class ComponenteEtichettaStato {
  @Input({ required: true }) stato!: EventoStato;
  protected readonly LABELS = LABELS;
}
