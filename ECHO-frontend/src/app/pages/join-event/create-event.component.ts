import { Component } from '@angular/core';
import { Router } from '@angular/router';

import { FormsModule } from '@angular/forms';
import { ToastController } from '@ionic/angular/standalone';
import { Clipboard } from '@capacitor/clipboard';
import { ApiService } from '../../services/api.service';
import { firstValueFrom } from 'rxjs';
import { localDatetimeToIsoUtc } from '../../core/time.util';
import { messaggioErrore } from '../../core/api-error';

@Component({
  selector: 'app-create-event',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './create-event.component.html',
  styleUrl: './create-event.component.scss',
})
export class CreateEventComponent {
  campiToccati = false;
  inCreazione = false;
  copiato = false;
  codiceCreatoEvento = '';
  messaggioErrore = '';
  erroredurata = '';
  modalitaSviluppo = false;
  form = {
    nome: '',
    luogo: '',
    data_inizio: '',
    durata_ore: 2,
    durata_min: 0,
    max_partecipanti: 50,
    scatti_per_utente: 3,
    durata_votazione_ore: 24,
  };

  aggiornaDurata(): void {
    const ore = Math.floor(this.form.durata_ore ?? 0);
    const min = Math.floor(this.form.durata_min ?? 0);

    this.modalitaSviluppo = ore === 0 && min === 3;
    this.erroredurata = '';

    if (!this.modalitaSviluppo) {
      const totaleMinuti = ore * 60 + min;
      if (!Number.isInteger(ore) || !Number.isInteger(min) || ore < 0 || min < 0 || min > 59) {
        this.erroredurata = 'Inserisci valori interi validi (ore 0-6, minuti 0-59).';
      } else if (totaleMinuti < 60) {
        this.erroredurata = 'La durata minima è 1 ora (60 minuti).';
      } else if (totaleMinuti > 360) {
        this.erroredurata = 'La durata massima è 6 ore (360 minuti).';
      }
    }
  }

  private get durataTotaleMinuti(): number {
    const ore = Math.floor(this.form.durata_ore ?? 0);
    const min = Math.floor(this.form.durata_min ?? 0);
    return ore * 60 + min;
  }

  get testoInvito(): string {
    return `Sei invitato a ${this.form.nome}! Usa il codice ${this.codiceCreatoEvento} per partecipare su ECHO.`;
  }

  constructor(
    public router: Router,
    private api: ApiService,
    private toastCtrl: ToastController,
  ) {}

  async creaEvento() {
    this.campiToccati = true;
    this.messaggioErrore = '';
    if (!this.form.nome || !this.form.luogo || !this.form.data_inizio) return;
    const totaleMinuti = this.durataTotaleMinuti;
    if (!this.modalitaSviluppo) {
      if (this.erroredurata) { this.messaggioErrore = this.erroredurata; return; }
      if (totaleMinuti < 60 || totaleMinuti > 360) {
        this.messaggioErrore = 'La durata deve essere tra 1h e 6h.';
        return;
      }
    }

    const nelRange = (v: number, min: number, max: number) => Number.isFinite(v) && v >= min && v <= max;
    
    if (!nelRange(this.form.max_partecipanti, 1, 500))  { this.messaggioErrore = 'I partecipanti devono essere tra 1 e 500.'; return; }
    if (!nelRange(this.form.scatti_per_utente, 1, 5))   { this.messaggioErrore = 'Gli scatti devono essere tra 1 e 5.'; return; }
    if (!nelRange(this.form.durata_votazione_ore, 12, 72))  { this.messaggioErrore = 'La finestra di votazione deve essere tra 12h e 72h.'; return; }

    this.inCreazione = true;
    try {
      const risposta = await firstValueFrom(
        this.api.creaEvento({
          nome: this.form.nome,
          luogo: this.form.luogo,
          data_inizio: localDatetimeToIsoUtc(this.form.data_inizio),
          durata_minuti: totaleMinuti,
          max_partecipanti: this.form.max_partecipanti,
          scatti_per_utente: this.form.scatti_per_utente,
          durata_votazione_ore: this.form.durata_votazione_ore,
          dev_mode: this.modalitaSviluppo,
        })
      );
      this.codiceCreatoEvento = risposta.codice;
    } catch (errore: unknown) {
      const messaggio = messaggioErrore(errore, 'Errore nella creazione');
      const toast = await this.toastCtrl.create({ message: messaggio, duration: 3000, color: 'danger', position: 'bottom' });
      toast.present();
    } finally {
      this.inCreazione = false;
    }
  }

  async condividiInvito() {
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: 'ECHO', text: this.testoInvito });
        return;
      } catch {
        // Condivisione annullata dall'utente o non riuscita: si ripiega sulla
        // copia negli appunti, subito sotto.
      }
    }
    await Clipboard.write({ string: this.testoInvito });
    this.copiato = true;
    setTimeout(() => (this.copiato = false), 2500);
  }
}