import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef
} from '@angular/core';
import {
  ActivatedRoute,
  Router
} from '@angular/router';
import { UpperCasePipe } from '@angular/common';
import {
  IonContent,
  IonRefresher,
  IonRefresherContent,
  ToastController
} from '@ionic/angular/standalone';
import type { RefresherCustomEvent } from '@ionic/angular/standalone';
import { ServizioPiattaforma } from '../../core/piattaforma.service';
import {
  interval,
  Subscription,
  switchMap,
  catchError,
  of,
  firstValueFrom
} from 'rxjs';
import { ApiService } from '../../services/api.service';
import { environment } from '../../../environments/environment';
import {
  AnalyticsData,
  RankEntry
} from '../../models/index';
import {
  ComponenteCornicePolaroid,
  ComponenteEtichettaStato
} from '../../shared/components';
import {
  Filesystem,
  Directory
} from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import jsPDF from 'jspdf';

interface ReportMetric { label: string; percent: number; valueLabel: string; }

// Cadenza del polling mentre l'evento è live (stato non finale).
const POLLING_MS = 20_000;

@Component({
  selector: 'app-analytics', standalone: true,
  imports: [UpperCasePipe, IonContent, IonRefresher, IonRefresherContent, ComponenteCornicePolaroid, ComponenteEtichettaStato],
  templateUrl: './analytics.page.html',
  styleUrl: './analytics.page.scss',
})
export class PaginaAnalisi implements OnInit, OnDestroy {
  data: AnalyticsData | null = null;
  ranking: RankEntry[] = [];
  eventoNome = '';
  caricamento = true;
  accessDenied = false;
  isLive = false;
  isFinal = false;
  codeModalOpen = false;
  // Impedisce doppi click sul bottone di export mentre la cattura è in corso
  esportazioneInCorso = false;
  private id_evento = '';
  private pollSub?: Subscription;

  // Riferimento alla card del report nel template: è l'elemento che viene "fotografato" per il PDF
  @ViewChild('reportCard') private reportCardRef?: ElementRef<HTMLElement>;

  constructor(
    private route: ActivatedRoute,
    public router: Router,
    private api: ApiService,
    private piattaforma: ServizioPiattaforma,
    private toastCtrl: ToastController,
  ) { }

  // Il flusso di avvio si legge come una sequenza di passi: leggi i parametri, carica i dati.
  ngOnInit() {
    // Estrae l'ID dall'URL corrente 
    this.id_evento = this.route.snapshot.paramMap.get('id') ?? '';
    // Tenta di recuperare il nome dell'evento dallo stato di navigazione della history, con fallback a stringa vuota
    this.eventoNome = ((history.state) as Record<string, unknown>)?.['eventoNome'] as string ?? '';
    this.load();
  }

  ngOnDestroy() {
    this.pollSub?.unsubscribe();
  }

  // Getter che costruisce l'array di metriche (Partecipanti e Scatti)
  get TortaMetrics(): ReportMetric[] {
    // Se i dati non sono ancora stati caricati, restituisce un array vuoto
    if (!this.data) return [];
    const iscritti = this.data.partecipanti.totale;
    const max = this.data.max_partecipanti;
    const scattiPossibili = iscritti * this.data.scatti_per_utente;
    const pct = (num: number, den: number) => den > 0 ? Math.min(100, Math.round((num / den) * 100)) : 0;

    return [
      { label: 'Partecipanti', percent: pct(iscritti, max), valueLabel: `${iscritti}/${max}` },
      // Metrica relativa agli scatti totali effettuati su quelli massimi possibili
      { label: 'Scatti Effettuati', percent: pct(this.data.foto.totale, scattiPossibili), valueLabel: `${this.data.foto.totale}/${scattiPossibili}` },
    ];
  }

  // Getter per calcolare i dati del pittogramma
  get pictogram(): { icons: boolean[]; valueLabel: string } | null {
    if (!this.data) return null;
    const iscritti = this.data.partecipanti.totale;
    const voti = this.data.voti.totale_voti;
    // Calcola quante delle 50 icone devono essere "piene", in base al rapporto voti/iscritti
    const filled = iscritti > 0 ? Math.round((voti / iscritti) * 50) : 0;
    return {
      // Genera un array di 50 booleani; true se l'indice è minore delle icone calcolate (filled), altrimenti false
      icons: Array.from({ length: 50 }, (_, i) => i < filled),
      valueLabel: `${voti}/${iscritti}`,
    };
  }

  photoUrl(path: string): string {
    return `${environment.apiUrl}${path}`;
  }

  // Esporta il report in PDF "fotografando" la card visibile a schermo (html2canvas)
  // e incorporando l'immagine in un A4: la pagina che l'utente vede E' il report.
  async exportPdf(): Promise<void> {
    const card = this.reportCardRef?.nativeElement;
    if (!this.data || !card || this.esportazioneInCorso) return;
    this.esportazioneInCorso = true;

    try {
      // Import dinamico: html2canvas pesa ~200 KB e serve solo qui
      const { default: html2canvas } = await import('html2canvas');

      // Cattura la card in un canvas: scale 2 per la nitidezza, useCORS per le foto dei
      // vincitori (servite dal backend); i bottoni-azione vengono esclusi dallo scatto.
      const canvas = await html2canvas(card, {
        scale: 2,
        useCORS: true,
        backgroundColor: null,
        ignoreElements: el => el.classList?.contains('report-actions'),
      });

      // Compone l'A4: banda header con logo/evento/data + screenshot centrato e adattato
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const pagW = doc.internal.pageSize.getWidth();
      const pagH = doc.internal.pageSize.getHeight();
      const dataOdierna = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });

      doc.setFillColor(184, 92, 56);                       // banda header color --echo-rust
      doc.rect(0, 0, pagW, 22, 'F');
      doc.setTextColor(245, 239, 230);                     // testi header color --echo-on-dark
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.text('ECHO', 14, 12);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text('The Persistence of the Moment', 14, 18);
      doc.text(this.eventoNome || 'Evento', pagW - 14, 12, { align: 'right' });
      doc.text(`Generato il ${dataOdierna}`, pagW - 14, 18, { align: 'right' });

      // Adatta lo screenshot alla pagina mantenendo le proporzioni (mai deformato, mai tagliato)
      const margine = 10;
      const topContenuto = 22 + margine;
      const scala = Math.min((pagW - margine * 2) / canvas.width, (pagH - topContenuto - margine) / canvas.height);
      const imgW = canvas.width * scala;
      const imgH = canvas.height * scala;
      // PNG per conservare la trasparenza degli angoli arrotondati della card
      doc.addImage(canvas.toDataURL('image/png'), 'PNG', (pagW - imgW) / 2, topContenuto, imgW, imgH);

      await this.salvaOCondividi(doc, `report-${this.sanitizeFilename(this.eventoNome || 'evento')}.pdf`);
    } catch {
      // Cattura fallita (es. canvas "tainted" da immagini cross-origin senza CORS) o scrittura file fallita
      const t = await this.toastCtrl.create({ message: "Errore durante l'esportazione del PDF.", duration: 2800, color: 'danger', position: 'bottom' });
      t.present();
    } finally {
      this.esportazioneInCorso = false;
    }
  }

  // Salva il PDF: su app nativa lo scrive in cache e apre la share sheet, sul web avvia il download
  private async salvaOCondividi(doc: jsPDF, filename: string): Promise<void> {
    if (this.piattaforma.isNativa) {
      // Estrae il Base64 del file PDF togliendo l'header URI generato da jsPDF
      const base64 = doc.output('datauristring').split(',')[1] ?? '';
      // Scrive il file nella directory temporanea (Cache) tramite Capacitor Filesystem
      const result = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
      try {
        // Apre la modale nativa di condivisione per salvarlo/esportarlo
        await Share.share({ url: result.uri, title: filename, dialogTitle: 'Salva o condividi il report' });
      } catch {
        // L'utente ha chiuso la share sheet volontariamente: nessuna azione necessaria
      }
    } else {
      // Sul web: download diretto del file
      doc.save(filename);
    }
  }

  // Funzione privata per normalizzare i nomi dei file stringa rimpiazzando qualsiasi cosa non sia alfanumerica
  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9 _-]/g, '_').trim() || 'evento';
  }

  // Chiude solo se il click cade sullo sfondo, non sul pannello.
  chiudiCodiceSuBackdrop(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('code-overlay')) {
      this.codeModalOpen = false;
    }
  }

  // Gestore per l'evento "Pull-to-refresh"
  async handleRefresh(event: RefresherCustomEvent) {
    await this.load();
    event.target.complete();
  }

  // Metodo privato responsabile di inizializzare e aggiornare tutti i dati prelevandoli da rete (API)
  private async load() {
    try {
      // Esegue la chiamata tramite il servizio api e attende (firstValueFrom) che il primo risultato sia ritornato per l'assegnazione a `data`
      this.data = await firstValueFrom(this.api.getAnalisi(this.id_evento));
      // Calcola e istanzia tutti gli stati ricavandoli dai dati ottenuti
      this.deriveState();

      if (this.isLive && !this.pollSub) {
        this.pollSub = interval(POLLING_MS).pipe(
          // SwitchMap intercetta il timer e ad ogni scatto scambia lo stream emettendo una nuova chiamata HTTP GET
          switchMap(() => this.api.getAnalisi(this.id_evento).pipe(catchError(() => of(null))))
        ).subscribe(data => {
          if (data) {
            this.data = data;
            this.deriveState();
            if (this.isFinal) {
              this.pollSub?.unsubscribe();
              this.isLive = false;
            }
          }
        });
      }
    } catch (errore: unknown) {
      if ((errore as { status?: number })?.status === 403)
        this.accessDenied = true;
    } finally {
      this.caricamento = false;
    }
  }

  // Metodo helper che converte i valori dello 'stato'
  private deriveState() {
    const stato = this.data?.stato ?? 'chiusa';
    this.isFinal = stato === 'chiusa';
    this.isLive = !this.isFinal && stato !== 'non_iniziata';

    const BADGES: ('oro' | 'argento' | 'bronzo')[] = ['oro', 'argento', 'bronzo'];

    this.ranking = (this.data?.classifica ?? []).slice(0, 3).map((c, i) => ({
      posizione: (i + 1) as 1 | 2 | 3,
      nome: c.nome,
      cognome: c.cognome,
      foto_profilo_url: c.foto_profilo_url,
      id_foto: c.id_foto,
      url_originale: c.url_originale,
      punteggio_voti: c.punteggio_voti,
      badge: BADGES[i],
    }));
  }
}