import { App, Modal, Notice, Setting, setIcon } from "obsidian";
import { STAGE_PRESETS, getStages, stageIdFrom } from "../core/stages";
import type { TreatmentStage } from "../core/types";
import type AquaPurePlugin from "../main";

/**
 * Editor del tren de tratamiento: renombrar, reordenar, quitar y añadir etapas,
 * o partir de una configuración típica. El id de cada etapa es estable (es lo que
 * se escribe en `stage:` de los entregables), por eso no se edita.
 */
export class TrainEditorModal extends Modal {
	private draft: TreatmentStage[];
	private listEl!: HTMLElement;

	constructor(app: App, private readonly plugin: AquaPurePlugin) {
		super(app);
		this.draft = getStages().map((s) => ({ ...s, aliases: [...s.aliases] }));
	}

	onOpen(): void {
		this.modalEl.addClass("aquapure-modal");
		this.titleEl.setText("Editar tren de tratamiento");
		const c = this.contentEl;
		c.createDiv({
			cls: "aquapure-hint",
			text: "El orden es el sentido del flujo. Los entregables se asocian a una etapa con `stage: [id]` o desde el formulario; los términos alternativos permiten detectarla en el título o el código."
		});

		let presetIdx = 0;
		new Setting(c)
			.setName("Partir de una configuración típica")
			.setDesc("Reemplaza el borrador actual; aún puedes editarlo antes de guardar.")
			.addDropdown((d) => {
				STAGE_PRESETS.forEach((p, i) => d.addOption(String(i), p.name));
				d.onChange((v) => (presetIdx = parseInt(v, 10)));
			})
			.addButton((b) =>
				b.setButtonText("Aplicar").onClick(() => {
					const p = STAGE_PRESETS[presetIdx];
					this.draft = p.stages.map((s) => ({ ...s, aliases: [...s.aliases] }));
					new Notice(`Configuración «${p.name}» cargada en el borrador.`);
					this.renderList();
				})
			);

		this.listEl = c.createDiv({ cls: "aquapure-train-editor" });
		this.renderList();

		let newLabel = "";
		let newInput: HTMLInputElement | null = null;
		new Setting(c)
			.setName("Agregar etapa")
			.addText((t) => {
				newInput = t.inputEl;
				t.setPlaceholder("Ej. Flotación por aire disuelto (DAF)").onChange((v) => (newLabel = v.trim()));
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						add();
					}
				});
			})
			.addButton((b) => b.setButtonText("+ Agregar").onClick(() => add()));
		const add = (): void => {
			if (!newLabel) return;
			this.draft.push({ id: stageIdFrom(newLabel, this.draft.map((s) => s.id)), label: newLabel, aliases: [] });
			newLabel = "";
			if (newInput) newInput.value = "";
			this.renderList();
		};

		const footer = new Setting(c);
		footer.addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()));
		footer.addButton((b) => b.setButtonText("Guardar tren").setCta().onClick(() => void this.save()));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private docCount(id: string): number {
		let n = 0;
		for (const d of this.plugin.index.deliverables.values()) if (d.stageIds.includes(id)) n++;
		return n;
	}

	private renderList(): void {
		const el = this.listEl;
		el.empty();
		this.draft.forEach((st, i) => {
			const row = el.createDiv({ cls: "aquapure-train-row" });
			row.createSpan({ cls: "aquapure-train-num aquapure-mono", text: String(i + 1).padStart(2, "0") });

			const fields = row.createDiv({ cls: "aquapure-train-fields" });
			const label = fields.createEl("input", { type: "text", value: st.label, attr: { "aria-label": "Nombre de la etapa" } });
			label.oninput = (): void => void (st.label = label.value);
			const aliases = fields.createEl("input", { type: "text", value: st.aliases.join(", "), attr: { placeholder: "Términos alternativos, separados por coma", "aria-label": "Términos alternativos" } });
			aliases.oninput = (): void => void (st.aliases = aliases.value.split(",").map((x) => x.trim()).filter(Boolean));
			const meta = fields.createDiv({ cls: "aquapure-hint" });
			const docs = this.docCount(st.id);
			meta.setText(`id: ${st.id}${docs ? ` · ${docs} entregable(s)` : ""}`);

			const btns = row.createDiv({ cls: "aquapure-train-btns" });
			const up = btns.createEl("button", { attr: { "aria-label": "Subir" } });
			setIcon(up, "arrow-up");
			up.disabled = i === 0;
			up.onclick = (): void => this.move(i, -1);
			const down = btns.createEl("button", { attr: { "aria-label": "Bajar" } });
			setIcon(down, "arrow-down");
			down.disabled = i === this.draft.length - 1;
			down.onclick = (): void => this.move(i, 1);
			const del = btns.createEl("button", { cls: "mod-warning", attr: { "aria-label": "Quitar etapa" } });
			setIcon(del, "trash-2");
			del.onclick = (): void => {
				if (docs && !del.hasClass("is-confirm")) {
					del.addClass("is-confirm");
					meta.setText(`${docs} entregable(s) usan esta etapa y quedarán sin ella. Pulsa de nuevo para confirmar.`);
					return;
				}
				this.draft.splice(i, 1);
				this.renderList();
			};
		});
		if (!this.draft.length) el.createDiv({ cls: "aquapure-empty", text: "El tren está vacío: agrega al menos una etapa." });
	}

	private move(i: number, dir: -1 | 1): void {
		const j = i + dir;
		if (j < 0 || j >= this.draft.length) return;
		[this.draft[i], this.draft[j]] = [this.draft[j], this.draft[i]];
		this.renderList();
	}

	private async save(): Promise<void> {
		const clean = this.draft.map((s) => ({ ...s, label: s.label.trim() })).filter((s) => s.label);
		if (!clean.length) {
			new Notice("El tren necesita al menos una etapa.");
			return;
		}
		await this.plugin.applyTreatmentStages(clean);
		new Notice(`AquaPure: tren de tratamiento actualizado (${clean.length} etapas).`);
		this.close();
	}
}
