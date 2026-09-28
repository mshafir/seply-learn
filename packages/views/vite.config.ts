// Dev harness only; the package itself ships as source.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "harness",
  plugins: [react()],
  server: { port: 5199, strictPort: true },
});
