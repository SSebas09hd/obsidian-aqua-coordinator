import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type AquaPurePlugin from "./main";

/** Pestaña de ajustes: umbrales de saturación, MOC, disciplinas activas y datos. */
export class AquaPureSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: AquaPurePlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("aquapure-settings");
		const s = this.plugin.data.settings;

		containerEl.createEl("h2", { text: "AquaPure · Coordinador PTAP" });

		// ---------------------------------------------------- Proyecto y carpetas
		containerEl.createEl("h3", { text: "Proyecto, carpetas y plantillas" });
		new Setting(containerEl)
			.setName("Código del proyecto")
			.setDesc("Prefijo de los códigos que generan los formularios: PTAP-PRC-PID-001.")
			.addText((t) =>
				t.setValue(s.projectCode).onChange(async (v) => {
					s.projectCode = v.trim().toUpperCase() || "PTAP";
					await this.plugin.saveSettingsOnly();
				})
			);
		const folders: Array<[string, "peopleFolder" | "disciplinesFolder" | "deliverablesFolder" | "meetingsFolder" | "templatesFolder" | "outputFolder", string]> = [
			["Carpeta de personas", "peopleFolder", "Personas"],
			["Carpeta de disciplinas", "disciplinesFolder", "Disciplinas"],
			["Carpeta de entregables", "deliverablesFolder", "Entregables"],
			["Carpeta de actas de reunión", "meetingsFolder", "Reuniones"],
			["Carpeta de plantillas editables", "templatesFolder", "AquaPure/Plantillas"],
			["Carpeta de salidas del plugin", "outputFolder", "AquaPure"]
		];
		for (const [label, key, fallback] of folders) {
			new Setting(containerEl).setName(label).addText((t) =>
				t.setValue(s[key]).onChange(async (v) => {
					s[key] = v.trim().replace(/\/+$/, "") || fallback;
					await this.plugin.saveSettingsOnly();
				})
			);
		}
		new Setting(containerEl)
			.setName("Plantillas editables")
			.setDesc("Crea en la carpeta de plantillas las que falten (persona, disciplina, entregable, reunión). Edita su cuerpo a tu gusto; los formularios las usarán.")
			.addButton((b) =>
				b.setButtonText("Crear plantillas").onClick(async () => {
					try {
						const n = await this.plugin.factory.ensureTemplates();
						new Notice(n ? `AquaPure: ${n} plantilla(s) creada(s).` : "AquaPure: las plantillas ya existen.");
					} catch (err) {
						console.error(err);
						new Notice("AquaPure: no se pudieron crear las plantillas.");
					}
				})
			);
		new Setting(containerEl)
			.setName("Compilar reuniones automáticamente")
			.setDesc("Mantiene al día «Registro de reuniones» (acciones por responsable, decisiones e índice) cada vez que cambia un acta.")
			.addToggle((t) =>
				t.setValue(s.autoCompileMeetings).onChange(async (v) => {
					s.autoCompileMeetings = v;
					await this.plugin.saveSettingsOnly();
				})
			);

		// ---------------------------------------------------- Carga de trabajo
		containerEl.createEl("h3", { text: "Saturación de personal" });

		new Setting(containerEl)
			.setName("Umbral de carga baja (%)")
			.setDesc("Por debajo de este porcentaje de su capacidad, el profesional aparece con carga Baja.")
			.addSlider((sl) =>
				sl.setLimits(10, 90, 5).setValue(s.lowSaturationPct).setDynamicTooltip().onChange(async (v) => {
					s.lowSaturationPct = Math.min(v, s.overloadSaturationPct - 5);
					await this.plugin.saveAndRefresh();
				})
			);

		new Setting(containerEl)
			.setName("Umbral de sobrecarga (%)")
			.setDesc("Por encima de este porcentaje se marca Sobrecarga (cuello de botella).")
			.addSlider((sl) =>
				sl.setLimits(60, 200, 5).setValue(s.overloadSaturationPct).setDynamicTooltip().onChange(async (v) => {
					s.overloadSaturationPct = Math.max(v, s.lowSaturationPct + 5);
					await this.plugin.saveAndRefresh();
				})
			);

		this.numberSetting("Horas por actividad (por defecto)", "Se usa cuando el entregable no declara `effort_hours`, y para tareas en línea e impactos.", s.defaultTaskHours, async (v) => {
			s.defaultTaskHours = v;
		});
		this.numberSetting("Capacidad por defecto (h/semana)", "Para personas sin `capacity_hours`.", s.defaultCapacityHours, async (v) => {
			s.defaultCapacityHours = v;
		});

		// ---------------------------------------------------- MOC
		containerEl.createEl("h3", { text: "Gestión del cambio" });
		this.numberSetting("Plazo de revisión por impacto (días)", "Cerrar dentro de este plazo otorga +60 XP (interferencia despejada).", s.impactSlaDays, async (v) => {
			s.impactSlaDays = v;
		});

		new Setting(containerEl)
			.setName("Escribir expedientes por disciplina")
			.setDesc("Genera notas propias del plugin con las revisiones pendientes de cada disciplina. Nunca modifica tus notas.")
			.addToggle((t) =>
				t.setValue(s.writeDisciplineDossiers).onChange(async (v) => {
					s.writeDisciplineDossiers = v;
					await this.plugin.saveAndRefresh();
				})
			);

		new Setting(containerEl)
			.setName("Carpeta de expedientes")
			.addText((t) =>
				t.setValue(s.dossierFolder).onChange(async (v) => {
					s.dossierFolder = v.trim().replace(/\/+$/, "") || "AquaPure/Expedientes";
					await this.plugin.saveSettingsOnly();
				})
			);

		new Setting(containerEl)
			.setName("Carpetas excluidas del escaneo")
			.setDesc("Una por línea. Útil para plantillas y archivos generados.")
			.addTextArea((t) =>
				t.setValue(s.excludedFolders.join("\n")).onChange(async (v) => {
					s.excludedFolders = v.split("\n").map((x) => x.trim()).filter(Boolean);
					await this.plugin.saveSettingsOnly();
				})
			);

		new Setting(containerEl).setName("Mostrar notificaciones").addToggle((t) =>
			t.setValue(s.showNotices).onChange(async (v) => {
				s.showNotices = v;
				await this.plugin.saveSettingsOnly();
			})
		);

		// ---------------------------------------------------- Disciplinas
		containerEl.createEl("h3", { text: "Disciplinas activas" });
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "Las disciplinas nuevas se registran solas al encontrar `type: discipline` o `discipline: <Nombre>` en el frontmatter."
		});
		for (const d of this.plugin.index.disciplines.all()) {
			const setting = new Setting(containerEl)
				.setName(d.name)
				.setDesc(d.builtIn ? "Integrada" : `Descubierta en ${d.sourcePath ?? "el Vault"}`)
				.addToggle((t) =>
					t.setValue(!s.disabledDisciplineIds.includes(d.id)).onChange(async (on) => {
						s.disabledDisciplineIds = on ? s.disabledDisciplineIds.filter((x) => x !== d.id) : [...s.disabledDisciplineIds, d.id];
						await this.plugin.saveAndRefresh();
					})
				);
			const swatch = setting.nameEl.createSpan({ cls: "aquapure-swatch" });
			swatch.style.setProperty("--aquapure-swatch", d.color);
			setting.nameEl.prepend(swatch);
		}

		// ---------------------------------------------------- Datos
		containerEl.createEl("h3", { text: "Datos y progreso" });
		new Setting(containerEl)
			.setName("Exportar estadísticas")
			.setDesc("Escribe AquaPure/aquapure-stats.json en el Vault para auditoría.")
			.addButton((b) => b.setButtonText("Exportar").onClick(() => void this.plugin.exportStats()));

		new Setting(containerEl)
			.setName("Purgar revisiones cerradas")
			.setDesc("Elimina del historial las revisiones por impacto cerradas hace más de 90 días.")
			.addButton((b) =>
				b.setButtonText("Purgar").onClick(() => {
					const n = this.plugin.engine.purgeClosed(90);
					new Notice(`AquaPure: ${n} revisiones archivadas eliminadas.`);
					this.plugin.refreshViews();
				})
			);

		new Setting(containerEl)
			.setName("Reiniciar gamificación")
			.setDesc("Pone XP, rachas e historial en cero. No toca tus notas.")
			.addButton((b) =>
				b
					.setButtonText("Reiniciar")
					.setWarning()
					.onClick(async () => {
						await this.plugin.resetGamification();
						new Notice("AquaPure: gamificación reiniciada.");
					})
			);
	}

	private numberSetting(name: string, desc: string, value: number, apply: (v: number) => Promise<void>): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((t) => {
				t.inputEl.type = "number";
				t.inputEl.min = "0";
				t.setValue(String(value)).onChange(async (raw) => {
					const v = parseFloat(raw);
					if (!Number.isFinite(v) || v <= 0) return;
					await apply(v);
					await this.plugin.saveAndRefresh();
				});
			});
	}
}
