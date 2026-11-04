import type { DocStatusCategory } from "./types";

/** Minúsculas sin tildes ni espacios redundantes, para comparar términos de dominio. */
export function normalize(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

export function slugify(value: string): string {
	return normalize(value)
		.replace(/[^a-z0-9&]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** Convierte un valor de frontmatter (string | string[] | unknown) en lista de strings. */
export function toStringList(value: unknown): string[] {
	if (value === null || value === undefined) return [];
	if (Array.isArray(value)) {
		return value.filter((v): v is string | number => typeof v === "string" || typeof v === "number").map((v) => String(v).trim()).filter(Boolean);
	}
	if (typeof value === "string" || typeof value === "number") {
		const s = String(value).trim();
		if (!s) return [];
		// Admite "Civil, Mecánica" como lista separada por comas (fuera de wikilinks).
		if (s.includes(",") && !s.includes("[[")) return s.split(",").map((p) => p.trim()).filter(Boolean);
		return [s];
	}
	return [];
}

export function toStringValue(value: unknown, fallback = ""): string {
	if (typeof value === "string") return value.trim();
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value) && value.length > 0) return toStringValue(value[0], fallback);
	return fallback;
}

export function toNumber(value: unknown, fallback: number): number {
	const n = typeof value === "number" ? value : typeof value === "string" ? parseFloat(value.replace(",", ".")) : NaN;
	return Number.isFinite(n) ? n : fallback;
}

export function toBoolean(value: unknown): boolean {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") return ["true", "si", "sí", "yes", "1", "compliant", "cumple"].includes(normalize(value));
	return false;
}

/** Extrae el destino de "[[Nota|Alias]]" o devuelve el texto tal cual. */
export function stripWikilink(value: string): string {
	const m = value.match(/^\s*\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]\s*$/);
	return (m ? m[1] : value).trim();
}

/**
 * Clasifica estados libres en categorías.
 * Ej.: "Rev B - Aprobado con Comentarios" → approved; "IFC" → ifc; "Modificación Crítica" → blocked.
 */
export function classifyStatus(raw: string): DocStatusCategory {
	const s = normalize(raw);
	if (!s) return "draft";
	if (/(bloque|critic|hold|stop|rechaz|reject|suspend)/.test(s)) return "blocked";
	if (/(\bifc\b|para construccion|issued for construction|as[- ]?built|\bafc\b)/.test(s)) return "ifc";
	if (/(aprobad|approved|\bafd\b|validad)/.test(s)) return "approved";
	if (/(revision|review|\bifr\b|comentari|interna|\bifa\b)/.test(s)) return "review";
	return "draft";
}

/** Extrae la letra/número de revisión de textos como "Rev B - Aprobado" o "B". */
export function parseRevision(raw: string): string {
	const s = raw.trim();
	const m = s.match(/\brev(?:isi[oó]n)?\.?\s*([A-Z0-9]{1,3})\b/i);
	if (m) return m[1].toUpperCase();
	if (/^[A-Z0-9]{1,3}$/i.test(s)) return s.toUpperCase();
	return s;
}

export function isoDate(ts: number): string {
	const d = new Date(ts);
	const p = (n: number): string => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Parsea YYYY-MM-DD como fecha local; null si no es válida. */
export function parseIsoDate(value: string | null): number | null {
	if (!value) return null;
	const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!m) return null;
	const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
	return Number.isFinite(t) ? t : null;
}

export function debounceKeyed(fn: (key: string) => void, wait: number): (key: string) => void {
	const timers = new Map<string, number>();
	return (key: string): void => {
		const existing = timers.get(key);
		if (existing !== undefined) window.clearTimeout(existing);
		timers.set(
			key,
			window.setTimeout(() => {
				timers.delete(key);
				fn(key);
			}, wait)
		);
	};
}

export function uid(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const DAY_MS = 86_400_000;
