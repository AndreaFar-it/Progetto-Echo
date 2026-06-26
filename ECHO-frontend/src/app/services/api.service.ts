/**
 * ECHO — Servizio API (api.service.ts)
 *
 * Centralizza tutte le chiamate HTTP verso il backend Express.
 * Ogni metodo pubblico corrisponde a un endpoint REST specifico e restituisce
 * un Observable tipizzato, consumato dalle pagine tramite firstValueFrom() o async pipe.
 *
 * L'URL base viene letto dalla configurazione d'ambiente (environment.apiUrl),
 * che cambia tra sviluppo locale, modalità Capacitor (Android) e produzione Render.
 */

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { EventoCard, ConfermaCaricamento, AnalyticsData, ProfiloResponse, GalleriaResponse } from '../models/index';

@Injectable({ providedIn: 'root' })
export class ApiService {
  /** URL base del backend (es. https://echo-backend.onrender.com) */
  private readonly urlBase = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /** Recupera tutti gli eventi dell'utente (come organizzatore o partecipante). */
  getMieiEventi(): Observable<{ events: EventoCard[] }> {
    return this.http.get<{ events: EventoCard[] }>(`${this.urlBase}/api/eventi/miei`);
  }

  /** Crea un nuovo evento fotografico con i parametri specificati. */
  creaEvento(parametri: {
    nome: string;
    luogo: string;
    data_inizio: string;
    durata_minuti: number;
    max_partecipanti: number;
    scatti_per_utente: number;
    durata_votazione: number;
    dev_mode?: boolean;
  }): Observable<{ message: string; eventoId: string; codice: string; data_fine_calc: string; stato: string }> {
    return this.http.post<{ message: string; eventoId: string; codice: string; data_fine_calc: string; stato: string }>(
      `${this.urlBase}/api/eventi/crea`, parametri
    );
  }

  /** Iscrive l'utente a un evento tramite codice di invito a 5 cifre. */
  partecipaEvento(codice: string): Observable<{ message: string; evento: EventoCard }> {
    return this.http.post<{ message: string; evento: EventoCard }>(
      `${this.urlBase}/api/eventi/partecipa`, { codice }
    );
  }

  /** Recupera le statistiche aggregate di un evento (solo per l'organizzatore). */
  getAnalisi(idEvento: string): Observable<AnalyticsData> {
    return this.http.get<AnalyticsData>(`${this.urlBase}/api/eventi/${idEvento}/analytics`);
  }

  /** Carica una foto sul server per un evento attivo. */
  uploadFoto(idEvento: string, blob: Blob): Observable<ConfermaCaricamento> {
    const formData = new FormData();
    formData.append('id_evento', idEvento);
    formData.append('foto', blob, `echo_${Date.now()}.jpg`);
    return this.http.post<ConfermaCaricamento>(`${this.urlBase}/api/foto/upload`, formData);
  }

  /** Registra il voto dell'utente per una foto nella galleria. */
  votaFoto(idFoto: string): Observable<{ message: string; voto_espresso: boolean }> {
    return this.http.post<{ message: string; voto_espresso: boolean }>(
      `${this.urlBase}/api/foto/vota`, { id_foto: idFoto }
    );
  }

  /** Recupera la galleria fotografica di un evento (disponibile dalla fase album_aperto). */
  getGalleria(idEvento: string): Observable<GalleriaResponse> {
    return this.http.get<GalleriaResponse>(`${this.urlBase}/api/foto/galleria/${idEvento}`);
  }

  /** Elimina un evento (solo l'organizzatore può eseguire questa operazione). */
  deleteEvento(idEvento: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.urlBase}/api/eventi/${idEvento}`);
  }

  /** L'organizzatore risponde al prompt "vuoi estendere l'evento di 2 ore?". */
  estendiEvento(idEvento: string, accetta: boolean): Observable<{ message: string; data_fine_calc: string; esteso: boolean }> {
    return this.http.post<{ message: string; data_fine_calc: string; esteso: boolean }>(
      `${this.urlBase}/api/eventi/${idEvento}/estendi`, { accetta }
    );
  }

  /** Il partecipante risponde al prompt "desideri rimanere all'evento?" dopo un'estensione. */
  rimaniEvento(idEvento: string, rimane: boolean): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.urlBase}/api/eventi/${idEvento}/rimani`, { rimane }
    );
  }

  /** Recupera il profilo completo dell'utente autenticato (dati, badge, archivio). */
  getProfilo(): Observable<ProfiloResponse> {
    return this.http.get<ProfiloResponse>(`${this.urlBase}/api/utente/profilo`);
  }

  /** Controlla la salute del backend e le tempistiche attive (sviluppo vs. produzione). */
  getConfigurazione(): Observable<{ status: string; ts: string; developmentDelayMinutes: number }> {
    return this.http.get<{ status: string; ts: string; developmentDelayMinutes: number }>(
      `${this.urlBase}/health`
    );
  }

  /** Avvia il flusso di recupero password inviando un OTP all'email specificata. */
  forgotPassword(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.urlBase}/api/auth/forgot-password`, { email }
    );
  }

  /** Verifica l'OTP di recupero e aggiorna la password dell'utente. */
  verifyResetOtp(email: string, otp: string, nuovaPassword: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.urlBase}/api/auth/verify-reset-otp`, { email, otp, nuova_password: nuovaPassword }
    );
  }

  /** Controlla se un'email è già registrata nel sistema (usato durante la registrazione). */
  checkEmail(email: string): Observable<{ exists: boolean }> {
    return this.http.post<{ exists: boolean }>(
      `${this.urlBase}/api/auth/check-email`, { email }
    );
  }

  /** Carica o aggiorna la foto profilo dell'utente autenticato. */
  uploadFotoProfilo(file: File | Blob): Observable<{ message: string; foto_profilo_url: string }> {
    const formData = new FormData();
    formData.append('foto', file, 'profilo.jpg');
    return this.http.post<{ message: string; foto_profilo_url: string }>(
      `${this.urlBase}/api/utente/foto-profilo`, formData
    );
  }

  /** Cambia la password dell'utente autenticato verificando prima quella attuale. */
  cambiaPassword(passwordAttuale: string, nuovaPassword: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.urlBase}/api/utente/password`, { password_attuale: passwordAttuale, nuova_password: nuovaPassword }
    );
  }

  /** Elimina definitivamente l'account dell'utente autenticato e tutti i suoi dati. */
  eliminaAccount(): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.urlBase}/api/utente/account`);
  }

  /** Registra il token di notifica push Firebase per l'utente autenticato. */
  registraPushToken(token: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.urlBase}/api/utente/push-token`, { token }
    );
  }
}
