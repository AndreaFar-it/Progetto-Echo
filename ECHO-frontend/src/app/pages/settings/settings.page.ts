import {
  Component,
  OnInit
} from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
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

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent, IonHeader, IonToolbar],
  template: `
    <ion-header><ion-toolbar>
      <div class="tb">
        <button class="tb__back" (click)="router.navigate(['/profilo'])">← Indietro</button>
        <span class="tb__title">Impostazioni</span>
        <span class="tb__spacer"></span>
      </div>
    </ion-toolbar></ion-header>

    <ion-content>
      <div class="settings-shell">

        <!-- Foto profilo  -->
        <section class="section">
          <p class="section__label">Cambio immagine profilo</p>
          <div class="avatar-row">
            <div class="avatar-preview">
              <img [src]="avatarUrl ? photoUrl(avatarUrl) : 'assets/default-avatar.svg'" alt="Foto profilo" />
            </div>
            <div class="avatar-actions">
              <button class="echo-btn-outline" [disabled]="caricamentoFoto" (click)="fileInput.click()">
                {{ caricamentoFoto ? 'Caricamento…' : 'Cambia foto' }}
              </button>
              <p class="field-hint">JPEG, PNG o WebP — max 15MB</p>
            </div>
            <input #fileInput type="file" accept="image/jpeg,image/png,image/webp" hidden
                   (change)="onPhotoSelected($event)" />
          </div>
        </section>

        <!--  Modifica password  -->
        <section class="section">
          <p class="section__label">Modifica password</p>
          <div class="field-group">
            <label class="field-label">Password attuale</label>
            <input class="field-input" type="password" autocomplete="current-password"
                   [(ngModel)]="pwForm.attuale" placeholder="········" />
          </div>
          <div class="field-group">
            <label class="field-label">Nuova password</label>
            <input class="field-input" type="password" autocomplete="new-password"
                   [(ngModel)]="pwForm.nuova" placeholder="········" />
          </div>
          <div class="field-group">
            <label class="field-label">Conferma nuova password</label>
            <input class="field-input" type="password" autocomplete="new-password"
                   [(ngModel)]="pwForm.conferma" placeholder="········" (keyup.enter)="changePassword()" />
          </div>
          <p class="field-error" *ngIf="pwError">{{ pwError }}</p>
          <button class="echo-btn-outline echo-btn-block" [disabled]="pwLoading" (click)="changePassword()">
            {{ pwLoading ? 'Salvataggio…' : 'Aggiorna password' }}
          </button>
        </section>

        <!--  Lingua  -->
        <section class="section">
          <p class="section__label">Cambio lingua</p>
          <div class="lang-list">
            <div class="lang-row lang-row--active">
              <span class="lang-dot"></span>
              <span class="lang-name">Italiano</span>
              <span class="lang-check">✓</span>
            </div>
            <div class="lang-row lang-row--disabled" *ngFor="let l of altreLingue">
              <span class="lang-dot"></span>
              <span class="lang-name">{{ l }}</span>
              <span class="lang-soon">Presto</span>
            </div>
          </div>
        </section>

        <!-- Esci  -->
        <section class="section">
          <button class="echo-btn-outline echo-btn-block" (click)="logout()">Esci</button>
        </section>

        <!--  Elimina profilo  -->
        <section class="section section--danger">
          <p class="section__label">Zona pericolosa</p>
          <button class="danger-btn" [disabled]="deleting" (click)="confirmDelete()">
            {{ deleting ? 'Eliminazione…' : 'Elimina profilo' }}
          </button>
          <p class="field-hint">Elimina definitivamente il tuo account e tutti i dati associati.</p>
        </section>

      </div>
    </ion-content>
  `,
  styles: [`
    ion-toolbar { --background: var(--echo-surface-dark); --border-color: var(--echo-ink); }
    ion-content  { --background: var(--echo-bg); }

    .tb { display: flex; align-items: center; gap: 12px; padding: 0 16px; height: 56px; }
    .tb__back { font-size: 12px; color: var(--echo-cream); background: transparent; border: none; cursor: pointer; font-family: var(--echo-font-mono); }
    .tb__title { font-family: var(--echo-font-serif); font-size: 18px; color: var(--echo-cream); flex: 1; text-align: center; }
    .tb__spacer { width: 52px; }

    .settings-shell { padding: 0 0 100px; }

    .section { padding: 24px 16px 0; border-top: 0.5px solid rgba(42,26,14,0.2); margin-top: 24px; }
    .section:first-child { border-top: none; margin-top: 12px; }
    .section__label { font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--echo-ink-soft); margin: 0 0 14px; font-family: var(--echo-font-mono); }

    /* ── Lingua ── */
    .lang-list { display: flex; flex-direction: column; gap: 8px; }
    .lang-row {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 14px; background: transparent; border: 1.5px solid var(--echo-ink); border-radius: 6px;
    }
    .lang-row--active { border-color: var(--echo-rust); }
    .lang-row--disabled { opacity: 0.45; }
    .lang-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--echo-surface-muted); flex-shrink: 0; }
    .lang-row--active .lang-dot { background: var(--echo-rust); }
    .lang-name { flex: 1; font-size: 14px; color: var(--echo-ink); font-family: var(--echo-font-mono); }
    .lang-check { color: var(--echo-rust); font-size: 14px; }
    .lang-soon {
      font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--echo-ink-soft);
      border: 0.5px solid var(--echo-ink); border-radius: 999px; padding: 2px 8px; font-family: var(--echo-font-mono);
    }

    /* ── Avatar ── */
    .avatar-row { display: flex; align-items: center; gap: 16px; margin-bottom: 8px; }
    .avatar-preview {
      width: 64px; height: 64px; border-radius: 50%; overflow: hidden;
      border: 1px solid var(--echo-ink); background: transparent; flex-shrink: 0;
      img { width: 100%; height: 100%; object-fit: cover; }
    }
    .avatar-actions { flex: 1; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }

    /* ── Stili condivisi dei campi (rispecchia auth.page.ts) ── */
    .field-group { margin-bottom: 18px; }
    .field-label {
      display: block; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
      color: var(--echo-ink-soft); margin-bottom: 8px; font-family: var(--echo-font-mono);
    }
    .field-input {
      width: 100%; background: transparent; border: 1.5px solid var(--echo-ink); border-radius: 2px;
      color: var(--echo-ink); font-size: 15px; padding: 12px 14px; outline: none;
      font-family: var(--echo-font-mono); transition: border-color 150ms;
      &::placeholder { color: var(--echo-surface-muted); }
      &:focus { border-color: var(--echo-rust); }
    }
    .field-hint { font-size: 11px; color: var(--echo-ink-soft); margin: 0; font-family: var(--echo-font-mono); }
    .field-error {
      font-size: 12px; color: #8A3F23; margin: -6px 0 14px; padding: 8px 12px;
      background: rgba(184,92,56,0.10); border-left: 2px solid var(--echo-rust); border-radius: 0 2px 2px 0;
      font-family: var(--echo-font-mono);
    }

    /* ── Buttons ── */
    .echo-btn-outline {
      border: 1px solid var(--echo-ink); color: var(--echo-ink); background: transparent;
      padding: 10px 20px; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase;
      border-radius: 4px; cursor: pointer; transition: background 150ms; font-family: var(--echo-font-mono);
      &:active { background: rgba(42,26,14,0.06); }
      &[disabled] { opacity: 0.4; cursor: not-allowed; }
    }
    .echo-btn-block { width: 100%; display: flex; justify-content: center; margin-top: 4px; }

    .section--danger { margin-bottom: 24px; }
    .danger-btn {
      width: 100%; border: 1px solid #8A3F23; color: #8A3F23; background: rgba(184,92,56,0.06);
      padding: 12px; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase;
      border-radius: 4px; cursor: pointer; transition: background 150ms; margin-bottom: 10px;
      font-family: var(--echo-font-mono);
      &:active { background: rgba(184,92,56,0.15); }
      &[disabled] { opacity: 0.4; cursor: not-allowed; }
    }
  `],
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
    } catch {
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
      const msg = (errore as { error?: { error?: string } })?.error?.error ?? 'Errore durante il caricamento';
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
      this.pwError = (errore as { error?: { error?: string } })?.error?.error ?? 'Errore durante l\'aggiornamento.';
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