import { App, TFile, TFolder, normalizePath } from "obsidian";
import type { CoordinatorEngine } from "./CoordinatorEngine";
import type { AquaPureSettings } from "./types";
import { isoDate } from "./utils";
import type { VaultIndex } from "./VaultIndex";

/**
 * Escribe un "expediente" por disciplina con sus revisiones pendientes por impacto.
 * Solo toca archivos propios dentro de `dossierFolder` (excluida del escaneo):
 * las notas del usuario nunca se modifican.
 */
export class DossierWriter {
	private writing = false;
	private lastHash = new Map<string, string>();

	constructor(
		private readonly app: App,
		private readonly index: VaultIndex,
		private readonly engine: CoordinatorEngine,
		private readonly settings: () => AquaPureSettings
	) {}

	async writeAll(force: boolean): Promise<void> {
		if (this.writing) return;
		this.writing = true;
		try {
			const s = this.settings();
			const folder = normalizePath(s.dossierFolder);
			await this.ensureFolder(folder);
			const open = this.engine.openImpactTasks();
			for (const disc of this.index.disciplines.active(s.disabledDisciplineIds)) {
				const tasks = open.filter((t) => t.targetDisciplineId === disc.id);
				const lines: string[] = [
					"---",
					"aquapure_generated: true",
					`discipline_id: ${disc.id}`,
					`updated: ${isoDate(Date.now())}`,
					"---",
					`# Expediente de impacto · ${disc.name}`,
					"",
					"> Nota generada por AquaPure. Se regenera automáticamente: no la edites a mano.",
					"",
					`## Revisiones pendientes por impacto (${tasks.length})`,
					""
				];
				if (!tasks.length) lines.push("_Sin revisiones pendientes._");
				for (const t of tasks) {
					const target = t.targetDocPath ? ` → [[${t.targetDocPath.replace(/\.md$/, "")}]]` : "";
					const who = t.assignees.map((p) => `[[${p.replace(/\.md$/, "")}]]`).join(", ") || "sin asignar";
					lines.push(`- [[${t.sourcePath.replace(/\.md$/, "")}|${t.sourceCode}]] ${t.fromState} → ${t.toState}${target} · ${who} · vence ${isoDate(t.dueAt)}`);
				}
				const content = lines.join("\n") + "\n";
				const path = normalizePath(`${folder}/${disc.short.replace(/[\\/:*?"<>|&]/g, "_")}.md`);
				const hash = content.replace(/^updated: .*$/m, "");
				if (!force && this.lastHash.get(path) === hash) continue;
				this.lastHash.set(path, hash);
				const existing = this.app.vault.getAbstractFileByPath(path);
				if (existing instanceof TFile) await this.app.vault.modify(existing, content);
				else await this.app.vault.create(path, content);
			}
		} catch (err) {
			console.error("[AquaPure] Error escribiendo expedientes", err);
		} finally {
			this.writing = false;
		}
	}

	private async ensureFolder(path: string): Promise<void> {
		const parts = path.split("/");
		let acc = "";
		for (const p of parts) {
			acc = acc ? `${acc}/${p}` : p;
			const f = this.app.vault.getAbstractFileByPath(acc);
			if (!f) await this.app.vault.createFolder(acc);
			else if (!(f instanceof TFolder)) throw new Error(`${acc} existe y no es carpeta`);
		}
	}
}
