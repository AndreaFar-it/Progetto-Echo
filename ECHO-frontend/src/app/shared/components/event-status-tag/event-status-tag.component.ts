import {
  Component,
  Input
} from '@angular/core';

import { EventoStato } from '../../../models/index';


const LABELS: Record<EventoStato, string> = {
  non_iniziata: 'In arrivo',
  in_corso:     'In corso',
  sviluppo:     'Sviluppo',
  album_aperto: 'Votazione',
  chiusa:       'Chiuso',
};

//Costruiamo il "blocchetto" degli eventi che cambia a seconda dello stato dell'evento
@Component({
  selector: 'app-event-status-tag',
  standalone: true,
  imports: [],
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
    .status-tag--non_iniziata { background: rgba(var(--echo-surface-mid-rgb),.18); color: var(--echo-on-light-soft); border: 1px solid rgba(var(--echo-surface-mid-rgb),.4); }
    .status-tag--in_corso { background: var(--echo-teal); color: var(--echo-on-dark); }
    .status-tag--sviluppo { background: var(--echo-rust); color: var(--echo-on-dark); }
    .status-tag--album_aperto { background: var(--echo-surface-dark); color: var(--echo-on-dark); }
    .status-tag--chiusa { background: transparent; color: var(--echo-on-light-soft); border: 1px solid var(--echo-medal-gold); }
  `],
})
export class ComponenteEtichettaStato {
  @Input({ required: true }) stato!: EventoStato;
  protected readonly LABELS = LABELS;
}
