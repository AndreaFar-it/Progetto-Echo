import { Component } from '@angular/core';
import { Router } from '@angular/router';

import { IonContent } from '@ionic/angular/standalone';
import { markTutorialSeen } from '../../core/tutorial.storage';

interface OnboardingSlide {
  illustration: string;
  title: string;
  lead: string;
  body: string;
}

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [IonContent],
  templateUrl: './onboarding.page.html',
  styleUrl: './onboarding.page.scss',
})
export class PaginaOnboarding {
  current = 0;

  constructor(private router: Router) {}

  slides: OnboardingSlide[] = [
    {
      illustration: 'assets/process-arch-1.svg',
      title: 'Il Momento è Tutto',
      lead: 'Vivi l\'evento senza distrazioni:',
      body: 'punta e scatta. Hai a disposizione un rullino limitato. Non ci sono filtri e non puoi cancellare le foto. Fai in modo che ogni scatto conti.',
    },
    {
      illustration: 'assets/process-arch-2.svg',
      title: 'La Magia dell\'Attesa',
      lead: 'Dimentica la fretta.',
      body: 'Al termine dell\'evento, le foto entrano in fase di sviluppo per 24 ore. Rilassati: riceverai una notifica quando i ricordi saranno pronti per essere svelati.',
    },
    {
      illustration: 'assets/process-arch-3-blank.svg',
      title: 'Sblocca, Esplora e Premia',
      lead: 'Allo scadere del timer,',
      body: 'l\'album collettivo prende vita. Scopri l\'evento attraverso gli occhi degli altri partecipanti e usa il tuo unico, preziosissimo voto per far vincere lo scatto migliore.',
    },
  ];

  next() {
    if (this.current < this.slides.length - 1) {
      this.current++;
    } else {
      this.finish();
    }
  }

  skip() { this.finish(); }

  private async finish() {
    await markTutorialSeen();
    this.router.navigate(['/welcome']);
  }
}
