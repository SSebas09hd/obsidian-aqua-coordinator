import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { VIEW_TYPE_PENDING } from "../core/constants";
import { normalize } from "../core/utils";
import type AquaPurePlugin from "../main";
import { PendingGroup, renderPendingList } from "../ui/pendingRenderer";

/** Vista dedicada: todos los pendientes de entregables (y actas) con filtros. */
export class PendingTasksView extends ItemView {
	private query = "";
	private discipline = "all";
	private person = "all";
	private overdueOnly = false;
	private includeMeetings = true;
	private group: PendingGroup = "deliverable";
	private renderToken = 0;
	private listEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: AquaPurePlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_PENDING;
	}
	getDisplayText(): string {
		return "Pendientes PTAP";
	}
	getIcon(): string {
		return "list-checks";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	/** Refresco ligero: conserva filtros y foco, solo recarga la lista. */
	refresh(): void {
		if (this.listEl?.isConnected) void this.fill();
		else this.render();
	}

	render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("aquapure-root");
		const head = root.createDiv({ cls: "aquapure-header" });
		const title = head.createDiv({ cls: "aquapure-title" });
		setIcon(title.createSpan({ cls: "aquapure-title-icon" }), "list-checks");
		const t = title.createDiv();
		t.createDiv({ cls: "aquapure-title-main", text: "Pendientes de entregables" });
		t.createDiv({ cls: "aquapure-title-sub", text: "Tareas - [ ] abiertas en entregables y actas · clic en el texto para ir a la línea" });
		const help = head.createEl("button", { cls: "aquapure-btn", text: "? Guía" });
		help.onclick = (): void => void this.plugin.openGuide("pendientes");

		const bar = root.createDiv({ cls: "aquapure-panel aquapure-filters" });
		const search = bar.createEl("input", { type: "search", value: this.query, attr: { placeholder: "Buscar…", "aria-label": "Buscar pendientes" } });
		search.oninput = (): void => {
			this.query = search.value;
			void this.fill();
		};
		const disc = bar.createEl("select", { cls: "dropdown", attr: { "aria-label": "Disciplina" } });
		disc.createEl("option", { text: "Todas las disciplinas", value: "all" });
		for (const d of this.plugin.index.disciplines.active(this.plugin.data.settings.disabledDisciplineIds)) disc.createEl("option", { text: d.short, value: d.id });
		disc.value = this.discipline;
		disc.onchange = (): void => {
			this.discipline = disc.value;
			void this.fill();
		};
		const per = bar.createEl("select", { cls: "dropdown", attr: { "aria-label": "Responsable" } });
		per.createEl("option", { text: "Todo el equipo", value: "all" });
		per.createEl("option", { text: "Sin responsable", value: "none" });
		for (const p of Array.from(this.plugin.index.stakeholders.values()).sort((a, b) => a.name.localeCompare(b.name))) per.createEl("option", { text: p.name, value: p.path });
		per.value = this.person;
		per.onchange = (): void => {
			this.person = per.value;
			void this.fill();
		};
		const grp = bar.createEl("select", { cls: "dropdown", attr: { "aria-label": "Agrupar por" } });
		[["deliverable", "Agrupar por entregable"], ["person", "Agrupar por responsable"], ["none", "Lista por fecha"]].forEach(([v, l]) => grp.createEl("option", { text: l, value: v }));
		grp.value = this.group;
		grp.onchange = (): void => {
			this.group = grp.value as PendingGroup;
			void this.fill();
		};
		this.toggle(bar, "Solo vencidas", this.overdueOnly, (v) => (this.overdueOnly = v));
		this.toggle(bar, "Incluir actas", this.includeMeetings, (v) => (this.includeMeetings = v));

		this.listEl = root.createDiv({ cls: "aquapure-panel" });
		void this.fill();
	}

	private toggle(parent: HTMLElement, label: string, value: boolean, set: (v: boolean) => void): void {
		const l = parent.createEl("label", { cls: "aquapure-toggle" });
		const cb = l.createEl("input", { type: "checkbox" });
		cb.checked = value;
		l.createSpan({ text: label });
		cb.onchange = (): void => {
			set(cb.checked);
			void this.fill();
		};
	}

	/** Relleno asíncrono; un token descarta resultados de renders anteriores. */
	private async fill(): Promise<void> {
		const el = this.listEl;
		if (!el) return;
		const token = ++this.renderToken;
		try {
			let tasks = await this.plugin.tasks.collect(this.includeMeetings);
			if (token !== this.renderToken) return;
			const q = normalize(this.query);
			tasks = tasks.filter(
				(t) =>
					(!q || normalize(`${t.text} ${t.sourceLabel}`).includes(q)) &&
					(this.discipline === "all" || t.disciplineId === this.discipline) &&
					(this.person === "all" || (this.person === "none" ? t.owners.length === 0 : t.owners.includes(this.person))) &&
					(!this.overdueOnly || t.overdue)
			);
			el.empty();
			const overdue = tasks.filter((t) => t.overdue).length;
			el.createDiv({ cls: "aquapure-panel-title", text: `${tasks.length} pendiente(s)${overdue ? ` · ${overdue} vencida(s)` : ""}` });
			renderPendingList(el, this.plugin, tasks, this.group, () => void this.fill());
		} catch (err) {
			console.error("[AquaPure] Error cargando pendientes", err);
			el.empty();
			el.createDiv({ cls: "aquapure-empty aquapure-error", text: "No se pudieron cargar los pendientes." });
		}
	}
}
