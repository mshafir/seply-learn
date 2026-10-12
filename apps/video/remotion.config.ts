// Remotion CLI config (`pnpm --filter video studio`). scripts/render.mjs
// passes the same settings to the bundler and renderer itself.
import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";

Config.overrideWebpackConfig((config) => enableTailwind(config));
// MapLibre (the Map scene) needs WebGL.
Config.setChromiumOpenGlRenderer("angle");
