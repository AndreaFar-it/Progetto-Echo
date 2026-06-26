import { Injectable, signal, Signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap, catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';

export interface EchoUser { id_utente: string; nome: string; cognome: string; email: string; }
interface AuthResponse { token: string; id_utente: string; nome: string; cognome: string; }

const TOKEN_KEY = 'echo_jwt';
const USER_KEY  = 'echo_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private _user$ = new BehaviorSubject<EchoUser | null>(this.hydrate());
  readonly user$: Observable<EchoUser | null> = this._user$.asObservable();
  private _userSig = signal<EchoUser | null>(this._user$.getValue());
  readonly userSig: Signal<EchoUser | null> = this._userSig.asReadonly();

  constructor(private http: HttpClient) {}

  get isLoggedIn(): boolean { return !!this.getToken() && !!this._user$.getValue(); }
  get currentUser(): EchoUser | null { return this._user$.getValue(); }
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
    localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY);
    this._user$.next(null); this._userSig.set(null);
  }

  private save(r: AuthResponse): void {
    localStorage.setItem(TOKEN_KEY, r.token);
    const u: EchoUser = { id_utente: r.id_utente, nome: r.nome, cognome: r.cognome, email: '' };
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    this._user$.next(u); this._userSig.set(u);
  }

  private hydrate(): EchoUser | null {
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const raw   = localStorage.getItem(USER_KEY);
      if (!token || !raw) return null;
      const [, b64] = token.split('.');
      const payload = JSON.parse(atob(b64.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); return null;
      }
      return JSON.parse(raw) as EchoUser;
    } catch { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); return null; }
  }
}
