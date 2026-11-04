import { CRITICAL_DOC_TYPES, STATUS_LABELS, TREATMENT_STAGES } from "./constants";
import { Gamification, MaturityResult } from "./Gamification";
import type {
	AquaPureData,
	DeliverableRecord,
	DocSnapshot,
	ImpactTask,
	SaturationLevel,
	StakeholderRecord,
	TreatmentStageId
} from "./types";
import { DAY_MS, normalize, parseIsoDate, uid } from "./utils";
import { VaultIndex } from "./VaultIndex";

export type StageLight = "none" | "ok" | "warn" | "alarm";

export interface StageStatus {
	id: TreatmentStageId;
	label: string;
	light: StageLight;
	docs: DeliverableRecord[];
	openImpacts: number;
	sealed: boolean;
}

export interface WorkloadItem {
	kind: "deliverable" | "inline" | "impact";
	label: string;
	path: string;
	hours: number;
	due: string | null;
	line?: number;
}

export interface WorkloadRow {
	person: StakeholderRecord;
	items: WorkloadItem[];
	hours: number;
	capacity: number;
	pct: number;
	level: SaturationLevel;
}

export type EngineNotify = (message: string, kind: "info" | "impact" | "xp" | "seal" | "level") => void;

/** Orquesta Gestión del Cambio (MOC), carga de trabajo y gamificación sobre el índice. */
export class CoordinatorEngine {
	readonly game: Gamification;

	constructor(
		private readonly index: VaultIndex,
		private readonly data: () => AquaPureData,
		private readonly requestSave: () => void,
		private readonly notify: EngineNotify
	) {
		this.game = new Gamification(() => this.data().gamification);
		index.onDeliverable((path, prev, next) => this.onDeliverableChanged(path, prev, next));
	}

	// ======================================================= Gestión del cambio

	/**
	 * Tras el escaneo inicial: compara con las instantáneas persistidas para detectar
	 * cambios hechos con el plugin desactivado (sync, edición externa) y limpia huérfanos.
	 */
	reconcileAfterScan(): void {
		const d = this.data();
		const firstRun = Object.keys(d.snapshots).length === 0;
		for (const doc of this.index.deliverables.values()) {
			const snap = d.snapshots[doc.path];
			if (!snap || firstRun) {
				d.snapshots[doc.path] = this.snapshotOf(doc);
				continue;
			}
			if (this.isSignificantChange(snap, doc)) this.handleChange(snap, doc);
			d.snapshots[doc.path] = this.snapshotOf(doc);
			this.evaluateAwards(doc);
		}
		for (const path of Object.keys(d.snapshots)) if (!this.index.deliverables.has(path)) delete d.snapshots[path];
		this.evaluateProjectState(true);
		this.requestSave();
	}

	private onDeliverableChanged(path: string, _prev: DeliverableRecord | null, next: DeliverableRecord | null): void {
		const d = this.data();
		if (!next) {
			delete d.snapshots[path];
			this.requestSave();
			return;
		}
		const snap = d.snapshots[path];
		if (!snap) {
			d.snapshots[path] = this.snapshotOf(next); // línea base: un documento nuevo no dispara impactos
		} else if (this.isSignificantChange(snap, next)) {
			this.handleChange(snap, next);
			d.snapshots[path] = this.snapshotOf(next);
		} else if (snap.statusRaw !== next.statusRaw || snap.revision !== next.revision) {
			d.snapshots[path] = this.snapshotOf(next); // cambio cosmético del texto
		}
		this.evaluateAwards(next);
		this.evaluateProjectState(false);
		this.requestSave();
	}

	private snapshotOf(doc: DeliverableRecord): DocSnapshot {
		return { revision: doc.revision, statusRaw: doc.statusRaw, status: doc.status };
	}

	private isSignificantChange(snap: DocSnapshot, doc: DeliverableRecord): boolean {
		return snap.revision !== doc.revision || snap.status !== doc.status;
	}

	private describe(revision: string, statusRaw: string): string {
		if (!revision) return statusRaw;
		return normalize(statusRaw).includes(normalize(`rev ${revision}`)) ? statusRaw : `Rev ${revision} · ${statusRaw}`;
	}

	/** Genera las Impact Tasks para disciplinas declaradas en `impacts` y documentos dependientes. */
	private handleChange(snap: DocSnapshot, doc: DeliverableRecord): void {
		const d = this.data();
		const from = this.describe(snap.revision, snap.statusRaw);
		const to = this.describe(doc.revision, doc.statusRaw);

		// Racha Cero Rework.
		if (doc.status === "ifc" && snap.status !== "ifc") {
			const r = this.game.registerIfc(doc);
			if (r === "reset") this.notify(`${doc.code} emitido IFC con observaciones mayores: racha Cero Rework reiniciada.`, "info");
		} else if (snap.status === "ifc" && (doc.status === "blocked" || snap.revision !== doc.revision)) {
			this.game.registerRework();
			this.notify(`${doc.code} se modificó después de IFC: racha Cero Rework reiniciada.`, "info");
		}

		const now = Date.now();
		const due = now + d.settings.impactSlaDays * DAY_MS;
		const created: ImpactTask[] = [];
		const touchedDisciplines = new Set<string>();

		const upsert = (targetDisciplineId: string, targetDocPath: string | null, assignees: string[], reason: string): void => {
			const open = d.impactTasks.find(
				(t) => t.closedAt === null && t.sourcePath === doc.path && t.targetDisciplineId === targetDisciplineId && t.targetDocPath === targetDocPath
			);
			if (open) {
				// Un nuevo cambio sobre un impacto aún abierto lo actualiza en lugar de duplicarlo.
				open.toState = to;
				open.sourceRevision = doc.revision;
				open.dueAt = due;
				open.reason = reason;
				open.assignees = Array.from(new Set([...open.assignees, ...assignees]));
				return;
			}
			const task: ImpactTask = {
				id: uid(),
				sourcePath: doc.path,
				sourceCode: doc.code,
				sourceRevision: doc.revision,
				fromState: from,
				toState: to,
				targetDisciplineId,
				targetDocPath,
				assignees,
				reason,
				createdAt: now,
				dueAt: due,
				closedAt: null
			};
			d.impactTasks.push(task);
			created.push(task);
			touchedDisciplines.add(targetDisciplineId);
		};

		for (const discId of doc.impacts) {
			if (d.settings.disabledDisciplineIds.includes(discId)) continue;
			const people = this.index.stakeholdersByDiscipline(discId).map((p) => p.path);
			upsert(discId, null, people, `Impacto declarado en ${doc.code}`);
		}

		for (const dep of this.index.dependentsOf(doc.path)) {
			const discId = dep.disciplineId ?? "sin-disciplina";
			const people = dep.assignedTo.length ? dep.assignedTo : this.index.stakeholdersByDiscipline(discId).map((p) => p.path);
			upsert(discId, dep.path, people, `${dep.code} depende de ${doc.code}`);
		}

		if (created.length) {
			const names = Array.from(touchedDisciplines).map((id) => this.index.disciplines.get(id)?.short ?? id);
			this.notify(`${doc.code}: ${from} → ${to}. ${created.length} revisión(es) por impacto → ${names.join(", ")}`, "impact");
		}
	}

	/** Cierra una revisión por impacto; +60 XP si se despeja antes del plazo. */
	closeImpactTask(id: string): void {
		const d = this.data();
		const t = d.impactTasks.find((x) => x.id === id);
		if (!t || t.closedAt !== null) return;
		t.closedAt = Date.now();
		if (t.closedAt <= t.dueAt) {
			const pts = this.game.award(`clear:${t.id}`, "interference_cleared", `Interferencia despejada a tiempo: ${t.sourceCode} → ${this.index.disciplines.get(t.targetDisciplineId)?.short ?? t.targetDisciplineId}`);
			if (pts) this.notify(`+${pts} XP · Interferencia ${t.sourceCode} → ${this.index.disciplines.get(t.targetDisciplineId)?.short ?? t.targetDisciplineId} despejada antes del plazo`, "xp");
		}
		const src = this.index.deliverables.get(t.sourcePath);
		if (src) this.evaluateAwards(src);
		this.evaluateProjectState(false);
		this.requestSave();
	}

	reopenImpactTask(id: string): void {
		const t = this.data().impactTasks.find((x) => x.id === id);
		if (!t) return;
		t.closedAt = null;
		this.requestSave();
	}

	/** Elimina del historial las tareas cerradas hace más de `days` días. */
	purgeClosed(days: number): number {
		const d = this.data();
		const limit = Date.now() - days * DAY_MS;
		const before = d.impactTasks.length;
		d.impactTasks = d.impactTasks.filter((t) => t.closedAt === null || t.closedAt > limit);
		this.requestSave();
		return before - d.impactTasks.length;
	}

	openImpactTasks(): ImpactTask[] {
		return this.data().impactTasks.filter((t) => t.closedAt === null && !this.data().settings.disabledDisciplineIds.includes(t.targetDisciplineId));
	}

	// =============================================================== XP

	private evaluateAwards(doc: DeliverableRecord): void {
		const type = normalize(doc.docType);
		const isCalc = doc.critical || CRITICAL_DOC_TYPES.some((t) => type.includes(t));
		if (isCalc && (doc.status === "approved" || doc.status === "ifc")) {
			const pts = this.game.award(`calc:${doc.path}:${doc.revision}`, "critical_calc_validated", `Validación crítica: ${doc.code} Rev ${doc.revision}`);
			if (pts) this.notify(`+${pts} XP · ${doc.code} validado (memoria/instrumentación crítica)`, "xp");
		}

		const tasks = this.data().impactTasks.filter((t) => t.sourcePath === doc.path && t.sourceRevision === doc.revision);
		const allClosed = tasks.length > 0 && tasks.every((t) => t.closedAt !== null);
		const allSigned = doc.requiredSignatures.every((p) => doc.signatures.includes(p));
		if (allClosed && allSigned) {
			const pts = this.game.award(`matrix:${doc.path}:${doc.revision}`, "impact_matrix_closed", `Matriz de impacto cerrada: ${doc.code} Rev ${doc.revision}`);
			if (pts) this.notify(`+${pts} XP · Matriz de impacto de ${doc.code} cerrada con todas las firmas`, "xp");
		}
	}

	// ======================================================= Estado del proyecto

	maturity(): MaturityResult {
		return this.game.computeMaturity(Array.from(this.index.deliverables.values()), this.openImpactTasks());
	}

	/** Detecta subida de nivel y sellos de calidad por etapa. */
	evaluateProjectState(silent: boolean): void {
		const g = this.data().gamification;
		const m = this.maturity();
		if (m.level > g.maturityLevel && !silent) this.notify(`🏁 La PTAP sube a ${m.label}`, "level");
		g.maturityLevel = m.level;

		for (const st of this.stageStatuses()) {
			const had = g.sealedStages.includes(st.id);
			if (st.sealed && !had) {
				g.sealedStages.push(st.id);
				if (!silent) this.notify(`🔷 Sello de calidad: ${st.label} completa en IFC sin cuellos de botella`, "seal");
			} else if (!st.sealed && had) {
				g.sealedStages = g.sealedStages.filter((s) => s !== st.id);
			}
		}
	}

	stageStatuses(): StageStatus[] {
		const docs = Array.from(this.index.deliverables.values());
		const open = this.openImpactTasks();
		const now = Date.now();
		return TREATMENT_STAGES.map((st) => {
			const sd = docs.filter((d) => d.stageIds.includes(st.id));
			const paths = new Set(sd.map((d) => d.path));
			const impacts = open.filter((t) => paths.has(t.sourcePath) || (t.targetDocPath !== null && paths.has(t.targetDocPath)));
			let light: StageLight = "none";
			if (sd.length) {
				const overdue = impacts.some((t) => t.dueAt < now) || sd.some((d) => d.status !== "ifc" && (parseIsoDate(d.due) ?? Infinity) < now);
				if (sd.some((d) => d.status === "blocked") || overdue) light = "alarm";
				else if (impacts.length || sd.some((d) => d.status !== "ifc")) light = "warn";
				else light = "ok";
			}
			return { id: st.id, label: st.label, light, docs: sd, openImpacts: impacts.length, sealed: light === "ok" };
		});
	}

	/** Conteo disciplina × estado para la matriz. */
	matrix(disciplineIds: string[]): Map<string, Map<string, DeliverableRecord[]>> {
		const out = new Map<string, Map<string, DeliverableRecord[]>>();
		for (const id of disciplineIds) {
			const row = new Map<string, DeliverableRecord[]>();
			for (const s of Object.keys(STATUS_LABELS)) row.set(s, []);
			out.set(id, row);
		}
		for (const d of this.index.deliverables.values()) {
			if (!d.disciplineId) continue;
			out.get(d.disciplineId)?.get(d.status)?.push(d);
		}
		return out;
	}

	// ======================================================= Carga de trabajo

	workload(): WorkloadRow[] {
		const s = this.data().settings;
		const open = this.openImpactTasks();
		const rows: WorkloadRow[] = [];
		for (const person of this.index.stakeholders.values()) {
			const items: WorkloadItem[] = [];
			for (const d of this.index.deliverables.values()) {
				if (d.status === "ifc" || !d.assignedTo.includes(person.path)) continue;
				items.push({ kind: "deliverable", label: `${d.code} · ${d.title}`, path: d.path, hours: d.effortHours ?? s.defaultTaskHours, due: d.due });
			}
			for (const t of this.index.openInlineTasksFor(person.path)) {
				items.push({ kind: "inline", label: `Tarea en ${t.path.split("/").pop()?.replace(/\.md$/, "")}`, path: t.path, hours: s.defaultTaskHours, due: null, line: t.line });
			}
			for (const t of open) {
				if (!t.assignees.includes(person.path)) continue;
				items.push({ kind: "impact", label: `Impacto ${t.sourceCode} → ${t.targetDisciplineId}`, path: t.targetDocPath ?? t.sourcePath, hours: s.defaultTaskHours, due: null });
			}
			const hours = items.reduce((a, i) => a + i.hours, 0);
			const capacity = Number.isFinite(person.capacityHours) && person.capacityHours > 0 ? person.capacityHours : s.defaultCapacityHours;
			const pct = capacity > 0 ? (hours / capacity) * 100 : 0;
			const level: SaturationLevel = pct > s.overloadSaturationPct ? "overload" : pct < s.lowSaturationPct ? "low" : "optimal";
			rows.push({ person, items, hours, capacity, pct, level });
		}
		return rows.sort((a, b) => b.pct - a.pct);
	}
}
