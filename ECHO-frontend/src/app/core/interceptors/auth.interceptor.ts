import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth  = inject(AuthService);
  const router = inject(Router);
  const isOwn  = req.url.startsWith(environment.apiUrl);
  if (isOwn) {
    const token = auth.getToken();
    if (token) req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(req).pipe(
    catchError((errore: HttpErrorResponse) => {
      if (!isOwn) return throwError(() => errore);
      if (errore.status === 401) { auth.logout(); router.navigate(['/auth'], { queryParams: { reason: 'session_expired' }, replaceUrl: true }); }
      if (errore.status === 403) { router.navigate(['/eventi/miei'], { queryParams: { error: 'forbidden' } }); }
      return throwError(() => errore);
    })
  );
};
