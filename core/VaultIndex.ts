import { App, CachedMetadata, TFile } from "obsidian";
import { MEETING_TYPE_VALUES } from "./constants";
import { getStages } from "./stages";
import { DisciplineRegistry } from "./DisciplineRegistry";
import type { DeliverableRecord, InlineTaskRecord, MeetingRecord, StakeholderRecord, TreatmentStageId } from "./types";
import {
	classifyStatus,
	normalize,
	parseRevision,
	stripWikilink,
	toBoolean,
	toNumber,
	toStringList,
	toStringValue
} from "./utils";

const DELIVERABLE_TYPES = ["deliverable", "entregable", "document", "documento", "doc"];
const STAKEHOLDER_TYPES = ["stakeholder", "persona", "person", "profesional"];

export type DeliverableListener = (path: string, prev: DeliverableRecord | null, next: DeliverableRecord | null) => void;

/**
 * Índice incremental del Vault construido SOLO desde MetadataCache (sin leer archivos):
 * escala a bóvedas grandes porque cada evento re-indexa un único archivo.
 */
export class VaultIndex {
	readonly stakeholders = new Map<string, StakeholderRecord>();
	readonly deliverables = new Map<string, DeliverableRecord>();
	readonly meetings = new Map<string, MeetingRecord>();
	/** Tareas abiertas por archivo; se filtran contra `stakeholders` al consultar. */
	private readonly inlineTasks = new Map<string, InlineTaskRecord[]>();
	private readonly listeners: DeliverableListener[] = [];
	private readonly disciplineListeners: Array<(id: string) => void> = [];

	constructor(private readonly app: App, readonly disciplines: DisciplineRegistry, private excluded: () => string[]) {}

	onDeliverable(fn: DeliverableListener): void {
		this.listeners.push(fn);
	}

	onDisciplineDiscovered(fn: (id: string) => void): void {
		this.disciplineListeners.push(fn);
	}

	/** Escaneo completo (al arrancar o por comando). No emite eventos de cambio. */
	fullScan(): void {
		this.stakeholders.clear();
		this.deliverables.clear();
		this.meetings.clear();
		this.inlineTasks.clear();
		const files = this.app.vault.getMarkdownFiles();
		// Primera pasada: disciplinas y personas, para que los enlaces resuelvan en la segunda.
		for (const f of files) this.safeIndex(f, false, "people");
		for (const f of files) this.safeIndex(f, false, "docs");
	}

	/** Re-indexa un archivo y notifica cambios de entregables. */
	indexFile(file: TFile): void {
		this.safeIndex(file, true, "all");
	}

	removePath(path: string): void {
		const prev = this.deliverables.get(path) ?? null;
		this.stakeholders.delete(path);
		this.deliverables.delete(path);
		this.meetings.delete(path);
		this.inlineTasks.delete(path);
		this.disciplines.releaseFile(path);
		if (prev) this.emit(path, prev, null);
	}

	renamePath(oldPath: string, file: TFile): void {
		const prev = this.deliverables.get(oldPath) ?? null;
		this.stakeholders.delete(oldPath);
		this.deliverables.delete(oldPath);
		this.meetings.delete(oldPath);
		this.inlineTasks.delete(oldPath);
		this.disciplines.releaseFile(oldPath);
		this.safeIndex(file, false, "all");
		// Actualiza referencias de dependencias que apuntaban a la ruta vieja.
		for (const d of this.deliverables.values()) {
			d.dependsOn = d.dependsOn.map((p) => (p === oldPath ? file.path : p));
		}
		if (prev) this.emit(oldPath, prev, null);
	}

	openInlineTasksFor(personPath: string): InlineTaskRecord[] {
		const out: InlineTaskRecord[] = [];
		for (const list of this.inlineTasks.values()) for (const t of list) if (t.assigneePath === personPath) out.push(t);
		return out;
	}

	/** Entregables que declaran depends_on → `path`. */
	dependentsOf(path: string): DeliverableRecord[] {
		const out: DeliverableRecord[] = [];
		for (const d of this.deliverables.values()) if (d.dependsOn.includes(path)) out.push(d);
		return out;
	}

	stakeholdersByDiscipline(disciplineId: string): StakeholderRecord[] {
		return Array.from(this.stakeholders.values()).filter((s) => s.disciplineIds.includes(disciplineId));
	}

	// ------------------------------------------------------------------ internos

	private isExcluded(path: string): boolean {
		return this.excluded().some((folder) => folder && (path === folder || path.startsWith(folder.replace(/\/$/, "") + "/")));
	}

	private safeIndex(file: TFile, emit: boolean, pass: "people" | "docs" | "all"): void {
		try {
			if (file.extension !== "md" || this.isExcluded(file.path)) return;
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) return;
			this.indexFromCache(file, cache, emit, pass);
		} catch (err) {
			console.error(`[AquaPure] Error indexando ${file.path}`, err);
		}
	}

	private indexFromCache(file: TFile, cache: CachedMetadata, emit: boolean, pass: "people" | "docs" | "all"): void {
		const fm = (cache.frontmatter ?? {}) as Record<string, unknown>;
		const type = normalize(toStringValue(fm["type"]));
		const path = file.path;

		if (pass !== "docs") {
			this.disciplines.releaseFile(path);
			this.stakeholders.delete(path);

			// 1) Nota de disciplina explícita.
			if (type === "discipline" || type === "disciplina") {
				const name = toStringValue(fm["name"]) || toStringValue(fm["discipline"]) || file.basename;
				const color = toStringValue(fm["color"]) || undefined;
				const short = toStringValue(fm["short"]) || undefined;
				const aliases = toStringList(fm["aliases_discipline"]);
				const res = this.disciplines.register(name, path, color, name, short, aliases);
				if (res.isNew) this.disciplineListeners.forEach((fn) => fn(res.id));
			}

			// 2) Persona.
			if (STAKEHOLDER_TYPES.includes(type)) {
				const ids = this.registerDisciplineTerms(toStringList(fm["discipline"]), path);
				this.stakeholders.set(path, {
					path,
					name: toStringValue(fm["name"]) || file.basename,
					role: toStringValue(fm["role"], "Ingeniero"),
					disciplineIds: ids,
					capacityHours: toNumber(fm["capacity_hours"], NaN)
				});
			}
		}

		if (pass === "people") return;

		// 3) Tareas en línea abiertas con enlace en la misma línea.
		const tasks: InlineTaskRecord[] = [];
		const openLines = new Set<number>();
		for (const li of cache.listItems ?? []) if (li.task === " ") openLines.add(li.position.start.line);
		if (openLines.size > 0) {
			for (const link of cache.links ?? []) {
				const line = link.position.start.line;
				if (!openLines.has(line)) continue;
				const dest = this.app.metadataCache.getFirstLinkpathDest(link.link.split("#")[0], path);
				if (dest && !tasks.some((t) => t.line === line && t.assigneePath === dest.path)) tasks.push({ path, line, assigneePath: dest.path });
			}
			// En la nota de una persona, toda tarea abierta es compromiso de esa persona.
			if (STAKEHOLDER_TYPES.includes(type)) {
				for (const line of openLines) if (!tasks.some((t) => t.line === line && t.assigneePath === path)) tasks.push({ path, line, assigneePath: path });
			}
		}
		if (tasks.length) this.inlineTasks.set(path, tasks);
		else this.inlineTasks.delete(path);

		// 4) Acta de reunión.
		if (MEETING_TYPE_VALUES.includes(type)) {
			let open = 0;
			let closed = 0;
			for (const li of cache.listItems ?? []) {
				if (li.task === " ") open++;
				else if (li.task !== undefined) closed++;
			}
			this.meetings.set(path, {
				path,
				title: toStringValue(fm["title"]) || file.basename,
				date: toStringValue(fm["date"]),
				meetingType: toStringValue(fm["meeting_type"], "Reunión"),
				attendees: this.resolveLinks(toStringList(fm["attendees"]), path),
				disciplineIds: toStringList(fm["disciplines"]).map((t) => this.disciplines.resolve(stripWikilink(t))).filter((x): x is string => !!x),
				related: this.resolveLinks(toStringList(fm["related"]), path),
				openActions: open,
				closedActions: closed
			});
		} else this.meetings.delete(path);

		// 5) Entregable.
		const prev = this.deliverables.get(path) ?? null;
		const isDeliverable =
			DELIVERABLE_TYPES.includes(type) ||
			(fm["revision"] !== undefined && (fm["impacts"] !== undefined || fm["depends_on"] !== undefined || fm["code"] !== undefined));

		if (!isDeliverable) {
			if (prev) {
				this.deliverables.delete(path);
				if (emit) this.emit(path, prev, null);
			}
			return;
		}

		const next = this.buildDeliverable(file, fm);
		this.deliverables.set(path, next);
		if (emit) this.emit(path, prev, next);
	}

	private buildDeliverable(file: TFile, fm: Record<string, unknown>): DeliverableRecord {
		const path = file.path;
		const code = toStringValue(fm["code"]) || file.basename;
		const revisionRaw = toStringValue(fm["revision"]);
		const statusRaw = toStringValue(fm["status"]) || revisionRaw;

		// Disciplina: frontmatter (con auto-registro) o segmento del código PTAP-XXX-...
		let disciplineId: string | null = null;
		const discTerms = toStringList(fm["discipline"]);
		if (discTerms.length) disciplineId = this.registerDisciplineTerms(discTerms, path)[0] ?? null;
		if (!disciplineId) {
			const seg = code.split("-")[1];
			if (seg) disciplineId = this.disciplines.resolve(seg);
		}

		const impacts: string[] = [];
		const unresolvedImpacts: string[] = [];
		for (const term of toStringList(fm["impacts"])) {
			const id = this.disciplines.resolve(stripWikilink(term));
			if (id) {
				if (!impacts.includes(id)) impacts.push(id);
			} else unresolvedImpacts.push(term);
		}

		const title = toStringValue(fm["title"]) || file.basename;
		const docType = toStringValue(fm["doc_type"]);

		return {
			path,
			code,
			title,
			docType,
			disciplineId,
			stageIds: this.resolveStages(toStringList(fm["stage"]), `${title} ${code} ${file.basename}`),
			phase: toStringValue(fm["phase"]),
			revision: parseRevision(revisionRaw),
			statusRaw,
			status: classifyStatus(statusRaw),
			impacts,
			unresolvedImpacts,
			dependsOn: this.resolveLinks(toStringList(fm["depends_on"]), path),
			assignedTo: this.resolveLinks(toStringList(fm["assigned_to"]), path),
			due: toStringValue(fm["due"]) || null,
			effortHours: Number.isFinite(toNumber(fm["effort_hours"], NaN)) ? toNumber(fm["effort_hours"], 0) : null,
			critical: toBoolean(fm["critical"]),
			majorComments: toNumber(fm["major_comments"], 0),
			requiredSignatures: this.resolveLinks(toStringList(fm["required_signatures"]), path),
			signatures: this.resolveLinks(toStringList(fm["signatures"]), path),
			commissioningCompliant: toBoolean(fm["water_quality_compliant"]) || normalize(toStringValue(fm["commissioning"])) === "compliant"
		};
	}

	private registerDisciplineTerms(terms: string[], path: string): string[] {
		const ids: string[] = [];
		for (const t of terms) {
			const clean = stripWikilink(t);
			if (!clean) continue;
			const res = this.disciplines.register(clean, path);
			if (res.isNew) this.disciplineListeners.forEach((fn) => fn(res.id));
			if (!ids.includes(res.id)) ids.push(res.id);
		}
		return ids;
	}

	private resolveLinks(values: string[], sourcePath: string): string[] {
		const out: string[] = [];
		for (const v of values) {
			const target = stripWikilink(v);
			if (!target) continue;
			const dest = this.app.metadataCache.getFirstLinkpathDest(target, sourcePath);
			const p = dest ? dest.path : `${target}.md`; // enlace no resuelto: se conserva como ruta virtual
			if (!out.includes(p)) out.push(p);
		}
		return out;
	}

	private resolveStages(explicit: string[], haystack: string): TreatmentStageId[] {
		const ids = new Set<TreatmentStageId>();
		const match = (text: string): void => {
			const n = normalize(text).replace(/[_-]/g, " ");
			const stages = getStages();
			// 1) Coincidencia exacta por id o nombre; 2) si no hay, por términos alternativos.
			const exact = stages.filter((st) => normalize(st.id).replace(/_/g, " ") === n || normalize(st.label) === n);
			if (exact.length) {
				exact.forEach((st) => ids.add(st.id));
				return;
			}
			for (const st of stages) {
				if (st.aliases.some((a) => {
					const na = normalize(a);
					return na.length > 2 ? n.includes(na) : n.split(/\W+/).includes(na);
				})) ids.add(st.id);
			}
		};
		if (explicit.length) explicit.forEach(match);
		else match(haystack);
		return Array.from(ids);
	}

	private emit(path: string, prev: DeliverableRecord | null, next: DeliverableRecord | null): void {
		for (const fn of this.listeners) {
			try {
				fn(path, prev, next);
			} catch (err) {
				console.error("[AquaPure] Listener de entregables falló", err);
			}
		}
	}
}
