import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Platform } from '@ionic/angular/common';
import { AuthService } from '../../services/auth.service';
import { hasSeenTutorial } from '../tutorial.storage';

/**
 * Protegge il tutorial di onboarding una tantum. Solo app nativa — la build web salta sempre
 * diritto alla landing page, poiché le slide del tutorial sono pensate per l'esperienza
 * nativa fotocamera/app e non valgono per i visitatori da browser. Su nativo, mostrato solo
 * al primissimo avvio su un nuovo dispositivo: se il flag persistente `hasSeenTutorial` è
 * già impostato, salta il tutorial e manda l'utente alla landing page pubblica. La rotta
 * radice reindirizza a /onboarding, quindi è questa guardia a decidere "mostra tutorial vs.
 * salta dritto all'app" a ogni avvio.
 */
export const guardiaTutorial: CanActivateFn = async () => {
  const router = inject(Router); const platform = inject(Platform);
  if (!platform.is('hybrid') || await hasSeenTutorial()) {
    router.navigate(['/benvenuto']);
    return false;
  }
  return true;
};

/** True solo per il percorso radice nudo in sé — '/' o '/?qualsiasi=query' — mai per una
 *  rotta interna reale. Confrontare solo il pathname (ignorando la query string) lo mantiene
 *  corretto anche se qualcosa appende parametri di query a una visita radice (es. link UTM). */
function isBareRoot(url: string): boolean {
  return url.split('?')[0] === '/';
}

export const guardiaAutenticazione: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService); const router = inject(Router); const platform = inject(Platform);
  // Sul web, la radice nuda ('/') è sempre prima la landing page — un momento di branding
  // deliberato a ogni visita, loggato o meno — non solo un gate per ospiti. Qualsiasi ALTRO
  // url (deep link, o un reload mentre si è su /profilo, /eventi/123, ecc.) salta del tutto
  // questo ramo e prosegue al normale controllo isLoggedIn sotto, così un reload di pagina su
  // una rotta interna non viene mai rimbalzato alla landing page — solo una sessione realmente
  // mancante/scaduta lo fa (→ /auth, con returnUrl preservato). L'app nativa non è interessata:
  // non ha mai una visita '/' significativa in primo luogo.
  if (isBareRoot(state.url) && !platform.is('hybrid')) {
    router.navigate(['/benvenuto']);
    return false;
  }
  if (auth.isLoggedIn) return true;
  router.navigate(['/auth'], { queryParams: { returnUrl: state.url } });
  return false;
};

/**
 * Protegge la landing page pubblica stessa. È solo web — l'app nativa non la mostra mai,
 * loggati o no, quindi reindirizza i visitatori nativi direttamente al posto giusto. I
 * visitatori web la vedono sempre, indipendentemente dallo stato di autenticazione (la pagina
 * stessa adatta la sua CTA: Accedi/Registrati per gli ospiti, una singola azione "entra
 * nell'app" una volta loggati).
 */
export const guardiaLanding: CanActivateFn = () => {
  const router = inject(Router); const platform = inject(Platform);
  const auth = inject(AuthService);
  if (platform.is('hybrid')) {
    // Già loggato → vai dritto nell'app, non mostrare mai la pagina di autenticazione
    router.navigateByUrl(auth.isLoggedIn ? '/eventi/miei' : '/auth', { replaceUrl: true });
    return false;
  }
  return true;
};

/**
 * La fotocamera richiede un layer nativo CameraPreview (rendering toBack: true dietro la
 * WebView) — non può funzionare in un semplice browser/PWA. platform.is('hybrid') è true
 * solo dentro lo shell nativo Capacitor/Cordova, false su web/desktop.
 */
export const guardiaSoloNativo: CanActivateFn = () => {
  const platform = inject(Platform); const router = inject(Router);
  if (platform.is('hybrid')) return true;
  router.navigate(['/eventi/miei']); return false;
};
