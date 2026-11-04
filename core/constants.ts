import type { AquaPureData, AquaPureSettings, DisciplineDef, DocStatusCategory, TreatmentStage } from "./types";

export const VIEW_TYPE_PTAP_DASHBOARD = "aquapure-ptap-dashboard";

export const BASE_DISCIPLINES: DisciplineDef[] = [
	{
		id: "procesos",
		short: "Procesos",
		name: "Procesos y Química de Potabilización",
		color: "#00b4d8",
		aliases: ["proceso", "process", "quimica", "prc", "prq", "potabilizacion"],
		builtIn: true
	},
	{
		id: "civil",
		short: "Civil",
		name: "Civil, Hidráulica y Estructuras",
		color: "#e0a96d",
		aliases: ["civ", "hidraulica", "estructuras", "estructural", "geotecnia", "str"],
		builtIn: true
	},
	{
		id: "mecanica",
		short: "Mecánica",
		name: "Mecánica, Equipamiento y Tuberías",
		color: "#a0aec0",
		aliases: ["mec", "mecanica", "tuberias", "piping", "equipos", "mechanical"],
		builtIn: true
	},
	{
		id: "electrica",
		short: "Eléctrica",
		name: "Eléctrica y Respaldo",
		color: "#f59e0b",
		aliases: ["ele", "elec", "electrical", "electrica"],
		builtIn: true
	},
	{
		id: "ic",
		short: "I&C",
		name: "Instrumentación, Automatización y Control",
		color: "#10b981",
		aliases: ["i&c", "iyc", "inc", "instrumentacion", "automatizacion", "control", "scada", "ins"],
		builtIn: true
	},
	{
		id: "calidad",
		short: "Calidad",
		name: "Calidad Sanitaria, Ambiental y Permisos",
		color: "#3a86ff",
		aliases: ["cal", "sanitaria", "ambiental", "permisos", "hse", "env", "qa"],
		builtIn: true
	}
];

/** Paleta de respaldo para disciplinas auto-descubiertas sin `color:`. */
export const DISCOVERED_PALETTE = ["#c084fc", "#f472b6", "#2dd4bf", "#fb7185", "#a3e635", "#38bdf8", "#facc15"];

export const TREATMENT_STAGES: TreatmentStage[] = [
	{ id: "captacion", label: "Captación", aliases: ["captacion", "bocatoma", "desarenador", "intake"] },
	{ id: "mezcla_rapida", label: "Mezcla rápida", aliases: ["mezcla", "mezcla rapida", "coagulacion", "rapid mix"] },
	{ id: "floculacion", label: "Floculación", aliases: ["floculacion", "floculador", "flocculation"] },
	{ id: "sedimentacion", label: "Sedimentación", aliases: ["sedimentacion", "clarificacion", "sedimentador", "lamelas"] },
	{ id: "filtracion", label: "Filtración", aliases: ["filtracion", "filtros", "filtration", "retrolavado"] },
	{ id: "desinfeccion", label: "Desinfección", aliases: ["desinfeccion", "cloracion", "cloro", "ozono", "uv"] },
	{ id: "almacenamiento", label: "Almacenamiento", aliases: ["almacenamiento", "tanque", "storage", "reserva"] }
];

export const STATUS_LABELS: Record<DocStatusCategory, string> = {
	draft: "Borrador",
	review: "En Revisión",
	approved: "Aprobado c/ Com.",
	ifc: "IFC",
	blocked: "Bloqueo"
};

export const STATUS_ORDER: DocStatusCategory[] = ["draft", "review", "approved", "ifc", "blocked"];

export const MATURITY_LEVELS: string[] = [
	"Nivel 1: Caracterización y Tren Conceptual",
	"Nivel 2: Ingeniería Básica Consolidada",
	"Nivel 3: Ingeniería de Detalle Coordinada",
	"Nivel 4: Construcción (IFC) sin Interferencias",
	"Nivel 5: Puesta en Marcha / Agua Tratada Cumpliendo Norma"
];

export const XP_RULES = {
	interference_cleared: 60,
	critical_calc_validated: 80,
	impact_matrix_closed: 120
} as const;

/** Tipos documentales considerados "memorias / hojas de datos críticas" (+80 XP al validarse). */
export const CRITICAL_DOC_TYPES = ["memoria", "calculo", "calc", "hoja de datos", "datasheet", "data sheet"];

export const DEFAULT_SETTINGS: AquaPureSettings = {
	lowSaturationPct: 50,
	overloadSaturationPct: 100,
	defaultTaskHours: 4,
	defaultCapacityHours: 40,
	impactSlaDays: 5,
	disabledDisciplineIds: [],
	writeDisciplineDossiers: false,
	dossierFolder: "AquaPure/Expedientes",
	showNotices: true,
	excludedFolders: ["Templates", "Plantillas"],
	projectCode: "PTAP",
	peopleFolder: "Personas",
	disciplinesFolder: "Disciplinas",
	deliverablesFolder: "Entregables",
	meetingsFolder: "Reuniones",
	templatesFolder: "AquaPure/Plantillas",
	outputFolder: "AquaPure",
	autoCompileMeetings: true
};

/** Abreviatura de disciplina para códigos de entregable. */
export const DISCIPLINE_CODES: Record<string, string> = {
	procesos: "PRC",
	civil: "CIV",
	mecanica: "MEC",
	electrica: "ELE",
	ic: "INS",
	calidad: "CAL"
};

/** Tipos documentales ofrecidos en el formulario, con su abreviatura de código. */
export const DOC_TYPES: Array<{ label: string; code: string; critical?: boolean }> = [
	{ label: "P&ID", code: "PID" },
	{ label: "PFD", code: "PFD" },
	{ label: "Plano", code: "DWG" },
	{ label: "Memoria de Cálculo", code: "MEM", critical: true },
	{ label: "Hoja de Datos", code: "HDD", critical: true },
	{ label: "Especificación Técnica", code: "ESP" },
	{ label: "Lista / Listado", code: "LST" },
	{ label: "Informe", code: "INF" },
	{ label: "Filosofía de Control", code: "FDC" },
	{ label: "Permiso / Trámite", code: "PER" }
];

export const ROLES = ["Ingeniero", "Revisor", "Líder", "Coordinador", "Especialista", "Dibujante", "Cliente / Interventoría"];

export const PHASES = ["Básica", "Detalle", "Construcción", "Puesta en Marcha"];

/** Estados sugeridos en los formularios (el plugin acepta cualquier texto). */
export const STATUS_PRESETS: Array<{ label: string; value: string }> = [
	{ label: "Borrador", value: "Borrador" },
	{ label: "Revisión interna", value: "Revisión Interna" },
	{ label: "Emitido para revisión del cliente (IFR)", value: "Emitido para Revisión (IFR)" },
	{ label: "Aprobado con comentarios", value: "Aprobado con Comentarios" },
	{ label: "Aprobado", value: "Aprobado" },
	{ label: "Emitido para construcción (IFC)", value: "IFC - Aprobado para Construcción" },
	{ label: "Modificación crítica / Bloqueo", value: "Modificación Crítica - Bloqueo" }
];

export const MEETING_TYPES = [
	"Coordinación interdisciplinaria",
	"Revisión de diseño",
	"Seguimiento semanal",
	"Reunión con cliente / interventoría",
	"Visita de obra",
	"Cierre de matriz de impacto",
	"Puesta en marcha"
];

export const MEETING_TYPE_VALUES = ["meeting", "reunion", "reunión", "acta"];

export const DEFAULT_DATA: AquaPureData = {
	settings: { ...DEFAULT_SETTINGS },
	snapshots: {},
	impactTasks: [],
	gamification: {
		xp: 0,
		zeroReworkStreak: 0,
		bestStreak: 0,
		maturityLevel: 1,
		events: [],
		sealedStages: []
	},
	schemaVersion: 1
};
