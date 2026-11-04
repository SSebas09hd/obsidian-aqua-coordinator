/**
 * AquaPure — tipos de dominio compartidos.
 * Todo el estado persistente vive en data.json (AquaPureData) y es auditable/exportable.
 */

/** Categoría normalizada del estado documental. */
export type DocStatusCategory = "draft" | "review" | "approved" | "ifc" | "blocked";

/** Etapas del tren de tratamiento de la PTAP. */
export type TreatmentStageId =
	| "captacion"
	| "mezcla_rapida"
	| "floculacion"
	| "sedimentacion"
	| "filtracion"
	| "desinfeccion"
	| "almacenamiento";

export interface TreatmentStage {
	id: TreatmentStageId;
	label: string;
	aliases: string[];
}

export interface DisciplineDef {
	/** Identificador estable (slug). */
	id: string;
	/** Nombre corto para chips y matrices (ej. "Civil"). */
	short: string;
	/** Nombre completo. */
	name: string;
	/** Color de acento (hex). */
	color: string;
	/** Términos alternativos para resolver `impacts:` y `discipline:`. */
	aliases: string[];
	/** true = integrada; false = auto-descubierta en el Vault. */
	builtIn: boolean;
	/** Ruta de la nota que la registró (si fue descubierta). */
	sourcePath?: string;
}

export type SaturationLevel = "low" | "optimal" | "overload";

export interface StakeholderRecord {
	path: string;
	name: string;
	role: string;
	disciplineIds: string[];
	capacityHours: number;
}

export interface DeliverableRecord {
	path: string;
	code: string;
	title: string;
	docType: string;
	disciplineId: string | null;
	stageIds: TreatmentStageId[];
	phase: string;
	revision: string;
	statusRaw: string;
	status: DocStatusCategory;
	impacts: string[]; // ids de disciplina resueltos
	unresolvedImpacts: string[]; // términos de `impacts:` que no corresponden a ninguna disciplina
	dependsOn: string[]; // rutas resueltas
	assignedTo: string[]; // rutas de personas
	due: string | null;
	effortHours: number | null;
	critical: boolean;
	majorComments: number;
	requiredSignatures: string[]; // rutas de personas
	signatures: string[]; // rutas de personas
	commissioningCompliant: boolean;
}

/** Acta de reunión indexada (`type: meeting`). */
export interface MeetingRecord {
	path: string;
	title: string;
	date: string;
	meetingType: string;
	attendees: string[]; // rutas de personas
	disciplineIds: string[];
	related: string[]; // rutas de entregables
	openActions: number;
	closedActions: number;
}

/** Tarea en línea (- [ ]) que enlaza a una persona. */
export interface InlineTaskRecord {
	path: string;
	line: number;
	assigneePath: string;
}

/** Instantánea mínima para detectar cambios de revisión/estado. */
export interface DocSnapshot {
	revision: string;
	statusRaw: string;
	status: DocStatusCategory;
}

export interface ImpactTask {
	id: string;
	sourcePath: string;
	sourceCode: string;
	sourceRevision: string;
	fromState: string;
	toState: string;
	targetDisciplineId: string;
	/** Documento dependiente afectado (si el impacto proviene de depends_on). */
	targetDocPath: string | null;
	assignees: string[];
	reason: string;
	createdAt: number;
	dueAt: number;
	closedAt: number | null;
}

export type XpReason = "interference_cleared" | "critical_calc_validated" | "impact_matrix_closed";

export interface XpEvent {
	key: string; // clave de idempotencia
	reason: XpReason;
	points: number;
	label: string;
	at: number;
}

export interface GamificationState {
	xp: number;
	zeroReworkStreak: number;
	bestStreak: number;
	maturityLevel: number;
	events: XpEvent[];
	/** Etapas que ya recibieron sello de calidad (evita repetir Notice). */
	sealedStages: TreatmentStageId[];
}

export interface AquaPureSettings {
	lowSaturationPct: number;
	overloadSaturationPct: number;
	defaultTaskHours: number;
	defaultCapacityHours: number;
	impactSlaDays: number;
	disabledDisciplineIds: string[];
	writeDisciplineDossiers: boolean;
	dossierFolder: string;
	showNotices: boolean;
	excludedFolders: string[];
	/** Prefijo de proyecto para códigos autogenerados (PTAP-PRC-PID-001). */
	projectCode: string;
	peopleFolder: string;
	disciplinesFolder: string;
	deliverablesFolder: string;
	meetingsFolder: string;
	templatesFolder: string;
	/** Carpeta de salidas generadas por el plugin (registro de reuniones, estadísticas). */
	outputFolder: string;
	autoCompileMeetings: boolean;
}

export interface AquaPureData {
	settings: AquaPureSettings;
	snapshots: Record<string, DocSnapshot>;
	impactTasks: ImpactTask[];
	gamification: GamificationState;
	schemaVersion: number;
	/** true cuando ya se crearon las plantillas editables la primera vez. */
	templatesInitialized?: boolean;
}
