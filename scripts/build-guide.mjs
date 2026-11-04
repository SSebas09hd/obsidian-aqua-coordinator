// Exporta la guía integrada (ui/guideContent.ts) a docs/GUIA.md para GitHub.
import { build } from "esbuild";
import { writeFileSync, mkdirSync } from "fs";

const out = await build({ entryPoints: ["ui/guideContent.ts"], bundle: true, write: false, format: "esm", platform: "node" });
const mod = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
const toc = mod.GUIDE_SECTIONS.map((s, i) => `${i + 1}. [${s.title}](#${s.id})`).join("\n");
const body = mod.GUIDE_SECTIONS.map((s) => `<a id="${s.id}"></a>\n## ${s.title}\n\n${s.md}\n`).join("\n");
mkdirSync("docs", { recursive: true });
writeFileSync(
  "docs/GUIA.md",
  `# Guía de uso · AquaPure\n\n> Esta guía también está dentro de Obsidian: botón **? Guía** del dashboard o comando *AquaPure: Abrir guía de uso*.\n\n${toc}\n\n${body}`
);
console.log("docs/GUIA.md generado");
