import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API = `http://localhost:${process.env.API_PORT ?? 4321}`;

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@video": path.resolve(__dirname, "../video/src"),
      "@server": path.resolve(__dirname, "../server/src"),
    },
    dedupe: ["react", "react-dom", "remotion"]
  },
  server: {
    port: 5173,
    proxy: { "/api": { target: API, changeOrigin: true }, "/media": API, "/renders": API },
  },
});
