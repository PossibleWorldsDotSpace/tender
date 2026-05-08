import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  base: "/_ui/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  },
  server: {
    proxy: {
      "/_api": "http://127.0.0.1:3993",
      "/_preview": "http://127.0.0.1:3993",
      "/_tender": { target: "ws://127.0.0.1:3993", ws: true }
    }
  }
});
