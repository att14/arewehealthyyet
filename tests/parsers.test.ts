import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import { parseFdaTable, statusFrom, toOutbreak } from '../scripts/ingest/fda-core.js';
import { adviceFrom, factValue, foodFromTitle, isFoodborne, statusFromPage } from '../scripts/ingest/cdc.js';
import { cleanText, splitStates, toInt, toIsoDate } from '../scripts/ingest/parse-utils.js';

const NOW = '2026-08-22T00:00:00.000Z';

describe('FDA CORE table', () => {
  // Captured from fda.gov so the parser is tested against real markup, not a mock of it.
  const html = readFileSync(new URL('./fixtures/fda-core-table.html', import.meta.url), 'utf8');
  const rows = parseFdaTable(html);

  it('finds the investigation table', () => {
    expect(rows.length).toBeGreaterThan(50);
  });

  it('maps columns by header, not position', () => {
    const row = rows.find((r) => r.reference === '1394');
    expect(row).toBeDefined();
    expect(row?.food).toContain('Alfalfa');
    expect(row?.pathogen).toContain('coli');
  });

  it('separates words that FDA splits with <br>', () => {
    // Without <br> handling these come back as "NotYetIdentified".
    const notYet = rows.filter((r) => r.food === 'Not Yet Identified');
    expect(notYet.length).toBeGreaterThan(0);
  });

  it('decodes entities rather than leaving &nbsp; in the text', () => {
    expect(rows.some((r) => (r.food ?? '').includes('&nbsp;'))).toBe(false);
  });

  it('reads status from both status columns', () => {
    expect(statusFrom({ investigationStatus: 'Active', outbreakStatus: 'Ongoing' })).toBe('active');
    expect(statusFrom({ investigationStatus: 'Completed', outbreakStatus: 'Ongoing' })).toBe('active');
    expect(statusFrom({ investigationStatus: 'Completed', outbreakStatus: 'Concluded' })).toBe('closed');
  });

  it('gives every row a stable id from the FDA reference number', () => {
    const outbreaks = rows.map((r) => toOutbreak(r, new Set(), NOW));
    const withRef = outbreaks.filter((o) => o.id.startsWith('fda-') && /\d/.test(o.id));
    expect(withRef.length).toBe(rows.filter((r) => r.reference).length);
    expect(new Set(outbreaks.map((o) => o.id)).size).toBe(outbreaks.length);
  });

  it('dates a closed investigation by when it was posted, not today', () => {
    const closed = rows
      .map((r) => toOutbreak(r, new Set(), NOW))
      .filter((o) => o.status === 'closed' && o.closedAt);
    expect(closed.length).toBeGreaterThan(0);
    expect(closed.some((o) => o.closedAt !== NOW)).toBe(true);
  });
});

describe('CDC outbreak notices', () => {
  const notice = `
    <h1>Salmonella Outbreak Linked to Jalapenos</h1>
    <p>Food safety alert</p><p>Investigation status: Open</p><p>Recall issued: Yes</p>
    <div class="dfe-outbreak_fact"><ul>
      <li><span>Cases</span>: 431 (86 new)</li>
      <li><span>Hospitalizations</span>: 57 (21 new)</li>
      <li><span>Deaths</span>: 0</li>
      <li><span>States</span>: 32 (5 new)</li>
    </ul></div>
    <h2>What you should do</h2>
    <ul><li>Do not eat recalled jalapeno peppers.<p>Check your fridge.</p></li></ul>
    <h2>What businesses should do</h2><ul><li>Do not sell them.</li></ul>`;

  // factValue reads the page's text, the same way ingestCdc feeds it.
  const noticeText = cleanText(cheerio.load(notice).root().text());

  it('reads the fast facts', () => {
    expect(factValue(noticeText, 'Cases')).toBe(431);
    expect(factValue(noticeText, 'Hospitalizations')).toBe(57);
    expect(factValue(noticeText, 'Deaths')).toBe(0);
    expect(factValue(noticeText, 'States')).toBe(32);
  });

  it('takes the total, not the "new since last update" number', () => {
    expect(factValue('Cases : 431 (86 new)', 'Cases')).toBe(431);
  });

  it('reads the investigation status CDC states outright', () => {
    expect(statusFromPage('Investigation status: Open')).toBe('active');
    expect(statusFromPage('Investigation status: Closed')).toBe('closed');
    expect(statusFromPage('a page with no status at all')).toBeNull();
  });

  it('pulls the food out of the notice title', () => {
    expect(foodFromTitle('Salmonella Outbreak Linked to Jalapenos')).toBe('Jalapenos');
    expect(foodFromTitle('Listeria Outbreak linked to Soft Ricotta Cheese')).toBe('Soft Ricotta Cheese');
    expect(foodFromTitle('Infant Botulism Outbreak Linked to Powdered Infant Formula, June 2026'))
      .toBe('Powdered Infant Formula');
    expect(foodFromTitle('Measles Outbreaks 2025')).toBeNull();
  });

  it('excludes outbreaks spread by animal contact', () => {
    expect(isFoodborne('Salmonella Outbreak Linked to Turtles', 'Animal safety alert')).toBe(false);
    expect(isFoodborne('Salmonella Outbreaks Linked to Backyard Poultry', 'Investigation notice')).toBe(false);
    expect(isFoodborne('Salmonella Outbreak Linked to Jalapenos', 'Food safety alert')).toBe(true);
  });

  it('takes the instruction, not the explanation nested inside it', () => {
    const advice = adviceFrom(cheerio.load(notice));
    expect(advice).toBe('Do not eat recalled jalapeno peppers.');
  });

  it('finds advice that sits in a sub-heading under the section heading', () => {
    const $ = cheerio.load(`
      <h2>What you should do</h2>
      <h3>Contact your healthcare provider if you have symptoms of Cyclospora</h3>
      <ul><li>Symptoms include watery diarrhea.</li></ul>`);
    expect(adviceFrom($)).toBe('Contact your healthcare provider if you have symptoms of Cyclospora');
  });

  it('skips bare section labels and FAQ questions', () => {
    const $ = cheerio.load(`
      <h2>What you should do</h2><h3>Actions to take</h3>
      <h3>What should I do with leftovers?</h3>
      <p>Throw away the recalled formula.</p>`);
    expect(adviceFrom($)).toBe('Throw away the recalled formula.');
  });
});

describe('parse utilities', () => {
  it('reads counts out of messy text', () => {
    expect(toInt('1,234')).toBe(1234);
    expect(toInt('at least 57')).toBe(57);
    expect(toInt('See Advisory')).toBeNull();
    expect(toInt('')).toBeNull();
  });

  it('tidies whitespace left behind by stripped tags', () => {
    expect(cleanText('recalled peppers .')).toBe('recalled peppers.');
    expect(cleanText('a b   c')).toBe('a b c');
  });

  it('pulls state names out of a distribution sentence', () => {
    expect(splitStates('distributed to the following states: MD, Virginia'))
      .toEqual(['Maryland', 'Virginia']);
    expect(splitStates('CA, TX, NY')).toEqual(['California', 'New York', 'Texas']);
    expect(splitStates('Distributed nationwide')).toEqual(['Nationwide']);
    expect(splitStates('')).toEqual([]);
  });

  it('normalizes the date formats the agencies use', () => {
    expect(toIsoDate('20260819')).toBe('2026-08-19');
    expect(toIsoDate('8/19/2026')).toBe('2026-08-19');
    expect(toIsoDate('nonsense')).toBeNull();
  });
});
