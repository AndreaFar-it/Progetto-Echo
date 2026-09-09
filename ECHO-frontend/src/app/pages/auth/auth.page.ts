import {
  Component,
  OnInit
} from '@angular/core';
import {
  ActivatedRoute,
  Router
} from '@angular/router';

import { FormsModule } from '@angular/forms';
import {
  AlertController,
  IonContent,
  IonIcon,
  ToastController
} from '@ionic/angular/standalone';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';
import { firstValueFrom } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { messaggioErrore } from '../../core/api-error';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [FormsModule, IonContent, IonIcon],
  templateUrl: './auth.page.html',
  styleUrl: './auth.page.scss',
})
export class PaginaAutenticazione implements OnInit {
  mode: 'login' | 'register' = 'login';
  caricamento = false;
  errorMsg = '';
  form = { nome: '', cognome: '', email: '', password: '' };
  avatarFile: File | null = null;
  avatarPreview: string | null = null;

  // 2 step per la fase di registrazione
  step: 'credentials' | 'profile' = 'credentials';

  constructor(
    private auth: AuthService,
    private api: ApiService,
    private router: Router,
    private route: ActivatedRoute,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
  ) { }

  // Variabile privata per memorizzare un eventuale URL a cui tornare dopo il login.
  private returnUrl: string | null = null;

  ngOnInit() {
    if (this.auth.isLoggedIn) {
      // Recupera l'URL di ritorno dai parametri della rotta, altrimenti usa '/eventi/miei' di default
      const dest = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/eventi/miei';
      this.router.navigateByUrl(dest.startsWith('/auth') ? '/eventi/miei' : dest, { replaceUrl: true });
      return;
    }
    if (this.route.snapshot.queryParamMap.get('mode') === 'register') this.mode = 'register';
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    // Se c'è un returnUrl valido e non è un redirect ciclico verso '/auth', lo salva nella variabile di classe
    if (returnUrl && !returnUrl.startsWith('/auth')) this.returnUrl = returnUrl;
  }

  switchMode(mode: 'login' | 'register') {
    this.mode = mode;
    this.step = 'credentials';
    this.errorMsg = '';
  }

  backToCredentials() {
    this.step = 'credentials';
    this.errorMsg = '';
  }

  // Metodo asincrono invocato al click del submit sul form del primo step (credenziali)
  async onCredentialsSubmit() {
    this.errorMsg = '';
    if (!this.form.email || !this.form.password) {
      this.errorMsg = 'Email e password sono obbligatorie.';
      return;
    }
    if (this.mode === 'login') {
      this.submit();
      return;
    }

    const email = this.form.email.trim();
    // Valida l'email utilizzando una Regex standard
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.errorMsg = 'Inserisci un indirizzo email valido.';
      return;
    }
    if (
      this.form.password.length < 8 ||
      !/[A-Z]/.test(this.form.password) ||
      !/[a-z]/.test(this.form.password) ||
      !/[0-9]/.test(this.form.password) ||
      !/[^A-Za-z0-9]/.test(this.form.password)
    ) {
      this.errorMsg = 'Password non soddisfa i criteri di sicurezza. Deve contenere almeno un carattere maiuscolo, uno minuscolo, un numero e un simbolo speciale.';
      return;
    }

    this.caricamento = true;
    try {
      const { exists } = await firstValueFrom(this.api.checkEmail(email));
      if (exists) {
        this.errorMsg = 'Questa email è già registrata. Accedi invece.';
        return;
      }
    } catch {
      // Verifica non riuscita: si prosegue, tanto submit() rifiuta l'email duplicata.
    } finally {
      this.caricamento = false;
    }
    this.step = 'profile';
  }

  async submit() {
    this.errorMsg = '';
    this.caricamento = true;
    try {
      if (this.mode === 'login') {
        await firstValueFrom(this.auth.login(this.form.email, this.form.password));
        this.router.navigateByUrl(this.returnUrl ?? '/eventi/miei');
      } else {
        await firstValueFrom(this.auth.register(
          this.form.nome,
          this.form.cognome,
          this.form.email,
          this.form.password
        ));
        // Se durante lo step 'profile' l'utente aveva selezionato un'immagine di profilo
        if (this.avatarFile) {
          try {
            await firstValueFrom(this.api.uploadFotoProfilo(this.avatarFile));
          } catch {
            // L'account c'e' gia': si avvisa e basta, senza annullare la registrazione.
            await this.toast(
              'Account creato, ma non siamo riusciti a caricare l’immagine. Puoi farlo dalle impostazioni.',
              'danger',
            );
          }
        }
        this.router.navigate(['/eventi/miei']);
      }
    } catch (errore: unknown) {
      // Ripiego con lo stato HTTP: distingue rete assente (0) da rifiuto del server.
      const stato = errore instanceof HttpErrorResponse ? errore.status : 0;
      const causa = errore instanceof Error ? errore.message : 'connessione fallita';
      this.errorMsg = messaggioErrore(errore, `Errore ${stato}: ${causa}`);
      if (this.mode === 'register') this.step = 'credentials';
    } finally {
      this.caricamento = false;
    }
  }

  // Metodo agganciato all'evento 'change' dell'input type="file" per selezionare l'avatar
  onAvatarSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.avatarFile = file;
    const reader = new FileReader();
    reader.onload = () => {
      this.avatarPreview = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  async openForgotPassword() {
    const step1 = await this.alertCtrl.create({
      header: 'Password dimenticata?',
      message: 'Inserisci la tua email per ricevere il codice OTP.',
      cssClass: 'echo-alert',
      inputs: [{ name: 'email', type: 'email', placeholder: 'giulia@example.com', value: this.form.email }],
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: 'Invia OTP',
          handler: async (data: { email?: string }) => {
            const email = data.email?.trim();
            if (!email) return false;
            try {
              await firstValueFrom(this.api.forgotPassword(email));
              setTimeout(() => this.openOtpStep(email), 300);
            } catch {
              this.toast('Errore durante l\'invio. Riprova più tardi.', 'danger');
            }
            return true;
          },
        },
      ],
    });
    await step1.present();
  }

  private async openOtpStep(email: string) {
    const step2 = await this.alertCtrl.create({
      header: 'Inserisci il codice OTP',
      message: `Controlla la console (in demo) o la tua email per il codice a 6 cifre inviato a ${email}.`,
      cssClass: 'echo-alert',
      inputs: [
        { name: 'otp', type: 'number', placeholder: 'Codice OTP (6 cifre)' },
        { name: 'password', type: 'password', placeholder: 'Nuova password (min. 8 caratteri)' },
      ],
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: 'Conferma',
          handler: async (data: { otp?: string; password?: string }) => {
            const otp = String(data.otp ?? '').trim();
            const nuova_password = data.password ?? '';
            const passwordValida =
              nuova_password.length >= 8 &&
              /[A-Z]/.test(nuova_password) &&
              /[a-z]/.test(nuova_password) &&
              /[0-9]/.test(nuova_password) &&
              /[^A-Za-z0-9]/.test(nuova_password);
            if (!otp || !passwordValida) {
              this.toast('Inserisci OTP e una password valida (8+ caratteri, maiuscola, minuscola, numero e simbolo).', 'danger');
              return false;
            }
            try {
              const res = await firstValueFrom(this.api.verifyResetOtp(email, otp, nuova_password));
              this.toast(res.message);
            } catch (errore: unknown) {
              const msg = messaggioErrore(errore, 'OTP non valido o scaduto.');
              this.toast(msg, 'danger');
            }
            return true;
          },
        },
      ],
    });
    await step2.present();
  }

  private async toast(message: string, color: 'success' | 'danger' = 'success') {
    const t = await this.toastCtrl.create({ message, duration: 2800, color, position: 'top' });
    t.present();
  }
}