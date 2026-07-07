import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Platform } from '@ionic/angular/common';
import { AuthService } from '../../services/auth.service';
import { hasSeenTutorial } from '../tutorial.storage';

//Controlliamo se siamo su un telefono e se abbiamo già visto il tutorial, ci muoviamo a seconda della condizione
export const guardOnBoarding: CanActivateFn = async () => {
  const router = inject(Router);
  const platform = inject(Platform);
  if (!platform.is('hybrid') || await hasSeenTutorial()) {
    router.navigate(['/benvenuto']);
    return false;
  }
  return true;
};

//Controlla se l'url è una radice, torna true solo se lo è
function isBareRoot(url: string): boolean {
  return url.split('?')[0] === '/';
}

//Controlla se un utente è autenticato o meno e controlla l'utilizzo di link root
export const guardAuth: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const platform = inject(Platform);
  if (isBareRoot(state.url) && !platform.is('hybrid')) {
    router.navigate(['/benvenuto']);
    return false;
  }
  if (auth.isLoggedIn) return true;
  router.navigate(['/auth'], { queryParams: { returnUrl: state.url } });
  return false;
};

//Gestisce l'accesso alla landing page da app
export const guardLanding: CanActivateFn = () => {
  const router = inject(Router);
  const platform = inject(Platform);
  const auth = inject(AuthService);
  if (platform.is('hybrid')) {
    // Già loggato → vai dritto nell'app, non mostrare mai la pagina di autenticazione
    router.navigateByUrl(auth.isLoggedIn ? '/eventi/miei' : '/auth', { replaceUrl: true });
    return false;
  }
  return true;
};

//Controlla che l'utente sia effettivamente da cellulare prima di abilitare la telecamera
export const guardCamera: CanActivateFn = () => {
  const platform = inject(Platform);
  const router = inject(Router);
  if (platform.is('hybrid')) return true;
  router.navigate(['/eventi/miei']); return false;
};
