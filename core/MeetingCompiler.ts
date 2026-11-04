import { App, TFile, normalizePath } from "obsidian";
import type { AquaPureSettings, MeetingRecord } from "./types";
import { isoDate, normalize } from "./utils";
import type { VaultIndex } from "./VaultIndex";

interface ParsedMeeting {
	rec: MeetingRecord;
	linkText: string;
	decisions: string[];
	openActions: Array<{ text: string; owners: string[]; due: string | null }>;
}

/**
 * Compila todas las actas en un único "Registro de reuniones":
 * índice cronológico, registro de decisiones y acciones abiertas por responsable.
 * Lee las actas (cachedRead) y escribe solo su propio archivo de salida.
 */
export class MeetingCompiler {
	private lastContent = "";
	private running = false;

	constructor(private readonly app: App, private readonly index: VaultIndex, private readonly settings: () => AquaPureSettings) {}

	outputPath(): string {
		return normalizePath(`${this.settings().outputFolder || "AquaPure"}/Registro de reuniones.md`);
	}

	async compile(): Promise<TFile | null> {
		if (this.running) return null;
		this.running = true;
		try {
			const meetings = Array.from(this.index.meetings.values()).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
			const parsed: ParsedMeeting[] = [];
			for (const m of meetings) {
				const p = await this.parse(m);
				if (p) parsed.push(p);
			}
			const content = this.render(parsed);
			const path = this.outputPath();
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile && content === this.lastContent) return existing;
			this.lastContent = content;
			if (existing instanceof TFile) {
				await this.app.vault.modify(existing, content);
				return existing;
			}
			const folder = path.split("/").slice(0, -1).join("/");
			if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
			return await this.app.vault.create(path, content);
		} catch (err) {
			console.error("[AquaPure] Error compilando reuniones", err);
			return null;
		} finally {
			this.running = false;
		}
	}

	private async parse(rec: MeetingRecord): Promise<ParsedMeeting | null> {
		const file = this.app.vault.getAbstractFileByPath(rec.path);
		if (!(file instanceof TFile)) return null;
		const cache = this.app.metadataCache.getFileCache(file);
		const text = await this.app.vault.cachedRead(file);
		const lines = text.split("\n");

		// Sección "Decisiones" delimitada con los encabezados de la caché (no por regex sobre el documento).
		const decisions: string[] = [];
		const headings = cache?.headings ?? [];
		const idx = headings.findIndex((h) => normalize(h.heading).startsWith("decision"));
		if (idx >= 0) {
			const h = headings[idx];
			const next = headings.slice(idx + 1).find((x) => x.level <= h.level);
			const end = next ? next.position.start.line : lines.length;
			for (let i = h.position.end.line + 1; i < end; i++) {
				const item = lines[i].replace(/^\s*[-*+]\s+(\[.\]\s*)?/, "").trim();
				if (item && /^\s*[-*+]\s/.test(lines[i])) decisions.push(item);
			}
		}

		const openActions: ParsedMeeting["openActions"] = [];
		for (const li of cache?.listItems ?? []) {
			if (li.task !== " ") continue;
			const line = li.position.start.line;
			const raw = (lines[line] ?? "").replace(/^\s*[-*+]\s+\[ \]\s*/, "").trim();
			if (!raw) continue;
			const owners = (cache?.links ?? [])
				.filter((l) => l.position.start.line === line)
				.map((l) => this.app.metadataCache.getFirstLinkpathDest(l.link, rec.path)?.path)
				.filter((p): p is string => !!p && this.index.stakeholders.has(p));
			const due = raw.match(/📅\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
			openActions.push({ text: raw, owners, due });
		}
		return { rec, linkText: this.app.metadataCache.fileToLinktext(file, "", true), decisions, openActions };
	}

	private render(list: ParsedMeeting[]): string {
		const name = (p: string): string => this.index.stakeholders.get(p)?.name ?? p.split("/").pop()?.replace(/\.md$/, "") ?? p;
		const totalOpen = list.reduce((a, m) => a + m.openActions.length, 0);
		const totalClosed = list.reduce((a, m) => a + m.rec.closedActions, 0);
		const today = isoDate(Date.now());
		const out: string[] = [
			"---",
			"aquapure_generated: true",
			`updated: ${today}`,
			"---",
			"# Registro de reuniones",
			"",
			"> Nota generada por AquaPure a partir de las actas (`type: meeting`). Se regenera sola: edita las actas, no este archivo.",
			"",
			`**${list.length}** reuniones · **${totalOpen}** acciones abiertas · **${totalClosed}** cerradas`,
			"",
			"## Acciones abiertas por responsable",
			""
		];

		const byOwner = new Map<string, Array<{ m: ParsedMeeting; text: string; due: string | null }>>();
		for (const m of list) {
			for (const a of m.openActions) {
				const keys = a.owners.length ? a.owners : ["__none__"];
				for (const k of keys) {
					const arr = byOwner.get(k) ?? [];
					arr.push({ m, text: a.text, due: a.due });
					byOwner.set(k, arr);
				}
			}
		}
		if (!byOwner.size) out.push("_Sin acciones abiertas._", "");
		const owners = Array.from(byOwner.keys()).sort((a, b) => (a === "__none__" ? 1 : b === "__none__" ? -1 : name(a).localeCompare(name(b))));
		for (const o of owners) {
			const items = (byOwner.get(o) ?? []).sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
			out.push(`### ${o === "__none__" ? "Sin responsable asignado" : name(o)} (${items.length})`);
			for (const it of items) {
				const late = it.due && it.due < today ? " ⚠️ vencida" : "";
				out.push(`- ${it.text.replace(/\[\[[^\]]+\]\]/g, "").replace(/📅\s*\d{4}-\d{2}-\d{2}/, "").trim()} — [[${it.m.linkText}|${it.m.rec.date || "s/f"}]]${it.due ? ` · 📅 ${it.due}${late}` : ""}`);
			}
			out.push("");
		}

		out.push("## Registro de decisiones", "");
		const withDecisions = list.filter((m) => m.decisions.length);
		if (!withDecisions.length) out.push("_Aún no hay decisiones registradas en la sección «Decisiones» de las actas._", "");
		for (const m of withDecisions) {
			out.push(`### ${m.rec.date || "s/f"} · [[${m.linkText}|${m.rec.title}]]`);
			for (const d of m.decisions) out.push(`- ${d}`);
			out.push("");
		}

		out.push("## Índice cronológico", "", "| Fecha | Tipo | Reunión | Asistentes | Acciones abiertas |", "|---|---|---|---|---|");
		for (const m of list) {
			const att = m.rec.attendees.map(name).join(", ") || "—";
			out.push(`| ${m.rec.date || "s/f"} | ${m.rec.meetingType} | [[${m.linkText}\\|${m.rec.title.replace(/\|/g, "/")}]] | ${att} | ${m.openActions.length} |`);
		}
		return out.join("\n") + "\n";
	}
}
