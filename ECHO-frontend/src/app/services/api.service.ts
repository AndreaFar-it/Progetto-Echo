import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  EventoCard,
  ConfermaCaricamento,
  AnalyticsData,
  ProfiloResponse,
  GalleriaResponse
} from '../models/index';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly urlBase = environment.apiUrl; //prende l'url del backend dall'environment

  constructor(private http: HttpClient) { }

  // Recupera tutti gli eventi dell'utente (come organizzatore o partecipante).
  getMieiEventi(): Observable<{ events: EventoCard[] }> {
    return this.http.get<{ events: EventoCard[] }>(`${this.urlBase}/api/events`);
  }

  // Definisce un metodo per creare un evento  
  creaEvento(parametri: {
    nome: string;
    luogo: string;
    data_inizio: string;
    durata_minuti: number;
    max_partecipanti: number;
    scatti_per_utente: number;
    durata_votazione_ore: number;
    dev_mode?: boolean;
  }): Observable<{ message: string; eventoId: string; codice: string; data_fine_calc: string; stato: string }> {
    return this.http.post<{ message: string; eventoId: string; codice: string; data_fine_calc: string; stato: string }>(
      `${this.urlBase}/api/events`, parametri
    );
  }

  // Definisce un metodo per partecipare ad un evento
  partecipaEvento(codice: string): Observable<{ message: string; evento: EventoCard }> {
    return this.http.post<{ message: string; evento: EventoCard }>(
      `${this.urlBase}/api/events/participation`, { codice }
    );
  }

  // Definisce un metodo per ottenere le statistiche di un evento
  getAnalisi(idEvento: string): Observable<AnalyticsData> {
    return this.http.get<AnalyticsData>(`${this.urlBase}/api/events/${idEvento}/analytics`);
  }

  // Definisce un metodo per caricare una foto
  uploadFoto(idEvento: string, blob: Blob): Observable<ConfermaCaricamento> {
    const formData = new FormData();
    // L'id evento ora sta nel path: multer lo legge da req.params, quindi non dipende piu'
    // dall'ordine con cui i campi compaiono nel multipart.
    formData.append('foto', blob, `echo_${Date.now()}.jpg`);// blob(Binary Large Object) ci permette di ottimizzare upload attraverso il multer nel backend
    return this.http.post<ConfermaCaricamento>(`${this.urlBase}/api/events/${idEvento}/photos`, formData);
  }

  // Definisce un metodo per votare una foto
  votaFoto(idFoto: string): Observable<{ message: string; voto_espresso: boolean }> {
    return this.http.post<{ message: string; voto_espresso: boolean }>(
      `${this.urlBase}/api/photos/${idFoto}/vote`, {}
    );
  }

  // Definisce un metodo per ottenere la galleria di un evento
  getGalleria(idEvento: string): Observable<GalleriaResponse> {
    return this.http.get<GalleriaResponse>(`${this.urlBase}/api/events/${idEvento}/photos`);
  }

  // Definisce un metodo per eliminare un evento
  deleteEvento(idEvento: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.urlBase}/api/events/${idEvento}`);
  }

  // Definisce un metodo per rispondere alla richiesta di estensione evento
  estendiEvento(idEvento: string, accetta: boolean): Observable<{ message: string; data_fine_calc: string; esteso: boolean }> {
    return this.http.post<{ message: string; data_fine_calc: string; esteso: boolean }>(
      `${this.urlBase}/api/events/${idEvento}/extension`, { accetta }
    );
  }

  // Definisce un metodo per accettare la permanenza ad un evento esteso
  rimaniEvento(idEvento: string, rimane: boolean): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.urlBase}/api/events/${idEvento}/attendance`, { rimane }
    );
  }

  // Definisce un metodo per ottenere i dati del profilo di un utente
  getProfilo(): Observable<ProfiloResponse> {
    return this.http.get<ProfiloResponse>(`${this.urlBase}/api/me`);
  }

  // Fa in modo che di tenere l'app accessa per ovviare al plan free di render
  getConfigurazione(): Observable<{ status: string; ts: string; developmentDelayMinutes: number }> {
    return this.http.get<{ status: string; ts: string; developmentDelayMinutes: number }>(
      `${this.urlBase}/health`
    );
  }

  // Avvia il flusso di recupero password inviando un OTP alla console
  forgotPassword(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.urlBase}/api/auth/password-reset`, { email }
    );
  }

  //Definisce un metodo per verificare l'OTP di recupero e aggiorna la password dell'utente.
  verifyResetOtp(email: string, otp: string, nuovaPassword: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.urlBase}/api/auth/password-reset/confirm`, { email, otp, nuova_password: nuovaPassword }
    );
  }

  //Controlla se un'email è già registrata nel sistema (usato durante la registrazione).
  checkEmail(email: string): Observable<{ exists: boolean }> {
    return this.http.post<{ exists: boolean }>(
      `${this.urlBase}/api/auth/email-check`, { email }
    );
  }

  // Carica o aggiorna la foto profilo dell'utente autenticato.
  uploadFotoProfilo(file: File | Blob): Observable<{ message: string; foto_profilo_url: string }> {
    const formData = new FormData();
    formData.append('foto', file, 'profilo.jpg');
    return this.http.put<{ message: string; foto_profilo_url: string }>(
      `${this.urlBase}/api/me/photo`, formData
    );
  }

  // Cambia la password dell'utente autenticato verificando prima quella attuale.
  cambiaPassword(passwordAttuale: string, nuovaPassword: string): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(
      `${this.urlBase}/api/me/password`, { password_attuale: passwordAttuale, nuova_password: nuovaPassword }
    );
  }

  // Elimina definitivamente l'account dell'utente autenticato e tutti i suoi dati.
  eliminaAccount(): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.urlBase}/api/me`);
  }

  // Registra il token di notifica push Firebase per l'utente autenticato.
  registraPushToken(token: string): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(
      `${this.urlBase}/api/me/push-token`, { token }
    );
  }
}
