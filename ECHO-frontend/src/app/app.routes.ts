import { Routes } from '@angular/router';
import {
  guardAuth,
  guardCamera,
  guardLanding,
  guardOnBoarding
} from './core/guards/guards';

import { ComponenteShellApp } from './shell/app-shell.component';

export const routes: Routes = [
  // Tutorial di primo avvio. La radice reindirizza qui; guardOnBoarding o lo mostra (primissimo
  // avvio su un dispositivo) o — se il flag hasSeenTutorial è già impostato — rimbalza dritto a
  // /benvenuto. Al termine, il componente imposta il flag e va a /benvenuto.
  { path: 'onboarding', loadComponent: () => import('./components/onboarding/onboarding.component').then(m => m.ComponenteOnboarding), canActivate: [guardOnBoarding] },
  { path: 'auth', loadComponent: () => import('./pages/auth/auth.page').then(m => m.PaginaAutenticazione) },
  { path: 'benvenuto', loadComponent: () => import('./pages/landing/landing.page').then(m => m.PaginaBenvenuto), canActivate: [guardLanding] },
  // La radice nuda va a /onboarding, che guardOnBoarding risolve: il primissimo avvio mostra
  // il tutorial, ogni avvio successivo viene reindirizzato alla landing page pubblica
  // (/benvenuto). Full-match così viene catturato solo il percorso vuoto esatto.
  { path: '', redirectTo: 'onboarding', pathMatch: 'full' },
  {
    path: '', component: ComponenteShellApp, canActivate: [guardAuth],
    children: [
      { path: 'eventi/miei', loadComponent: () => import('./pages/events/events.page').then(m => m.PaginaEventi) },
      // Entrambe le rotte caricano la pagina unificata Partecipa/Crea; `data.tab` seleziona il segmento.
      { path: 'eventi/crea', loadComponent: () => import('./pages/join-event/join-event.page').then(m => m.PaginaPartecipaEvento), data: { tab: 'crea' } },
      { path: 'eventi/partecipa', loadComponent: () => import('./pages/join-event/join-event.page').then(m => m.PaginaPartecipaEvento), data: { tab: 'partecipa' } },
      { path: 'eventi/:id/analytics', loadComponent: () => import('./pages/analytics/analytics.page').then(m => m.PaginaAnalisi) },
      { path: 'camera/:id_evento', loadComponent: () => import('./pages/camera/camera.page').then(m => m.PaginaFotocamera), canActivate: [guardCamera] },
      { path: 'galleria/:id_evento', loadComponent: () => import('./pages/gallery/gallery.page').then(m => m.PaginaGalleria) },
      { path: 'profilo', loadComponent: () => import('./pages/profile/profile.page').then(m => m.PaginaProfilo) },
      { path: 'impostazioni', loadComponent: () => import('./pages/settings/settings.page').then(m => m.PaginaImpostazioni) },
    ],
  },
  { path: '**', redirectTo: 'eventi/miei' },
];
