import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  it('should create the app', async () => {
    // Configura l'ambiente di test per il componente
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])] 
    }).compileComponents();
    
    // Crea il contenitore di test per interagire col DOM e il componente
    const fixture = TestBed.createComponent(AppComponent);
    
    // Recupera l'istanza effettiva della classe AppComponent
    const app = fixture.componentInstance;
    
    expect(app).toBeTruthy();
  });
});