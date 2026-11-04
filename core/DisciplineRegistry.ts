import { BASE_DISCIPLINES, DISCOVERED_PALETTE } from "./constants";
import type { DisciplineDef } from "./types";
import { normalize, slugify } from "./utils";

/**
 * Registro dinámico de disciplinas: las 6 base + las descubiertas en el Vault
 * (`type: discipline` o `discipline: <Nueva>`). Resuelve términos libres a ids.
 */
export class DisciplineRegistry {
	private readonly discovered = new Map<string, DisciplineDef>();
	/** Cuántos archivos referencian cada disciplina descubierta (para retirarla al quedar en 0). */
	private readonly refCount = new Map<string, Set<string>>();
	private lookupCache: Map<string, string> | null = null;

	all(): DisciplineDef[] {
		return [...BASE_DISCIPLINES, ...Array.from(this.discovered.values()).sort((a, b) => a.name.localeCompare(b.name))];
	}

	active(disabled: string[]): DisciplineDef[] {
		return this.all().filter((d) => !disabled.includes(d.id));
	}

	get(id: string): DisciplineDef | undefined {
		return BASE_DISCIPLINES.find((d) => d.id === id) ?? this.discovered.get(id);
	}

	/** Resuelve "Civil", "I&C", "Procesos y Química" o un slug a un id; null si no existe. */
	resolve(term: string): string | null {
		const n = normalize(term);
		if (!n) return null;
		const map = this.buildLookup();
		const direct = map.get(n) ?? map.get(slugify(term));
		if (direct) return direct;
		// Coincidencia por prefijo del nombre completo ("civil hidraulica" → civil).
		for (const d of this.all()) {
			const full = normalize(d.name);
			if (full.startsWith(n) || n.startsWith(normalize(d.short))) return d.id;
		}
		return null;
	}

	/**
	 * Registra (o confirma) una disciplina referenciada por `sourcePath`.
	 * Devuelve el id y si es nueva para el registro.
	 */
	register(term: string, sourcePath: string, color?: string, fullName?: string): { id: string; isNew: boolean } {
		const existing = this.resolve(term);
		if (existing) {
			this.trackRef(existing, sourcePath);
			const def = this.discovered.get(existing);
			if (def && color && def.sourcePath === sourcePath) def.color = color;
			return { id: existing, isNew: false };
		}
		const id = slugify(term) || `disc-${this.discovered.size + 1}`;
		const def: DisciplineDef = {
			id,
			short: term.length > 14 ? term.slice(0, 14) + "…" : term,
			name: fullName ?? term,
			color: color ?? DISCOVERED_PALETTE[this.discovered.size % DISCOVERED_PALETTE.length],
			aliases: [],
			builtIn: false,
			sourcePath
		};
		this.discovered.set(id, def);
		this.lookupCache = null;
		this.trackRef(id, sourcePath);
		return { id, isNew: true };
	}

	/** Libera las referencias de un archivo; retira disciplinas descubiertas huérfanas. */
	releaseFile(path: string): void {
		for (const [id, refs] of this.refCount) {
			if (refs.delete(path) && refs.size === 0 && this.discovered.has(id)) {
				this.discovered.delete(id);
				this.refCount.delete(id);
				this.lookupCache = null;
			}
		}
	}

	private trackRef(id: string, path: string): void {
		if (!this.discovered.has(id)) return; // las base no se retiran
		let set = this.refCount.get(id);
		if (!set) {
			set = new Set();
			this.refCount.set(id, set);
		}
		set.add(path);
	}

	private buildLookup(): Map<string, string> {
		if (this.lookupCache) return this.lookupCache;
		const map = new Map<string, string>();
		for (const d of this.all()) {
			for (const t of [d.id, d.short, d.name, ...d.aliases]) map.set(normalize(t), d.id);
		}
		this.lookupCache = map;
		return map;
	}
}
