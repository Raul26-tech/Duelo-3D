import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
/** Same arena, independent build: no root .env, proxy or administrative sources. */
export default defineConfig({
    root: fileURLToPath(new URL('./', import.meta.url)),
    base: './',
    envDir: false,
    define: {
        'import.meta.env': {
            BASE_URL: './',
            MODE: 'production',
            DEV: false,
            PROD: true,
            SSR: false,
        },
    },
    build: {
        outDir: fileURLToPath(new URL('./homologation-dist/', import.meta.url)),
        emptyOutDir: true,
    },
});
