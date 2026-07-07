// Memorizziamo piccole informazioni su localStorage, in modo tale da capire se l'utente 
// ha o meno visto la onBoarding
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
