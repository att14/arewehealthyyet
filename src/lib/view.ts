import type { Outbreak, Recall, SourceHealth } from './types.js';
import { labelFor } from './ifsac.js';

export const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

export function num(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : n.toLocaleString('en-US');
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return 'unknown date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown date';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

/** "2 days ago" reads better than a date when something is moving. */
export function relativeDate(iso: string | null | undefined): string {
  const days = daysAgo(iso);
  if (days === null) return 'unknown';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return shortDate(iso);
}

export function foodLabel(o: Outbreak | Recall): string {
  if (o.foodCategory) return labelFor(o.foodCategory);
  return 'Food not identified yet';
}

export interface Headline {
  /** The one sentence that answers "is anything going on". */
  sentence: string;
  tone: 'ok' | 'active' | 'unknown';
  detail: string;
}

export function buildHeadline(active: Outbreak[], sources: Record<string, SourceHealth>): Headline {
  const anySourceOk = Object.values(sources).some((s) => s.ok);

  if (!anySourceOk) {
    const last = Object.values(sources)
      .map((s) => s.lastSuccessAt)
      .filter(Boolean)
      .sort()
      .pop();
    return {
      tone: 'unknown',
      sentence: "We can't reach CDC or FDA right now, so this page can't confirm what's active today.",
      detail: last
        ? `Everything below is what we last confirmed on ${shortDate(last)}.`
        : 'No confirmed data has been collected yet.',
    };
  }

  if (active.length === 0) {
    return {
      tone: 'ok',
      sentence: 'Right now there are no active foodborne outbreak investigations in the US.',
      detail: 'That can change quickly — this page rechecks CDC and FDA several times a day.',
    };
  }

  const sick = sum(active, 'illnesses');
  const hospital = sum(active, 'hospitalizations');
  const deaths = sum(active, 'deaths');
  const unknownFood = active.filter((o) => !o.foodCategory).length;

  const parts: string[] = [];
  if (sick > 0) parts.push(`${num(sick)} ${plural(sick, 'person', 'people')} reported sick`);
  if (hospital > 0) parts.push(`${num(hospital)} in hospital`);
  if (deaths > 0) parts.push(`${num(deaths)} ${plural(deaths, 'death')}`);

  const detailBits: string[] = [];
  if (parts.length) detailBits.push(`${parts.join(', ')} so far.`);
  if (unknownFood > 0) {
    detailBits.push(
      `${unknownFood} of these ${plural(unknownFood, "doesn't", "don't")} have a food source identified yet.`,
    );
  }

  return {
    tone: 'active',
    sentence: `Right now health officials are investigating ${num(active.length)} foodborne outbreaks in the US.`,
    detail: detailBits.join(' '),
  };
}

export function sum(records: Outbreak[], key: 'illnesses' | 'hospitalizations' | 'deaths'): number {
  return records.reduce((total, r) => total + (r[key] ?? 0), 0);
}

export interface Facet {
  key: string;
  label: string;
  count: number;
}

/** Chip options with live counts, biggest first, so the bar reflects what's actually there. */
export function facets<T>(records: readonly T[], pick: (record: T) => string | null): Facet[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const value = pick(record);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** How serious this looks at a glance — drives the card's status stripe. */
export function severityOf(o: Outbreak): 'critical' | 'serious' | 'warning' | 'none' {
  if ((o.deaths ?? 0) > 0) return 'critical';
  if ((o.hospitalizations ?? 0) > 0) return 'serious';
  if ((o.illnesses ?? 0) > 0) return 'warning';
  return 'none';
}

export function severityLabel(level: ReturnType<typeof severityOf>): string {
  switch (level) {
    case 'critical': return 'Deaths reported';
    case 'serious': return 'People hospitalized';
    case 'warning': return 'People sick';
    default: return 'No case count published';
  }
}

/* ------------------------------------------------------------------------- *
 * Filter chip values.
 *
 * Chips are matched against data attributes by exact string, so the chip label
 * and the element's attribute must come from the same function. These are the
 * single source of truth for both.
 * ------------------------------------------------------------------------- */

export function foodChip(item: Outbreak | Recall): string {
  if (item.foodCategory) return labelFor(item.foodCategory);
  // A recall always names a product; an unmatched one is unclassified, not unidentified.
  return 'firm' in item ? 'Other / not classified' : 'Food not identified yet';
}

export function severityChip(o: Outbreak): string {
  switch (severityOf(o)) {
    case 'critical': return 'Deaths reported';
    case 'serious': return 'People hospitalized';
    case 'warning': return 'People sick';
    default: return 'No counts published';
  }
}

/** "E. coli and Salmonella" is two germs; chips should match either one. */
export function germChips(o: Outbreak): string[] {
  return o.pathogen.split(/\s+and\s+/).map((p) => p.trim()).filter(Boolean);
}

export function sourceChip(o: Outbreak): string {
  if (o.source === 'cdc') return 'CDC';
  if (o.source === 'fda') return 'FDA';
  return 'Added by hand';
}

export function recencyChip(o: Outbreak): string {
  const days = daysAgo(o.updatedAt ?? o.lastSeen);
  if (days === null) return 'Date unknown';
  if (days <= 7) return 'Updated this week';
  if (days <= 30) return 'Updated this month';
  return 'Older than a month';
}

export function riskChip(r: Recall): string {
  const t = (r.classification ?? '').toLowerCase();
  if (t.includes('iii')) return 'Low risk';
  if (t.includes('ii')) return 'Could make you sick';
  if (t.includes('i')) return 'Serious risk';
  return 'Risk not classified';
}
