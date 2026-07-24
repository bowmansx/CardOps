// SKU: {CAT}-{YYYY}-{seq}  e.g. FB-2026-000412 (contract §3).

import { CATEGORIES } from "./types";

// Derived from the category registry so codes can never drift from it.
export const CAT_CODE: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c.code]),
);

export function catCode(category?: string | null): string {
  return (category && CAT_CODE[category]) || "OT";
}

export function buildSku(cat: string, year: number, seq: number): string {
  return `${cat}-${year}-${String(seq).padStart(6, "0")}`;
}
