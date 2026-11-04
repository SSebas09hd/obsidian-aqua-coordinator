import { App, TFile, TFolder, normalizePath, stringifyYaml } from "obsidian";
import { DISCIPLINE_CODES, DOC_TYPES } from "./constants";
import { stageLabel } from "./stages";
import type { AquaPureSettings, DeliverableRecord } from "./types";
import { isoDate, normalize } from "./utils";
import type { VaultIndex } from "./VaultIndex";

export type TemplateKind = "persona" | "disciplina" | "entregable" | "reunion";

export interface PersonInput {
	name: string;
	role: string;
	disciplineIds: string[];
	capacityHours: number;
	email: string;
}

export interface DisciplineInput {
	name: string;
	short: string;
	code: string;
	color: string;
	aliases: string[];
}

export interface DeliverableInput {
	code: string;
	title: string;
	docType: string;
	disciplineId: string;
	stageIds: string[];
	phase: string;
	status: string;
	impacts: string[];
	dependsOn: string[]; // rutas
	assignedTo: string; // ruta o ""
	reviewers: string[]; // rutas: firmas requeridas
	due: string;
	effortHours: number;
	critical: boolean;
}

export interface ActionInput {
	text: string;
	ownerPath: string;
	due: string;
}

export interface MeetingInput {
	title: string;
	meetingType: string;
	date: string;
	attendees: string[];
	disciplineIds: string[];
	related: string[];
	agenda: string[];
	decisions: string[];
	actions: ActionInput[];
}

/**
 * Crea y actualiza notas con frontmatter válido (stringifyYaml / processFrontMatter):
 * nunca se edita YAML con expresiones regulares. El cuerpo sale de una plantilla
 * editable en `templatesFolder` o, si no existe, de la plantilla integrada.
 */
export class NoteFactory {
	constructor(private readonly app: App, private readonly index: VaultIndex, private readonly settings: () => AquaPureSettings) {}

	// ------------------------------------------------------------ creación

	async createPerson(p: PersonInput): Promise<TFile> {
		const fm: Record<string, unknown> = {
			type: "stakeholder",
			name: p.name,
			role: p.role,
			discipline: p.disciplineIds.map((id) => this.index.disciplines.get(id)?.short ?? id),
			capacity_hours: p.capacityHours
		};
		if (p.email) fm["email"] = p.email;
		const discNames = p.disciplineIds.map((id) => this.index.disciplines.get(id)?.name ?? id).join(", ");
		const body = await this.body("persona", { title: p.name, name: p.name, role: p.role, disciplines: discNames || "—", capacity: String(p.capacityHours) });
		return this.create(this.settings().peopleFolder, `${p.name} - ${p.role}`, fm, body);
	}

	async createDiscipline(d: DisciplineInput): Promise<TFile> {
		const fm: Record<string, unknown> = { type: "discipline", name: d.name, short: d.short || d.name, code: d.code.toUpperCase(), color: d.color };
		if (d.aliases.length) fm["aliases_discipline"] = d.aliases;
		const body = await this.body("disciplina", { title: d.name, name: d.name, code: d.code.toUpperCase() });
		return this.create(this.settings().disciplinesFolder, `Disciplina - ${d.name}`, fm, body);
	}

	async createDeliverable(d: DeliverableInput): Promise<TFile> {
		const disc = this.index.disciplines.get(d.disciplineId);
		const link = (p: string): string => `[[${this.linkText(p)}]]`;
		const fm: Record<string, unknown> = {
			type: "deliverable",
			code: d.code,
			title: d.title,
			doc_type: d.docType,
			discipline: disc?.short ?? d.disciplineId,
			stage: d.stageIds,
			phase: d.phase,
			revision: "A",
			status: `Rev A - ${d.status}`,
			impacts: d.impacts.map((id) => this.index.disciplines.get(id)?.short ?? id),
			depends_on: d.dependsOn.map(link),
			assigned_to: d.assignedTo ? link(d.assignedTo) : "",
			due: d.due,
			effort_hours: d.effortHours,
			critical: d.critical,
			major_comments: 0,
			required_signatures: d.reviewers.map(link),
			signatures: [],
			revision_history: [{ rev: "A", date: isoDate(Date.now()), status: d.status }]
		};
		const stages = d.stageIds.map(stageLabel).join(", ");
		const body = await this.body("entregable", {
			title: d.title,
			code: d.code,
			doc_type: d.docType,
			discipline: disc?.name ?? d.disciplineId,
			stages: stages || "—",
			impacts: d.impacts.map((id) => this.index.disciplines.get(id)?.short ?? id).join(", ") || "—",
			depends_on: d.dependsOn.map(link).join(", ") || "—"
		});
		return this.create(this.settings().deliverablesFolder, `${d.code} ${d.title}`, fm, body);
	}

	async createMeeting(m: MeetingInput): Promise<TFile> {
		const link = (p: string): string => `[[${this.linkText(p)}]]`;
		const fm: Record<string, unknown> = {
			type: "meeting",
			title: m.title,
			meeting_type: m.meetingType,
			date: m.date,
			attendees: m.attendees.map(link),
			disciplines: m.disciplineIds.map((id) => this.index.disciplines.get(id)?.short ?? id),
			related: m.related.map(link)
		};
		const bullets = (items: string[], empty: string): string => (items.length ? items.map((x) => `- ${x}`).join("\n") : empty);
		const actions = m.actions.length
			? m.actions.map((a) => `- [ ] ${a.text}${a.ownerPath ? ` ${link(a.ownerPath)}` : ""}${a.due ? ` 📅 ${a.due}` : ""}`).join("\n")
			: "_Agrega acciones como `- [ ] Acción [[Responsable]] 📅 AAAA-MM-DD`: entran a la carga de esa persona._";
		const body = await this.body("reunion", {
			title: m.title,
			date: m.date,
			meeting_type: m.meetingType,
			attendees: m.attendees.map(link).join(", ") || "—",
			related: m.related.map(link).join(", ") || "—",
			agenda: bullets(m.agenda, "- "),
			decisions: bullets(m.decisions, "- "),
			actions
		});
		return this.create(this.settings().meetingsFolder, `${m.date} ${m.title}`, fm, body);
	}

	// ------------------------------------------------------------ acciones sobre entregables

	/** Emite una nueva revisión: actualiza revision/status/historial con la API oficial. */
	async issueRevision(doc: DeliverableRecord, revision: string, status: string, majorComments: number, note: string): Promise<void> {
		const file = this.fileAt(doc.path);
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			const history = Array.isArray(fm["revision_history"]) ? (fm["revision_history"] as unknown[]) : [];
			history.push({ rev: revision, date: isoDate(Date.now()), status, ...(note ? { note } : {}) });
			fm["revision"] = revision;
			fm["status"] = `Rev ${revision} - ${status}`;
			fm["major_comments"] = majorComments;
			fm["revision_history"] = history;
			// Una revisión nueva invalida las firmas de la anterior.
			if (revision !== doc.revision) fm["signatures"] = [];
		});
	}

	async sign(doc: DeliverableRecord, personPath: string): Promise<void> {
		const file = this.fileAt(doc.path);
		const link = `[[${this.linkText(personPath)}]]`;
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			const list = Array.isArray(fm["signatures"]) ? (fm["signatures"] as unknown[]).map(String) : [];
			if (!list.includes(link)) list.push(link);
			fm["signatures"] = list;
		});
	}

	// ------------------------------------------------------------ códigos y revisiones

	/** Siguiente código libre: PTAP-PRC-PID-003. */
	nextCode(disciplineId: string, docTypeLabel: string): string {
		const project = (this.settings().projectCode || "PTAP").toUpperCase();
		const disc = this.disciplineCode(disciplineId);
		const type = DOC_TYPES.find((t) => t.label === docTypeLabel)?.code ?? (normalize(docTypeLabel).replace(/[^a-z]/g, "").slice(0, 3).toUpperCase() || "DOC");
		const prefix = `${project}-${disc}-${type}-`;
		let max = 0;
		for (const d of this.index.deliverables.values()) {
			if (!d.code.startsWith(prefix)) continue;
			const n = parseInt(d.code.slice(prefix.length), 10);
			if (Number.isFinite(n)) max = Math.max(max, n);
		}
		return `${prefix}${String(max + 1).padStart(3, "0")}`;
	}

	disciplineCode(id: string): string {
		if (DISCIPLINE_CODES[id]) return DISCIPLINE_CODES[id];
		const def = this.index.disciplines.get(id);
		const src = def?.sourcePath ? this.app.metadataCache.getCache(def.sourcePath)?.frontmatter?.["code"] : undefined;
		if (typeof src === "string" && src.trim()) return src.trim().toUpperCase();
		return normalize(def?.short ?? id).replace(/[^a-z]/g, "").slice(0, 3).toUpperCase() || "GEN";
	}

	/** Convención usual: A, B, C… en revisión; 0, 1, 2… a partir de IFC. */
	static suggestNextRevision(current: string, targetIsIfc: boolean): string {
		const c = current.trim().toUpperCase();
		if (/^\d+$/.test(c)) return String(parseInt(c, 10) + 1);
		if (targetIsIfc) return "0";
		if (/^[A-Y]$/.test(c)) return String.fromCharCode(c.charCodeAt(0) + 1);
		return c ? `${c}1` : "A";
	}

	// ------------------------------------------------------------ plantillas

	static readonly BUILTIN_TEMPLATES: Record<TemplateKind, string> = {
		persona: [
			"# {{name}} · {{role}}",
			"",
			"> [!info] Ficha del profesional",
			"> **Disciplinas:** {{disciplines}} · **Capacidad:** {{capacity}} h/semana",
			"",
			"## Compromisos",
			"Toda tarea abierta en esta nota cuenta en su carga de trabajo. Escríbelas como `- [ ] Tarea 📅 AAAA-MM-DD`.",
			"",
			"## Notas"
		].join("\n"),
		disciplina: [
			"# {{name}}",
			"",
			"Disciplina registrada por AquaPure (código `{{code}}`). Aparece en filtros, matriz de impacto y ajustes.",
			"",
			"## Alcance",
			"- ",
			"",
			"## Criterios y normas de referencia",
			"- "
		].join("\n"),
		entregable: [
			"# `{{code}}` · {{title}}",
			"",
			"> [!abstract] Ficha",
			"> **Tipo:** {{doc_type}} · **Disciplina:** {{discipline}} · **Etapas:** {{stages}}",
			"> **Impacta a:** {{impacts}} · **Depende de:** {{depends_on}}",
			"",
			"## Alcance",
			"- ",
			"",
			"## Bases de diseño",
			"| Parámetro | Valor | Unidad | Fuente |",
			"|---|---|---|---|",
			"|  |  |  |  |",
			"",
			"## Interfaces con otras disciplinas",
			"- ",
			"",
			"## Pendientes",
			"- [ ] "
		].join("\n"),
		reunion: [
			"# {{title}}",
			"",
			"> [!info] {{meeting_type}} · {{date}}",
			"> **Asistentes:** {{attendees}}",
			"> **Entregables tratados:** {{related}}",
			"",
			"## Agenda",
			"{{agenda}}",
			"",
			"## Desarrollo",
			"",
			"",
			"## Decisiones",
			"{{decisions}}",
			"",
			"## Acciones",
			"{{actions}}"
		].join("\n")
	};

	templatePath(kind: TemplateKind): string {
		const names: Record<TemplateKind, string> = { persona: "Plantilla - Persona", disciplina: "Plantilla - Disciplina", entregable: "Plantilla - Entregable", reunion: "Plantilla - Reunión" };
		return normalizePath(`${this.settings().templatesFolder}/${names[kind]}.md`);
	}

	/** Crea las plantillas editables que falten (no sobrescribe las del usuario). */
	async ensureTemplates(): Promise<number> {
		await this.ensureFolder(this.settings().templatesFolder);
		let created = 0;
		for (const kind of Object.keys(NoteFactory.BUILTIN_TEMPLATES) as TemplateKind[]) {
			const path = this.templatePath(kind);
			if (this.app.vault.getAbstractFileByPath(path)) continue;
			const header = `<!-- Plantilla AquaPure: edita libremente el cuerpo. Variables disponibles: ${this.variablesFor(kind)}. El frontmatter lo genera el formulario. -->\n`;
			await this.app.vault.create(path, header + NoteFactory.BUILTIN_TEMPLATES[kind] + "\n");
			created++;
		}
		return created;
	}

	private variablesFor(kind: TemplateKind): string {
		const m = NoteFactory.BUILTIN_TEMPLATES[kind].match(/\{\{\w+\}\}/g) ?? [];
		return Array.from(new Set(m)).join(" ");
	}

	private async body(kind: TemplateKind, vars: Record<string, string>): Promise<string> {
		let tpl = NoteFactory.BUILTIN_TEMPLATES[kind];
		try {
			const f = this.app.vault.getAbstractFileByPath(this.templatePath(kind));
			if (f instanceof TFile) {
				const raw = await this.app.vault.cachedRead(f);
				// Quita frontmatter y comentarios HTML de la plantilla.
				tpl = raw.replace(/^---\n[\s\S]*?\n---\n?/, "").replace(/<!--[\s\S]*?-->\n?/g, "");
			}
		} catch (err) {
			console.warn("[AquaPure] Plantilla ilegible, se usa la integrada", err);
		}
		const all: Record<string, string> = { date: isoDate(Date.now()), ...vars };
		return tpl.replace(/\{\{(\w+)\}\}/g, (m, key: string) => (key in all ? all[key] : m));
	}

	// ------------------------------------------------------------ utilidades de archivo

	private async create(folder: string, baseName: string, fm: Record<string, unknown>, body: string): Promise<TFile> {
		await this.ensureFolder(folder);
		const safe = baseName.replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/\s+/g, " ").trim().slice(0, 150) || "Sin título";
		let path = normalizePath(`${folder}/${safe}.md`);
		for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`${folder}/${safe} (${i}).md`);
		const content = `---\n${stringifyYaml(fm)}---\n${body.startsWith("\n") ? "" : "\n"}${body}\n`;
		return this.app.vault.create(path, content);
	}

	async ensureFolder(folder: string): Promise<void> {
		const clean = normalizePath(folder);
		if (!clean || clean === "/") return;
		let acc = "";
		for (const part of clean.split("/")) {
			acc = acc ? `${acc}/${part}` : part;
			const f = this.app.vault.getAbstractFileByPath(acc);
			if (!f) await this.app.vault.createFolder(acc);
			else if (!(f instanceof TFolder)) throw new Error(`${acc} existe y no es una carpeta`);
		}
	}

	private fileAt(path: string): TFile {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) throw new Error(`No existe ${path}`);
		return f;
	}

	/** Texto de enlace más corto no ambiguo para una ruta. */
	linkText(path: string): string {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (f instanceof TFile) return this.app.metadataCache.fileToLinktext(f, "", true);
		return path.replace(/\.md$/, "");
	}
}
