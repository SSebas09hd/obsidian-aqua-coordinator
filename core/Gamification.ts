import { MATURITY_LEVELS, TREATMENT_STAGES, XP_RULES } from "./constants";
import type { DeliverableRecord, GamificationState, ImpactTask, TreatmentStageId, XpReason } from "./types";

export interface MaturityResult {
	level: number;
	label: string;
	/** Progreso 0–1 hacia el siguiente nivel. */
	progressToNext: number;
	nextHint: string;
}

/**
 * Motor "Clean Flow": XP idempotente (cada evento tiene clave única),
 * racha Cero Rework y nivel de madurez de la PTAP calculado desde el estado real del Vault.
 */
export class Gamification {
	constructor(private readonly state: () => GamificationState) {}

	/** Otorga XP una sola vez por `key`. Devuelve los puntos otorgados (0 si ya existía). */
	award(key: string, reason: XpReason, label: string): number {
		const s = this.state();
		if (s.events.some((e) => e.key === key)) return 0;
		const points = XP_RULES[reason];
		s.events.push({ key, reason, points, label, at: Date.now() });
		// Mantiene el historial acotado; el total de XP se conserva aparte.
		if (s.events.length > 500) s.events.splice(0, s.events.length - 500);
		s.xp += points;
		return points;
	}

	/** Entregable emitido IFC: suma a la racha si no tuvo observaciones mayores. */
	registerIfc(doc: DeliverableRecord): "up" | "reset" {
		const s = this.state();
		if (doc.majorComments > 0) {
			s.zeroReworkStreak = 0;
			return "reset";
		}
		s.zeroReworkStreak += 1;
		s.bestStreak = Math.max(s.bestStreak, s.zeroReworkStreak);
		return "up";
	}

	/** Un IFC que vuelve a modificarse cuenta como rework. */
	registerRework(): void {
		this.state().zeroReworkStreak = 0;
	}

	computeMaturity(docs: DeliverableRecord[], openTasks: ImpactTask[]): MaturityResult {
		const n = docs.length;
		const approvedOrIfc = docs.filter((d) => d.status === "approved" || d.status === "ifc").length;
		const ifc = docs.filter((d) => d.status === "ifc").length;
		const blocked = docs.filter((d) => d.status === "blocked").length;
		const covered = new Set<TreatmentStageId>();
		docs.forEach((d) => d.stageIds.forEach((s) => covered.add(s)));
		const fApproved = n ? approvedOrIfc / n : 0;
		const fIfc = n ? ifc / n : 0;

		const l2 = n > 0 && covered.size >= 5 && fApproved >= 0.3;
		const l3 = l2 && fApproved >= 0.6 && blocked === 0;
		const l4 = l3 && fIfc >= 0.9 && openTasks.length === 0;
		const l5 = l4 && docs.some((d) => d.commissioningCompliant);

		const level = l5 ? 5 : l4 ? 4 : l3 ? 3 : l2 ? 2 : 1;
		let progressToNext = 1;
		let nextHint = "Máximo nivel alcanzado: agua tratada cumpliendo norma.";
		switch (level) {
			case 1:
				progressToNext = Math.min(1, (Math.min(covered.size / 5, 1) + Math.min(fApproved / 0.3, 1)) / 2);
				nextHint = `Cubrir ≥5 etapas del tren (${covered.size}/${TREATMENT_STAGES.length}) y ≥30% aprobado (${Math.round(fApproved * 100)}%).`;
				break;
			case 2:
				progressToNext = Math.min(1, fApproved / 0.6) * (blocked === 0 ? 1 : 0.8);
				nextHint = `≥60% aprobado (${Math.round(fApproved * 100)}%) y 0 bloqueos (${blocked}).`;
				break;
			case 3:
				progressToNext = Math.min(1, fIfc / 0.9) * (openTasks.length === 0 ? 1 : 0.85);
				nextHint = `≥90% IFC (${Math.round(fIfc * 100)}%) y 0 impactos abiertos (${openTasks.length}).`;
				break;
			case 4:
				progressToNext = 0.5;
				nextHint = "Declarar `water_quality_compliant: true` en el acta de puesta en marcha.";
				break;
			default:
				break;
		}
		return { level, label: MATURITY_LEVELS[level - 1], progressToNext, nextHint };
	}

	/** Promedio (días) entre creación y cierre de las últimas `sample` revisiones por impacto. */
	static velocityDays(tasks: ImpactTask[], sample = 20): number | null {
		const closed = tasks
			.filter((t): t is ImpactTask & { closedAt: number } => t.closedAt !== null)
			.sort((a, b) => b.closedAt - a.closedAt)
			.slice(0, sample);
		if (!closed.length) return null;
		const avg = closed.reduce((acc, t) => acc + (t.closedAt - t.createdAt), 0) / closed.length;
		return avg / 86_400_000;
	}
}
