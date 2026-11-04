import { ItemView, MarkdownRenderer, WorkspaceLeaf, setIcon } from "obsidian";
import { VIEW_TYPE_GUIDE } from "../core/constants";
import type AquaPurePlugin from "../main";
import { GUIDE_SECTIONS, GuideAction } from "../ui/guideContent";

/** Guía de uso integrada: índice lateral + secciones con botones de acción. */
export class GuideView extends ItemView {
	private target: string | null = null;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: AquaPurePlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_GUIDE;
	}
	getDisplayText(): string {
		return "Guía AquaPure";
	}
	getIcon(): string {
		return "book-open";
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	/** Lleva la guía a una sección concreta. */
	goTo(id: string): void {
		this.target = id;
		const el = this.contentEl.querySelector(`[data-guide="${id}"]`);
		if (el) {
			el.scrollIntoView({ behavior: "smooth", block: "start" });
			el.addClass("aquapure-guide-flash");
			window.setTimeout(() => el.removeClass("aquapure-guide-flash"), 1200);
		}
	}

	private async render(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("aquapure-root", "aquapure-guide");

		const nav = root.createDiv({ cls: "aquapure-guide-nav" });
		nav.createDiv({ cls: "aquapure-detail-title", text: "Guía de uso" });
		const main = root.createDiv({ cls: "aquapure-guide-main" });

		for (const s of GUIDE_SECTIONS) {
			const link = nav.createEl("button", { cls: "aquapure-guide-link" });
			setIcon(link.createSpan(), s.icon);
			link.createSpan({ text: s.title });
			link.onclick = (): void => this.goTo(s.id);

			const sec = main.createDiv({ cls: "aquapure-panel aquapure-guide-section", attr: { "data-guide": s.id } });
			const h = sec.createDiv({ cls: "aquapure-panel-title" });
			setIcon(h.createSpan(), s.icon);
			h.createSpan({ text: s.title });
			const body = sec.createDiv({ cls: "aquapure-guide-body markdown-rendered" });
			try {
				await MarkdownRenderer.render(this.app, s.md, body, "", this);
			} catch (err) {
				console.error("[AquaPure] Error renderizando la guía", err);
				body.setText(s.md);
			}
			if (s.actions?.length) {
				const bar = sec.createDiv({ cls: "aquapure-guide-actions" });
				for (const a of s.actions) {
					const b = bar.createEl("button", { cls: "aquapure-btn aquapure-btn-primary", text: a.label });
					b.onclick = (): void => this.run(a.action);
				}
			}
		}
		if (this.target) this.goTo(this.target);
	}

	private run(action: GuideAction): void {
		this.plugin.runGuideAction(action);
	}
}
