import { App, ButtonComponent, Modal, Notice, Setting, SuggestModal, TFile } from "obsidian";
import { DOC_TYPES, MEETING_TYPES, PHASES, ROLES, STATUS_PRESETS, TREATMENT_STAGES } from "../core/constants";
import { ActionInput, NoteFactory } from "../core/NoteFactory";
import type { DeliverableRecord } from "../core/types";
import { classifyStatus, isoDate, normalize } from "../core/utils";
import type AquaPurePlugin from "../main";

interface Option {
	value: string;
	label: string;
	color?: string;
}

/** Base de formularios: campos con validación y envío con Ctrl/Cmd+Enter. */
abstract class FormModal extends Modal {
	protected errorEl!: HTMLElement;
	private busy = false;

	constructor(app: App, protected readonly plugin: AquaPurePlugin, private readonly heading: string) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("aquapure-modal");
		this.titleEl.setText(this.heading);
		const form = this.contentEl.createDiv({ cls: "aquapure-form" });
		this.build(form);
		this.errorEl = this.contentEl.createDiv({ cls: "aquapure-form-error" });
		const footer = new Setting(this.contentEl);
		footer.addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()));
		footer.addButton((b) => this.decorateSubmit(b));
		this.scope.register(["Mod"], "Enter", () => {
			void this.trySubmit();
			return false;
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	protected abstract build(form: HTMLElement): void;
	/** Devuelve un mensaje de error o null si es válido. */
	protected abstract validate(): string | null;
	protected abstract submit(): Promise<void>;
	protected submitLabel(): string {
		return "Crear";
	}

	private decorateSubmit(b: ButtonComponent): void {
		b.setButtonText(this.submitLabel()).setCta().onClick(() => void this.trySubmit());
	}

	private async trySubmit(): Promise<void> {
		if (this.busy) return;
		const err = this.validate();
		this.errorEl.setText(err ?? "");
		if (err) return;
		this.busy = true;
		try {
			await this.submit();
			this.close();
		} catch (e) {
			console.error("[AquaPure] Error en formulario", e);
			this.errorEl.setText(`No se pudo completar: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			this.busy = false;
		}
	}

	// ----------------------------------------------------------- campos

	protected text(parent: HTMLElement, name: string, value: string, onChange: (v: string) => void, opts: { desc?: string; placeholder?: string; type?: string } = {}): HTMLInputElement {
		let input!: HTMLInputElement;
		new Setting(parent)
			.setName(name)
			.setDesc(opts.desc ?? "")
			.addText((t) => {
				input = t.inputEl;
				if (opts.type) t.inputEl.type = opts.type;
				t.setPlaceholder(opts.placeholder ?? "").setValue(value).onChange(onChange);
			});
		return input;
	}

	protected dropdown(parent: HTMLElement, name: string, options: Option[], value: string, onChange: (v: string) => void, desc = ""): HTMLSelectElement {
		let sel!: HTMLSelectElement;
		new Setting(parent)
			.setName(name)
			.setDesc(desc)
			.addDropdown((d) => {
				sel = d.selectEl;
				for (const o of options) d.addOption(o.value, o.label);
				d.setValue(value).onChange(onChange);
			});
		return sel;
	}

	/** Selector múltiple tipo chips (accesible: cada chip es un botón con aria-pressed). */
	protected chips(parent: HTMLElement, name: string, options: Option[], selected: Set<string>, desc = "", onToggle?: () => void): HTMLElement {
		const s = new Setting(parent).setName(name).setDesc(desc);
		s.settingEl.addClass("aquapure-chip-setting");
		const box = s.controlEl.createDiv({ cls: "aquapure-chip-picker" });
		if (!options.length) box.createSpan({ cls: "aquapure-hint", text: "No hay opciones todavía." });
		for (const o of options) {
			const b = box.createEl("button", { cls: "aquapure-chip aquapure-chip-toggle", text: o.label, attr: { type: "button", "aria-pressed": String(selected.has(o.value)) } });
			if (o.color) b.style.setProperty("--aquapure-disc", o.color);
			b.toggleClass("is-on", selected.has(o.value));
			b.onclick = (): void => {
				if (selected.has(o.value)) selected.delete(o.value);
				else selected.add(o.value);
				b.toggleClass("is-on", selected.has(o.value));
				b.setAttr("aria-pressed", String(selected.has(o.value)));
				onToggle?.();
			};
		}
		return box;
	}

	/** Lista de líneas libres (agenda, decisiones). */
	protected lines(parent: HTMLElement, name: string, desc: string, target: string[]): void {
		new Setting(parent)
			.setName(name)
			.setDesc(desc)
			.addTextArea((t) => {
				t.inputEl.rows = 3;
				t.setPlaceholder("Un elemento por línea").onChange((v) => {
					target.splice(0, target.length, ...v.split("\n").map((x) => x.trim()).filter(Boolean));
				});
			});
	}

	protected peopleOptions(): Option[] {
		return Array.from(this.plugin.index.stakeholders.values())
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((p) => ({ value: p.path, label: `${p.name} · ${p.role}` }));
	}

	protected disciplineOptions(): Option[] {
		const s = this.plugin.data.settings;
		return this.plugin.index.disciplines.active(s.disabledDisciplineIds).map((d) => ({ value: d.id, label: d.short, color: d.color }));
	}

	protected deliverableOptions(exclude?: string): Option[] {
		return Array.from(this.plugin.index.deliverables.values())
			.filter((d) => d.path !== exclude)
			.sort((a, b) => a.code.localeCompare(b.code))
			.map((d) => ({ value: d.path, label: d.code }));
	}

	protected async openCreated(file: TFile): Promise<void> {
		await this.app.workspace.getLeaf("tab").openFile(file);
	}
}

// =================================================================== Persona

export class NewPersonModal extends FormModal {
	private name = "";
	private role = "Ingeniero";
	private disc = new Set<string>();
	private capacity = 40;
	private email = "";

	constructor(app: App, plugin: AquaPurePlugin) {
		super(app, plugin, "Nuevo miembro del equipo");
		this.capacity = plugin.data.settings.defaultCapacityHours;
	}

	protected build(form: HTMLElement): void {
		this.text(form, "Nombre", "", (v) => (this.name = v.trim()), { placeholder: "Ing. Nombre Apellido" }).focus();
		this.dropdown(form, "Rol", ROLES.map((r) => ({ value: r, label: r })), this.role, (v) => (this.role = v));
		this.chips(form, "Disciplinas", this.disciplineOptions(), this.disc, "Define a quién se notifican los impactos.");
		this.text(form, "Capacidad (h/semana)", String(this.capacity), (v) => (this.capacity = parseFloat(v)), { type: "number", desc: "Base para el indicador de saturación." });
		this.text(form, "Correo (opcional)", "", (v) => (this.email = v.trim()), { type: "email" });
	}

	protected validate(): string | null {
		if (!this.name) return "Escribe el nombre.";
		if (!this.disc.size) return "Elige al menos una disciplina.";
		if (!Number.isFinite(this.capacity) || this.capacity <= 0) return "La capacidad debe ser mayor que 0.";
		return null;
	}

	protected async submit(): Promise<void> {
		const f = await this.plugin.factory.createPerson({ name: this.name, role: this.role, disciplineIds: [...this.disc], capacityHours: this.capacity, email: this.email });
		new Notice(`AquaPure: ${this.name} agregado al equipo.`);
		await this.openCreated(f);
	}
}

// =================================================================== Disciplina

export class NewDisciplineModal extends FormModal {
	private name = "";
	private short = "";
	private code = "";
	private color = "#c084fc";
	private aliases: string[] = [];

	constructor(app: App, plugin: AquaPurePlugin) {
		super(app, plugin, "Nueva disciplina");
	}

	protected build(form: HTMLElement): void {
		let codeInput: HTMLInputElement | null = null;
		this.text(form, "Nombre completo", "", (v) => {
			this.name = v.trim();
			if (codeInput && !codeInput.dataset.touched) {
				this.code = normalize(this.name).replace(/[^a-z]/g, "").slice(0, 3).toUpperCase();
				codeInput.value = this.code;
			}
		}, { placeholder: "Ej. Hidrogeología y Captación Subterránea" }).focus();
		this.text(form, "Nombre corto", "", (v) => (this.short = v.trim()), { desc: "Para chips y matrices. Si lo dejas vacío se usa el nombre.", placeholder: "Hidrogeología" });
		codeInput = this.text(form, "Código (3 letras)", "", (v) => (this.code = v.trim().toUpperCase()), { desc: "Se usa al numerar entregables: PTAP-HID-MEM-001" });
		codeInput.addEventListener("input", () => (codeInput!.dataset.touched = "1"));
		new Setting(form).setName("Color de acento").addColorPicker((c) => c.setValue(this.color).onChange((v) => (this.color = v)));
		this.text(form, "Términos alternativos", "", (v) => (this.aliases = v.split(",").map((x) => x.trim()).filter(Boolean)), { desc: "Separados por coma; permiten escribir `impacts: [hidro]`.", placeholder: "hidro, pozos" });
	}

	protected validate(): string | null {
		if (!this.name) return "Escribe el nombre.";
		if (this.plugin.index.disciplines.resolve(this.name)) return "Ya existe una disciplina con ese nombre o alias.";
		if (!/^[A-Z]{2,4}$/.test(this.code)) return "El código debe tener entre 2 y 4 letras.";
		return null;
	}

	protected async submit(): Promise<void> {
		const f = await this.plugin.factory.createDiscipline({ name: this.name, short: this.short, code: this.code, color: this.color, aliases: this.aliases });
		new Notice(`AquaPure: disciplina «${this.name}» creada.`);
		await this.openCreated(f);
	}
}

// =================================================================== Entregable

export class NewDeliverableModal extends FormModal {
	private disciplineId = "";
	private docType = DOC_TYPES[0].label;
	private code = "";
	private codeTouched = false;
	private title = "";
	private stages = new Set<string>();
	private phase = PHASES[1];
	private status = STATUS_PRESETS[1].value;
	private impacts = new Set<string>();
	private deps = new Set<string>();
	private assignedTo = "";
	private reviewers = new Set<string>();
	private due = "";
	private effort = 8;
	private critical = false;
	private codeInput!: HTMLInputElement;

	constructor(app: App, plugin: AquaPurePlugin) {
		super(app, plugin, "Nuevo entregable");
		this.disciplineId = this.disciplineOptions()[0]?.value ?? "";
		this.due = isoDate(Date.now() + 14 * 86_400_000);
	}

	protected build(form: HTMLElement): void {
		let criticalToggle: { setValue: (v: boolean) => unknown } | null = null as { setValue: (v: boolean) => unknown } | null;
		const refreshCode = (): void => {
			if (this.codeTouched || !this.disciplineId) return;
			this.code = this.plugin.factory.nextCode(this.disciplineId, this.docType);
			this.codeInput.value = this.code;
		};
		this.dropdown(form, "Disciplina", this.disciplineOptions(), this.disciplineId, (v) => {
			this.disciplineId = v;
			refreshCode();
		});
		this.dropdown(form, "Tipo de documento", DOC_TYPES.map((t) => ({ value: t.label, label: t.label })), this.docType, (v) => {
			this.docType = v;
			this.critical = !!DOC_TYPES.find((t) => t.label === v)?.critical;
			criticalToggle?.setValue(this.critical);
			refreshCode();
		});
		this.codeInput = this.text(form, "Código", "", (v) => {
			this.code = v.trim();
			this.codeTouched = true;
		}, { desc: "Se numera solo según los entregables existentes; puedes editarlo." });
		refreshCode();
		this.text(form, "Título", "", (v) => (this.title = v.trim()), { placeholder: "Memoria de cálculo del sedimentador de placas" }).focus();
		this.chips(form, "Etapas del tren", TREATMENT_STAGES.map((s) => ({ value: s.id, label: s.label })), this.stages);
		this.dropdown(form, "Fase", PHASES.map((p) => ({ value: p, label: p })), this.phase, (v) => (this.phase = v));
		this.dropdown(form, "Estado inicial (Rev A)", STATUS_PRESETS.map((s) => ({ value: s.value, label: s.label })), this.status, (v) => (this.status = v));
		this.chips(form, "Impacta a", this.disciplineOptions(), this.impacts, "Disciplinas que deben revisar cuando cambie su revisión.");
		this.chips(form, "Depende de", this.deliverableOptions(), this.deps, "Si alguno de estos cambia, este entregable recibe una revisión por impacto.");
		this.dropdown(form, "Responsable", [{ value: "", label: "— Sin asignar —" }, ...this.peopleOptions()], "", (v) => (this.assignedTo = v));
		this.chips(form, "Firmas requeridas", this.peopleOptions(), this.reviewers, "Necesarias para cerrar la matriz de impacto (+120 XP).");
		this.text(form, "Fecha límite", this.due, (v) => (this.due = v), { type: "date" });
		this.text(form, "Esfuerzo estimado (h)", String(this.effort), (v) => (this.effort = parseFloat(v)), { type: "number" });
		new Setting(form)
			.setName("Crítico")
			.setDesc("Memoria / instrumentación crítica: +80 XP al aprobarse.")
			.addToggle((t) => {
				criticalToggle = t;
				t.setValue(this.critical).onChange((v) => (this.critical = v));
			});
	}

	protected validate(): string | null {
		if (!this.disciplineId) return "Elige una disciplina.";
		if (!this.code) return "El código es obligatorio.";
		if (Array.from(this.plugin.index.deliverables.values()).some((d) => d.code === this.code)) return `Ya existe un entregable ${this.code}.`;
		if (!this.title) return "Escribe el título.";
		if (!Number.isFinite(this.effort) || this.effort <= 0) return "El esfuerzo debe ser mayor que 0.";
		return null;
	}

	protected async submit(): Promise<void> {
		const f = await this.plugin.factory.createDeliverable({
			code: this.code,
			title: this.title,
			docType: this.docType,
			disciplineId: this.disciplineId,
			stageIds: [...this.stages],
			phase: this.phase,
			status: this.status,
			impacts: [...this.impacts],
			dependsOn: [...this.deps],
			assignedTo: this.assignedTo,
			reviewers: [...this.reviewers],
			due: this.due,
			effortHours: this.effort,
			critical: this.critical
		});
		new Notice(`AquaPure: ${this.code} creado.`);
		await this.openCreated(f);
	}
}

// =================================================================== Reunión

export class NewMeetingModal extends FormModal {
	private title = "";
	private meetingType = MEETING_TYPES[0];
	private date = isoDate(Date.now());
	private attendees = new Set<string>();
	private disc = new Set<string>();
	private related = new Set<string>();
	private agenda: string[] = [];
	private decisions: string[] = [];
	private actions: ActionInput[] = [];

	constructor(app: App, plugin: AquaPurePlugin, preset?: { related?: string[]; title?: string }) {
		super(app, plugin, "Registrar reunión");
		preset?.related?.forEach((p) => this.related.add(p));
		if (preset?.title) this.title = preset.title;
	}

	protected build(form: HTMLElement): void {
		this.text(form, "Tema", this.title, (v) => (this.title = v.trim()), { placeholder: "Coordinación Procesos – Civil: floculador" }).focus();
		this.dropdown(form, "Tipo", MEETING_TYPES.map((t) => ({ value: t, label: t })), this.meetingType, (v) => (this.meetingType = v));
		this.text(form, "Fecha", this.date, (v) => (this.date = v), { type: "date" });
		this.chips(form, "Asistentes", this.peopleOptions(), this.attendees);
		this.chips(form, "Disciplinas", this.disciplineOptions(), this.disc);
		this.chips(form, "Entregables tratados", this.deliverableOptions(), this.related);
		this.lines(form, "Agenda", "Opcional; se puede completar después en la nota.", this.agenda);
		this.lines(form, "Decisiones", "Se compilan en el Registro de decisiones.", this.decisions);

		const s = new Setting(form).setName("Acciones").setDesc("Cada acción con responsable entra a su carga de trabajo.");
		s.settingEl.addClass("aquapure-chip-setting");
		const rows = s.controlEl.createDiv({ cls: "aquapure-action-rows" });
		const addRow = (): void => {
			const a: ActionInput = { text: "", ownerPath: "", due: isoDate(Date.now() + 7 * 86_400_000) };
			this.actions.push(a);
			const row = rows.createDiv({ cls: "aquapure-action-row" });
			const t = row.createEl("input", { type: "text", attr: { placeholder: "Acción", "aria-label": "Acción" } });
			t.oninput = (): void => void (a.text = t.value.trim());
			const sel = row.createEl("select", { cls: "dropdown", attr: { "aria-label": "Responsable" } });
			sel.createEl("option", { text: "Responsable…", value: "" });
			for (const o of this.peopleOptions()) sel.createEl("option", { text: o.label.split(" · ")[0], value: o.value });
			sel.onchange = (): void => void (a.ownerPath = sel.value);
			const d = row.createEl("input", { type: "date", value: a.due, attr: { "aria-label": "Fecha" } });
			d.onchange = (): void => void (a.due = d.value);
			const rm = row.createEl("button", { text: "✕", attr: { type: "button", "aria-label": "Quitar acción" } });
			rm.onclick = (): void => {
				this.actions.splice(this.actions.indexOf(a), 1);
				row.remove();
			};
			t.focus();
		};
		const add = s.controlEl.createEl("button", { text: "+ Acción", attr: { type: "button" } });
		add.onclick = addRow;
	}

	protected validate(): string | null {
		if (!this.title) return "Escribe el tema de la reunión.";
		if (!/^\d{4}-\d{2}-\d{2}$/.test(this.date)) return "Fecha inválida.";
		return null;
	}

	protected submitLabel(): string {
		return "Crear acta";
	}

	protected async submit(): Promise<void> {
		const f = await this.plugin.factory.createMeeting({
			title: this.title,
			meetingType: this.meetingType,
			date: this.date,
			attendees: [...this.attendees],
			disciplineIds: [...this.disc],
			related: [...this.related],
			agenda: this.agenda,
			decisions: this.decisions,
			actions: this.actions.filter((a) => a.text)
		});
		new Notice("AquaPure: acta creada.");
		await this.openCreated(f);
	}
}

// =================================================================== Emitir revisión

export class IssueRevisionModal extends FormModal {
	private status: string;
	private revision: string;
	private majors = 0;
	private note = "";
	private revInput!: HTMLInputElement;
	private revTouched = false;

	constructor(app: App, plugin: AquaPurePlugin, private readonly doc: DeliverableRecord) {
		super(app, plugin, `Emitir revisión · ${doc.code}`);
		const idx = STATUS_PRESETS.findIndex((s) => classifyStatus(s.value) === doc.status);
		this.status = STATUS_PRESETS[Math.min(STATUS_PRESETS.length - 1, Math.max(0, idx) + 1)].value;
		this.revision = NoteFactory.suggestNextRevision(doc.revision, classifyStatus(this.status) === "ifc");
	}

	protected build(form: HTMLElement): void {
		form.createDiv({ cls: "aquapure-hint", text: `Actual: Rev ${this.doc.revision || "—"} · ${this.doc.statusRaw || "sin estado"}` });
		this.dropdown(form, "Nuevo estado", STATUS_PRESETS.map((s) => ({ value: s.value, label: s.label })), this.status, (v) => {
			this.status = v;
			if (!this.revTouched) {
				this.revision = NoteFactory.suggestNextRevision(this.doc.revision, classifyStatus(v) === "ifc");
				this.revInput.value = this.revision;
			}
		});
		this.revInput = this.text(form, "Revisión", this.revision, (v) => {
			this.revision = v.trim().toUpperCase();
			this.revTouched = true;
		}, { desc: "Sugerida: letras durante el diseño, números desde IFC. Igual a la actual = solo cambio de estado." });
		this.text(form, "Observaciones mayores", "0", (v) => (this.majors = parseInt(v, 10) || 0), { type: "number", desc: "Más de 0 al emitir IFC reinicia la racha Cero Rework." });
		this.text(form, "Nota de la revisión", "", (v) => (this.note = v.trim()), { placeholder: "Ajuste de dosis máxima de PAC a 40 mg/L" });
		const affected = this.doc.impacts.length + this.plugin.index.dependentsOf(this.doc.path).length;
		form.createDiv({ cls: "aquapure-hint", text: affected ? `Se generarán revisiones por impacto para ${affected} destino(s).` : "Este entregable no declara impactos ni dependientes." });
	}

	protected validate(): string | null {
		if (!this.revision) return "Indica la revisión.";
		if (this.revision === this.doc.revision && this.status === this.doc.statusRaw.replace(/^Rev\s+\S+\s*-\s*/i, "")) return "No hay cambios.";
		return null;
	}

	protected submitLabel(): string {
		return "Emitir";
	}

	protected async submit(): Promise<void> {
		await this.plugin.factory.issueRevision(this.doc, this.revision, this.status, this.majors, this.note);
		new Notice(`AquaPure: ${this.doc.code} → Rev ${this.revision}`);
	}
}

// =================================================================== Firmar

export class SignModal extends FormModal {
	private signer = "";

	constructor(app: App, plugin: AquaPurePlugin, private readonly doc: DeliverableRecord) {
		super(app, plugin, `Firmar · ${doc.code} Rev ${doc.revision}`);
	}

	private pending(): string[] {
		return this.doc.requiredSignatures.filter((p) => !this.doc.signatures.includes(p));
	}

	protected build(form: HTMLElement): void {
		const pending = this.pending();
		const name = (p: string): string => this.plugin.index.stakeholders.get(p)?.name ?? p.replace(/\.md$/, "");
		const signed = this.doc.signatures.map(name);
		form.createDiv({ cls: "aquapure-hint", text: signed.length ? `Ya firmaron: ${signed.join(", ")}` : "Aún sin firmas." });
		const opts = (pending.length ? pending : Array.from(this.plugin.index.stakeholders.keys())).map((p) => ({ value: p, label: name(p) }));
		this.signer = opts[0]?.value ?? "";
		this.dropdown(form, "Firma de", opts, this.signer, (v) => (this.signer = v), pending.length ? `${pending.length} firma(s) requerida(s) pendiente(s).` : "No hay firmas requeridas pendientes; se registrará como firma adicional.");
	}

	protected validate(): string | null {
		return this.signer ? null : "No hay personas para firmar. Crea primero un miembro del equipo.";
	}

	protected submitLabel(): string {
		return "Firmar";
	}

	protected async submit(): Promise<void> {
		await this.plugin.factory.sign(this.doc, this.signer);
		new Notice(`AquaPure: firma registrada en ${this.doc.code}.`);
	}
}

// =================================================================== Selector de entregable

export class DeliverablePicker extends SuggestModal<DeliverableRecord> {
	constructor(app: App, private readonly plugin: AquaPurePlugin, private readonly onPick: (d: DeliverableRecord) => void) {
		super(app);
		this.setPlaceholder("Busca un entregable por código o título…");
	}

	getSuggestions(query: string): DeliverableRecord[] {
		const q = normalize(query);
		return Array.from(this.plugin.index.deliverables.values())
			.filter((d) => !q || normalize(`${d.code} ${d.title}`).includes(q))
			.sort((a, b) => a.code.localeCompare(b.code))
			.slice(0, 50);
	}

	renderSuggestion(d: DeliverableRecord, el: HTMLElement): void {
		el.createDiv({ cls: "aquapure-mono", text: d.code });
		el.createEl("small", { text: `${d.title} · Rev ${d.revision || "—"} · ${d.statusRaw}` });
	}

	onChooseSuggestion(d: DeliverableRecord): void {
		this.onPick(d);
	}
}
