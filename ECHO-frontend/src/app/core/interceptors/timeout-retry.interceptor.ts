import { HttpInterceptorFn } from '@angular/common/http';
import { HttpEvent } from '@angular/common/http';
import { timeout, retry } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { timer } from 'rxjs';
import { environment } from '../../../environments/environment';

const TIMEOUT_MS = 90_000;

export const timeoutRetryInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl)) return next(req);

  const isReadOnly = req.method === 'GET' || req.method === 'HEAD';
  const base$: Observable<HttpEvent<unknown>> = next(req).pipe(timeout(TIMEOUT_MS));

  if (isReadOnly) {
    return base$.pipe(retry({ count: 2, delay: (_e, n) => timer(n * 3000) }));
  }
  return base$;
};
