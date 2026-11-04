/**
 * AquaPure: Potable Water Engineering Coordinator
 * Copyright (c) 2026 Juan Sebastián Herrera Delgado — MIT License
 *
 * Convierte el Vault en una cabina de control EPC para ingeniería de PTAP:
 * matriz disciplina × estado, gestión del cambio con Impact Tasks,
 * balance de carga y gamificación "Clean Flow". 100 % local.
 */
import { Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { DEFAULT_DATA, DEFAULT_SETTINGS, VIEW_TYPE_GUIDE, VIEW_TYPE_PENDING, VIEW_TYPE_PTAP_DASHBOARD } from "./core/constants";
import { setStages } from "./core/stages";
import { TaskCollector } from "./core/TaskCollector";
import type { TreatmentStage } from "./core/types";
import { TrainEditorModal } from "./ui/TrainEditorModal";
import type { GuideAction } from "./ui/guideContent";
import { GuideView } from "./views/GuideView";
import { PendingTasksView } from "./views/PendingTasksView";
import { CoordinatorEngine } from "./core/CoordinatorEngine";
import { DisciplineRegistry } from "./core/DisciplineRegistry";
import { DossierWriter } from "./core/DossierWriter";
import { MeetingCompiler } from "./core/MeetingCompiler";
import { NoteFactory } from "./core/NoteFactory";
import type { AquaPureData } from "./core/types";
import { debounceKeyed } from "./core/utils";
import { VaultIndex } from "./core/VaultIndex";
import { AquaPureSettingTab } from "./settings";
import { DeliverablePicker, IssueRevisionModal, NewDeliverableModal, NewDisciplineModal, NewMeetingModal, NewPersonModal, SignModal } from "./ui/modals";
import type { DeliverableRecord } from "./core/types";
import { PtapCoordinatorDashboardView } from "./views/PtapCoordinatorDashboardView";

export default class AquaPurePlugin extends Plugin {
	data: AquaPureData = structuredClone(DEFAULT_DATA);
	index!: VaultIndex;
	engine!: CoordinatorEngine;
	factory!: NoteFactory;
	meetings!: MeetingCompiler;
	tasks!: TaskCollector;
	private dossiers!: DossierWriter;
	private meetingsDirty = false;
	private statusEl: HTMLElement | null = null;
	private ready = false;
	private saveTimer: number | null = null;
	private refreshTimer: number | null = null;
	private reindexQueue!: (path: string) => void;

	async onload(): Promise<void> {
		try {
			await this.loadPluginData();
		} catch (err) {
			console.error("[AquaPure] data.json ilegible; se usan valores por defecto", err);
			new Notice("AquaPure: no se pudo leer data.json, se inicia con valores por defecto.");
		}

		setStages(this.data.settings.treatmentStages);
		const registry = new DisciplineRegistry();
		this.index = new VaultIndex(this.app, registry, () => {
			const st = this.data.settings;
			// Las carpetas propias del plugin (plantillas, salidas) nunca se indexan.
			return [...st.excludedFolders, st.templatesFolder, st.dossierFolder, st.outputFolder];
		});
		this.engine = new CoordinatorEngine(
			this.index,
			() => this.data,
			() => this.requestSave(),
			(msg, kind) => this.notify(msg, kind)
		);
		this.dossiers = new DossierWriter(this.app, this.index, this.engine, () => this.data.settings);
		this.factory = new NoteFactory(this.app, this.index, () => this.data.settings);
		this.meetings = new MeetingCompiler(this.app, this.index, () => this.data.settings);
		this.tasks = new TaskCollector(this.app, this.index);

		this.index.onDisciplineDiscovered((id) => {
			if (!this.ready) return;
			const def = registry.get(id);
			this.notify(`Nueva disciplina registrada: ${def?.name ?? id}`, "info");
			this.scheduleRefresh();
		});

		this.registerView(VIEW_TYPE_PTAP_DASHBOARD, (leaf) => new PtapCoordinatorDashboardView(leaf, this));
		this.registerView(VIEW_TYPE_PENDING, (leaf) => new PendingTasksView(leaf, this));
		this.registerView(VIEW_TYPE_GUIDE, (leaf) => new GuideView(leaf, this));
		this.addRibbonIcon("droplets", "Abrir Dashboard del Coordinador PTAP", () => void this.activateDashboard());
		this.addSettingTab(new AquaPureSettingTab(this.app, this));
		this.registerCommands();
		this.registerFileMenu();
		this.statusEl = this.addStatusBarItem();
		this.statusEl.addClass("aquapure-statusbar");
		this.statusEl.onclick = (): void => void this.activateDashboard();

		// Re-indexado por archivo con debounce: un guardado continuo no satura el hilo principal.
		this.reindexQueue = debounceKeyed((path) => {
			const f = this.app.vault.getAbstractFileByPath(path);
			const wasMeeting = this.index.meetings.has(path);
			if (f instanceof TFile) this.index.indexFile(f);
			if (wasMeeting || this.index.meetings.has(path)) this.meetingsDirty = true;
			this.scheduleRefresh();
		}, 400);

		this.app.workspace.onLayoutReady(() => {
			// MetadataCache puede no estar listo en bóvedas grandes: esperamos a 'resolved' la primera vez.
			const boot = (): void => this.bootstrap();
			if (this.app.metadataCache.resolvedLinks && Object.keys(this.app.metadataCache.resolvedLinks).length > 0) boot();
			else {
				const ref = this.app.metadataCache.on("resolved", () => {
					this.app.metadataCache.offref(ref);
					boot();
				});
				this.registerEvent(ref);
				// Respaldo para bóvedas vacías, donde 'resolved' podría no dispararse.
				window.setTimeout(() => {
					if (!this.ready) boot();
				}, 3000);
			}
		});
	}

	onunload(): void {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			void this.saveData(this.data);
		}
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
	}

	// ------------------------------------------------------------- arranque

	private bootstrap(): void {
		if (this.ready) return;
		try {
			const t0 = performance.now();
			this.index.fullScan();
			this.engine.reconcileAfterScan();
			this.ready = true;
			console.info(`[AquaPure] Índice listo: ${this.index.deliverables.size} entregables, ${this.index.stakeholders.size} personas (${Math.round(performance.now() - t0)} ms)`);
		} catch (err) {
			console.error("[AquaPure] Falló el escaneo inicial", err);
			new Notice("AquaPure: error en el escaneo inicial. Revisa la consola (Ctrl+Shift+I).");
			this.ready = true;
		}
		this.registerVaultEvents();
		this.scheduleRefresh();
		if (!this.data.guideShown) {
			this.data.guideShown = true;
			this.requestSave();
			void this.openGuide("inicio");
		}
		if (!this.data.templatesInitialized) {
			this.factory
				.ensureTemplates()
				.then(() => {
					this.data.templatesInitialized = true;
					this.requestSave();
				})
				.catch((err) => console.error("[AquaPure] No se pudieron crear las plantillas", err));
		}
	}

	private registerVaultEvents(): void {
		// Frontmatter ya parseado: es la señal fiable para detectar cambios de revisión/estado.
		this.registerEvent(this.app.metadataCache.on("changed", (file) => this.reindexQueue(file.path)));
		// Listeners del Vault solicitados: create/modify encolan; delete/rename limpian el índice.
		this.registerEvent(
			this.app.vault.on("create", (f: TAbstractFile) => {
				if (f instanceof TFile && f.extension === "md") this.reindexQueue(f.path);
			})
		);
		this.registerEvent(
			this.app.vault.on("modify", (f: TAbstractFile) => {
				if (f instanceof TFile && f.extension === "md") this.reindexQueue(f.path);
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (f: TAbstractFile) => {
				if (f instanceof TFile) {
					if (this.index.meetings.has(f.path)) this.meetingsDirty = true;
					this.index.removePath(f.path);
					this.scheduleRefresh();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (f: TAbstractFile, oldPath: string) => {
				if (!(f instanceof TFile) || f.extension !== "md") return;
				this.index.renamePath(oldPath, f);
				for (const t of this.data.impactTasks) {
					if (t.sourcePath === oldPath) t.sourcePath = f.path;
					if (t.targetDocPath === oldPath) t.targetDocPath = f.path;
					t.assignees = t.assignees.map((p) => (p === oldPath ? f.path : p));
				}
				const snap = this.data.snapshots[oldPath];
				if (snap) {
					this.data.snapshots[f.path] = snap;
					delete this.data.snapshots[oldPath];
				}
				this.requestSave();
				this.scheduleRefresh();
			})
		);
	}

	private registerCommands(): void {
		this.addCommand({ id: "open-dashboard", name: "Abrir Dashboard del Coordinador PTAP", callback: () => void this.activateDashboard() });
		this.addCommand({
			id: "rescan-vault",
			name: "Re-escanear Vault (disciplinas, personas y entregables)",
			callback: () => {
				this.index.fullScan();
				this.engine.reconcileAfterScan();
				this.refreshViews();
				new Notice(`AquaPure: ${this.index.deliverables.size} entregables · ${this.index.stakeholders.size} personas · ${this.index.disciplines.all().length} disciplinas`);
			}
		});
		this.addCommand({ id: "open-pending", name: "Abrir pendientes de entregables", callback: () => void this.openPending() });
		this.addCommand({ id: "open-guide", name: "Abrir guía de uso", callback: () => void this.openGuide() });
		this.addCommand({ id: "edit-train", name: "Editar tren de tratamiento", callback: () => new TrainEditorModal(this.app, this).open() });
		// --- Formularios de creación (v1.1)
		this.addCommand({ id: "new-person", name: "Nuevo miembro del equipo", callback: () => new NewPersonModal(this.app, this).open() });
		this.addCommand({ id: "new-discipline", name: "Nueva disciplina", callback: () => new NewDisciplineModal(this.app, this).open() });
		this.addCommand({ id: "new-deliverable", name: "Nuevo entregable", callback: () => new NewDeliverableModal(this.app, this).open() });
		this.addCommand({ id: "new-meeting", name: "Registrar reunión", callback: () => this.openMeetingForm() });
		this.addCommand({ id: "issue-revision", name: "Emitir nueva revisión de un entregable", callback: () => this.withDeliverable((d) => new IssueRevisionModal(this.app, this, d).open()) });
		this.addCommand({ id: "sign-deliverable", name: "Firmar un entregable", callback: () => this.withDeliverable((d) => new SignModal(this.app, this, d).open()) });
		this.addCommand({
			id: "compile-meetings",
			name: "Compilar registro de reuniones",
			callback: () => void this.compileAndOpenMeetings()
		});
		this.addCommand({
			id: "create-templates",
			name: "Crear / restaurar plantillas editables",
			callback: async () => {
				try {
					const n = await this.factory.ensureTemplates();
					new Notice(n ? `AquaPure: ${n} plantilla(s) creada(s) en ${this.data.settings.templatesFolder}` : "AquaPure: las plantillas ya existen.");
				} catch (err) {
					console.error(err);
					new Notice("AquaPure: no se pudieron crear las plantillas.");
				}
			}
		});
		this.addCommand({ id: "export-stats", name: "Exportar estadísticas Clean Flow (JSON)", callback: () => void this.exportStats() });
		this.addCommand({
			id: "write-dossiers",
			name: "Regenerar expedientes de impacto por disciplina",
			callback: () => void this.dossiers.writeAll(true)
		});
	}

	// ------------------------------------------------------------- vistas

	async activateDashboard(): Promise<void> {
		try {
			const { workspace } = this.app;
			let leaf = workspace.getLeavesOfType(VIEW_TYPE_PTAP_DASHBOARD)[0];
			if (!leaf) {
				leaf = workspace.getLeaf("tab");
				await leaf.setViewState({ type: VIEW_TYPE_PTAP_DASHBOARD, active: true });
			}
			await workspace.revealLeaf(leaf);
		} catch (err) {
			console.error("[AquaPure] No se pudo abrir el dashboard", err);
			new Notice("AquaPure: no se pudo abrir el dashboard.");
		}
	}

	/** Re-render agrupado (máx. ~3/s) de todas las vistas abiertas y de los expedientes. */
	scheduleRefresh(): void {
		if (this.refreshTimer !== null) return;
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.refreshViews();
			if (this.data.settings.writeDisciplineDossiers) void this.dossiers.writeAll(false);
			if (this.meetingsDirty && this.data.settings.autoCompileMeetings) {
				this.meetingsDirty = false;
				void this.meetings.compile();
			}
		}, 300);
	}

	/** Clic derecho sobre un entregable: acciones sin abrir el dashboard. */
	private registerFileMenu(): void {
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFile)) return;
				const doc = this.index.deliverables.get(file.path);
				if (!doc) return;
				menu.addSeparator();
				menu.addItem((i) => i.setTitle("AquaPure: emitir nueva revisión").setIcon("file-up").onClick(() => new IssueRevisionModal(this.app, this, doc).open()));
				menu.addItem((i) => i.setTitle("AquaPure: firmar").setIcon("pen-line").onClick(() => new SignModal(this.app, this, doc).open()));
				menu.addItem((i) =>
					i.setTitle("AquaPure: registrar reunión sobre este entregable").setIcon("calendar-plus").onClick(() => new NewMeetingModal(this.app, this, { related: [doc.path], title: `Revisión ${doc.code}` }).open())
				);
			})
		);
	}

	private updateStatusBar(): void {
		if (!this.statusEl) return;
		const open = this.engine.openImpactTasks();
		const overdue = open.filter((t) => t.dueAt < Date.now()).length;
		this.statusEl.setText(`💧 ${open.length} impactos${overdue ? ` · ⚠ ${overdue} vencidos` : ""} · ${this.data.gamification.xp} XP`);
		this.statusEl.setAttr("aria-label", "Abrir Dashboard del Coordinador PTAP");
		this.statusEl.toggleClass("is-alarm", overdue > 0);
	}

	refreshViews(): void {
		this.updateStatusBar();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PTAP_DASHBOARD)) {
			const view = leaf.view;
			if (view instanceof PtapCoordinatorDashboardView) view.render();
		}
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PENDING)) {
			const view = leaf.view;
			if (view instanceof PendingTasksView) view.refresh();
		}
	}

	/** Usa el entregable de la nota activa o, si no lo es, abre un buscador. */
	withDeliverable(fn: (d: DeliverableRecord) => void): void {
		const active = this.app.workspace.getActiveFile();
		const doc = active ? this.index.deliverables.get(active.path) : undefined;
		if (doc) fn(doc);
		else new DeliverablePicker(this.app, this, fn).open();
	}

	/** Reunión: si la nota activa es un entregable, se pre-carga como tratado. */
	openMeetingForm(): void {
		const active = this.app.workspace.getActiveFile();
		const doc = active ? this.index.deliverables.get(active.path) : undefined;
		new NewMeetingModal(this.app, this, doc ? { related: [doc.path], title: `Revisión ${doc.code}` } : undefined).open();
	}

	async compileAndOpenMeetings(): Promise<void> {
		const f = await this.meetings.compile();
		if (f) await this.app.workspace.getLeaf("tab").openFile(f);
		else new Notice("AquaPure: no se pudo compilar el registro de reuniones.");
	}

	/** Abre (o enfoca) una vista propia en una pestaña. */
	private async openView(type: string): Promise<WorkspaceLeaf | null> {
		try {
			const { workspace } = this.app;
			let leaf = workspace.getLeavesOfType(type)[0];
			if (!leaf) {
				leaf = workspace.getLeaf("tab");
				await leaf.setViewState({ type, active: true });
			}
			await workspace.revealLeaf(leaf);
			return leaf;
		} catch (err) {
			console.error(`[AquaPure] No se pudo abrir la vista ${type}`, err);
			new Notice("AquaPure: no se pudo abrir la vista.");
			return null;
		}
	}

	async openPending(): Promise<void> {
		await this.openView(VIEW_TYPE_PENDING);
	}

	async openGuide(section?: string): Promise<void> {
		const leaf = await this.openView(VIEW_TYPE_GUIDE);
		if (leaf && section && leaf.view instanceof GuideView) {
			const view = leaf.view;
			window.setTimeout(() => view.goTo(section), 150);
		}
	}

	runGuideAction(action: GuideAction): void {
		switch (action) {
			case "new-person":
				new NewPersonModal(this.app, this).open();
				break;
			case "new-discipline":
				new NewDisciplineModal(this.app, this).open();
				break;
			case "new-deliverable":
				new NewDeliverableModal(this.app, this).open();
				break;
			case "new-meeting":
				this.openMeetingForm();
				break;
			case "edit-train":
				new TrainEditorModal(this.app, this).open();
				break;
			case "open-dashboard":
				void this.activateDashboard();
				break;
			case "open-pending":
				void this.openPending();
				break;
			case "create-templates":
				void this.factory.ensureTemplates().then((n) => new Notice(n ? `AquaPure: ${n} plantilla(s) creada(s).` : "AquaPure: las plantillas ya existen."));
				break;
			case "open-settings": {
				// API no tipada pública: abre los ajustes en la pestaña del plugin.
				const setting = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
				setting?.open();
				setting?.openTabById(this.manifest.id);
				break;
			}
		}
	}

	/** Guarda un nuevo tren de tratamiento y re-indexa para reasociar etapas. */
	async applyTreatmentStages(stages: TreatmentStage[]): Promise<void> {
		this.data.settings.treatmentStages = stages;
		setStages(stages);
		const sealed = this.data.gamification.sealedStages;
		this.data.gamification.sealedStages = sealed.filter((id) => stages.some((s) => s.id === id));
		this.index.fullScan();
		this.engine.evaluateProjectState(true);
		await this.saveAndRefresh();
	}

	isReady(): boolean {
		return this.ready;
	}

	// ------------------------------------------------------------- persistencia

	private async loadPluginData(): Promise<void> {
		const raw = (await this.loadData()) as Partial<AquaPureData> | null;
		const base = structuredClone(DEFAULT_DATA);
		if (!raw) {
			this.data = base;
			return;
		}
		this.data = {
			schemaVersion: base.schemaVersion,
			settings: { ...structuredClone(DEFAULT_SETTINGS), ...(raw.settings ?? {}) },
			snapshots: raw.snapshots ?? {},
			impactTasks: Array.isArray(raw.impactTasks) ? raw.impactTasks : [],
			gamification: { ...base.gamification, ...(raw.gamification ?? {}) },
			templatesInitialized: raw.templatesInitialized ?? false,
			guideShown: raw.guideShown ?? false
		};
	}

	/** Guardado diferido (1 s) para agrupar ráfagas de eventos en una sola escritura. */
	requestSave(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			this.saveData(this.data).catch((err) => console.error("[AquaPure] Error guardando data.json", err));
		}, 1000);
	}

	async saveSettingsOnly(): Promise<void> {
		try {
			await this.saveData(this.data);
		} catch (err) {
			console.error("[AquaPure] Error guardando ajustes", err);
		}
	}

	async saveAndRefresh(): Promise<void> {
		await this.saveSettingsOnly();
		this.refreshViews();
	}

	async resetGamification(): Promise<void> {
		this.data.gamification = structuredClone(DEFAULT_DATA.gamification);
		this.engine.evaluateProjectState(true);
		await this.saveAndRefresh();
	}

	async exportStats(): Promise<void> {
		try {
			const folder = this.data.settings.outputFolder || "AquaPure";
			await this.factory.ensureFolder(folder);
			const path = normalizePath(`${folder}/aquapure-stats.json`);
			const m = this.engine.maturity();
			const payload = {
				exportedAt: new Date().toISOString(),
				maturity: m,
				gamification: this.data.gamification,
				openImpactTasks: this.engine.openImpactTasks(),
				workload: this.engine.workload().map((r) => ({ person: r.person.name, hours: r.hours, capacity: r.capacity, pct: Math.round(r.pct), level: r.level }))
			};
			const json = JSON.stringify(payload, null, 2);
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) await this.app.vault.modify(existing, json);
			else await this.app.vault.create(path, json);
			new Notice(`AquaPure: estadísticas exportadas a ${path}`);
		} catch (err) {
			console.error("[AquaPure] Exportación fallida", err);
			new Notice("AquaPure: no se pudieron exportar las estadísticas.");
		}
	}

	private notify(message: string, kind: "info" | "impact" | "xp" | "seal" | "level"): void {
		if (!this.ready || !this.data.settings.showNotices) return;
		const frag = createFragment((f) => {
			f.createSpan({ cls: `aquapure-notice aquapure-notice--${kind}`, text: message });
		});
		new Notice(frag, kind === "impact" || kind === "level" ? 8000 : 5000);
	}
}
