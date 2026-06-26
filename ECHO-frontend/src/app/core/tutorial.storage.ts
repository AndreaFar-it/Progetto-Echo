/**
 * ECHO — flag del tutorial di primo avvio
 *
 * Persistito con @capacitor/preferences, che usa in modo trasparente le native
 * UserDefaults/SharedPreferences su dispositivo e ricade su localStorage sul web — così
 * la stessa chiamata funziona ovunque. Pilota l'onboarding una tantum: il tutorial a 3 slide
 * è mostrato solo quando questo flag è assente (primissimo avvio su un nuovo dispositivo), poi
 * mai più (vedi guardiaTutorial in core/guards/guards.ts).
 */

import { Preferences } from '@capacitor/preferences';

const KEY = 'hasSeenTutorial';

export async function hasSeenTutorial(): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key: KEY });
    return value === 'true';
  } catch {
    // Storage non disponibile — trattalo come "non visto" così il tutorial viene comunque
    // mostrato invece di essere saltato silenziosamente.
    return false;
  }
}

export async function markTutorialSeen(): Promise<void> {
  try {
    await Preferences.set({ key: KEY, value: 'true' });
  } catch { /* best-effort; nel caso peggiore il tutorial riappare al prossimo avvio */ }
}
