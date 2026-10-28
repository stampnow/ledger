import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" damit der Build auch unter GitHub Pages (Unterpfad) läuft
export default defineConfig({ plugins: [react()], base: "./" });
