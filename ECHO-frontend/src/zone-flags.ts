/*
 * Flag letti da Zone.js all'avvio. Vanno impostati su `window` PRIMA che zone.js
 * venga caricato: per questo polyfills.ts fa `import './zone-flags'` sulla riga
 * precedente a `import 'zone.js'`. L'ordine dei due import non va invertito.
 */

declare global {
  interface Window {
    /** Disattiva il patching dei Custom Elements da parte di Zone.js. */
    __Zone_disable_customElements?: boolean;
  }
}

window.__Zone_disable_customElements = true;

export {};
