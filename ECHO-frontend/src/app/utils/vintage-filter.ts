const MAX_DIMENSION  = 1600;   // limita la dimensione di output per upload leggeri
const CONTRAST       = 1.18;  // >1 = più contrasto
const SATURATION     = 0.72;  // <1 = desaturato
const SEPIA_AMOUNT   = 0.28;  // 0..1 quantità di tinta calda
const GRAIN          = 16;    // rumore di picco per canale
const VIGNETTE_ALPHA = 0.45;  // intensità dello scuro agli angoli

/** Gradi per raddrizzare il fotogramma "di traverso" del sensore FRONTALE (selfie) */
const FRONT_ROTATION_DEG = 90;

/** Gradi per normalizzare in verticale il fotogramma EXIF-6 del sensore POSTERIORE. */
const REAR_ROTATION_DEG = 90;

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('IMAGE_DECODE_FAILED'));
    img.src = src;
  });
}

/**
 * Legge il tag EXIF di orientamento (0x0112) dai primi 64 KB di una stringa JPEG base64 grezza.
 * Ritorna 1 (verticale, nessuna trasformazione) se il tag è assente o illeggibile.
 */
function readExifOrientation(base64Jpeg: string): number {
  try {
    const bin = atob(base64Jpeg.slice(0, 65536));
    const len = bin.length;
    let i = 2; // salta lo SOI (FF D8)
    while (i < len - 4) {
      if (bin.charCodeAt(i) !== 0xFF) break;
      const marker = bin.charCodeAt(i + 1);
      const segLen = (bin.charCodeAt(i + 2) << 8) | bin.charCodeAt(i + 3);
      if (marker === 0xE1) { // APP1 — può contenere EXIF
        if (bin.slice(i + 4, i + 10) !== 'Exif\0\0') { i += 2 + segLen; continue; }
        const base = i + 10; // inizio dell'header TIFF
        const little = bin.charCodeAt(base) === 0x49; // 'I' = little-endian
        const r16 = (off: number) => little
          ? (bin.charCodeAt(off) | (bin.charCodeAt(off + 1) << 8))
          : ((bin.charCodeAt(off) << 8) | bin.charCodeAt(off + 1));
        const r32 = (off: number) => little
          ? (bin.charCodeAt(off)       | (bin.charCodeAt(off+1) << 8) |
             (bin.charCodeAt(off+2) << 16) | (bin.charCodeAt(off+3) << 24))
          : ((bin.charCodeAt(off) << 24) | (bin.charCodeAt(off+1) << 16) |
             (bin.charCodeAt(off+2) << 8) |  bin.charCodeAt(off+3));
        const ifdOff = r32(base + 4);
        const count  = r16(base + ifdOff);
        for (let e = 0; e < count; e++) {
          const entry = base + ifdOff + 2 + e * 12;
          if (r16(entry) === 0x0112) return r16(entry + 8); // valore del tag Orientation
        }
      }
      if (marker === 0xDA || marker === 0xD9) break; // SOS oppure EOI
      i += 2 + segLen;
    }
  } catch { /* ignora un EXIF malformato */ }
  return 1;
}

/**
 * @param base64Jpeg JPEG base64 grezzo così come restituito da
 *                   CameraPreview.capture().value.
 * @param facing     Quale obiettivo era attivo ('rear' | 'front').
 * @returns Un Blob JPEG filtrato pronto per l'upload.
 */
export async function applyVintageFilter(base64Jpeg: string, facing: 'rear' | 'front' = 'rear'): Promise<Blob> {
  const orientation = readExifOrientation(base64Jpeg);
  const dataUrl = `data:image/jpeg;base64,${base64Jpeg}`;

  // ── Decodifica i pixel grezzi, bypassando l'auto-rotazione EXIF del browser ───────────
  // createImageBitmap({ imageOrientation: 'none' }) ci dà i pixel esatti del sensore
  // indipendentemente dalla versione di Chrome/WebView.
  let source: ImageBitmap | null = null;
  let rawW = 0;
  let rawH = 0;
  let useFallback = false;

  try {
    const rawBlob = await fetch(dataUrl).then(r => r.blob());
    source = await createImageBitmap(rawBlob, { imageOrientation: 'none' } as ImageBitmapOptions);
    rawW = source.width;
    rawH = source.height;
  } catch {
    useFallback = true;
  }

  // Fallback: <img> — i WebView moderni potrebbero applicare l'EXIF automaticamente. Accettiamo
  // il risultato così com'è (nessuna seconda trasformazione EXIF) e aggiungiamo solo il ribaltamento
  // della fotocamera frontale.
  let fallbackImg: HTMLImageElement | null = null;
  if (useFallback) {
    fallbackImg = await loadImage(dataUrl);
    rawW = fallbackImg.naturalWidth || fallbackImg.width;
    rawH = fallbackImg.naturalHeight || fallbackImg.height;
  }

  // Gli orientamenti 5–8 hanno una componente di rotazione di 90°/270° che scambia W e H visive.
  const is90deg = !useFallback && orientation >= 5 && orientation <= 8;
  const visW = is90deg ? rawH : rawW;
  const visH = is90deg ? rawW : rawH;

  const longest = Math.max(visW, visH);
  const scale   = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;
  const width   = Math.round(visW * scale);
  const height  = Math.round(visH * scale);
  const sw      = Math.round(rawW * scale); // larghezza di disegno della sorgente grezza
  const sh      = Math.round(rawH * scale); // altezza di disegno della sorgente grezza

  const canvas = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('CANVAS_2D_UNAVAILABLE');

  // ── Applica la trasformazione di orientamento ──────────────────────────────────
  if (!useFallback && source) {
    ctx.save();
    // La trasformazione applicata via ctx.A(); ctx.B() significa CTM = A * B.
    // Per un punto di disegno P: canvas_pos = A(B(P)) = A applicato dopo B.
    // Trasformazioni verificate secondo la specifica EXIF:
    switch (orientation) {
      case 2: ctx.translate(width,  0     ); ctx.scale(-1,  1); break; // ribalta H
      case 3: ctx.translate(width,  height); ctx.scale(-1, -1); break; // 180°
      case 4: ctx.translate(0,      height); ctx.scale( 1, -1); break; // ribalta V
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;                  // trasposta
      case 6: ctx.translate(width,  0     ); ctx.rotate( Math.PI / 2); break; // 90° orari
      case 7: ctx.transform(0, -1, -1, 0, width, height); break;       // trasversa
      case 8: ctx.translate(0,      height); ctx.rotate(-Math.PI / 2); break; // 90° antiorari
      // Caso 1: identità — nessuna trasformazione necessaria
    }
    ctx.drawImage(source, 0, 0, sw, sh);
    ctx.restore();
  } else if (fallbackImg) {
    // Il browser ha già applicato l'EXIF via <img>; disegna alle dimensioni visive post-EXIF.
    ctx.drawImage(fallbackImg, 0, 0, width, height);
  }

  // Dimensioni di output effettive per il passaggio sui pixel + vignettatura sotto — aggiornate
  // se il passo di raddrizzamento ruota di 90° (da orizzontale a verticale).
  let outW = width;
  let outH = height;

  // ── Raddrizzamento dell'orientamento (per obiettivo) + specchio (solo frontale) ───────────
  // Entrambi gli obiettivi di questo dispositivo consegnano un fotogramma a forma orizzontale che
  // resta orizzontale dopo il passaggio EXIF sopra, quindi ciascuno richiede un raddrizzamento di
  // 90°
  const frontStraighten = facing === 'front' && !useFallback && orientation === 1 && rawW > rawH;
  const rearStraighten  = facing === 'rear'  && !useFallback && orientation === 6;
  const needsStraighten = frontStraighten || rearStraighten;

  // SPECCHIO — solo obiettivo frontale/selfie, per annullare lo specchio nativo sinistra↔destra del sensore.
  const mirror = facing === 'front';

  if (needsStraighten || mirror) {
    // Segno di rotazione per obiettivo; 0 quando stiamo solo specchiando (nessun raddrizzamento).
    const rotationDeg = !needsStraighten ? 0
      : (facing === 'front' ? FRONT_ROTATION_DEG : REAR_ROTATION_DEG);

    // Scambia le dimensioni del canvas solo quando ruotiamo davvero di 90° (orizzontale → verticale).
    const tmp = document.createElement('canvas');
    tmp.width  = needsStraighten ? height : width;
    tmp.height = needsStraighten ? width  : height;
    const tCtx = tmp.getContext('2d')!;

    // Ruota attorno al centro dell'immagine, poi ruota (se raddrizziamo) e/o specchia.
    tCtx.translate(tmp.width / 2, tmp.height / 2);
    if (needsStraighten) tCtx.rotate(rotationDeg * Math.PI / 180);
    if (mirror)          tCtx.scale(-1, 1);
    // Disegna spostato indietro di metà delle proprie dimensioni così il centro della sorgente cade sull'origine.
    tCtx.drawImage(canvas, -width / 2, -height / 2, width, height);

    // Ridimensiona il canvas PRINCIPALE alla forma (eventualmente scambiata) e riversa di nuovo.
    // Aggiornare outW/outH è essenziale — il passaggio sui pixel + vignettatura sotto leggono queste dimensioni.
    canvas.width  = tmp.width;
    canvas.height = tmp.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tmp, 0, 0);
    outW = canvas.width;
    outH = canvas.height;
  }

  // ── Manipolazione pixel per pixel ──────────────────────────────────────────────
  // Usa outW/outH (non width/height): il ramo di raddrizzamento frontale potrebbe aver
  // scambiato il canvas in verticale, quindi queste sono le dimensioni correnti reali.
  const imageData = ctx.getImageData(0, 0, outW, outH);
  const d = imageData.data;
  const intercept = 128 * (1 - CONTRAST);
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];

    // contrasto
    r = r * CONTRAST + intercept;
    g = g * CONTRAST + intercept;
    b = b * CONTRAST + intercept;

    // desatura verso la luminanza (luma)
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    r = luma + (r - luma) * SATURATION;
    g = luma + (g - luma) * SATURATION;
    b = luma + (b - luma) * SATURATION;

    // tinta seppia calda (matrice seppia classica, miscelata in base a SEPIA_AMOUNT)
    const sr = r * 0.393 + g * 0.769 + b * 0.189;
    const sg = r * 0.349 + g * 0.686 + b * 0.168;
    const sb = r * 0.272 + g * 0.534 + b * 0.131;
    r = r * (1 - SEPIA_AMOUNT) + sr * SEPIA_AMOUNT;
    g = g * (1 - SEPIA_AMOUNT) + sg * SEPIA_AMOUNT;
    b = b * (1 - SEPIA_AMOUNT) + sb * SEPIA_AMOUNT;

    // grana pellicola
    const noise = (Math.random() - 0.5) * GRAIN;
    d[i]     = clamp(r + noise);
    d[i + 1] = clamp(g + noise);
    d[i + 2] = clamp(b + noise);
    // alfa (d[i+3]) lasciato invariato
  }
  ctx.putImageData(imageData, 0, 0);

  // ── Morbida vignettatura scura ──────────────────────────────────────────────
  const grad = ctx.createRadialGradient(
    outW / 2, outH / 2, Math.min(outW, outH) * 0.30,
    outW / 2, outH / 2, Math.max(outW, outH) * 0.72,
  );
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(0,0,0,${VIGNETTE_ALPHA})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, outW, outH);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('CANVAS_TOBLOB_FAILED'))),
      'image/jpeg',
      0.9,
    );
  });
}
