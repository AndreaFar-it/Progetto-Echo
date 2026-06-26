// Build per l'APK Android — punta al backend sempre attivo ospitato su Render,
// così l'app funziona su qualsiasi dispositivo/emulatore senza tunnel ADB o server locale.
export const environment = { production: true, apiUrl: 'https://echo-backend-wsl2.onrender.com' } as const;