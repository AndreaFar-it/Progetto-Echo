import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent }  from './app/app.component';
import { appConfig }     from './app/app.config';
import { registraIcone } from './app/core/icone';

registraIcone();

bootstrapApplication(AppComponent, appConfig)
  .catch((errore: unknown) => console.error('[ECHO] Bootstrap failed:', errore));