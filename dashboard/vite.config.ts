import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  base: "./",
  build: {
    outDir: "../server/dist/dashboard",
    emptyOutDir: true,
  },
  server: {
    port: 7432,
    strictPort: true,
    host: true,
    allowedHosts: ["beepbotai"],
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3004",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:3004",
        ws: true,
      },
    },
  },
});
