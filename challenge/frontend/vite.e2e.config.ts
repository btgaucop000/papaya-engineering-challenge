import { defineConfig } from "vite";

export default defineConfig({
  root: "challenge/frontend",
  server: {
    host: "127.0.0.1",
    port: 4273,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:3100",
        changeOrigin: true,
      },
    },
  },
});
