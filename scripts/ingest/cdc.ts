import * as cheerio from 'cheerio';
import { fetchJson, fetchText, FetchFailure } from './fetch.js';
import { classifyAndTrack } from '../../src/lib/classify.js';
import { pathogenNamesFrom } from '../../src/lib/pathogens.js';
import type { Outbreak } from '../../src/lib/types.js';
import { cleanText, splitStates, toInt } from './parse-utils.js';

/**
 * CDC has no outbreak API in the usual sense, but it does syndicate its current outbreak
 * list through the Public Health Media Library: media 285676 ("CDC Outbreaks - US Based")
 * has one child per active outbreak notice, and each child's content.html carries the
 * investigation status, case counts and food. That is a real machine-readable feed of the
 * same notices the website shows, so we use it instead of scraping www.cdc.gov (which sits
 * behind bot protection and renders its outbreak tables client-side anyway).
 */
const FEED_ID = 285676;
const FEED_URL = `https://tools.cdc.gov/api/v2/resources/media/${FEED_ID}.json`;
const contentUrl = (id: number) => `https://tools.cdc.gov/api/v2/resources/media/${id}/content.html`;

export const CDC_LIST_URL = 'https://www.cdc.gov/outbreaks/index.html';

interface FeedChild {
  id: number;
  name: string;
  sourceUrl: string;
  datePublished: string;
  dateModified: string;
  tags?: Array<{ name: string; type: string }>;
}

interface FeedResponse {
  results?: Array<{ children?: FeedChild[] }>;
}

const stripTags = (s: string) => cleanText(s.replace(/<[^>]+>/g, ' '));

/** Outbreaks spread by animal contact are not foodborne; they share the same feed. */
export function isFoodborne(title: string, pageText: string): boolean {
  if (/Animal safety alert/i.test(pageText)) return false;
  if (/\b(turtles?|backyard poultry|reptiles?|hedgehogs?|puppies|kittens|bearded dragons?)\b/i.test(title)) {
    return false;
  }
  return /Food safety alert|Recalled food|Food linked to illness|linked to/i.test(pageText + title);
}

/** "Cases : 431 (86 new)" -> 431. The parenthetical is new-since-last-update, not a total. */
export function factValue(pageText: string, label: string): number | null {
  const re = new RegExp(`${label}\\s*:\\s*([\\d,]+)`, 'i');
  return toInt(pageText.match(re)?.[1]);
}

/** CDC states the status explicitly, so we never have to infer "closed" from absence. */
export function statusFromPage(pageText: string): 'active' | 'closed' | null {
  const m = pageText.match(/Investigation status:\s*([A-Za-z]+)/i);
  if (!m) return null;
  return /open|ongoing|active/i.test(m[1]) ? 'active' : 'closed';
}

/** Titles read "<Germ> Outbreak Linked to <Food>" — the cleanest food string CDC gives us. */
export function foodFromTitle(title: string): string | null {
  const m = title.match(/linked to\s+(.+?)(?:,\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\b.*)?$/i);
  return m ? cleanText(m[1]) : null;
}

export function pathogenFromTitle(title: string, tags: FeedChild['tags']): string {
  const topic = tags?.find((t) => t.type === 'Topic' && !/outbreak/i.test(t.name));
  const lead = title.match(/^(.*?)\s+Outbreaks?\b/i)?.[1] ?? topic?.name ?? 'Unknown';
  return pathogenNamesFrom(lead);
}

/**
 * The first instruction under a "what you should do" style heading — the one line a reader
 * actually needs. Notices word the heading several ways, so we try them in order of how
 * directly they address the reader.
 */
/** Sub-headings that mean the advice section has ended. */
const NOT_ADVICE = /^(what businesses|symptoms of|read more|see also|about |previous|on this page|related)/i;

const ADVICE_HEADINGS = [
  /what you should do/i,
  /what everyone should do/i,
  /what people at high risk should do/i,
  /protect yourself/i,
];

/**
 * The text a block owns, excluding nested blocks. cheerio's .text() concatenates every
 * descendant with no separator, so a bullet that wraps an explanatory paragraph comes back
 * as "...symptoms of CyclosporaSymptoms of cyclosporiasis..." — two sentences fused.
 * Taking only the block's own text gives the instruction by itself.
 */
function ownText($: cheerio.CheerioAPI, node: never): string {
  const clone = $(node).clone();
  clone.find('p, ul, ol, li, div, table').remove();
  const html = clone.html() ?? '';
  const frag = cheerio.load(`<div>${html.replace(/<[^>]+>/g, ' ')}</div>`);
  return cleanText(frag('div').text());
}

/**
 * Walks document order rather than DOM siblings: on these notices the heading and the
 * text under it often sit in different wrappers, so nextUntil() finds nothing.
 */
export function adviceFrom($: cheerio.CheerioAPI): string | null {
  const flow = $('h2, h3, p, li').toArray();

  for (const heading of ADVICE_HEADINGS) {
    for (let i = 0; i < flow.length; i++) {
      const node = flow[i];
      const tag = (node as { tagName?: string }).tagName ?? '';
      if (!/^h[23]$/i.test(tag)) continue;
      if (!heading.test(cleanText($(node).text()))) continue;

      for (let j = i + 1; j < flow.length; j++) {
        const next = flow[j];
        const nextTag = (next as { tagName?: string }).tagName ?? '';
        const text = ownText($, next as never);

        // An h2 always starts a new section. An h3 usually does NOT — notices often put
        // the instruction itself in an h3 under the "What you should do" heading — so only
        // treat an h3 as a terminator when it names a different section.
        if (/^h2$/i.test(nextTag)) break;
        if (/^h3$/i.test(nextTag) && NOT_ADVICE.test(text)) break;

        // Skip empty wrappers and bare section labels ("Actions to take"): real advice is
        // either a full sentence or long enough to say something.
        if (text.length < 20 && !/[.!?]$/.test(text)) continue;
        // FAQ headings ("What should I do if...?") ask rather than instruct.
        if (text.endsWith('?')) continue;
        const sentence = text.split(/(?<=[.!?])\s+/)[0];
        return sentence.slice(0, 240);
      }
    }
  }
  return null;
}

export interface CdcResult {
  outbreaks: Outbreak[];
  skipped: string[];
}

export function parseNotice(
  child: FeedChild,
  html: string,
  misses: Set<string>,
  now: string,
): Outbreak | null {
  const $ = cheerio.load(html);
  const pageText = cleanText($.root().text());
  const title = stripTags(child.name);

  const status = statusFromPage(pageText);
  // No investigation status means this is a topic page, not an outbreak notice.
  if (!status) return null;
  if (!isFoodborne(title, pageText)) return null;

  const foodRaw = foodFromTitle(title);
  const { foodCategory, foodGroup } = classifyAndTrack(foodRaw, misses);

  return {
    id: `cdc-${child.id}`,
    source: 'cdc',
    pathogen: pathogenFromTitle(title, child.tags),
    status,
    foodRaw,
    foodCategory,
    foodGroup,
    illnesses: factValue(pageText, 'Cases'),
    hospitalizations: factValue(pageText, 'Hospitalizations'),
    deaths: factValue(pageText, 'Deaths'),
    stateCount: factValue(pageText, 'States'),
    states: splitStates(pageText).filter((s) => s !== 'Nationwide'),
    firstSeen: child.datePublished || now,
    lastSeen: now,
    closedAt: status === 'closed' ? now : null,
    sourceUrl: child.sourceUrl || CDC_LIST_URL,
    advice: adviceFrom($),
    notes: /Recall issued:\s*Yes/i.test(pageText) ? 'A recall has been issued.' : null,
    title,
    updatedAt: child.dateModified || child.datePublished || null,
  };
}

export async function ingestCdc(misses: Set<string>, now: string): Promise<CdcResult> {
  const feed = await fetchJson<FeedResponse>(FEED_URL);
  const children = feed.results?.[0]?.children ?? [];
  if (children.length === 0) {
    // An empty feed is indistinguishable from a broken one, and publishing "no outbreaks"
    // on a broken read would be a false all-clear.
    throw new FetchFailure(`CDC syndication feed ${FEED_ID} returned no items`);
  }

  const outbreaks: Outbreak[] = [];
  const skipped: string[] = [];

  for (const child of children) {
    let html: string;
    try {
      html = await fetchText(contentUrl(child.id), { attempts: 2 });
    } catch (err) {
      skipped.push(`${stripTags(child.name)} (content unavailable)`);
      continue;
    }
    const outbreak = parseNotice(child, html, misses, now);
    if (outbreak) outbreaks.push(outbreak);
    else skipped.push(stripTags(child.name));
  }

  if (outbreaks.length === 0) {
    throw new FetchFailure(
      `CDC feed had ${children.length} items but none parsed as a foodborne outbreak notice — ` +
        'the notice layout likely changed',
    );
  }

  return { outbreaks, skipped };
}
