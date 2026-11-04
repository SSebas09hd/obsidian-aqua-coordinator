import { TREATMENT_STAGES } from "./constants";
import type { TreatmentStage } from "./types";
import { normalize } from "./utils";

/**
 * Tren de tratamiento activo. Lo fija el plugin desde los ajustes; el resto del
 * código lo consulta aquí para no arrastrar los ajustes por todas las capas.
 */
let active: TreatmentStage[] = TREATMENT_STAGES;

export function getStages(): TreatmentStage[] {
	return active;
}

export function setStages(stages: TreatmentStage[]): void {
	active = stages.length ? stages : TREATMENT_STAGES;
}

export function stageLabel(id: string): string {
	return active.find((s) => s.id === id)?.label ?? id;
}

/** Id estable a partir de un nombre: "Flotación (DAF)" → "flotacion_daf". */
export function stageIdFrom(label: string, taken: string[]): string {
	const base = normalize(label).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "etapa";
	let id = base;
	for (let i = 2; taken.includes(id); i++) id = `${base}_${i}`;
	return id;
}

const st = (id: string, label: string, aliases: string[]): TreatmentStage => ({ id, label, aliases });

/** Configuraciones típicas para arrancar; se pueden editar después. */
export const STAGE_PRESETS: Array<{ name: string; desc: string; stages: TreatmentStage[] }> = [
	{
		name: "Convencional completa",
		desc: "Coagulación, floculación, sedimentación, filtración rápida y desinfección.",
		stages: TREATMENT_STAGES
	},
	{
		name: "Filtración directa",
		desc: "Agua cruda de baja turbiedad: sin sedimentador.",
		stages: [
			st("captacion", "Captación", ["captacion", "bocatoma", "desarenador"]),
			st("mezcla_rapida", "Mezcla rápida", ["mezcla", "coagulacion"]),
			st("floculacion", "Floculación", ["floculacion", "floculador"]),
			st("filtracion", "Filtración", ["filtracion", "filtros", "retrolavado"]),
			st("desinfeccion", "Desinfección", ["desinfeccion", "cloracion", "cloro"]),
			st("almacenamiento", "Almacenamiento", ["almacenamiento", "tanque"])
		]
	},
	{
		name: "FiME (filtración en múltiples etapas)",
		desc: "Típica de acueductos rurales: prefiltros de grava y filtración lenta en arena.",
		stages: [
			st("captacion", "Captación", ["captacion", "bocatoma", "desarenador"]),
			st("fgdi", "Filtro grueso dinámico", ["fgdi", "filtro grueso dinamico"]),
			st("fgas", "Filtro grueso ascendente", ["fgas", "fgac", "prefiltro", "filtro grueso ascendente"]),
			st("fla", "Filtración lenta en arena", ["fla", "filtro lento", "filtracion lenta"]),
			st("desinfeccion", "Desinfección", ["desinfeccion", "cloracion", "cloro"]),
			st("almacenamiento", "Almacenamiento", ["almacenamiento", "tanque"])
		]
	},
	{
		name: "Planta compacta",
		desc: "Unidad prefabricada (clarificador de alta tasa + filtro) con dosificación química.",
		stages: [
			st("captacion", "Captación", ["captacion", "bocatoma", "bombeo"]),
			st("dosificacion", "Dosificación química", ["dosificacion", "coagulante", "polimero"]),
			st("clarificacion", "Clarificación compacta", ["clarificacion", "clarificador", "sedimentacion", "lamelas"]),
			st("filtracion", "Filtración", ["filtracion", "filtros"]),
			st("desinfeccion", "Desinfección", ["desinfeccion", "cloracion"]),
			st("almacenamiento", "Almacenamiento", ["almacenamiento", "tanque"])
		]
	},
	{
		name: "Convencional + lodos",
		desc: "Convencional con manejo de aguas de lavado y deshidratación de lodos.",
		stages: [...TREATMENT_STAGES, st("lodos", "Tratamiento de lodos", ["lodos", "espesador", "lechos de secado", "retrolavado recuperado"])]
	}
];
