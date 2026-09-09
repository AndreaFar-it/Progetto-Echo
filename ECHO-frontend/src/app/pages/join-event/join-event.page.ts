import {
  AfterViewInit,
  Component,
  ElementRef,
  ViewChild
} from '@angular/core';
import {
  ActivatedRoute,
  Router
} from '@angular/router';

import { FormsModule } from '@angular/forms';
import {
  IonContent,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  ToastController
} from '@ionic/angular/standalone';
import { ApiService } from '../../services/api.service';
import { ComponenteIntestazione } from '../../components';
import { CreateEventComponent } from './create-event.component';
import { firstValueFrom } from 'rxjs';
import { messaggioErrore } from '../../core/api-error';

@Component({
  selector: 'app-event-entry',
  standalone: true,
  imports: [
    FormsModule,
    IonContent,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    ComponenteIntestazione,
    CreateEventComponent
],
  templateUrl: './join-event.page.html',
  styleUrl: './join-event.page.scss',
})
export class PaginaPartecipaEvento implements AfterViewInit {
  // Tramite @ViewChild, ottiene un riferimento all'elemento HTML (es. un tag input) contrassegnato con #hiddenInput nel template
  @ViewChild('hiddenInput') hiddenInput!: ElementRef<HTMLInputElement>;

  segment: 'partecipa' | 'crea' = 'partecipa';
  code = '';
  joining = false;

  // Pubblica: il template la usa per le caselle e per abilitare il pulsante.
  readonly CODE_LENGTH = 5;
  // Precalcolate: un letterale nel template verrebbe riallocato a ogni ciclo.
  readonly posizioni = Array.from({ length: this.CODE_LENGTH }, (_, i) => i);

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private api: ApiService,
    private toastCtrl: ToastController,
  ) {
    const tab = this.route.snapshot.data['tab'];
    if (tab === 'crea') this.segment = 'crea';
  }

  ngAfterViewInit() {
    // Se ci troviamo nel tab 'partecipa', imposta un ritardo di 200 millisecondi 
    // prima di dare il focus all'input nascosto per far aprire la tastiera
    if (this.segment === 'partecipa') setTimeout(() => this.hiddenInput?.nativeElement.focus(), 200);
  }

  // Tiene solo le cifre. Riallinea anche il DOM, non solo il modello: se il valore
  // ripulito non cambia, Angular non riscrive l'input e il carattere scartato resta.
  onCodeChange(event: Event): void {
    const elemento = event.target as HTMLInputElement;
    const pulito = elemento.value.replace(/\D/g, '').slice(0, this.CODE_LENGTH);
    elemento.value = pulito;
    this.code = pulito;
  }

  async join() {
    if (this.code.length !== this.CODE_LENGTH || this.joining) return;
    this.joining = true;
    try {
      const res = await firstValueFrom(this.api.partecipaEvento(this.code));
      this.toast(res.message, 'success');
      this.router.navigate(['/eventi/miei']);
    } catch (errore: unknown) {
      const msg = messaggioErrore(errore, 'Codice non valido');
      this.toast(msg, 'danger');
    } finally {
      this.joining = false;
    }
  }

  private async toast(msg: string, color: string = 'dark') {
    const t = await this.toastCtrl.create({ message: msg, duration: 2800, color, position: 'bottom' });
    t.present();
  }
}
