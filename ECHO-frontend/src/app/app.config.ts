import {
  ApplicationConfig,
  isDevMode
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withViewTransitions
} from '@angular/router';
import {
  provideHttpClient,
  withInterceptors
} from '@angular/common/http';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { timeoutRetryInterceptor } from './core/interceptors/timeout-retry.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    // Configura il routing attivando il passaggio di parametri ai componenti e le transizioni visive
    provideRouter(routes, withComponentInputBinding(), withViewTransitions()),
    // Configura il client HTTP aggiungendo gli interceptor per timeout/retry e autenticazione
    provideHttpClient(withInterceptors([timeoutRetryInterceptor, authInterceptor])),
    // Inizializza Ionic forzando il design iOS, disabilitando l'effetto "ripple" e mantenendo le animazioni
    provideIonicAngular({ mode: 'ios', rippleEffect: false, animated: true }),
    // Configura il Service Worker per la PWA (attivo solo in produzione, si registra dopo 30 secondi di stabilità)
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};