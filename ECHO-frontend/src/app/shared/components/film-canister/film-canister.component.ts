import {
  Component,
  Input
} from '@angular/core';
import { CommonModule } from '@angular/common';

// Crea il "rullino" nella sezione archivio del rullino
@Component({
  selector: 'app-film-canister',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="canister">
      <div class="cap"></div>
      <div class="body">
        <span class="label">{{ label }}</span>
      </div>
    </div>
  `,
  styles: [`
    .canister {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 56px;
      flex-shrink: 0;
    }
    .cap {
      width: 38px;
      height: 14px;
      border-radius: 6px 6px 0 0;
      background: var(--echo-ink, #2A1A0E);
    }
    .body {
      width: 56px;
      height: 122px;
      border-radius: 10px;
      background: var(--echo-rust, #B85C38);
      border: 1px solid var(--echo-ink, #2A1A0E);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 8px 4px;
      overflow: hidden;
    }
    .label {
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      font-family: var(--echo-font-mono);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      color: var(--echo-cream, #F5EFE6);
      text-align: center;
      max-height: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `],
})
export class ComponenteRullino {
  @Input() label = '';
}
