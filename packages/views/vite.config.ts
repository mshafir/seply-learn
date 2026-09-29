// Dev harness only; the package itself ships as source. Tailwind is here
// because the harness plays the app's part and loads @umbel/ui's tokens
// (globals.css), which the canvas's --umbel-* variables point at.
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "harness",
  plugins: [react(), tailwindcss()],
  server: { port: 5199, strictPort: true },
});
