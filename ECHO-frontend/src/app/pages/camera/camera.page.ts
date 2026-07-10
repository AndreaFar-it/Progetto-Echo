import {
  Component,
  OnInit,
  ViewChild
} from '@angular/core';
import {
  ActivatedRoute,
  Router
} from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import {
  ViewWillEnter,
  ViewWillLeave
} from '@ionic/angular';
import { ComponenteFotocamera } from '../../components/camera/camera.component';
import { ServizioFotocamera } from '../../services/camera.service';

@Component({
  selector: 'app-camera-page', standalone: true,
  imports: [IonContent, ComponenteFotocamera],
  template: `<ion-content [fullscreen]="true"><app-camera [id_evento]="id_evento" [eventoNome]="eventoNome" [scatti_usati_iniziali]="scattiUsati" [scatti_per_utente]="scattiTotali"></app-camera></ion-content>`,
})
// Esporta la classe PaginaFotocamera che implementa le interfacce per i cicli di vita di Angular e Ionic
export class PaginaFotocamera implements OnInit, ViewWillEnter, ViewWillLeave {

  id_evento = '';
  eventoNome = '';
  scattiUsati = 0; 
  scattiTotali = 3;

  // Ottiene un riferimento al componente figlio ComponenteFotocamera tramite il decoratore ViewChild
  @ViewChild(ComponenteFotocamera) private cameraCmp?: ComponenteFotocamera;

  // Costruttore: inietta i servizi necessari per leggere la rotta attuale, gestire la navigazione e usare la fotocamera
  constructor(
    private route: ActivatedRoute, 
    private router: Router, 
    private camera: ServizioFotocamera
  ) { }

  ngOnInit() {
    this.id_evento = this.route.snapshot.paramMap.get('id_evento') ?? '';

    const nav = this.router.getCurrentNavigation();
    const state = (nav?.extras?.state ?? history.state) as Record<string, unknown>;
    this.scattiUsati = (state['scatti_usati'] as number) ?? 0;
    this.scattiTotali = (state['scatti_per_utente'] as number) ?? 3;
    this.eventoNome = (state['eventoNome'] as string) ?? '';
    this.camera.initState(this.scattiUsati, this.scattiTotali);
  }

  ionViewWillEnter(): void {
    this.cameraCmp?.activate();
  }

  ionViewWillLeave(): void {
    this.cameraCmp?.deactivate();
  }
}