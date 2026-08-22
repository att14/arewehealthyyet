export interface PathogenInfo {
  /** Canonical name we display. */
  name: string;
  /** One-line "what it is" in plain words. */
  what: string;
  /** Who tends to get seriously ill. */
  whoIsAtRisk: string;
}

const CATALOG: Record<string, PathogenInfo> = {
  salmonella: {
    name: 'Salmonella',
    what: 'A bacteria that usually causes diarrhea, fever and stomach cramps for a few days.',
    whoIsAtRisk: 'Young children, adults over 65, and anyone with a weakened immune system.',
  },
  listeria: {
    name: 'Listeria',
    what: 'A bacteria that can cause serious illness, and unlike most food bugs it grows in the fridge.',
    whoIsAtRisk: 'Pregnant people, newborns, adults over 65, and anyone with a weakened immune system.',
  },
  'e-coli': {
    name: 'E. coli',
    what: 'A bacteria that causes severe stomach cramps and often bloody diarrhea.',
    whoIsAtRisk: 'Young children and older adults, who can develop serious kidney problems.',
  },
  campylobacter: {
    name: 'Campylobacter',
    what: 'A bacteria that causes diarrhea, cramping and fever, usually for about a week.',
    whoIsAtRisk: 'Young children, older adults, and anyone with a weakened immune system.',
  },
  cyclospora: {
    name: 'Cyclospora',
    what: 'A tiny parasite that causes watery diarrhea that can come and go for weeks.',
    whoIsAtRisk: 'Anyone, though illness lasts longer in people with a weakened immune system.',
  },
  'hepatitis-a': {
    name: 'Hepatitis A',
    what: 'A virus that affects the liver and can cause weeks of fatigue, nausea and jaundice.',
    whoIsAtRisk: 'Unvaccinated people, and adults over 50 who tend to get sicker.',
  },
  norovirus: {
    name: 'Norovirus',
    what: 'A very contagious virus causing sudden vomiting and diarrhea for a day or two.',
    whoIsAtRisk: 'Anyone; it spreads quickly in households and group settings.',
  },
  botulism: {
    name: 'Botulism',
    what: 'A rare but serious toxin that affects the nerves and needs emergency care.',
    whoIsAtRisk: 'Anyone who ate the contaminated food; infants are especially vulnerable.',
  },
  vibrio: {
    name: 'Vibrio',
    what: 'A bacteria found in raw shellfish that causes diarrhea and, rarely, severe infections.',
    whoIsAtRisk: 'People with liver disease or a weakened immune system.',
  },
  shigella: {
    name: 'Shigella',
    what: 'A bacteria causing diarrhea (often bloody), fever and stomach pain.',
    whoIsAtRisk: 'Young children and anyone with a weakened immune system.',
  },
};

/** Maps the many ways agencies write a pathogen onto one canonical key. */
export function normalizePathogen(raw: string): string {
  const t = raw.toLowerCase();
  if (t.includes('salmonella')) return 'salmonella';
  if (t.includes('listeria')) return 'listeria';
  if (t.includes('coli') || t.includes('stec') || t.includes('shiga')) return 'e-coli';
  if (t.includes('campylobacter')) return 'campylobacter';
  if (t.includes('cyclospora')) return 'cyclospora';
  if (t.includes('hepatitis')) return 'hepatitis-a';
  if (t.includes('norovirus')) return 'norovirus';
  if (t.includes('botul')) return 'botulism';
  if (t.includes('vibrio')) return 'vibrio';
  if (t.includes('shigella')) return 'shigella';
  return t.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

export function pathogenInfo(raw: string): PathogenInfo {
  const key = normalizePathogen(raw);
  return (
    CATALOG[key] ?? {
      name: raw.trim() || 'Unknown germ',
      what: 'A germ that can cause foodborne illness.',
      whoIsAtRisk: 'Risk depends on the germ; follow the agency notice for details.',
    }
  );
}

export function pathogenDisplayName(raw: string): string {
  return pathogenInfo(raw).name;
}

/**
 * Some notices cover two germs at once — "E. coli and Salmonella Outbreak Linked to...",
 * "E. coli (multiple strains) & Salmonella Agona". Name both rather than dropping one.
 */
export function pathogenNamesFrom(raw: string): string {
  const parts = raw.split(/\s+and\s+|&|,|\+/i).map((p) => p.trim()).filter(Boolean);
  const known = parts
    .filter((p) => normalizePathogen(p) in CATALOG)
    .map((p) => pathogenDisplayName(p));
  const unique = [...new Set(known)];
  if (unique.length === 0) return pathogenDisplayName(raw);
  return unique.join(' and ');
}
