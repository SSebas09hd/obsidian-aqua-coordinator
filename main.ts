/**
 * AquaPure: Potable Water Engineering Coordinator
 * Copyright (c) 2026 Juan Sebastián Herrera Delgado — MIT License
 *
 * Convierte el Vault en una cabina de control EPC para ingeniería de PTAP:
 * matriz disciplina × estado, gestión del cambio con Impact Tasks,
 * balance de carga y gamificación "Clean Flow". 100 % local.
 */
import { Notice, Plugin, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { DEFAULT_DATA, DEFAULT_SETTINGS, VIEW_TYPE_PTAP_DASHBOARD } from "./core/constants";
import { CoordinatorEngine } from "./core/CoordinatorEngine";
import { DisciplineRegistry } from "./core/DisciplineRegistry";
import { DossierWriter } from "./core/DossierWriter";
import type { AquaPureData } from "./core/types";
import { debounceKeyed } from "./core/utils";
import { VaultIndex } from "./core/VaultIndex";
import { AquaPureSettingTab } from "./settings";
import { PtapCoordinatorDashboardView } from "./views/PtapCoordinatorDashboardView";

export default class AquaPurePlugin extends Plugin {
	data: AquaPureData = structuredClone(DEFAULT_DATA);
	index!: VaultIndex;
	engine!: CoordinatorEngine;
	private dossiers!: DossierWriter;
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

		const registry = new DisciplineRegistry();
		this.index = new VaultIndex(this.app, registry, () => this.data.settings.excludedFolders);
		this.engine = new CoordinatorEngine(
			this.index,
			() => this.data,
			() => this.requestSave(),
			(msg, kind) => this.notify(msg, kind)
		);
		this.dossiers = new DossierWriter(this.app, this.index, this.engine, () => this.data.settings);

		this.index.onDisciplineDiscovered((id) => {
			if (!this.ready) return;
			const def = registry.get(id);
			this.notify(`Nueva disciplina registrada: ${def?.name ?? id}`, "info");
			this.scheduleRefresh();
		});

		this.registerView(VIEW_TYPE_PTAP_DASHBOARD, (leaf) => new PtapCoordinatorDashboardView(leaf, this));
		this.addRibbonIcon("droplets", "Abrir Dashboard del Coordinador PTAP", () => void this.activateDashboard());
		this.addSettingTab(new AquaPureSettingTab(this.app, this));
		this.registerCommands();

		// Re-indexado por archivo con debounce: un guardado continuo no satura el hilo principal.
		this.reindexQueue = debounceKeyed((path) => {
			const f = this.app.vault.getAbstractFileByPath(path);
			if (f instanceof TFile) this.index.indexFile(f);
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
		}, 300);
	}

	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PTAP_DASHBOARD)) {
			const view = leaf.view;
			if (view instanceof PtapCoordinatorDashboardView) view.render();
		}
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
			settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
			snapshots: raw.snapshots ?? {},
			impactTasks: Array.isArray(raw.impactTasks) ? raw.impactTasks : [],
			gamification: { ...base.gamification, ...(raw.gamification ?? {}) }
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
			const folder = "AquaPure";
			if (!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) await this.app.vault.createFolder(folder);
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
