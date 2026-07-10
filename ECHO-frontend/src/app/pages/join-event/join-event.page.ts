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
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  ToastController
} from '@ionic/angular/standalone';
import { ApiService } from '../../services/api.service';
import { ComponenteIntestazione } from '../../shared/components';
import { CreateEventComponent } from '../events/create-event.component';
import { firstValueFrom } from 'rxjs';

const CODE_LENGTH = 5;

@Component({
  selector: 'app-event-entry',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    IonContent, 
    IonSegment, 
    IonSegmentButton, 
    IonLabel,
    ComponenteIntestazione, 
    CreateEventComponent,
  ],
  template: `
    <app-echo-header></app-echo-header>
    <ion-content>
      <div class="page-shell">

        <ion-segment class="entry-segment" [(ngModel)]="segment" mode="md">
          <ion-segment-button value="partecipa">
            <ion-label>Partecipa</ion-label>
          </ion-segment-button>
          <ion-segment-button value="crea">
            <ion-label>Crea Evento</ion-label>
          </ion-segment-button>
        </ion-segment>

        <!-- ── Partecipa ── -->
        <div class="join-view" *ngIf="segment === 'partecipa'">
          <p class="label">Inserisci il codice</p>
          <p class="subtitle">Ti viene fornito dall'organizzatore dell'evento</p>

          <div class="boxes" (click)="focusInput()">
            <div class="box" *ngFor="let i of [0,1,2,3,4]" [class.filled]="code.length > i" [class.active]="code.length === i">
              <span *ngIf="code.length > i">{{ code[i] }}</span>
              <span class="underline" *ngIf="code.length <= i"></span>
            </div>
          </div>

          <input
            #hiddenInput
            class="hidden-input"
            [(ngModel)]="code"
            type="text"
            inputmode="numeric"
            maxlength="5"
            autocomplete="off"
            (ngModelChange)="onCodeChange($event)"
            (keyup.enter)="join()"
          />

          <button class="join-btn echo-btn" [disabled]="code.length !== 5 || joining" (click)="join()">
            <span *ngIf="!joining">Partecipa</span>
            <span class="spinner" *ngIf="joining"></span>
          </button>
        </div>

        <!-- ── Crea Evento ── -->
        <div class="create-view" *ngIf="segment === 'crea'">
          <app-create-event></app-create-event>
        </div>

      </div>
    </ion-content>
  `,
  styles: [`
    ion-content { --background: var(--echo-bg); }
    .page-shell { padding: 24px 16px 60px; max-width: 460px; margin: 0 auto; }
    /* Desktop: allarga a una colonna centrata e immersiva, in linea con landing/dashboard. */
    @media (min-width:768px){ .page-shell { max-width: 1180px; } }

    /* ── Segment (Canva palette on active state) ── */
    .entry-segment {
      margin: 8px 0 28px;
      --background: transparent;
      border: 1.5px solid var(--echo-ink);
      border-radius: var(--echo-radius-pill);
      padding: 3px;
    }
    .entry-segment ion-segment-button {
      --background: transparent;
      --background-checked: var(--ion-color-primary);
      --color: var(--echo-ink);
      --color-checked: var(--ion-color-primary-contrast);
      --indicator-color: transparent;
      --border-radius: var(--echo-radius-pill);
      --indicator-box-shadow: none;
      min-height: 38px;
      font-family: var(--echo-font-mono);
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    /* La seconda tab (Crea) usa l'accento secondario/teal quando attiva */
    .entry-segment ion-segment-button:last-of-type {
      --background-checked: var(--ion-color-secondary);
      --color-checked: var(--ion-color-secondary-contrast);
    }

    /* ── Partecipa view ── */
    .join-view { display: flex; flex-direction: column; align-items: center; text-align: center; padding-top: 8px; }
    .label {
      font-family: var(--echo-font-mono); font-weight: 700;
      font-size: 14px; letter-spacing: 0.1em; text-transform: uppercase;
      color: var(--echo-ink); margin: 0 0 8px;
    }
    .subtitle {
      font-family: var(--echo-font-mono); font-size: 12px;
      color: var(--echo-ink-soft); margin: 0 0 32px; line-height: 1.5;
    }
    .boxes { display: flex; gap: 10px; margin-bottom: 36px; cursor: text; }
    .box {
      width: 56px; height: 64px; border-radius: var(--echo-radius-md);
      background: var(--echo-surface-dark);
      display: flex; align-items: center; justify-content: center;
      font-family: var(--echo-font-mono); font-size: 24px; font-weight: 700;
      color: var(--echo-cream);
    }
    .box.active { box-shadow: 0 0 0 2px var(--echo-rust); }
    .underline { width: 16px; height: 2px; background: rgba(245,239,230,0.5); }
    .hidden-input { position: absolute; opacity: 0; pointer-events: none; width: 1px; height: 1px; }
    .join-btn { width: 100%; max-width: 280px; }

    .spinner {
      width: 16px; height: 16px;
      border: 1.5px solid rgba(245,239,230,0.3); border-top-color: var(--echo-cream);
      border-radius: 50%; animation: spin 0.7s linear infinite; display: inline-block;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `],
})
export class PaginaPartecipaEvento implements AfterViewInit {
  // Tramite @ViewChild, ottiene un riferimento all'elemento HTML (es. un tag input) contrassegnato con #hiddenInput nel template
  @ViewChild('hiddenInput') hiddenInput!: ElementRef<HTMLInputElement>;

  segment: 'partecipa' | 'crea' = 'partecipa';
  code = '';
  joining = false;

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

  focusInput() {
    this.hiddenInput?.nativeElement.focus();
  }

  // Metodo che viene innescato ogni volta che l'utente digita qualcosa nell'input
  onCodeChange(value: string) {
    this.code = value.replace(/\D/g, '').slice(0, CODE_LENGTH);
  }

  async join() {
    if (this.code.length !== CODE_LENGTH || this.joining) return;
    this.joining = true;
    try {
      const res = await firstValueFrom(this.api.partecipaEvento(this.code));
      this.toast(res.message, 'success');
      this.router.navigate(['/eventi/miei']);
    } catch (errore: unknown) {
      const msg = (errore as { error?: { error?: string } })?.error?.error ?? 'Codice non valido';
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
