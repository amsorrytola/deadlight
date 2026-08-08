import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from https://<user>.github.io/deadlight/ — override with BASE=/ for local
// or root-domain hosting.
export default defineConfig({
  base: process.env.BASE ?? "/deadlight/",
  plugins: [react()],
  build: { outDir: "dist" },
});
