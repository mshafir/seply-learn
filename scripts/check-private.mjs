// Fails if tracked files contain markers of private data (the repo is public).
import { execSync } from "node:child_process";
const markers = ["statins-chat", "gen-statins", "Me: 36", "LDL 143", "Sebasco", "rosuvastatin 5"];
const files = execSync("git ls-files -co --exclude-standard", { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !f.startsWith("scripts/check-private") && f !== ".gitignore" && !f.endsWith(".png"));
let bad = 0;
for (const f of files) {
  let text = "";
  try { text = execSync(`cat ${JSON.stringify(f)}`, { encoding: "utf8", maxBuffer: 64 << 20 }); } catch { continue; }
  for (const m of markers) if (text.includes(m)) (console.error(`${f}: contains "${m}"`), bad++);
}
if (bad) process.exit(1);
console.log("no private markers in tracked files");
