# Lavori in sospeso

Backlog tecnico di ECHO, raccolto durante la revisione di settembre 2026. Ogni voce
riporta **dove**, **perché** e **cosa è già stato misurato**, così da poter essere
ripresa a distanza di mesi senza rifare l'analisi.

Le voci sono ordinate per rapporto valore/rischio. Nessuna è bloccante per la
consegna: sono tutte migliorie di qualità, tranne dove indicato.

---

## 1 · Route input binding — configurato e mai usato

**Dove:** `ECHO-frontend/src/app/app.config.ts`, più le 6 pagine che leggono parametri.

`provideRouter(routes, withComponentInputBinding(), …)` è **attivo**, ma nessuna
pagina lo sfrutta: tutte leggono i parametri a mano.

```ts
// oggi, ripetuto in 6 pagine
this.id_evento = this.route.snapshot.paramMap.get('id_evento') ?? '';

// con la funzionalità già abilitata
@Input() id_evento = '';
```

**Perché conta.** `snapshot` fotografa il momento in cui il componente viene creato.
Se Angular riusa la stessa istanza per un parametro diverso — navigando da
`/galleria/A` a `/galleria/B` — il valore non si aggiorna e la pagina mostra
l'evento sbagliato. Con l'input binding l'aggiornamento è automatico.

**File coinvolti:** `analytics.page.ts`, `auth.page.ts`, `camera.page.ts`,
`gallery.page.ts`, `join-event.page.ts` (legge `route.snapshot.data['tab']`).

**Rischio:** medio. Tocca la navigazione, va provato su ogni rotta.

---

## 2 · `prewarmBackend()` — retry infinito

**Dove:** `ECHO-frontend/src/app/app.component.ts`

```ts
while (!ok) {
  try { await firstValueFrom(this.api.getConfigurazione()); ok = true; }
  catch { await new Promise(r => setTimeout(r, 8000)); }
}
```

Nessun tetto ai tentativi, nessun backoff, nessuna cancellazione in `ngOnDestroy`
(che non esiste). Su rete assente gira all'infinito consumando batteria.

**Misurato:** durante l'analisi della change detection, **8 task su 11** nella zona
Angular in 10 secondi erano richieste `XMLHttpRequest` di questo ciclo che
ritentava `/health` fallendo in CORS.

**Cosa serve:** massimo di tentativi, backoff esponenziale con tetto, e stop
quando il componente viene distrutto.

**Rischio:** basso, il codice è isolato.

---

## 3 · Migrazione a signals e `OnPush`

**Dove:** `event-state.service.ts` → `app-shell.component.ts` → `events.page.ts` →
`gallery.component.ts`, in quest'ordine.

Il passo 6a ha già rimosso l'impalcatura inerte (14 `markForCheck()` senza `OnPush`,
due ticker morti, il tick da 1 secondo spostato fuori dalla zona di Angular). La
migrazione vera resta da fare.

**Cosa resta:**

- `event-state.service` mantiene **quattro contenitori di stato** allineati a mano:
  `_events$`, `eventi$`, `_state$`, `_stateSig`. Il metodo `push()` deve chiamare
  sia `next()` sia `set()`, e `statiUguali()` esiste solo perché non c'è
  memoizzazione. Con un signal più un `computed`, `_state$` e `statiUguali`
  sparirebbero quasi del tutto.
- **Undici** fra metodi e getter vengono chiamati dai template, quindi ricalcolati
  a ogni ciclo: `eventiFiltrati`, `makePips`, `statoCopy`, `creatorStatoCopy`,
  `ctaLabel`, `bottomLabel`, `votingTimeLabel`, `TortaMetrics`, `pictogram`,
  `prizeLabel`, `photoUrl`. `eventiFiltrati` e `makePips` allocano un array nuovo
  ogni volta; `votingTimeLabel` chiama `Date.now()` dentro il ciclo.
- `app-shell` copia ancora un signal in una property dentro un `effect()`.

**Prerequisito per:** le API a signal di Angular 17 — `input()`, `viewChild()`,
`output()` — che oggi sono tutte in forma di decoratore (11 `@Input`, 5
`@ViewChild`, 1 `@Output`).

**Rischio:** il più alto del backlog. È l'unico intervento che cambia il
comportamento a runtime senza una verifica oggettiva equivalente al confronto del
bundle. Da fare un componente alla volta. Nota: `events` e `gallery` sono dietro il
guard di autenticazione e non sono verificabili nella preview del browser.

---

## 4 · Reactive Forms

**Dove:** `auth.page.ts`, `settings.page.ts`, `create-event.component.ts`.

Nel progetto **non esiste un solo `<form>`**. Conseguenze misurate:

| | |
|---:|---|
| **0** | `Validators` di Angular |
| **0** | `ReactiveFormsModule` |
| **12** | test regex sulla password scritti a mano, in 3 blocchi duplicati |
| — | `campiToccati` in `create-event` è un `touched` reimplementato |

`ngModel` fuori da un form è legittimo, ma ogni regola di validazione è imperativa
e ripetuta, e stati che i form reattivi danno gratis (`touched`, `dirty`, `valid`,
`errors`) sono ricostruiti a mano dove servono e assenti dove no.

**Attenzione — trappola già incontrata.** Combinare `[(ngModel)]` con un
`(ngModelChange)` che riscrive il modello ha prodotto un bug reale in
`join-event.page` (cifre valide perse durante la digitazione). Restano due casi
simili in `create-event.component.html`, sui campi durata: lì l'handler non
riscrive il modello, quindi non è un bug, ma dipende dall'ordine di esecuzione in
modo non esplicito. Sono candidati naturali a `computed()`.

---

## 5 · Countdown sviluppo in `camera.component`

**Dove:** `ECHO-frontend/src/app/components/camera/camera.component.ts`

Funzionalità implementata per tre quarti e mai collegata al template. Va
**completata o rimossa**: lo stato attuale è il peggiore dei tre.

Pezzi presenti, nessuno letto o chiamato da altro codice:

- `sviluppo_ended_at` — assegnato, mai letto
- `formatDelay(minutes)` — formatta "45 minuti" / "24 ore", mai chiamato
- `loadDevelopmentTarget()` — fa una **GET `/api/eventi/miei` completa a ogni
  apertura della fotocamera** per estrarre un campo che nessuno legge
- `developmentTicker` — chiama solo `markForCheck()`, inerte senza `OnPush`
- `@Input() eventoNome` — passato da `camera.page.ts`, mai usato

Indizi che era un countdown: la schermata di blocco dice «Ti invieremo una notifica
non appena l'album sarà pronto», frase statica dove serviva «Album pronto tra 23h
45m»; il `catch` commenta un «fallback di default a 24 ore» che non esiste; la
classe si chiama `.hud-event-name` ma mostra il conteggio degli scatti.

**Nota:** il file conserva anche le **7 `markForCheck()`** rimaste nel progetto,
che seguono la stessa decisione.

**Rischio:** il componente dipende dal layer nativo Capacitor e **non è
verificabile nella preview del browser**. La rete di sicurezza è il compilatore:
`strict` e `strictTemplates` sono attivi.

---

## 6 · Audit contrasto WCAG AA sull'intera palette

**Dove:** tutti gli `.scss` sotto `src/app`, più `theme/variables.scss`.

Durante la riorganizzazione dei token è emerso che **`--echo-surface-mid`
(#8C7B6E) non regge testo conforme in nessuna direzione**:

| Testo su `--echo-surface-mid` | Contrasto | AA (4.5:1) |
|---|---:|:---:|
| `--echo-on-dark` #F5EFE6 | 3,55:1 | ✗ |
| `--echo-on-light` #2A1A0E | 4,14:1 | ✗ |

Non è «abbiamo scelto il colore di testo sbagliato»: quel taupe sta a metà della
scala e nessun colore di testo lo salva. Lo usano come sfondo con testo sopra:
`.tab-pill` in `gallery.component.scss` e `.sub-section` in
`create-event.component.scss` — quest'ultima contiene `sub-heading`, tutte le
`field-label` e il testo digitato nelle `field-input`, cioè l'intero form di
creazione evento.

**Opzioni valutate:** scurire a #7A6A5E (4,54:1) o #756355 (5,00:1) — entrambi
**visibilmente** più scuri, la luminanza scende da 0,209 a 0,153/0,134 — oppure
smettere di usarlo dietro il testo, lasciandolo come riempimento decorativo
(bacheca trofei, skeleton, disco otturatore, pallini lingua), dove funziona bene.

La stessa verifica non è mai stata fatta sulle altre superfici.

---

## 7 · Focus trap nelle modali

**Dove:** `gallery.component.html` (dettaglio foto), `events.page.html` e
`analytics.page.html` (codice evento), `create-event.component.html` (successo).

Le tre modali hanno ora `role="dialog"`, `aria-modal`, `aria-labelledby` e chiusura
con `Esc`, ma **il focus può ancora uscire dal dialog** e non viene ripristinato
alla chiusura.

La strada pulita è migrare a `IonModal`, che gestisce focus trap, `Esc`, backdrop e
ARIA. Risolverebbe anche una duplicazione: le modali del codice evento in `events`
e `analytics` sono **quasi identiche** e vivono in due file.

---

## 8 · Backend mai revisionato

**Dove:** `ECHO-backend/`

Durante tutta la revisione sono stati letti solo `src/config.ts` e `src/cron/jobs.ts`,
e solo per ricavare i tempi del ciclo di vita degli eventi. Non sono stati guardati:
schema SQL, rotte, servizi, middleware di autenticazione, gestione degli upload.

È l'unica area valutata dalla scheda di trasparenza — *«progettazione del software e
della base di dati»* — su cui non esistono dati.

---

## 9 · Voci minori

**Bundle iniziale oltre budget.** 732 kB grezzi contro un budget di 500 kB
configurato in `angular.json`. A ~178 kB trasferiti non è urgente, ma il warning si
ripete a ogni build: o si alza la soglia a un valore realistico, o si indaga cosa ci
finisce dentro.

**`environment.ts` unico.** Un solo file con `production: true` fisso e nessun
`fileReplacements`: puntare a un backend locale richiede di modificare un file
tracciato in git. È il motivo per cui la preview di sviluppo sbatte contro CORS —
il backend di produzione accetta solo l'origine di produzione.

**Test.** `karma.conf.js` e `src/test.ts` sono configurati, ma esiste **un solo
spec** (`app.component.spec.ts`) su 42 file sorgente. Le funzioni a più alto
rapporto valore/costo sono pure e banali da coprire: `derive()` in
`event-state.service` (cinque rami di logica di business con priorità fra stati),
`remainingFromMs()` in `events.page`, la validazione password, `isoToMs` e
`localDatetimeToIsoUtc`.

**`tsconfig`.** Manca `noUncheckedIndexedAccess`, l'unico flag strict rilevante non
attivo. Catturerebbe accessi oggi sicuri solo per invariante implicita.

---

## Come è stato verificato ciò che è già stato fatto

Ogni intervento chiuso si è concluso con `npm run build --configuration production`
e `npm run lint`, più un giro nel browser dove la modifica era osservabile. Il
controllo più utile si è rivelato il confronto della dimensione del bundle:
all'estrazione di template e stili è risultato **identico al byte**, che è la prova
che 2.917 righe spostate non avevano cambiato nulla di ciò che arriva all'utente.

Due aree non sono verificabili nella preview: `camera.component`, che dipende dal
layer nativo Capacitor, e le pagine dietro il guard di autenticazione.
