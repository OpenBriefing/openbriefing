import { defineConfig } from "astro/config";

// Static, for GitHub Pages. `format: "file"` writes ns.html and spec/v1.html,
// which Pages serves at /ns and /spec/v1 with no trailing-slash redirect, so
// the namespace URL stays exactly https://openbriefingstandard.org/ns.
export default defineConfig({
  site: "https://openbriefingstandard.org",
  output: "static",
  trailingSlash: "never",
  build: { format: "file" },
  // The checker and the builder bundle the reference parser from the package
  // beside the site; its one dependency resolves from this folder.
  vite: { server: { fs: { allow: [".."] } }, resolve: { dedupe: ["yaml"] } },
});
