import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  Observable,
  tap,
  catchError,
  throwError
} from 'rxjs';
import { environment } from '../../environments/environment';

export interface EchoUser { id_utente: string; nome: string; cognome: string; email: string; }
interface AuthResponse { token: string; id_utente: string; nome: string; cognome: string; }
interface JwtPayload { id_utente: string; email: string; exp: number; }

const TOKEN_KEY = 'echo_jwt';
const USER_KEY = 'echo_user';

/** Decodifica il payload di un JWT (senza verificarne la firma — è compito del backend). */
function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const [, b64] = token.split('.');
    return JSON.parse(atob(b64.replace(/-/g, '+').replace(/_/g, '/'))) as JwtPayload;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  //Cerca l'utente nel local storage
  private user: EchoUser | null = this.ripristinaStatoUtente();

  constructor(private http: HttpClient) { }

  //Restituisce true solo se sono vere due condizioni: c'è un token nel browser E l'oggetto utente è caricato in memoria.
  get isLoggedIn(): boolean { return !!this.getToken() && !!this.user; }

  getToken(): string | null { return localStorage.getItem(TOKEN_KEY); }

  login(email: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${environment.apiUrl}/api/auth/login`, { email, password })
      .pipe(tap(r => this.save(r)), catchError(e => throwError(() => e)));
  }

  register(nome: string, cognome: string, email: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${environment.apiUrl}/api/auth/registrazione`, { nome, cognome, email, password })
      .pipe(tap(r => this.save(r)), catchError(e => throwError(() => e)));
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.user = null;
  }

  private save(res: AuthResponse): void {
    localStorage.setItem(TOKEN_KEY, res.token);
    const email = decodeJwtPayload(res.token)?.email ?? '';
    const user: EchoUser = { id_utente: res.id_utente, nome: res.nome, cognome: res.cognome, email };
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    this.user = user;
  }

  // Vede se i token presenti nella
  private ripristinaStatoUtente(): EchoUser | null {
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const raw = localStorage.getItem(USER_KEY);
      if (!token || !raw) return null;
      const payload = decodeJwtPayload(token);
      if (!payload) throw new Error('TOKEN_MALFORMATO');
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        return null;
      }
      return JSON.parse(raw) as EchoUser;
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      return null;
    }
  }
}
