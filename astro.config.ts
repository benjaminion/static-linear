import { defineConfig } from "astro/config";
import { syncLinearSnapshot } from "./src/lib/linear/sync";

export default defineConfig({
  output: "static",
  integrations: [
    {
      name: "linear-build-sync",
      hooks: {
        "astro:build:start": async () => {
          if (process.env.LINEAR_SKIP_SYNC === "1") return;
          await syncLinearSnapshot();
        },
      },
    },
  ],
  vite: {
    build: {
      sourcemap: false,
    },
  },
});

