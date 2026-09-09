import {
  Component,
  EventEmitter,
  OnInit,
  Output
} from '@angular/core';


@Component({
  selector: 'app-splash-overlay',
  standalone: true,
  imports: [],
  templateUrl: './splash-overlay.component.html',
  styleUrl: './splash-overlay.component.scss',
})
export class ComponenteSplash implements OnInit {
  // Questo è un canale di comunicazione verso il genitore.
  @Output() done = new EventEmitter<void>();

  shown = false;

  ngOnInit(): void {
    // Aspetta il millisecondo esatto in cui il browser sta per ridisegnare la pagina,
    // e solo allora imposta shown = true
    requestAnimationFrame(() => { this.shown = true; });
    // 1500 millisecondi di visibilità (durata splash screen)
    setTimeout(() => { this.shown = false; }, 1500);
    // 480 ms dissolvenza
    setTimeout(() => { this.done.emit(); }, 1500 + 480);
  }
}
