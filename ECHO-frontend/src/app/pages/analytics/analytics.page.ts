import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonContent, IonRefresher, IonRefresherContent, ToastController } from '@ionic/angular/standalone';
import type { RefresherCustomEvent } from '@ionic/angular/standalone';
import { Platform } from '@ionic/angular/common';
import { interval, Subscription, switchMap, catchError, of, firstValueFrom } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { environment } from '../../../environments/environment';
import { AnalyticsData, RankEntry } from '../../models/index';
import { ComponenteCornicePolaroid, ComponenteEtichettaStato } from '../../shared/components';
import { Filesystem, Directory } from '@capacitor/filesystem';
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

        <div class="report-card" *ngIf="!caricamento && !accessDenied && data">
          <p class="report-intro">Questo documento certifica la prospettiva autentica e senza filtri del tuo pubblico</p>

          <!-- ── Partecipanti — gauge ───────────────────────────── -->
          <div class="metric-row" *ngFor="let m of gaugeMetrics">
            <svg viewBox="0 0 36 36" class="gauge">
              <path class="gauge-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              <path class="gauge-fill" [attr.stroke-dasharray]="m.percent + ', 100'"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              <text x="18" y="20" class="gauge-text">{{ m.percent }}%</text>
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
            <button class="echo-btn btn-light" (click)="exportPdf()">Esporta in PDF</button>
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
    .gauge{width:80px;height:80px;flex-shrink:0}
    .gauge-bg{fill:none;stroke:rgba(245,239,230,0.2);stroke-width:2.6}
    .gauge-fill{fill:none;stroke:var(--echo-teal);stroke-width:2.6;stroke-linecap:round;transition:stroke-dasharray 400ms ease-out}
    .gauge-text{fill:var(--echo-cream);font-size:7px;font-family:var(--echo-font-mono);text-anchor:middle;dominant-baseline:middle}
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
  caricamento = true; accessDenied = false; isLive = false; isFinal = false;
  codeModalOpen = false;
  private id_evento = '';
  private pollSub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    public router: Router,
    private api: ApiService,
    private platform: Platform,
    private toastCtrl: ToastController,
  ) {}

  ngOnInit() {
    this.id_evento  = this.route.snapshot.paramMap.get('id') ?? '';
    this.eventoNome = ((history.state) as Record<string, unknown>)?.['eventoNome'] as string ?? '';
    this.load();
  }
  ngOnDestroy() { this.pollSub?.unsubscribe(); }

  /** Partecipanti + Scatti Effettuati — i due indicatori circolari. Voti Espressi è
   *  renderizzato separatamente come pittogramma (vedi getter `pictogram`), non come gauge. */
  get gaugeMetrics(): ReportMetric[] {
    if (!this.data) return [];
    const iscritti   = this.data.partecipanti.totale;
    const max        = this.data.max_partecipanti;
    const scattiPoss = iscritti * this.data.scatti_per_utente;
    const pct = (num: number, den: number) => den > 0 ? Math.min(100, Math.round((num / den) * 100)) : 0;
    return [
      { label: 'Partecipanti',      percent: pct(iscritti, max),                    valueLabel: `${iscritti}/${max}` },
      { label: 'Scatti Effettuati', percent: pct(this.data.foto.totale, scattiPoss), valueLabel: `${this.data.foto.totale}/${scattiPoss}` },
    ];
  }

  /** Griglia fissa di 50 icone che rappresenta il rapporto di voti espressi — un pittogramma
   *  letterale a 1 icona per partecipante sarebbe illimitato (gli eventi possono avere fino a 500 partecipanti). */
  get pictogram(): { icons: boolean[]; valueLabel: string } | null {
    if (!this.data) return null;
    const iscritti = this.data.partecipanti.totale;
    const voti = this.data.voti.totale_voti;
    const filled = iscritti > 0 ? Math.round((voti / iscritti) * 50) : 0;
    return {
      icons: Array.from({ length: 50 }, (_, i) => i < filled),
      valueLabel: `${voti}/${iscritti}`,
    };
  }

  photoUrl(path: string): string {
    return `${environment.apiUrl}${path}`;
  }

  async exportPdf(): Promise<void> {
    if (!this.data) return;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();

    // ── Palette — valori esatti da variables.scss ─────────────────────────────
    const RUST   : [number,number,number] = [184,  92,  56];  // --echo-rust
    const INK    : [number,number,number] = [ 42,  26,  14];  // --echo-ink
    const SURFACE: [number,number,number] = [ 59,  35,  20];  // --echo-surface-dark
    const CREAM  : [number,number,number] = [245, 239, 230];  // --echo-cream
    const TEAL   : [number,number,number] = [ 91, 168, 160];  // --echo-teal
    const RING_BG: [number,number,number] = [ 90,  62,  40];  // cream 20% on surface
    const CREAM70: [number,number,number] = [200, 194, 186];  // cream a 70% su scuro
    const GOLD   : [number,number,number] = [212, 175,  55];  // --echo-medal-gold
    const SILVER : [number,number,number] = [168, 169, 173];  // --echo-medal-silver
    const BRONZE : [number,number,number] = [205, 127,  50];  // --echo-medal-bronze

    const now = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });

    // ── Header band (rust) ───────────────────────────────────────────────────
    doc.setFillColor(...RUST);
    doc.rect(0, 0, W, 26, 'F');

    doc.setTextColor(...CREAM);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('ECHO', 14, 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('The Persistence of the Moment', 14, 20);

    doc.setFontSize(9);
    doc.text(this.eventoNome || 'Evento', W - 14, 13, { align: 'right' });
    doc.setFontSize(8);
    doc.text(now, W - 14, 20, { align: 'right' });

    // ── Dark card (replica visiva del .report-card) ──────────────────────────
    const cardX = 10, cardY = 30, cardW = W - 20, cardH = H - 42;
    doc.setFillColor(...SURFACE);
    doc.roundedRect(cardX, cardY, cardW, cardH, 4, 4, 'F');

    let y = cardY + 14;

    // Titolo "Report"
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(...CREAM);
    doc.text('Report', W / 2, y, { align: 'center' });
    y += 8;

    // Status chip — stessi colori delle classi .echo-stato-*
    const statoConfig: Record<string, { bg: [number,number,number]; text: [number,number,number]; label: string }> = {
      'non_iniziata': { bg: [220,228,237], text: [47,69,102],  label: 'NON INIZIATA' },
      'in_corso':     { bg: [227,238,221], text: [47,107,54],  label: 'IN CORSO' },
      'sviluppo':     { bg: [246,232,201], text: [122,84,25],  label: 'IN SVILUPPO' },
      'album_aperto': { bg: [243,220,210], text: [138,63,35],  label: 'VOTAZIONI APERTE' },
      'chiusa':       { bg: [227,215,192], text: [107,87,68],  label: 'CONCLUSO' },
    };
    const sc = statoConfig[this.data.stato] ?? { bg: RING_BG, text: CREAM, label: this.data.stato.toUpperCase() };
    doc.setFontSize(7);
    const chipW = doc.getTextWidth(sc.label) + 10;
    doc.setFillColor(...sc.bg);
    doc.roundedRect((W - chipW) / 2, y - 3.5, chipW, 6, 3, 3, 'F');
    doc.setTextColor(...sc.text);
    doc.text(sc.label, W / 2, y, { align: 'center' });
    y += 11;

    // Intro (replica .report-intro)
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...CREAM70);
    doc.text(
      'Questo documento certifica la prospettiva autentica e senza filtri del tuo pubblico.',
      W / 2, y, { align: 'center', maxWidth: cardW - 24 }
    );
    y += 15;

    // ── Gauge circolari (replica .gauge SVG) ─────────────────────────────────
    const gauges = this.gaugeMetrics;
    const GAUGE_R = 16, STROKE = 2.8;
    const g1x = W / 2 - 36, g2x = W / 2 + 36;
    const gCY = y + GAUGE_R;

    for (let i = 0; i < Math.min(gauges.length, 2); i++) {
      const g = gauges[i];
      const cx = i === 0 ? g1x : g2x;

      this.pdfArcRing(doc, cx, gCY, GAUGE_R, 0, 360, STROKE, RING_BG);
      if (g.percent > 0)
        this.pdfArcRing(doc, cx, gCY, GAUGE_R, -90, -90 + (g.percent / 100) * 360, STROKE, TEAL);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...CREAM);
      doc.text(`${g.percent}%`, cx, gCY + 1.5, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6);
      doc.setTextColor(...CREAM70);
      doc.text(g.valueLabel, cx, gCY + 6, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...CREAM);
      doc.text(g.label.toUpperCase(), cx, gCY + GAUGE_R + 6, { align: 'center' });
    }

    y = gCY + GAUGE_R + 15;

    // Divider
    doc.setDrawColor(...RING_BG);
    doc.setLineWidth(0.3);
    doc.line(cardX + 16, y, cardX + cardW - 16, y);
    y += 8;

    // ── Pictogram voti (replica .pictogram — griglia 10×5 = 50 icone) ────────
    if (this.pictogram) {
      const pic = this.pictogram;
      const COLS = 10, ROWS = 5, DOT_R = 1.0, STEP = 3.2;
      const startX = W / 2 - (COLS * STEP) / 2 + STEP / 2;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...CREAM);
      doc.text('VOTI ESPRESSI', W / 2, y, { align: 'center' });
      y += 6;

      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const cx2 = startX + col * STEP;
          const cy2 = y + row * STEP;
          if (pic.icons[row * COLS + col]) {
            doc.setFillColor(...TEAL);
            doc.circle(cx2, cy2, DOT_R, 'F');
          } else {
            doc.setDrawColor(...RING_BG);
            doc.setLineWidth(0.3);
            doc.circle(cx2, cy2, DOT_R, 'S');
          }
        }
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...CREAM70);
      doc.text(pic.valueLabel, W / 2, y + ROWS * STEP + 5, { align: 'center' });
      y += ROWS * STEP + 13;
    }

    // ── Vincitori (solo stato chiusa) ─────────────────────────────────────────
    if (this.isFinal && this.ranking.length) {
      doc.setDrawColor(...RING_BG);
      doc.setLineWidth(0.3);
      doc.line(cardX + 16, y, cardX + cardW - 16, y);
      y += 8;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...CREAM);
      doc.text('VINCITORI', W / 2, y, { align: 'center' });
      y += 9;

      const medalColors: [number,number,number][] = [GOLD, SILVER, BRONZE];
      const BADGE_LABELS: Record<string, string> = { oro: 'ECHO Oro', argento: 'ECHO Argento', bronzo: 'ECHO Bronzo' };

      for (const [i, e] of this.ranking.entries()) {
        doc.setFillColor(...medalColors[i]);
        doc.circle(cardX + 22, y, 4, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...INK);
        doc.text(String(e.posizione), cardX + 22, y + 1.5, { align: 'center' });

        doc.setTextColor(...CREAM);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(`${e.nome} ${e.cognome}`, cardX + 32, y + 1);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...CREAM70);
        doc.text(`${BADGE_LABELS[e.badge] ?? e.badge}  ·  ${e.punteggio_voti} ${e.punteggio_voti === 1 ? 'voto' : 'voti'}`, cardX + 32, y + 7);

        y += 17;
      }
    }

    // ── Footer ───────────────────────────────────────────────────────────────
    doc.setFillColor(...INK);
    doc.rect(0, H - 12, W, 12, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...CREAM);
    doc.text('ECHO — The Persistence of the Moment', 14, H - 4);
    doc.text(`Generato il ${now}`, W - 14, H - 4, { align: 'right' });

    // ── Save / share ─────────────────────────────────────────────────────────
    const filename = `report-${this.sanitizeFilename(this.eventoNome || 'evento')}.pdf`;
    if (this.platform.is('capacitor')) {
      try {
        const base64 = doc.output('datauristring').split(',')[1] ?? '';
        const result = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
        try {
          await Share.share({ url: result.uri, title: filename, dialogTitle: 'Salva o condividi il report' });
        } catch { /* user dismissed */ }
      } catch {
        const t = await this.toastCtrl.create({ message: "Errore durante l'esportazione del PDF.", duration: 2800, color: 'danger', position: 'bottom' });
        t.present();
      }
    } else {
      doc.save(filename);
    }
  }

  /** Disegna un arco circolare in jsPDF approssimandolo con segmenti di linea.
   *  startDeg/endDeg in gradi; 0° = destra, angoli in senso orario (coord schermo). */
  private pdfArcRing(
    doc: jsPDF,
    cx: number, cy: number, r: number,
    startDeg: number, endDeg: number,
    lineW: number,
    color: [number,number,number],
  ): void {
    const STEPS = 64;
    const a0 = (startDeg * Math.PI) / 180;
    const a1 = (endDeg   * Math.PI) / 180;
    const range = a1 - a0;
    doc.setDrawColor(...color);
    doc.setLineWidth(lineW);
    for (let i = 0; i < STEPS; i++) {
      const ta = a0 + range * i / STEPS;
      const tb = a0 + range * (i + 1) / STEPS;
      doc.line(cx + r * Math.cos(ta), cy + r * Math.sin(ta),
               cx + r * Math.cos(tb), cy + r * Math.sin(tb));
    }
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9 _-]/g, '_').trim() || 'evento';
  }

  /** Handler del pull-to-refresh — rifà il fetch e segnala al refresher di fermare lo spinner. */
  async handleRefresh(event: RefresherCustomEvent) {
    await this.load();
    event.target.complete();
  }

  private async load() {
    try {
      this.data = await firstValueFrom(this.api.getAnalisi(this.id_evento));
      this.deriveState();
      if (this.isLive && !this.pollSub) {
        this.pollSub = interval(POLLING_MS).pipe(
          switchMap(() => this.api.getAnalisi(this.id_evento).pipe(catchError(() => of(null))))
        ).subscribe(d => { if (d) { this.data = d; this.deriveState(); if (this.isFinal) { this.pollSub?.unsubscribe(); this.isLive = false; } } });
      }
    } catch (errore: unknown) {
      if ((errore as { status?: number })?.status === 403) this.accessDenied = true;
    } finally { this.caricamento = false; }
  }

  /** stato arriva direttamente dalla risposta analytics di questo evento — non da un'euristica
   *  globale "evento attualmente attivo", che potrebbe puntare a un evento del tutto diverso. */
  private deriveState() {
    const stato  = this.data?.stato ?? 'chiusa';
    this.isFinal = stato === 'chiusa';
    this.isLive  = !this.isFinal && stato !== 'non_iniziata';
    const BADGES: ('oro' | 'argento' | 'bronzo')[] = ['oro', 'argento', 'bronzo'];
    this.ranking = (this.data?.classifica ?? []).slice(0, 3).map((c, i) => ({
      posizione: (i + 1) as 1 | 2 | 3,
      nome: c.nome, cognome: c.cognome, foto_profilo_url: c.foto_profilo_url,
      url_originale: c.url_originale, punteggio_voti: c.punteggio_voti, badge: BADGES[i],
    }));
  }
}
