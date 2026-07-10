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
import { CommonModule } from '@angular/common';
import {
  IonContent,
  IonRefresher,
  IonRefresherContent,
  ToastController
} from '@ionic/angular/standalone';
import type { RefresherCustomEvent } from '@ionic/angular/standalone';
import { Platform } from '@ionic/angular/common';
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
  imports: [CommonModule, IonContent, IonRefresher, IonRefresherContent, ComponenteCornicePolaroid, ComponenteEtichettaStato],
  template: `
    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="handleRefresh($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>
      <div class="shell">
        <button class="back-btn" (click)="router.navigate(['/eventi/miei'])">← Indietro</button>
        <h1 class="page-title">Report</h1>
        <div class="status-tag-row" *ngIf="data"><app-event-status-tag [stato]="data.stato"></app-event-status-tag></div>

        <div class="loading" *ngIf="caricamento"><p>Caricamento…</p></div>
        <div class="denied" *ngIf="!caricamento && accessDenied"><p>Solo l'organizzatore può vedere il report.</p></div>

        <div class="report-card" #reportCard *ngIf="!caricamento && !accessDenied && data">
          <p class="report-intro">Questo documento certifica la prospettiva autentica e senza filtri del tuo pubblico</p>

          <!-- ── Partecipanti — Torta ───────────────────────────── -->
          <div class="metric-row" *ngFor="let m of TortaMetrics">
            <svg viewBox="0 0 36 36" class="Torta">
              <path class="Torta-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              <path class="Torta-fill" [attr.stroke-dasharray]="m.percent + ', 100'"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              <text x="18" y="20" class="Torta-text">{{ m.percent }}%</text>
            </svg>
            <div class="metric-info">
              <span class="metric-label">{{ m.label }}</span>
              <span class="metric-value">{{ m.valueLabel }}</span>
            </div>
          </div>

          <!-- ── Voti Espressi — pictogram ──────────────────────── -->
          <div class="metric-row" *ngIf="pictogram">
            <div class="pictogram">
              <svg class="person" *ngFor="let filled of pictogram.icons" [class.filled]="filled" viewBox="0 0 24 24">
                <circle cx="12" cy="7" r="4" fill="currentColor"/>
                <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="currentColor"/>
              </svg>
            </div>
            <div class="metric-info">
              <span class="metric-label">Voti<br>Espressi</span>
              <span class="metric-value">{{ pictogram.valueLabel }}</span>
            </div>
          </div>

          <!-- ── Vincitori — solo una volta che l'evento è del tutto chiuso ───── -->
          <ng-container *ngIf="isFinal && ranking.length">
            <p class="winners-label">Vincitori</p>
            <div class="winners-row">
              <div class="winner" *ngFor="let e of ranking; let i = index">
                <app-polaroid-frame [rotationDeg]="[-6,4,-3][i % 3]">
                  <svg class="paperclip" viewBox="0 0 14 28"><path d="M4 4 v16 a3 3 0 0 0 6 0 V8" fill="none" stroke="#8C7B6E" stroke-width="2"/></svg>
                  <img [src]="photoUrl(e.url_originale)" [alt]="'Foto di ' + e.nome" loading="lazy" />
                </app-polaroid-frame>
                <span class="winner-name">{{ e.nome | uppercase }}</span>
              </div>
            </div>
          </ng-container>

          <div class="report-actions">
            <button class="echo-btn btn-light" (click)="codeModalOpen = true">Visualizza il codice</button>
            <button class="echo-btn btn-light" (click)="exportPdf()" [disabled]="esportazioneInCorso">
              {{ esportazioneInCorso ? 'Esportazione…' : 'Esporta in PDF' }}
            </button>
            <button class="echo-btn btn-light" (click)="router.navigate(['/eventi/miei'])">I tuoi eventi</button>
          </div>
        </div>
      </div>

      <!-- ── Codice evento modal ─────────────────────────────────── -->
      <div class="code-overlay" *ngIf="codeModalOpen" (click)="codeModalOpen = false">
        <div class="code-modal" (click)="$event.stopPropagation()">
          <p class="code-modal-title">Codice evento</p>
          <p class="code-modal-sub">Ecco il codice generato per l'evento:</p>
          <div class="code-boxes">
            <div class="code-box" *ngFor="let ch of (data?.codice ?? '').split('')">{{ ch }}</div>
          </div>
          <button class="echo-btn code-modal-close" (click)="codeModalOpen = false">Torna indietro</button>
        </div>
      </div>
    </ion-content>`,
  styles: [`
    ion-content{--background:var(--echo-bg)}
    .shell{padding:20px 16px 100px;max-width:520px;margin:0 auto}
    /* Desktop: allarga a una colonna centrata e immersiva, in linea con landing/dashboard. */
    @media (min-width:768px){ .shell{max-width:1180px} }
    .back-btn{font-size:12px;color:var(--echo-ink-soft);background:transparent;border:none;cursor:pointer;font-family:var(--echo-font-mono);padding:0;margin-bottom:8px}
    .page-title{font-family:var(--echo-font-serif);font-size:24px;font-weight:400;color:var(--echo-ink);text-align:center;margin:0 0 4px}
    .status-tag-row{display:flex;justify-content:center;margin:0 0 20px}

    .loading,.denied{padding:60px 24px;text-align:center;color:var(--echo-ink-soft);font-family:var(--echo-font-mono)}

    .report-card{background:var(--echo-surface-dark);border-radius:var(--echo-radius-lg);padding:24px 20px;color:var(--echo-cream)}
    .report-intro{font-family:var(--echo-font-mono);font-size:11px;color:rgba(245,239,230,0.7);text-align:center;line-height:1.6;margin:0 0 28px}

    .metric-row{display:flex;align-items:center;gap:18px;margin-bottom:32px}
    .Torta{width:80px;height:80px;flex-shrink:0}
    .Torta-bg{fill:none;stroke:rgba(245,239,230,0.2);stroke-width:2.6}
    .Torta-fill{fill:none;stroke:var(--echo-teal);stroke-width:2.6;stroke-linecap:round;transition:stroke-dasharray 400ms ease-out}
    .Torta-text{fill:var(--echo-cream);font-size:7px;font-family:var(--echo-font-mono);text-anchor:middle;dominant-baseline:middle}
    .metric-info{display:flex;flex-direction:column;gap:4px}
    .metric-label{font-family:var(--echo-font-mono);font-weight:700;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--echo-cream)}
    .metric-value{font-family:var(--echo-font-mono);font-size:12px;color:rgba(245,239,230,0.7)}

    .pictogram{width:80px;flex-shrink:0;display:flex;flex-wrap:wrap;gap:2px}
    .person{width:10px;height:10px;color:rgba(245,239,230,0.25)}
    .person.filled{color:var(--echo-teal)}

    .winners-label{font-family:var(--echo-font-mono);font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:rgba(245,239,230,0.7);text-align:center;margin:8px 0 18px}
    .winners-row{display:flex;justify-content:center;gap:18px;margin-bottom:28px;flex-wrap:wrap}
    .winner{display:flex;flex-direction:column;align-items:center;gap:8px;position:relative}
    .winner ::ng-deep .polaroid{width:90px}
    .paperclip{position:absolute;top:-10px;left:8px;width:12px;height:24px;z-index:2}
    .winner-name{font-family:var(--echo-font-mono);font-size:10px;letter-spacing:.06em;color:var(--echo-cream)}

    .report-actions{display:flex;flex-direction:column;gap:10px;margin-top:8px}
    .btn-light{background:var(--echo-cream);color:var(--echo-ink);box-shadow:none}

    /* ── Codice evento modal ── */
    .code-overlay{position:fixed;inset:0;z-index:200;background:rgba(42,26,14,.6);display:flex;align-items:center;justify-content:center;padding:24px}
    .code-modal{background:var(--echo-bg);border-radius:var(--echo-radius-lg);padding:28px 24px;max-width:340px;width:100%;text-align:center}
    .code-modal-title{font-family:var(--echo-font-mono);font-weight:700;font-size:15px;letter-spacing:.06em;text-transform:uppercase;color:var(--echo-ink);margin:0 0 10px}
    .code-modal-sub{font-family:var(--echo-font-mono);font-size:12px;color:var(--echo-ink-soft);margin:0 0 22px;line-height:1.5}
    .code-boxes{display:flex;gap:8px;justify-content:center;margin-bottom:24px}
    .code-box{width:42px;height:50px;border-radius:var(--echo-radius-sm);background:var(--echo-surface-dark);color:var(--echo-cream);display:flex;align-items:center;justify-content:center;font-family:var(--echo-font-mono);font-weight:700;font-size:20px}
    .code-modal-close{width:100%}
  `],
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
    private platform: Platform,
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
      doc.setTextColor(245, 239, 230);                     // testi header color --echo-cream
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
    if (this.platform.is('capacitor')) {
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
      url_originale: c.url_originale,
      punteggio_voti: c.punteggio_voti,
      badge: BADGES[i],
    }));
  }
}