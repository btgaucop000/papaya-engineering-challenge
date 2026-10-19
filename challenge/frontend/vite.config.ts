import { defineConfig } from "vite";

const apiProxy = {
  "/api": {
    target: "http://localhost:3000",
    changeOrigin: true,
  },
};

export default defineConfig({
  root: "challenge/frontend",
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    proxy: apiProxy,
  },
  build: {
    outDir: "../../dist/frontend",
    emptyOutDir: true,
  },
});
