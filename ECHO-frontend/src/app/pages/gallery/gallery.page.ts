import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ComponenteGalleria } from '../../components/gallery/gallery.component';

@Component({
  selector: 'app-gallery-page', standalone: true,
  imports: [CommonModule, ComponenteGalleria],
  // ComponenteGalleria possiede il proprio blocco titolo + pulsante indietro (barra inferiore)
  // secondo i mockup del redesign — nessun ion-header separato qui, raddoppierebbe.
  template: `<app-gallery [id_evento]="id_evento" [eventoNome]="eventoNome"></app-gallery>`,
})
export class PaginaGalleria implements OnInit {
  id_evento = '';
  eventoNome = '';
  constructor(private route: ActivatedRoute) {}
  ngOnInit() {
    this.id_evento  = this.route.snapshot.paramMap.get('id_evento') ?? '';
    this.eventoNome = ((history.state) as Record<string, unknown>)?.['eventoNome'] as string ?? '';
  }
}
