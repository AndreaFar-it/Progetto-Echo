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
  // /welcome. Al termine, il componente imposta il flag e va a /welcome.
  { path: 'onboarding', loadComponent: () => import('./pages/onboarding/onboarding.page').then(m => m.PaginaOnboarding), canActivate: [guardOnBoarding] },
  { path: 'auth', loadComponent: () => import('./pages/auth/auth.page').then(m => m.PaginaAutenticazione) },
  { path: 'welcome', loadComponent: () => import('./pages/landing/landing.page').then(m => m.PaginaBenvenuto), canActivate: [guardLanding] },
  // La radice nuda va a /onboarding, che guardOnBoarding risolve: il primissimo avvio mostra
  // il tutorial, ogni avvio successivo viene reindirizzato alla landing page pubblica
  // (/welcome). Full-match così viene catturato solo il percorso vuoto esatto.
  { path: '', redirectTo: 'onboarding', pathMatch: 'full' },
  {
    path: '', component: ComponenteShellApp, canActivate: [guardAuth],
    children: [
      { path: 'events/mine', loadComponent: () => import('./pages/events/events.page').then(m => m.PaginaEventi) },
      // Entrambe le rotte caricano la pagina unificata Partecipa/Crea; `data.tab` seleziona il segmento.
      { path: 'events/create', loadComponent: () => import('./pages/join-event/join-event.page').then(m => m.PaginaPartecipaEvento), data: { tab: 'create' } },
      { path: 'events/join', loadComponent: () => import('./pages/join-event/join-event.page').then(m => m.PaginaPartecipaEvento), data: { tab: 'join' } },
      { path: 'events/:id/analytics', loadComponent: () => import('./pages/analytics/analytics.page').then(m => m.PaginaAnalisi) },
      { path: 'camera/:id', loadComponent: () => import('./pages/camera/camera.page').then(m => m.PaginaFotocamera), canActivate: [guardCamera] },
      { path: 'gallery/:id', loadComponent: () => import('./pages/gallery/gallery.page').then(m => m.PaginaGalleria) },
      { path: 'profile', loadComponent: () => import('./pages/profile/profile.page').then(m => m.PaginaProfilo) },
      { path: 'settings', loadComponent: () => import('./pages/settings/settings.page').then(m => m.PaginaImpostazioni) },
    ],
  },
  { path: '**', redirectTo: 'events/mine' },
];
