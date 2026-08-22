import { fetchJson } from './fetch.js';
import type { Trend, TrendPoint } from '../../src/lib/types.js';

const NNDSS = 'https://data.cdc.gov/resource/x9gk-5huc.json';

/**
 * NNDSS weekly notifiable-disease counts. Labels are verbatim from the dataset
 * (data.cdc.gov/resource/x9gk-5huc.json?$select=distinct label), paired with the
 * name we actually put on the page.
 */
const TRACKED: Array<{ label: string; displayName: string }> = [
  {
    label: 'Salmonellosis (excluding Salmonella Typhi infection and Salmonella Paratyphi infection)',
    displayName: 'Salmonella',
  },
  { label: 'Shiga toxin-producing Escherichia coli (STEC)', displayName: 'E. coli (STEC)' },
  { label: 'Listeriosis, Confirmed', displayName: 'Listeria' },
  { label: 'Campylobacteriosis', displayName: 'Campylobacter' },
  { label: 'Cyclosporiasis', displayName: 'Cyclospora' },
  { label: 'Shigellosis', displayName: 'Shigella' },
];

interface Row {
  label: string;
  year: string;
  week: string;
  m1?: string;
  states: string;
}

/** m1 is the current-week case count; blank means "not reported", not zero. */
function toPoints(rows: Row[], year: number): TrendPoint[] {
  return rows
    .filter((r) => Number(r.year) === year && r.m1 !== undefined)
    .map((r) => ({ year, week: Number(r.week), cases: Math.round(Number(r.m1)) }))
    .filter((p) => Number.isFinite(p.cases))
    .sort((a, b) => a.week - b.week);
}

export async function ingestTrends(now: Date): Promise<Trend[]> {
  const currentYear = now.getUTCFullYear();
  const previousYear = currentYear - 1;
  const trends: Trend[] = [];

  for (const { label, displayName } of TRACKED) {
    const where = encodeURIComponent(
      `label='${label.replace(/'/g, "''")}' AND states='U.S. Residents' ` +
        `AND (year='${currentYear}' OR year='${previousYear}')`,
    );
    const url = `${NNDSS}?$select=label,year,week,states,m1&$where=${where}&$limit=200`;
    const rows = await fetchJson<Row[]>(url);

    const current = toPoints(rows, currentYear);
    // Compare like with like: last year is clipped to the weeks we have reached this year,
    // so the chart isn't a short line next to a full-year one.
    const weeksSoFar = current.length ? Math.max(...current.map((p) => p.week)) : 52;
    const previous = toPoints(rows, previousYear).filter((p) => p.week <= weeksSoFar);

    trends.push({
      label,
      displayName,
      currentYear: current,
      previousYear: previous,
      currentYearTotal: current.reduce((s, p) => s + p.cases, 0),
      previousYearTotalToDate: previous.reduce((s, p) => s + p.cases, 0),
    });
  }

  return trends.filter((t) => t.currentYear.length > 0 || t.previousYear.length > 0);
}
