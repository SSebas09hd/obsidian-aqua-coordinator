import { App, Notice, TFile } from "obsidian";
import type { PendingTask } from "../core/TaskCollector";
import type AquaPurePlugin from "../main";

export type PendingGroup = "deliverable" | "person" | "none";

/** Texto legible: sin wikilinks de responsables ni marcas de fecha. */
function cleanText(t: string): string {
	return t
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
		.replace(/\[\[([^\]]+)\]\]/g, (_m, p: string) => p.split("/").pop() ?? p)
		.replace(/📅\s*\d{4}-\d{2}-\d{2}|\bdue::\s*\d{4}-\d{2}-\d{2}|\(vence:?\s*\d{4}-\d{2}-\d{2}\)|@\d{4}-\d{2}-\d{2}/gi, "")
		.replace(/\s{2,}/g, " ")
		.trim();
}

export async function openAt(app: App, path: string, line?: number): Promise<void> {
	const f = app.vault.getAbstractFileByPath(path);
	if (!(f instanceof TFile)) return;
	await app.workspace.getLeaf("tab").openFile(f, line !== undefined ? { eState: { line } } : undefined);
}

/** Lista de pendientes agrupada; compartida por el dashboard y la vista dedicada. */
export function renderPendingList(parent: HTMLElement, plugin: AquaPurePlugin, tasks: PendingTask[], group: PendingGroup, onChanged: () => void): void {
	if (!tasks.length) {
		parent.createDiv({ cls: "aquapure-empty aquapure-tone-ok", text: "✓ Sin pendientes con estos filtros" });
		return;
	}
	const personName = (p: string): string => plugin.index.stakeholders.get(p)?.name ?? p.split("/").pop()?.replace(/\.md$/, "") ?? p;
	const groups = new Map<string, PendingTask[]>();
	for (const t of tasks) {
		const keys = group === "none" ? [""] : group === "deliverable" ? [t.sourceLabel] : t.owners.length ? t.owners : ["__none__"];
		for (const k of keys) {
			const arr = groups.get(k) ?? [];
			arr.push(t);
			groups.set(k, arr);
		}
	}
	for (const [key, list] of groups) {
		const box = parent.createDiv({ cls: "aquapure-pending-group" });
		if (group !== "none") {
			const overdue = list.filter((t) => t.overdue).length;
			const h = box.createDiv({ cls: "aquapure-pending-head" });
			const title = group === "person" ? (key === "__none__" ? "Sin responsable" : personName(key)) : key;
			h.createSpan({ cls: group === "deliverable" ? "aquapure-code aquapure-mono" : "aquapure-person-name", text: title });
			h.createSpan({ cls: "aquapure-mono aquapure-pending-count", text: `${list.length}${overdue ? ` · ${overdue} vencida(s)` : ""}` });
		}
		for (const t of list) {
			const row = box.createDiv({ cls: `aquapure-pending${t.overdue ? " is-overdue" : ""}` });
			const check = row.createEl("button", { cls: "aquapure-check", attr: { "aria-label": "Marcar como hecha", title: "Marcar como hecha" } });
			check.onclick = async (): Promise<void> => {
				try {
					check.addClass("is-done");
					const ok = await plugin.tasks.complete(t);
					if (!ok) new Notice("AquaPure: la nota cambió; ábrela para cerrar la tarea.");
					row.addClass("aquapure-flash");
					window.setTimeout(onChanged, 260);
				} catch (err) {
					console.error("[AquaPure] No se pudo cerrar la tarea", err);
					check.removeClass("is-done");
				}
			};
			const body = row.createDiv({ cls: "aquapure-pending-body" });
			const text = body.createEl("a", { cls: "aquapure-pending-text", text: cleanText(t.text) || t.text, href: "#" });
			text.onclick = (e): void => {
				e.preventDefault();
				void openAt(plugin.app, t.path, t.line);
			};
			const meta = body.createDiv({ cls: "aquapure-pending-meta" });
			if (group !== "deliverable") meta.createSpan({ cls: "aquapure-mono", text: t.sourceKind === "meeting" ? `Acta ${t.sourceLabel}` : t.sourceLabel });
			if (group !== "person") {
				const who = t.owners.map(personName).join(", ");
				meta.createSpan({ text: who ? `${who}${t.ownerInherited ? " (resp. del entregable)" : ""}` : "Sin responsable" });
			}
			const disc = t.disciplineId ? plugin.index.disciplines.get(t.disciplineId) : undefined;
			if (disc) {
				const chip = meta.createSpan({ cls: "aquapure-chip", text: disc.short });
				chip.style.setProperty("--aquapure-disc", disc.color);
			}
			row.createSpan({ cls: `aquapure-pill aquapure-mono ${t.overdue ? "aquapure-status-blocked" : t.due ? "aquapure-status-review" : "aquapure-status-draft"}`, text: t.due ? (t.overdue ? `vencida ${t.due}` : t.due) : "sin fecha" });
		}
	}
}
