import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  envPrefix: ['VITE_', 'PUBLIC_SYNVOX_'],
  plugins: [sveltekit()],
});
