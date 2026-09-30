// Enforces the one-way package dependency rule (see CLAUDE.md):
//   domain ← sync ← views/ui ← web;  domain ← server/ai;  apps compose packages.
import { readFileSync, readdirSync, existsSync } from "node:fs";

const allowed = {
  "@seply/config": [],
  "@seply/domain": [],
  "@seply/ui": [],
  "@seply/sync": ["@seply/domain"],
  "@seply/views": ["@seply/domain", "@seply/sync"],
  "@seply/ai": ["@seply/domain"],
  "@seply/server": ["@seply/domain", "@seply/ai"],
  web: ["@seply/ui", "@seply/views", "@seply/sync", "@seply/domain"],
  "@seply/worker": ["@seply/server", "@seply/ai", "@seply/domain"],
  "@seply/server-node": ["@seply/server", "@seply/ai", "@seply/domain"],
};
let bad = 0;
for (const root of ["apps", "packages"]) {
  for (const dir of readdirSync(root)) {
    const file = `${root}/${dir}/package.json`;
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    const deps = Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith("@seply/"));
    const ok = allowed[pkg.name];
    if (!ok) {
      console.error(`${pkg.name}: not in the dependency rule; add it to scripts/check-deps.mjs`);
      bad++;
      continue;
    }
    for (const d of deps) if (!ok.includes(d)) (console.error(`${pkg.name} may not depend on ${d}`), bad++);
  }
}
if (bad) process.exit(1);
console.log("dependency rule ok");
