import {
  Component,
  OnInit,
  OnDestroy,
  Input
} from '@angular/core';
import { UpperCasePipe, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonContent,
  IonIcon,
  IonRefresher,
  IonRefresherContent,
  ToastController
} from '@ionic/angular/standalone';
import type { RefresherCustomEvent } from '@ionic/angular/standalone';
import { ServizioPiattaforma } from '../../services/piattaforma.service';
import { ApiService } from '../../services/api.service';
import { environment } from '../../../environments/environment';
import {
  firstValueFrom,
  Subscription,
  interval
} from 'rxjs';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  Filesystem,
  Directory
} from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import {
  FotoGalleria,
  RankEntry
} from '../../models/index';
import {
  FilmBorderComponent,
  ComponenteMedaglia,
  MedalTipo
} from '../../components';
import {
  MS_PER_MINUTO,
  isoToMs
} from '../../core/time.util';
import { messaggioErrore } from '../../core/api-error';

const VOTING_TICKER_MS = 60_000;

// Funzione di utilità asincrona per convertire un oggetto Blob in una stringa codificata in Base64.
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // Callback scatenata quando la lettura viene completata: estrae il puro Base64 rimuovendo il prefisso del mime type.
    reader.onloadend = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(blob); //da blob a base64
  });
}

@Component({
  selector: 'app-gallery',
  standalone: true,
  imports: [UpperCasePipe, DatePipe, IonContent, IonRefresher, IonRefresherContent, FilmBorderComponent, ComponenteMedaglia, IonIcon],
  templateUrl: './gallery.component.html',
  styleUrl: './gallery.component.scss',
})
export class ComponenteGalleria implements OnInit, OnDestroy {
  @Input() id_evento!: string;
  @Input() eventoNome = '';

  foto: FotoGalleria[] = [];
  ha_votato = false;
  caricamento = true;
  errorMessage = '';
  selectedPhoto: FotoGalleria | null = null;
  isVoting = false;

  stato = '';
  ranking: RankEntry[] = [];

  downloadingZip = false;
  // Contatore che tiene traccia di quante foto sono state processate ed impacchettate nello ZIP.
  downloadProgress = 0;

  private voteEndAt: number | null = null;
  private votingTicker?: Subscription;
  activeTab: 'rullino' | 'classifica' = 'rullino';

  constructor(
    private api: ApiService,
    private toastCtrl: ToastController,
    private piattaforma: ServizioPiattaforma,
    private router: Router,
  ) { }

  // ciclo di vita invocato subito dopo l'inizializzazione del componente.
  ngOnInit() {
    this.loadGallery();
    this.votingTicker = interval(VOTING_TICKER_MS).subscribe(() => this.loadGallery());
  }

  ngOnDestroy() {
    this.votingTicker?.unsubscribe();
  }

  // Metodo associato all'evento "pull-to-refresh".
  async handleRefresh(event: RefresherCustomEvent) {
    await this.loadGallery();
    event.target.complete();
  }

  // Getter che costruisce e restituisce una stringa user-friendly del tipo "3h 45m" o "12m".
  get votingTimeLabel(): string {
    if (!this.voteEndAt) return '';
    const remainingMs = this.voteEndAt - Date.now();
    if (remainingMs <= 0) return '';
    const totalMin = Math.ceil(remainingMs / MS_PER_MINUTO);
    const ore = Math.floor(totalMin / 60);
    const minuti = totalMin % 60;
    return ore > 0 ? `${ore}h ${minuti}m` : `${minuti}m`;
  }

  // Metodo per far contattare al servizio API il backend.
  private async loadGallery() {
    try {
      const res = await firstValueFrom(this.api.getGalleria(this.id_evento));

      this.foto = res?.foto ?? [];
      this.ha_votato = res?.ha_votato ?? false;
      this.stato = res?.stato ?? '';

      this.voteEndAt = res.voting_end_at ? isoToMs(res.voting_end_at) : null;
      const BADGES: ('oro' | 'argento' | 'bronzo')[] = ['oro', 'argento', 'bronzo'];
      this.ranking = (res.classifica ?? []).slice(0, 3).map((c, i) => ({
        posizione: (i + 1) as 1 | 2 | 3,
        nome: c.nome, cognome: c.cognome, foto_profilo_url: c.foto_profilo_url,
        id_foto: c.id_foto, url_originale: c.url_originale, punteggio_voti: c.punteggio_voti,
        badge: BADGES[i],
      }));
    } catch (errore: unknown) {
      this.errorMessage = messaggioErrore(errore, 'Galleria non disponibile.');
    } finally {
      this.caricamento = false;
    }
  }

  // Apre la foto ingrandita quando un utente tocca un gradino del podio con la medaglia.
  openPodiumPhoto(entry: RankEntry) {
    const photo = this.foto.find(p => p.id_foto === entry.id_foto);
    if (photo) this.openDetail(photo);
  }

  photoUrl(path: string): string {
    return `${environment.apiUrl}${path}`;
  }

  prizeLabel(tipo: MedalTipo): string {
    return ({ oro: 'Oro', argento: 'Argento', bronzo: 'Bronzo' } as Record<MedalTipo, string>)[tipo];
  }

  // Torna a "I miei eventi".
  goBack(): void {
    this.router.navigate(['/events/mine']);
  }

  // Genera dinamicamente le scritte visibili in fondo alla schermata, in base a varianti logiche intrecciate.
  bottomLabel(): string {
    if (this.stato === 'chiusa') return 'Classifica Finale';
    return this.ha_votato ? 'Hai assegnato il tuo unico voto' : 'Assegna il tuo unico voto';
  }

  // Scarica ogni singola foto raggruppandole e creando localmente l'archivio ZIP.
  async downloadAlbum() {
    // Se c'è un download attivo non fa accavallare due ZIP
    if (this.downloadingZip || !this.foto.length) return;
    this.downloadingZip = true;
    this.downloadProgress = 0;

    const filename = `ECHO-${this.sanitizeFilename(this.eventoNome || 'Album')}.zip`;

    try {
      // Contenitore zip
      const zip = new JSZip();
      await Promise.all(this.foto.map(async (photo, i) => {
        const blob = await fetch(this.photoUrl(photo.url_originale)).then(r => r.blob());
        // Appende questo Blob fisicamente dentro allo ZIP
        zip.file(`${String(i + 1).padStart(4, '0')}-${photo.nome}-${photo.id_foto}.jpg`, blob); // prende l'array partendo da 1 e ordina le foto 
        this.downloadProgress++;
      }));
      // Fa elaborare un oggetto Blob dell'archivio in cui racchiude tutte le JPG compresse.
      const zipped = await zip.generateAsync({ type: 'blob' });

      if (this.piattaforma.isNativa) {
        await this.saveAndShareNative(zipped, filename);
      } else {
        saveAs(zipped, filename);
      }
    } catch {
      this.toast('Errore durante la preparazione dello ZIP. Riprova.', 'danger');
    } finally {
      this.downloadingZip = false;
    }
  }

  // Condivide lo zip nel sistema integrato (Whatsapp, AirDrop, etc.).
  private async saveAndShareNative(zipped: Blob, filename: string): Promise<void> {
    // Si deve tradurre dal tipo Blob JavaScript al tipo stringa testuale grezza base64 che i plugin Capacitor tollerano di base per interagire col FileSystem locale.
    const base64Data = await blobToBase64(zipped);
    // Tramite plugin Capacitor ordina al OS di memorizzare l'intera stringa in formato file dentro la cache del telefono (utile perché se ne sbarazzerà da solo non intasando la ROM).
    const result = await Filesystem.writeFile({ path: filename, data: base64Data, directory: Directory.Cache });
    try {
      // Innalza a video tramite le api native l'opzione "cosa vuoi farne del file che ha URI x".
      await Share.share({ url: result.uri, title: filename, dialogTitle: 'Salva o condividi l\'album' });
    } catch {
      /* Nel caso in cui si preme annulla */
    }
  }

  // Metodo che previene illegal file name exception del file zip.
  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9 _-]/g, '_').trim() || 'Album';
  }

  // Apre la foto
  openDetail(photo: FotoGalleria) { this.selectedPhoto = photo; }

  closeDetail() { this.selectedPhoto = null; }

  // Se non tocchiamo elementi della foto ingrandita, considera il tocco come chiusura
  chiusuraAlTocco(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('detail-overlay')) {
      this.closeDetail();
    }
  }

  // Gestisce la votazione
  async castVote(photo: FotoGalleria) {
    if (this.ha_votato || photo.is_own_photo || this.isVoting) return;
    this.isVoting = true;
    this.ha_votato = true;

    try {
      await firstValueFrom(
        this.api.votaFoto(photo.id_foto)
      );
      photo.user_has_voted_this = true;
      photo.punteggio_voti += 1;
      this.toast('Voto registrato', 'success');
    } catch (errore: unknown) {
      const msg = messaggioErrore(errore, 'Errore nel voto');
      this.toast(msg, 'danger');
    } finally {
      this.isVoting = false;
    }
  }

  private async toast(msg: string, color: 'success' | 'danger' = 'success') {
    const t = await this.toastCtrl.create({
      message: msg, duration: 2500, color, position: 'bottom',
    });
    t.present();
  }
}