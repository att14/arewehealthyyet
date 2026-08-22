import * as cheerio from 'cheerio';
import { fetchText, FetchFailure } from './fetch.js';
import { classifyAndTrack } from '../../src/lib/classify.js';
import { pathogenNamesFrom } from '../../src/lib/pathogens.js';
import type { Outbreak } from '../../src/lib/types.js';
import { cleanText, toInt, toIsoDate } from './parse-utils.js';

export const FDA_URL =
  'https://www.fda.gov/food/outbreaks-foodborne-illness/investigations-foodborne-illness-outbreaks';

/**
 * FDA's CORE table is updated weekly and states both an investigation status and an
 * outbreak status, so unlike a bare list we can read "closed" directly instead of
 * inferring it from a record's disappearance.
 */
type Field =
  | 'date' | 'reference' | 'pathogen' | 'food' | 'illnesses'
  | 'investigationStatus' | 'outbreakStatus' | 'recall';

/**
 * Ordered header rules: first match wins. 'product' must be tested before anything
 * matching "illness", because FDA's product column is headed
 * "Product(s) Linked to Illnesses (if any)".
 */
const HEADER_RULES: Array<[Field, RegExp]> = [
  ['date', /date/i],
  ['reference', /reference/i],
  ['food', /product/i],
  ['pathogen', /pathogen|cause of illness/i],
  ['illnesses', /case count|total case|illnesses/i],
  ['investigationStatus', /investigation status/i],
  ['outbreakStatus', /outbreak|event status/i],
  ['recall', /recall/i],
];

export type FdaRow = Partial<Record<Field, string>> & { href?: string };

function headerField(header: string): Field | null {
  const h = cleanText(header);
  for (const [field, re] of HEADER_RULES) {
    if (re.test(h)) return field;
  }
  return null;
}

/**
 * FDA breaks cell content with <br>, which collapses into "NotYetIdentified" if ignored,
 * and uses &nbsp; freely — so reparse the fragment rather than stripping tags by regex.
 */
function cellText($: cheerio.CheerioAPI, cell: cheerio.Cheerio<never>): string {
  const html = $.html(cell) ?? '';
  const frag = cheerio.load(`<div>${html.replace(/<br\s*\/?>/gi, ' ')}</div>`);
  return cleanText(frag('div').text());
}

export function parseFdaTable(html: string): FdaRow[] {
  const $ = cheerio.load(html);
  const rows: FdaRow[] = [];

  $('table').each((_, table) => {
    const headers: Array<Field | null> = [];
    const headerCells = $(table).find('thead th');
    const cells = headerCells.length ? headerCells : $(table).find('tr').first().find('th, td');
    cells.each((__, th) => {
      headers.push(headerField($(th).text()));
    });

    // Without a product or pathogen column this is some other table on the page.
    if (!headers.includes('food') && !headers.includes('pathogen')) return;

    $(table)
      .find('tbody tr')
      .each((__, tr) => {
        const tds = $(tr).find('td');
        if (tds.length === 0) return;
        const row: FdaRow = {};
        tds.each((i, td) => {
          const field = headers[i];
          if (field) row[field] = cellText($, $(td) as unknown as cheerio.Cheerio<never>);
        });
        const link = $(tr).find('a[href]').last().attr('href');
        if (link && !link.startsWith('#')) row.href = new URL(link, FDA_URL).toString();
        if (row.pathogen || row.food) rows.push(row);
      });
  });

  return rows;
}

/**
 * An investigation is over only when FDA says both the investigation and the outbreak
 * are done; either one still running means it belongs on the page as active.
 */
export function statusFrom(row: FdaRow): 'active' | 'closed' {
  const investigation = cleanText(row.investigationStatus).toLowerCase();
  const outbreak = cleanText(row.outbreakStatus).toLowerCase();
  const investigationOpen = /active|ongoing|open/.test(investigation);
  const outbreakOpen = /ongoing|active/.test(outbreak);
  return investigationOpen || outbreakOpen ? 'active' : 'closed';
}

export async function ingestFda(misses: Set<string>, now: string): Promise<Outbreak[]> {
  const html = await fetchText(FDA_URL);
  const rows = parseFdaTable(html);
  if (rows.length === 0) {
    throw new FetchFailure(
      'FDA CORE page returned no recognizable investigation table — layout changed or blocked',
    );
  }
  return rows.map((row) => toOutbreak(row, misses, now));
}

export function toOutbreak(row: FdaRow, misses: Set<string>, now: string): Outbreak {
  const pathogen = pathogenNamesFrom(row.pathogen ?? 'Unknown');
  const foodRaw = cleanText(row.food) || null;
  const { foodCategory, foodGroup } = classifyAndTrack(foodRaw, misses);
  const status = statusFrom(row);
  const posted = toIsoDate(row.date);
  const reference = cleanText(row.reference);

  return {
    id: reference ? `fda-${reference}` : `fda-${pathogen}-${foodRaw ?? 'unknown'}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
    source: 'fda',
    pathogen,
    status,
    foodRaw,
    foodCategory,
    foodGroup,
    illnesses: toInt(row.illnesses),
    hospitalizations: null,
    deaths: null,
    stateCount: null,
    states: [],
    firstSeen: posted ?? now,
    lastSeen: now,
    // Date the row was posted is the best "when did this end" signal FDA gives us; using
    // today would make a 2023 investigation look like it just concluded.
    closedAt: status === 'closed' ? (posted ?? now) : null,
    sourceUrl: row.href ?? FDA_URL,
    advice: null,
    notes: /yes|✔/i.test(cleanText(row.recall)) ? 'A recall has been issued.' : null,
    title: [pathogen, foodRaw].filter(Boolean).join(' linked to ') || null,
    updatedAt: posted,
  };
}
