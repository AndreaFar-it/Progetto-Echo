import {
  Component,
  OnInit
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ComponenteGalleria } from '../../components/gallery/gallery.component';

@Component({
  selector: 'app-gallery-page', standalone: true,
  imports: [ComponenteGalleria],
  template: `<app-gallery [id_evento]="id_evento" [eventoNome]="eventoNome"></app-gallery>`,
})

// Esporta la classe PaginaGalleria che implementa l'interfaccia del ciclo di vita OnInit di Angular
export class PaginaGalleria implements OnInit {
  id_evento = '';
  eventoNome = '';

  constructor(private route: ActivatedRoute) { }
  ngOnInit() {
    this.id_evento = this.route.snapshot.paramMap.get('id_evento') ?? '';
    this.eventoNome = ((history.state) as Record<string, unknown>)?.['eventoNome'] as string ?? '';
  }
}
