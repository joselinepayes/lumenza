import { defineConfig } from '@playwright/test';

// E2E real: navegador Microsoft Edge instalado + API/web de PRUEBA en puertos aparte (4100/5174),
// misma PostgreSQL y Mailpit locales. NODE_ENV=test relaja los rate limits solo en este servidor.
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5174', channel: 'msedge', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'npm run dev -w @lumenza/api',
      cwd: '../..',
      url: 'http://localhost:4100/api/health',
      env: { NODE_ENV: 'test', API_PORT: '4100', WEB_ORIGIN: 'http://localhost:5174', PHOTO_QUEUE: 'process-photo-e2e' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // Worker real de procesamiento (Sharp) en cola aislada del worker de desarrollo; sin URL: se espera a que arranque
      command: 'npm run dev:worker -w @lumenza/api',
      cwd: '../..',
      wait: { stdout: /Worker de fotograf/ },
      env: { NODE_ENV: 'development', PHOTO_QUEUE: 'process-photo-e2e' },
      reuseExistingServer: false,
      timeout: 90_000,
    },
    {
      command: 'npm run dev -w @lumenza/web',
      cwd: '../..',
      url: 'http://localhost:5174',
      env: { VITE_PORT: '5174', API_URL: 'http://localhost:4100' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
