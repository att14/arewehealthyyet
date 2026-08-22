import { fetchJson } from './fetch.js';
import { classifyAndTrack } from '../../src/lib/classify.js';
import type { Recall } from '../../src/lib/types.js';
import { cleanText, splitStates, toIsoDate } from './parse-utils.js';

const OPENFDA_URL = 'https://api.fda.gov/food/enforcement.json';
const FSIS_URL = 'https://www.fsis.usda.gov/fsis/api/recall/v/1';

/** How far back a recall stays interesting to a shopper. */
const WINDOW_DAYS = 120;

interface OpenFdaResponse {
  meta?: { last_updated?: string };
  results?: Array<Record<string, string>>;
}

function windowStart(now: Date): Date {
  return new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
}

export async function ingestOpenFda(misses: Set<string>, now: Date): Promise<Recall[]> {
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const url =
    `${OPENFDA_URL}?search=report_date:[${fmt(windowStart(now))}+TO+${fmt(now)}]&limit=100`;
  const body = await fetchJson<OpenFdaResponse>(url);
  const results = body.results ?? [];

  return results.map((r) => {
    const product = cleanText(r.product_description).slice(0, 400);
    const { foodCategory, foodGroup } = classifyAndTrack(product, misses);
    return {
      id: `openfda-${r.recall_number ?? cleanText(r.event_id)}`,
      source: 'openfda' as const,
      firm: cleanText(r.recalling_firm),
      product,
      reason: cleanText(r.reason_for_recall).slice(0, 400),
      classification: cleanText(r.classification) || null,
      foodRaw: product,
      foodCategory,
      foodGroup,
      states: splitStates(r.distribution_pattern?.length && r.distribution_pattern.length < 200
        ? r.distribution_pattern
        : r.state),
      date: toIsoDate(r.report_date),
      sourceUrl: 'https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts',
    };
  });
}

interface FsisRecord {
  field_title?: string;
  field_recall_number?: string;
  field_recall_date?: string;
  field_recall_classification?: string;
  field_states?: string;
  field_summary?: string;
  field_establishment?: string;
  field_recall_reason?: string;
  field_product_items?: string;
  langcode?: string;
  url?: string;
}

export async function ingestFsis(misses: Set<string>, now: Date): Promise<Recall[]> {
  const records = await fetchJson<FsisRecord[]>(FSIS_URL);
  const cutoff = windowStart(now);

  return records
    .filter((r) => (r.langcode ?? 'English') === 'English')
    .map((r) => {
      const product = cleanText(r.field_product_items || r.field_title).slice(0, 400);
      const { foodCategory, foodGroup } = classifyAndTrack(product, misses);
      return {
        id: `fsis-${cleanText(r.field_recall_number) || cleanText(r.field_title).slice(0, 40)}`,
        source: 'fsis' as const,
        firm: cleanText(r.field_establishment) || cleanText(r.field_title),
        product,
        reason: cleanText(r.field_recall_reason || r.field_summary).slice(0, 400),
        classification: cleanText(r.field_recall_classification) || null,
        foodRaw: product,
        foodCategory,
        foodGroup,
        states: splitStates(r.field_states),
        date: toIsoDate(r.field_recall_date),
        sourceUrl: r.url
          ? new URL(r.url, 'https://www.fsis.usda.gov').toString()
          : 'https://www.fsis.usda.gov/recalls',
      };
    })
    .filter((r) => !r.date || new Date(r.date) >= cutoff);
}

/** Class I first — that is the "reasonable probability of serious harm" tier. */
export function sortRecalls(recalls: Recall[]): Recall[] {
  const rank = (c: string | null) => {
    const t = (c ?? '').toLowerCase();
    if (t.includes('i') && !t.includes('ii')) return 0;
    if (t.includes('ii') && !t.includes('iii')) return 1;
    if (t.includes('iii')) return 2;
    return 3;
  };
  return [...recalls].sort(
    (a, b) => rank(a.classification) - rank(b.classification) || (b.date ?? '').localeCompare(a.date ?? ''),
  );
}
