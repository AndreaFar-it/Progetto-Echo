import { HttpInterceptorFn } from '@angular/common/http';
import { HttpEvent } from '@angular/common/http';
import {
  timeout,
  retry
} from 'rxjs/operators';
import { Observable } from 'rxjs';
import { timer } from 'rxjs';
import { environment } from '../../../environments/environment';

const TIMEOUT_MS = 90_000;

// Anche questo è parte di sicurezza HTTP, ma gestisce connessioni lente e instabili
// imposta un limite massimo di 90 secondi per ogni singola richiesta HTTP inviata al nostro server backend
// Attenzioniamo se la richiesta è di lettura o meno per capire se possiamo ripeterla oltre il timeout senza provocare danni
// Se è read only la la proviamo 2 volte a distanza di 3 e 6 secondi
export const timeoutRetryInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl)) return next(req);

  const isReadOnly = req.method === 'GET' || req.method === 'HEAD';
  const base$: Observable<HttpEvent<unknown>> = next(req).pipe(timeout(TIMEOUT_MS));

  if (isReadOnly) {
    return base$.pipe(retry({ count: 2, delay: (_e, n) => timer(n * 3000) }));
  }
  return base$;
};
