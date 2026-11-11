import { defineConfig } from 'vitest/config';

// Las pruebas de integración usan servicios reales (PostgreSQL, RustFS, worker): necesitan más margen que las unitarias.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
