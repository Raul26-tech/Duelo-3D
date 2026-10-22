import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
    root: fileURLToPath(new URL('./admin/', import.meta.url)),
    base: '/admin/',
    envDir: false,
    build: {
        outDir: fileURLToPath(new URL('./admin-dist/', import.meta.url)),
        emptyOutDir: true,
        rollupOptions: {
            input: {
                index: fileURLToPath(
                    new URL('./admin/index.html', import.meta.url),
                ),
                login: fileURLToPath(
                    new URL('./admin/login.html', import.meta.url),
                ),
            },
        },
    },
});
