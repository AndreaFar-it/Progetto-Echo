import {
  Component,
  OnInit
} from '@angular/core';
import { Router } from '@angular/router';

import { FormsModule } from '@angular/forms';
import {
  IonContent,
  IonHeader,
  IonToolbar,
  ToastController,
  AlertController,
  LoadingController
} from '@ionic/angular/standalone';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';
import { environment } from '../../../environments/environment';
import { firstValueFrom } from 'rxjs';
import { messaggioErrore } from '../../core/api-error';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, IonContent, IonHeader, IonToolbar],
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
})
export class PaginaImpostazioni implements OnInit {
  altreLingue = ['English', 'Español'];
  avatarUrl: string | null = null;
  caricamentoFoto = false;

  pwForm = {
    attuale: '',
    nuova: '',
    conferma: ''
  };
  pwError = '';
  pwLoading = false;

  deleting = false;

  constructor(
    private auth: AuthService,
    private api: ApiService,
    public router: Router,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private loadingCtrl: LoadingController,
  ) { }

  ngOnInit() {
    this.loadAvatar();
  }

  // Metodo privato asincrono per ottenere la foto profilo dell'utente al caricamento della pagina
  private async loadAvatar() {
    try {
      const profilo = await firstValueFrom(this.api.getProfilo());
      this.avatarUrl = profilo.utente.foto_profilo_url;
    } catch (errore: unknown) {
      // Lettura non critica: resta l'avatar di default, ma la traccia serve in debug.
      console.warn('[PaginaImpostazioni] foto profilo non caricata', errore);
    }
  }

  photoUrl(path: string): string {
    return `${environment.apiUrl}${path}`;
  }

  // Metodo asincrono che si attiva quando l'utente sceglie un file dall'input type="file"
  async onPhotoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.caricamentoFoto = true;
    try {
      const res = await firstValueFrom(this.api.uploadFotoProfilo(file));
      this.avatarUrl = res.foto_profilo_url;
      this.toast('Immagine profilo aggiornata');
    } catch (errore: unknown) {
      const msg = messaggioErrore(errore, 'Errore durante il caricamento');
      this.toast(msg, 'danger');
    } finally {
      this.caricamentoFoto = false;
    }
  }

  // Metodo asincrono per gestire la logica di invio del form "Cambia Password"
  async changePassword() {
    this.pwError = '';
    if (!this.pwForm.attuale || !this.pwForm.nuova || !this.pwForm.conferma) {
      this.pwError = 'Compila tutti i campi.';
      return;
    }
    if (
      this.pwForm.nuova.length < 8 ||
      !/[A-Z]/.test(this.pwForm.nuova) ||
      !/[a-z]/.test(this.pwForm.nuova) ||
      !/[0-9]/.test(this.pwForm.nuova) ||
      !/[^A-Za-z0-9]/.test(this.pwForm.nuova)
    ) {
      this.pwError = 'Password non soddisfa i criteri di sicurezza. Deve contenere almeno un carattere maiuscolo, uno minuscolo, un numero e un simbolo speciale.';
      return;
    }
    if (this.pwForm.nuova !== this.pwForm.conferma) {
      this.pwError = 'Le password non coincidono.';
      return;
    }

    this.pwLoading = true;
    try {
      await firstValueFrom(this.api.cambiaPassword(this.pwForm.attuale, this.pwForm.nuova));
      this.pwForm = { attuale: '', nuova: '', conferma: '' };
      this.toast('Password aggiornata con successo');
    } catch (errore: unknown) {
      this.pwError = messaggioErrore(errore, 'Errore durante l\'aggiornamento.');
    } finally {
      this.pwLoading = false;
    }
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/benvenuto']);
  }

  async confirmDelete() {
    const first = await this.alertCtrl.create({
      header: 'Sei sicuro?',
      message: 'Questa azione è irreversibile. Tutti i tuoi dati, eventi organizzati, foto e voti verranno eliminati permanentemente.',
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        { text: 'Continua', role: 'destructive', handler: () => this.confirmDeleteFinal() },
      ],
    });
    await first.present();
  }

  private async confirmDeleteFinal() {
    const second = await this.alertCtrl.create({
      header: 'Conferma definitiva',
      message: 'Ultima possibilità per annullare. Confermi l\'eliminazione definitiva del tuo profilo?',
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        { text: 'Elimina definitivamente', role: 'destructive', handler: () => this.deleteAccount() },
      ],
    });
    await second.present();
  }

  // Metodo asincrono e privato che invia la vera e propria richiesta di rimozione al server
  private async deleteAccount() {
    this.deleting = true;
    const loading = await this.loadingCtrl.create({ message: 'Eliminazione account…' });
    await loading.present();
    try {
      await firstValueFrom(this.api.eliminaAccount());
      this.auth.logout();
      this.router.navigate(['/benvenuto']);
    } catch {
      this.toast('Errore durante l\'eliminazione. Riprova più tardi.', 'danger');
    } finally {
      this.deleting = false;
      loading.dismiss();
    }
  }

  private async toast(message: string, color: 'success' | 'danger' = 'success') {
    const t = await this.toastCtrl.create({ message, duration: 2500, color, position: 'bottom' });
    t.present();
  }
}