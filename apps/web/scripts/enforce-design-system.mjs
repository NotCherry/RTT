#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "src");
const allowList = new Set(["components/ui/typography.tsx"]);

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(p)) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const stylePath = join(ROOT, "styles.css");
let failed = false;
function fail(msg) {
  console.error("✗ " + msg);
  failed = true;
}
function warn(msg) {
  console.warn("⚠ " + msg);
}

try {
  const styleTxt = readFileSync(stylePath, "utf8");
  if (
    /\bbg-\[#/.test(styleTxt) ||
    /\bborder-\[#/.test(styleTxt) ||
    /\btext-\[#/.test(styleTxt)
  ) {
    fail(
      `styles.css: arbitrary color bg-[# / border-[# / text-[# — use tokens`,
    );
  }
  if (
    /\btext-slate-/.test(styleTxt) ||
    /\btext-blue-/.test(styleTxt) ||
    /\bbg-slate-/.test(styleTxt)
  ) {
    fail(`styles.css: text-slate-*/text-blue-*/bg-slate-* — use tokens`);
  }
} catch {}

for (const f of files) {
  const rel = f.replace(ROOT + "/", "");
  const txt = readFileSync(f, "utf8");
  if (
    /\bbg-\[#/.test(txt) ||
    /\bborder-\[#/.test(txt) ||
    /\btext-\[#/.test(txt)
  ) {
    fail(
      `${rel}: arbitrary color bg-[# / border-[# / text-[# — add token to @theme and use bg-ink-*/text-text-*/border-line-* instead`,
    );
  }
  if (
    /\btext-slate-/.test(txt) ||
    /\bbg-slate-/.test(txt) ||
    /\btext-blue-/.test(txt) ||
    /\bbg-blue-/.test(txt)
  ) {
    if (!rel.includes("typography.tsx"))
      fail(
        `${rel}: text-slate-*/text-blue-*/bg-slate-* — use text-text-* / bg-ink-* / bg-accent-* tokens`,
      );
  }
  // Check for legacy ".button" utility token (exact token, not capture-button/icon-button)
  {
    const classAttr = /class(?:Name)?="([^"]*)"/g;
    let m;
    let hasLegacyButton = false;
    while ((m = classAttr.exec(txt)) !== null) {
      const tokens = m[1].split(/\s+/);
      if (tokens.includes("button")) {
        hasLegacyButton = true;
        break;
      }
    }
    if (hasLegacyButton) {
      fail(
        `${rel}: class="button" — use <Button> (asChild for <a>/<Link>) instead of legacy .button CSS`,
      );
    }
  }
  if (!allowList.has(rel) && /<h[1-3]\b/.test(txt)) {
    if (rel === "App.tsx") {
      warn(
        `${rel}: raw <h1>/<h2>/<h3> — legacy App.tsx, prefer H1/H2/H3 (warn)`,
      );
    } else {
      fail(
        `${rel}: raw <h1>/<h2>/<h3> — use H1/H2/H3 from @/components/ui/typography`,
      );
    }
  }
}

if (failed) {
  console.error("\nEnforcement FAILED — see docs/design-system.md");
  process.exit(1);
} else {
  console.log("✓ design-system enforcement passed");
}
