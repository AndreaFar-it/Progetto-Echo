import {
  Component,
  OnInit
} from '@angular/core';
import { Router } from '@angular/router';
import { UpperCasePipe, DatePipe } from '@angular/common';
import {
  IonContent,
  ToastController
} from '@ionic/angular/standalone';
import { ViewWillEnter } from '@ionic/angular';
import { ApiService } from '../../services/api.service';
import { Badge, ProfiloResponse } from '../../models/index';
import { environment } from '../../../environments/environment';
import { firstValueFrom } from 'rxjs';
import {
  ComponenteIntestazione,
  ComponenteCornicePolaroid,
  ComponenteMedaglia,
  ComponenteRullino
} from '../../shared/components';
import { messaggioErrore } from '../../core/api-error';

interface MedagliaDisposta {
  badge: Badge;
  sinistra: number;
  alto: number;
  rotazione: number;
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [UpperCasePipe, DatePipe, IonContent, ComponenteIntestazione, ComponenteCornicePolaroid, ComponenteMedaglia, ComponenteRullino],
  templateUrl: './profile.page.html',
  styleUrl: './profile.page.scss',
})
export class PaginaProfilo implements OnInit, ViewWillEnter {

  profilo: ProfiloResponse | null = null;

  constructor(
    private api: ApiService,
    public router: Router,
    private toastCtrl: ToastController,
  ) { }

  ngOnInit() { this.caricaProfilo(); }
  ionViewWillEnter() { this.profilo = null; this.caricaProfilo(); }

  // Recupera il profilo dal backend e aggiorna la vista.
  private async caricaProfilo() {
    try {
      this.profilo = await firstValueFrom(this.api.getProfilo());
      this.disponiMedaglie(this.profilo?.badge ?? []);
    } catch (errore: unknown) {
      const messaggio = messaggioErrore(errore, 'Errore caricamento profilo');
      const toast = await this.toastCtrl.create({ message: messaggio, duration: 2000, color: 'danger' });
      toast.present();
    }
  }

  // Naviga alla galleria dell'evento archiviato (solo se in stato album_aperto o chiusa).
  apriArchiviato(evento: { id_evento: string; nome: string; stato: string }) {
    if (['album_aperto', 'chiusa'].includes(evento.stato)) {
      this.router.navigate(['/galleria', evento.id_evento], { state: { eventoNome: evento.nome } });
    }
  }

  urlFoto(percorso: string): string {
    return `${environment.apiUrl}${percorso}`;
  }

  // Badge gia' abbinati alla posizione: il template legge proprieta', non metodi.
  medaglieDisposte: MedagliaDisposta[] = [];

  private disponiMedaglie(badge: readonly Badge[]): void {
    const casuale = (min: number, max: number) => Math.round(min + Math.random() * (max - min));
    this.medaglieDisposte = badge.map(b => ({
      badge: b,
      sinistra: casuale(4, 76),
      alto: casuale(8, 104),
      rotazione: casuale(-18, 14),
    }));
  }

}