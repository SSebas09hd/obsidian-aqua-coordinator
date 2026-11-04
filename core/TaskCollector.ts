import { App, TFile } from "obsidian";
import { isoDate } from "./utils";
import type { VaultIndex } from "./VaultIndex";

export interface PendingTask {
	path: string;
	line: number;
	text: string;
	sourceKind: "deliverable" | "meeting";
	sourceLabel: string; // código del entregable o título del acta
	disciplineId: string | null;
	owners: string[]; // rutas de personas
	/** true si el responsable se hereda del `assigned_to` del entregable (la línea no enlaza a nadie). */
	ownerInherited: boolean;
	due: string | null;
	overdue: boolean;
}

const DUE_PATTERNS = [/📅\s*(\d{4}-\d{2}-\d{2})/, /\bdue::\s*(\d{4}-\d{2}-\d{2})/i, /\(vence:?\s*(\d{4}-\d{2}-\d{2})\)/i, /@(\d{4}-\d{2}-\d{2})\b/];

/**
 * Reúne las tareas abiertas (`- [ ]`) de entregables y actas.
 * Usa la caché de metadatos para ubicar cada tarea y lee el texto con cachedRead,
 * memorizando por archivo según su fecha de modificación.
 */
export class TaskCollector {
	private readonly memo = new Map<string, { mtime: number; tasks: PendingTask[] }>();

	constructor(private readonly app: App, private readonly index: VaultIndex) {}

	async collect(includeMeetings: boolean): Promise<PendingTask[]> {
		const out: PendingTask[] = [];
		const paths = [...this.index.deliverables.keys(), ...(includeMeetings ? this.index.meetings.keys() : [])];
		const today = isoDate(Date.now());
		for (const path of paths) {
			try {
				for (const t of await this.forFile(path)) out.push({ ...t, overdue: !!t.due && t.due < today });
			} catch (err) {
				console.warn(`[AquaPure] No se pudieron leer las tareas de ${path}`, err);
			}
		}
		// Vencidas primero, luego por fecha, y las sin fecha al final.
		return out.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.sourceLabel.localeCompare(b.sourceLabel));
	}

	private async forFile(path: string): Promise<PendingTask[]> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return [];
		const cached = this.memo.get(path);
		if (cached && cached.mtime === file.stat.mtime) return cached.tasks;

		const cache = this.app.metadataCache.getFileCache(file);
		const open = (cache?.listItems ?? []).filter((li) => li.task === " ");
		let tasks: PendingTask[] = [];
		if (open.length) {
			const lines = (await this.app.vault.cachedRead(file)).split("\n");
			const doc = this.index.deliverables.get(path);
			const meeting = this.index.meetings.get(path);
			tasks = open
				.map((li): PendingTask | null => {
					const line = li.position.start.line;
					const raw = (lines[line] ?? "").replace(/^\s*[-*+]\s+\[ \]\s*/, "").trim();
					if (!raw) return null; // casillas vacías de plantilla
					const linked = (cache?.links ?? [])
						.filter((l) => l.position.start.line === line)
						.map((l) => this.app.metadataCache.getFirstLinkpathDest(l.link.split("#")[0], path)?.path)
						.filter((p): p is string => !!p && this.index.stakeholders.has(p));
					const owners = linked.length ? linked : doc?.assignedTo.filter((p) => this.index.stakeholders.has(p)) ?? [];
					let due: string | null = null;
					for (const re of DUE_PATTERNS) {
						const m = raw.match(re);
						if (m) {
							due = m[1];
							break;
						}
					}
					return {
						path,
						line,
						text: raw,
						sourceKind: doc ? "deliverable" : "meeting",
						sourceLabel: doc ? doc.code : meeting ? `${meeting.date} ${meeting.title}` : file.basename,
						disciplineId: doc?.disciplineId ?? meeting?.disciplineIds[0] ?? null,
						owners,
						ownerInherited: !linked.length && owners.length > 0,
						due,
						overdue: false
					};
				})
				.filter((t): t is PendingTask => t !== null);
		}
		this.memo.set(path, { mtime: file.stat.mtime, tasks });
		return tasks;
	}

	/**
	 * Marca una tarea como hecha: cambia solo "[ ]" → "[x]" en esa línea y añade la
	 * fecha de cierre (formato compatible con el plugin Tasks). Si la línea ya no
	 * coincide (la nota cambió), no toca nada.
	 */
	async complete(task: PendingTask): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) return false;
		let ok = false;
		await this.app.vault.process(file, (data) => {
			const lines = data.split("\n");
			const current = lines[task.line];
			if (current === undefined || !/^\s*[-*+]\s+\[ \]/.test(current) || !current.includes(task.text.slice(0, 40))) return data;
			lines[task.line] = current.replace("[ ]", "[x]") + ` ✅ ${isoDate(Date.now())}`;
			ok = true;
			return lines.join("\n");
		});
		this.memo.delete(task.path);
		return ok;
	}
}
