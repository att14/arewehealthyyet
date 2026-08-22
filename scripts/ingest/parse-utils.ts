/** Collapses whitespace and strips the non-breaking spaces government pages are full of. */
export function cleanText(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    // Stripping inline tags leaves a gap before punctuation ("peppers ." -> "peppers.").
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

/** "1,234" -> 1234; "at least 57" -> 57; "-" / "" / "TBD" -> null. */
export function toInt(s: string | null | undefined): number | null {
  const text = cleanText(s);
  if (!text) return null;
  const m = text.replace(/,/g, '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

const STATE_ABBR: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
  PR: 'Puerto Rico', VI: 'U.S. Virgin Islands', GU: 'Guam',
};

/**
 * Pulls state names out of whatever the source gives us — a tidy "CA, TX, NY", or a
 * sentence like "The recalled product was distributed to the following states: MD,
 * Virginia". Scanning for known names beats splitting on punctuation, which otherwise
 * turns the whole sentence into a "state".
 */
export function splitStates(s: string | null | undefined): string[] {
  const text = cleanText(s);
  if (!text) return [];

  const found = new Set<string>();
  for (const [abbr, name] of Object.entries(STATE_ABBR)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(text)) found.add(name);
    else if (new RegExp(`\\b${abbr}\\b`).test(text)) found.add(name);
  }

  if (found.size === 0 && /nationwide|all states|nation ?wide|throughout the (us|u\.s\.)/i.test(text)) {
    return ['Nationwide'];
  }
  // "Distributed nationwide" alongside a few named states still means nationwide.
  if (/nationwide|all 50 states/i.test(text)) found.add('Nationwide');

  return [...found].sort();
}

/**
 * Stable id: the same outbreak keeps its id as counts climb, so a rising illness count
 * updates a record instead of creating a duplicate.
 */
export function slugId(source: string, pathogen: string, food: string | null, isoDate: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const year = isoDate.slice(0, 4);
  return [source, slug(pathogen), slug(food ?? 'unknown-food'), year].filter(Boolean).join('-');
}

/** FDA/FSIS dates come in several shapes; normalize to ISO or null. */
export function toIsoDate(s: string | null | undefined): string | null {
  const text = cleanText(s);
  if (!text) return null;
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}
