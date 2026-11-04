import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { MATURITY_LEVELS, STATUS_LABELS, STATUS_ORDER, VIEW_TYPE_PTAP_DASHBOARD } from "../core/constants";
import type { StageStatus, WorkloadRow } from "../core/CoordinatorEngine";
import { Gamification } from "../core/Gamification";
import type { DeliverableRecord, DisciplineDef, DocStatusCategory, ImpactTask } from "../core/types";
import { DAY_MS, isoDate } from "../core/utils";
import type AquaPurePlugin from "../main";

type Selection = { kind: "stage"; id: string } | { kind: "cell"; disc: string; status: DocStatusCategory } | null;

/**
 * Dashboard del Coordinador PTAP. Render imperativo con la API DOM de Obsidian
 * (sin innerHTML ni frameworks); el estado de UI se conserva entre refrescos.
 */
export class PtapCoordinatorDashboardView extends ItemView {
	private selection: Selection = null;
	private impactFilter = "all";
	private showClosed = false;
	private expandedPeople = new Set<string>();

	constructor(leaf: WorkspaceLeaf, private readonly plugin: AquaPurePlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_PTAP_DASHBOARD;
	}

	getDisplayText(): string {
		return "Coordinador PTAP";
	}

	getIcon(): string {
		return "droplets";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	render(): void {
		const root = this.contentEl;
		const scroll = root.scrollTop;
		root.empty();
		root.addClass("aquapure-root");

		try {
			if (!this.plugin.isReady()) {
				root.createDiv({ cls: "aquapure-empty", text: "Indexando el Vault…" });
				return;
			}
			const s = this.plugin.data.settings;
			const disciplines = this.plugin.index.disciplines.active(s.disabledDisciplineIds);

			this.renderHeader(root);
			const grid = root.createDiv({ cls: "aquapure-grid" });
			this.renderTrain(grid.createDiv({ cls: "aquapure-panel aquapure-span-2" }));
			this.renderMatrix(grid.createDiv({ cls: "aquapure-panel aquapure-span-2" }), disciplines);
			this.renderImpacts(grid.createDiv({ cls: "aquapure-panel" }), disciplines);
			this.renderGamification(grid.createDiv({ cls: "aquapure-panel" }));
			this.renderWorkload(grid.createDiv({ cls: "aquapure-panel aquapure-span-2" }));
		} catch (err) {
			console.error("[AquaPure] Error renderizando dashboard", err);
			root.createDiv({ cls: "aquapure-empty aquapure-error", text: "Error al renderizar el dashboard. Revisa la consola." });
		}
		root.scrollTop = scroll;
	}

	// ------------------------------------------------------------------ cabecera

	private renderHeader(root: HTMLElement): void {
		const docs = Array.from(this.plugin.index.deliverables.values());
		const ifc = docs.filter((d) => d.status === "ifc").length;
		const open = this.plugin.engine.openImpactTasks();
		const overdue = open.filter((t) => t.dueAt < Date.now()).length;
		const vel = Gamification.velocityDays(this.plugin.data.impactTasks);
		const g = this.plugin.data.gamification;

		const head = root.createDiv({ cls: "aquapure-header" });
		const title = head.createDiv({ cls: "aquapure-title" });
		setIcon(title.createSpan({ cls: "aquapure-title-icon" }), "droplets");
		const t = title.createDiv();
		t.createDiv({ cls: "aquapure-title-main", text: "PTAP · Cabina del Coordinador" });
		t.createDiv({ cls: "aquapure-title-sub", text: `PureWater SCADA Blueprint · ${isoDate(Date.now())}` });

		const actions = head.createDiv({ cls: "aquapure-actions" });
		const refresh = actions.createEl("button", { cls: "aquapure-btn", attr: { "aria-label": "Re-escanear Vault" } });
		setIcon(refresh, "refresh-cw");
		refresh.onclick = (): void => {
			this.plugin.index.fullScan();
			this.plugin.engine.reconcileAfterScan();
			this.render();
		};

		const kpis = root.createDiv({ cls: "aquapure-kpis" });
		this.kpi(kpis, "Entregables", String(docs.length), "file-stack");
		this.kpi(kpis, "IFC", docs.length ? `${Math.round((ifc / docs.length) * 100)}%` : "—", "badge-check", "ok");
		this.kpi(kpis, "Impactos abiertos", String(open.length), "git-pull-request-arrow", open.length ? "warn" : "ok");
		this.kpi(kpis, "Vencidos", String(overdue), "alarm-clock", overdue ? "alarm" : "ok");
		this.kpi(kpis, "Velocity", vel === null ? "—" : `${vel.toFixed(1)} d`, "gauge");
		this.kpi(kpis, "XP Técnica", String(g.xp), "zap", "accent");
	}

	private kpi(parent: HTMLElement, label: string, value: string, icon: string, tone = ""): void {
		const el = parent.createDiv({ cls: `aquapure-kpi ${tone ? `aquapure-tone-${tone}` : ""}` });
		setIcon(el.createSpan({ cls: "aquapure-kpi-icon" }), icon);
		el.createDiv({ cls: "aquapure-kpi-value aquapure-mono", text: value });
		el.createDiv({ cls: "aquapure-kpi-label", text: label });
	}

	private panelTitle(panel: HTMLElement, text: string, icon: string): HTMLElement {
		const h = panel.createDiv({ cls: "aquapure-panel-title" });
		setIcon(h.createSpan(), icon);
		h.createSpan({ text });
		return h;
	}

	// ------------------------------------------------------------------ tren de tratamiento

	private renderTrain(panel: HTMLElement): void {
		this.panelTitle(panel, "Semáforo del tren de tratamiento", "waves");
		const stages = this.plugin.engine.stageStatuses();
		const train = panel.createDiv({ cls: "aquapure-train" });
		stages.forEach((st, i) => {
			if (i > 0) train.createDiv({ cls: "aquapure-pipe", attr: { "aria-hidden": "true" } });
			const selected = this.selection?.kind === "stage" && this.selection.id === st.id;
			const tile = train.createEl("button", {
				cls: `aquapure-stage aquapure-light-${st.light}${selected ? " is-selected" : ""}`,
				attr: { "aria-label": `${st.label}: ${this.lightLabel(st)}` }
			});
			tile.createDiv({ cls: "aquapure-lamp" });
			tile.createDiv({ cls: "aquapure-stage-name", text: st.label });
			tile.createDiv({ cls: "aquapure-stage-meta aquapure-mono", text: st.docs.length ? `${st.docs.filter((d) => d.status === "ifc").length}/${st.docs.length} IFC` : "sin docs" });
			if (st.openImpacts) tile.createDiv({ cls: "aquapure-stage-badge", text: `${st.openImpacts} imp.` });
			if (st.sealed) tile.createDiv({ cls: "aquapure-seal", text: "SELLO", attr: { title: "Etapa completa en IFC sin impactos abiertos" } });
			tile.onclick = (): void => {
				this.selection = selected ? null : { kind: "stage", id: st.id };
				this.render();
			};
		});

		if (this.selection?.kind === "stage") {
			const sel = this.selection;
			const st = stages.find((x) => x.id === sel.id);
			if (st) this.renderDocList(panel, `${st.label} · ${this.lightLabel(st)}`, st.docs);
		}
	}

	private lightLabel(st: StageStatus): string {
		return { none: "Sin entregables", ok: "Operando (IFC)", warn: "En ingeniería", alarm: "Alarma: bloqueo o vencido" }[st.light];
	}

	// ------------------------------------------------------------------ matriz

	private renderMatrix(panel: HTMLElement, disciplines: DisciplineDef[]): void {
		this.panelTitle(panel, "Matriz disciplinas × estado de entregables", "table-2");
		const matrix = this.plugin.engine.matrix(disciplines.map((d) => d.id));
		const wrap = panel.createDiv({ cls: "aquapure-table-wrap" });
		const table = wrap.createEl("table", { cls: "aquapure-matrix" });
		const hr = table.createEl("thead").createEl("tr");
		hr.createEl("th", { text: "Disciplina" });
		for (const s of STATUS_ORDER) hr.createEl("th", { text: STATUS_LABELS[s], cls: `aquapure-status-head aquapure-status-${s}` });
		hr.createEl("th", { text: "Total" });

		const body = table.createEl("tbody");
		for (const d of disciplines) {
			const row = matrix.get(d.id);
			if (!row) continue;
			const tr = body.createEl("tr");
			const name = tr.createEl("td", { cls: "aquapure-disc-cell" });
			this.discChip(name, d);
			let total = 0;
			for (const s of STATUS_ORDER) {
				const list = row.get(s) ?? [];
				total += list.length;
				const selected = this.selection?.kind === "cell" && this.selection.disc === d.id && this.selection.status === s;
				const td = tr.createEl("td", { cls: `aquapure-cell aquapure-status-${s}${list.length ? " has-items" : ""}${selected ? " is-selected" : ""}` });
				const b = td.createEl("button", { cls: "aquapure-mono", text: list.length ? String(list.length) : "·", attr: { "aria-label": `${d.short} ${STATUS_LABELS[s]}: ${list.length}` } });
				b.disabled = list.length === 0;
				b.onclick = (): void => {
					this.selection = selected ? null : { kind: "cell", disc: d.id, status: s };
					this.render();
				};
			}
			tr.createEl("td", { cls: "aquapure-mono aquapure-total", text: String(total) });
		}

		const unassigned = Array.from(this.plugin.index.deliverables.values()).filter((x) => !x.disciplineId);
		if (unassigned.length) panel.createDiv({ cls: "aquapure-hint", text: `${unassigned.length} entregable(s) sin disciplina: añade \`discipline:\` o un código PTAP-XXX-…` });

		if (this.selection?.kind === "cell") {
			const sel = this.selection;
			const list = matrix.get(sel.disc)?.get(sel.status) ?? [];
			const disc = this.plugin.index.disciplines.get(sel.disc);
			this.renderDocList(panel, `${disc?.short ?? sel.disc} · ${STATUS_LABELS[sel.status]}`, list);
		}
	}

	private renderDocList(panel: HTMLElement, title: string, docs: DeliverableRecord[]): void {
		const box = panel.createDiv({ cls: "aquapure-detail" });
		box.createDiv({ cls: "aquapure-detail-title", text: title });
		if (!docs.length) {
			box.createDiv({ cls: "aquapure-empty", text: "Sin entregables." });
			return;
		}
		for (const d of docs) {
			const row = box.createDiv({ cls: "aquapure-doc-row" });
			const code = row.createEl("a", { cls: "aquapure-code aquapure-mono", text: d.code, href: "#" });
			code.onclick = (e): void => {
				e.preventDefault();
				void this.openPath(d.path);
			};
			row.createSpan({ cls: "aquapure-doc-title", text: d.title });
			row.createSpan({ cls: `aquapure-pill aquapure-status-${d.status}`, text: d.revision ? `Rev ${d.revision} · ${STATUS_LABELS[d.status]}` : STATUS_LABELS[d.status] });
			if (d.unresolvedImpacts.length) row.createSpan({ cls: "aquapure-hint", text: `impacts sin resolver: ${d.unresolvedImpacts.join(", ")}` });
		}
	}

	// ------------------------------------------------------------------ bandeja de impactos

	private renderImpacts(panel: HTMLElement, disciplines: DisciplineDef[]): void {
		const h = this.panelTitle(panel, "Revisiones pendientes por impacto", "git-pull-request-arrow");
		const controls = h.createDiv({ cls: "aquapure-controls" });
		const sel = controls.createEl("select", { cls: "dropdown aquapure-select", attr: { "aria-label": "Filtrar por disciplina" } });
		sel.createEl("option", { text: "Todas", value: "all" });
		for (const d of disciplines) sel.createEl("option", { text: d.short, value: d.id });
		sel.value = this.impactFilter;
		sel.onchange = (): void => {
			this.impactFilter = sel.value;
			this.render();
		};
		const toggle = controls.createEl("button", { cls: `aquapure-btn${this.showClosed ? " is-active" : ""}`, text: this.showClosed ? "Ocultar cerradas" : "Ver cerradas" });
		toggle.onclick = (): void => {
			this.showClosed = !this.showClosed;
			this.render();
		};

		const all = this.plugin.data.impactTasks.filter((t) => this.impactFilter === "all" || t.targetDisciplineId === this.impactFilter);
		const open = this.plugin.engine.openImpactTasks().filter((t) => this.impactFilter === "all" || t.targetDisciplineId === this.impactFilter).sort((a, b) => a.dueAt - b.dueAt);
		const list = panel.createDiv({ cls: "aquapure-impact-list" });
		if (!open.length) list.createDiv({ cls: "aquapure-empty aquapure-tone-ok", text: "✓ Sin interferencias pendientes" });
		for (const t of open) this.impactRow(list, t);

		if (this.showClosed) {
			const closed = all.filter((t) => t.closedAt !== null).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)).slice(0, 15);
			if (closed.length) {
				list.createDiv({ cls: "aquapure-subtitle", text: "Cerradas recientemente" });
				for (const t of closed) this.impactRow(list, t);
			}
		}
	}

	private impactRow(parent: HTMLElement, t: ImpactTask): void {
		const closed = t.closedAt !== null;
		const days = Math.ceil((t.dueAt - Date.now()) / DAY_MS);
		const tone = closed ? "closed" : days < 0 ? "alarm" : days <= 1 ? "warn" : "ok";
		const row = parent.createDiv({ cls: `aquapure-impact aquapure-impact--${tone}` });
		const top = row.createDiv({ cls: "aquapure-impact-top" });
		const code = top.createEl("a", { cls: "aquapure-code aquapure-mono", text: t.sourceCode, href: "#" });
		code.onclick = (e): void => {
			e.preventDefault();
			void this.openPath(t.sourcePath);
		};
		const disc = this.plugin.index.disciplines.get(t.targetDisciplineId);
		if (disc) this.discChip(top, disc);
		else top.createSpan({ cls: "aquapure-chip", text: t.targetDisciplineId });
		top.createSpan({ cls: "aquapure-impact-due aquapure-mono", text: closed ? `cerrada ${isoDate(t.closedAt ?? 0)}` : days < 0 ? `vencida ${-days} d` : `vence en ${days} d` });

		row.createDiv({ cls: "aquapure-impact-change aquapure-mono", text: `${t.fromState} → ${t.toState}` });
		const reason = row.createDiv({ cls: "aquapure-impact-reason", text: t.reason });
		if (t.targetDocPath) {
			const target = t.targetDocPath;
			const link = reason.createEl("a", { text: " · abrir dependiente", href: "#" });
			link.onclick = (e): void => {
				e.preventDefault();
				void this.openPath(target);
			};
		}
		const foot = row.createDiv({ cls: "aquapure-impact-foot" });
		const names = t.assignees.map((p) => this.plugin.index.stakeholders.get(p)?.name ?? p.split("/").pop()?.replace(/\.md$/, "") ?? p);
		foot.createSpan({ cls: "aquapure-assignees", text: names.length ? names.join(", ") : "Sin responsable: crea una persona con esta disciplina" });
		const btn = foot.createEl("button", { cls: `aquapure-btn ${closed ? "" : "mod-cta aquapure-btn-primary"}`, text: closed ? "Reabrir" : "Despejar" });
		btn.onclick = (): void => {
			if (closed) this.plugin.engine.reopenImpactTask(t.id);
			else {
				row.addClass("aquapure-flash");
				this.plugin.engine.closeImpactTask(t.id);
			}
			window.setTimeout(() => this.plugin.scheduleRefresh(), 250);
		};
	}

	// ------------------------------------------------------------------ gamificación

	private renderGamification(panel: HTMLElement): void {
		this.panelTitle(panel, "Clean Flow · Madurez de la PTAP", "trophy");
		const g = this.plugin.data.gamification;
		const m = this.plugin.engine.maturity();

		const ladder = panel.createDiv({ cls: "aquapure-ladder" });
		MATURITY_LEVELS.forEach((label, i) => {
			const lvl = i + 1;
			const step = ladder.createDiv({ cls: `aquapure-step${lvl < m.level ? " is-done" : lvl === m.level ? " is-current" : ""}` });
			step.createDiv({ cls: "aquapure-step-num aquapure-mono", text: `N${lvl}` });
			step.createDiv({ cls: "aquapure-step-label", text: label.replace(/^Nivel \d: /, "") });
		});

		if (m.level < 5) {
			const meter = panel.createDiv({ cls: "aquapure-meter", attr: { role: "progressbar", "aria-valuenow": String(Math.round(m.progressToNext * 100)), "aria-valuemin": "0", "aria-valuemax": "100" } });
			const fill = meter.createDiv({ cls: "aquapure-meter-fill" });
			fill.style.setProperty("--aquapure-fill", `${Math.round(m.progressToNext * 100)}%`);
			meter.createDiv({ cls: "aquapure-meter-ticks" });
		}
		panel.createDiv({ cls: "aquapure-hint", text: m.nextHint });

		const stats = panel.createDiv({ cls: "aquapure-stats" });
		this.stat(stats, "Racha Cero Rework", String(g.zeroReworkStreak), `mejor ${g.bestStreak}`);
		this.stat(stats, "XP Técnica", String(g.xp), `${g.events.length} eventos`);
		this.stat(stats, "Sellos", String(g.sealedStages.length), "etapas en IFC");

		const recent = g.events.slice(-5).reverse();
		if (recent.length) {
			const log = panel.createDiv({ cls: "aquapure-xp-log" });
			for (const e of recent) {
				const r = log.createDiv({ cls: "aquapure-xp-row" });
				r.createSpan({ cls: "aquapure-xp-pts aquapure-mono", text: `+${e.points}` });
				r.createSpan({ text: e.label });
				r.createSpan({ cls: "aquapure-xp-date aquapure-mono", text: isoDate(e.at) });
			}
		} else {
			panel.createDiv({ cls: "aquapure-empty", text: "Despeja impactos a tiempo (+60), valida memorias críticas (+80) y cierra matrices con firmas (+120)." });
		}
	}

	private stat(parent: HTMLElement, label: string, value: string, sub: string): void {
		const el = parent.createDiv({ cls: "aquapure-stat" });
		el.createDiv({ cls: "aquapure-stat-value aquapure-mono", text: value });
		el.createDiv({ cls: "aquapure-stat-label", text: label });
		el.createDiv({ cls: "aquapure-stat-sub", text: sub });
	}

	// ------------------------------------------------------------------ carga de trabajo

	private renderWorkload(panel: HTMLElement): void {
		const s = this.plugin.data.settings;
		this.panelTitle(panel, `Carga de trabajo · Baja <${s.lowSaturationPct}% · Sobrecarga >${s.overloadSaturationPct}%`, "users");
		const rows = this.plugin.engine.workload();
		if (!rows.length) {
			panel.createDiv({ cls: "aquapure-empty", text: "No hay personas. Crea notas con `type: stakeholder`." });
			return;
		}
		const list = panel.createDiv({ cls: "aquapure-workload" });
		for (const r of rows) this.workloadRow(list, r);
	}

	private workloadRow(parent: HTMLElement, r: WorkloadRow): void {
		const expanded = this.expandedPeople.has(r.person.path);
		const row = parent.createDiv({ cls: `aquapure-person aquapure-sat-${r.level}` });
		const head = row.createEl("button", { cls: "aquapure-person-head", attr: { "aria-expanded": String(expanded) } });
		const who = head.createDiv({ cls: "aquapure-person-who" });
		who.createDiv({ cls: "aquapure-person-name", text: r.person.name });
		const meta = who.createDiv({ cls: "aquapure-person-meta" });
		meta.createSpan({ text: r.person.role });
		for (const id of r.person.disciplineIds) {
			const d = this.plugin.index.disciplines.get(id);
			if (d) this.discChip(meta, d);
		}
		const gauge = head.createDiv({ cls: "aquapure-gauge" });
		const fill = gauge.createDiv({ cls: "aquapure-gauge-fill" });
		fill.style.setProperty("--aquapure-fill", `${Math.min(100, (r.pct / Math.max(this.plugin.data.settings.overloadSaturationPct, 100)) * 100)}%`);
		gauge.createDiv({ cls: "aquapure-gauge-mark" }).style.setProperty("--aquapure-mark", `${Math.min(100, (this.plugin.data.settings.overloadSaturationPct / Math.max(this.plugin.data.settings.overloadSaturationPct, 100)) * 100)}%`);
		head.createDiv({ cls: "aquapure-person-pct aquapure-mono", text: `${Math.round(r.pct)}%` });
		head.createDiv({ cls: `aquapure-pill aquapure-sat-pill-${r.level}`, text: { low: "Baja", optimal: "Óptima", overload: "Sobrecarga" }[r.level] });
		head.createDiv({ cls: "aquapure-person-hours aquapure-mono", text: `${r.hours}/${r.capacity} h` });
		head.onclick = (): void => {
			if (expanded) this.expandedPeople.delete(r.person.path);
			else this.expandedPeople.add(r.person.path);
			this.render();
		};

		if (expanded) {
			const items = row.createDiv({ cls: "aquapure-person-items" });
			const open = items.createEl("a", { text: "Abrir ficha de la persona", href: "#" });
			open.onclick = (e): void => {
				e.preventDefault();
				void this.openPath(r.person.path);
			};
			if (!r.items.length) items.createDiv({ cls: "aquapure-empty", text: "Sin actividades activas." });
			for (const it of r.items) {
				const li = items.createDiv({ cls: `aquapure-item aquapure-item--${it.kind}` });
				const a = li.createEl("a", { text: it.label, href: "#" });
				a.onclick = (e): void => {
					e.preventDefault();
					void this.openPath(it.path, it.line);
				};
				li.createSpan({ cls: "aquapure-mono", text: `${it.hours} h${it.due ? ` · ${it.due}` : ""}` });
			}
		}
	}

	// ------------------------------------------------------------------ utilidades

	private discChip(parent: HTMLElement, d: DisciplineDef): void {
		const chip = parent.createSpan({ cls: "aquapure-chip", text: d.short, attr: { title: d.name } });
		chip.style.setProperty("--aquapure-disc", d.color);
	}

	private async openPath(path: string, line?: number): Promise<void> {
		try {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) return;
			const leaf = this.app.workspace.getLeaf("tab"); // nunca reemplaza el dashboard
			await leaf.openFile(file, line !== undefined ? { eState: { line } } : undefined);
		} catch (err) {
			console.error("[AquaPure] No se pudo abrir", path, err);
		}
	}
}
