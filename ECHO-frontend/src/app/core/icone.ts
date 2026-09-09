// Registro delle icone Ionicons usate da ECHO. addIcons() riempie una mappa globale,
// quindi basta chiamarlo una volta all'avvio: i componenti importano solo IonIcon.
import { addIcons } from 'ionicons';
import {
  apertureOutline,
  arrowBackOutline,
  attachOutline,
  batteryHalfOutline,
  cameraOutline,
  cameraReverseOutline,
  filmOutline,
  flashOffOutline,
  flashOutline,
  imageOutline,
  person,
  personOutline,
  settingsOutline,
  ticketOutline,
  timeOutline,
} from 'ionicons/icons';

export function registraIcone(): void {
  addIcons({
    'aperture-outline': apertureOutline,        // rullino: auth e splash
    'arrow-back-outline': arrowBackOutline,       // torna alla griglia, dettaglio foto
    'attach-outline': attachOutline,              // graffetta sulla polaroid del vincitore
    'battery-half-outline': batteryHalfOutline,   // HUD della landing
    'camera-outline': cameraOutline,              // tab scatta, medaglia, voto in galleria
    'camera-reverse-outline': cameraReverseOutline, // inverti fotocamera
    'film-outline': filmOutline,                  // tab eventi
    'flash-outline': flashOutline,                // flash acceso
    'flash-off-outline': flashOffOutline,         // flash spento
    'image-outline': imageOutline,                // rullino vuoto
    'person': person,                             // partecipante presente, analytics
    'person-outline': personOutline,              // tab profilo
    'settings-outline': settingsOutline,          // ingranaggio impostazioni
    'ticket-outline': ticketOutline,              // tab partecipa/crea
    'time-outline': timeOutline,                  // attesa sviluppo
  });
}
