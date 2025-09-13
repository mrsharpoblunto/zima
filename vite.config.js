import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig(({ mode }) => {
  if (mode === "client") {
    return {
      root: resolve(__dirname, "src/client"),
      build: {
        outDir: resolve(__dirname, "dist/client"),
        emptyOutDir: true,
        rollupOptions: {
          input: {
            main: resolve(__dirname, "src/client/index.html"),
          },
        },
        assetsInlineLimit: 4096,
      },
      server: {
        proxy: {
          '/api/1': {
            target: 'http://localhost:3000',
            changeOrigin: true,
          },
        },
      },
    };
  }
  return {};
});
