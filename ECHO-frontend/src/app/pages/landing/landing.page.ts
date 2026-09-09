import { Component } from '@angular/core';
import { Router } from '@angular/router';

import { IonContent } from '@ionic/angular/standalone';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';

interface Passo {
  // Accento dello slogan. E' un'unione, non una stringa CSS: il compilatore
  // verifica il valore e il colore resta nel foglio di stile.
  accento: 'teal' | 'rust';
  lead: string; // Slogan breve da evidenziare .
  body: string; // Resto del testo
  title: string;
  illustration: string;
}

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [IonContent],
  templateUrl: './landing.page.html',
  styleUrl: './landing.page.scss',
})
export class PaginaBenvenuto {
  
  readonly apkUrl = `${environment.apiUrl}/downloads/echo.apk`;

  constructor(
    public auth: AuthService, 
    private router: Router) {}

  readonly passi: readonly Passo[] = [
    {
      accento: 'teal',
      title: 'Il Momento è Tutto',
      lead: "Vivi l'evento senza distrazioni:",
      body: 'punta e scatta. Hai a disposizione un rullino limitato. Non ci sono filtri e non puoi cancellare le foto. Fai in modo che ogni scatto conti.',
      illustration: 'assets/process-arch-1.svg',
    },
    {
      accento: 'rust',
      title: "La Magia dell'Attesa",
      lead: 'Dimentica la fretta.',
      body: "Al termine dell'evento, le foto entrano in fase di sviluppo per 24 ore. Rilassati: riceverai una notifica quando i ricordi saranno pronti per essere svelati.",
      illustration: 'assets/process-arch-2.svg',
    },
    {
      accento: 'teal',
      title: 'Sblocca, Esplora e Premia',
      lead: 'Allo scadere del timer,',
      body: "l'album collettivo prende vita. Scopri l'evento attraverso gli occhi degli altri partecipanti e usa il tuo unico, preziosissimo voto per far vincere lo scatto migliore.",
      illustration: 'assets/process-arch-3-blank.svg',
    },
  ];

  vaiAllAutenticazione(modalita: 'login' | 'register') {
    this.router.navigate(['/auth'], { queryParams: { mode: modalita } });
  }

  entraInApp() {
    this.router.navigateByUrl('/auth', { replaceUrl: true });
  }

  scorriAlProcesso() {
    document.getElementById('echo-process')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}