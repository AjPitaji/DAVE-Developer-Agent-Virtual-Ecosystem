import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { ChallengeSection, ChallengeSectionKey } from '@/lib/types/hackathon';

/** A cheerio selection, typed without reaching into cheerio's internals. */
type Selection = ReturnType<CheerioAPI>;

/**
 * DevPost pages are markdown-ish: the organizers write sections like
 * "About the Challenge", "Why join", "What to build", "Requirements" and
 * "What to Submit" as headings (or bold-only paragraphs) and the body below
 * them is the section content.
 *
 * Rather than depending on DevPost's CSS class names (which change often),
 * we locate the best content container and walk its block elements in
 * document order, treating headings as section boundaries.
 */

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const TEXT_TAGS = new Set(['p', 'blockquote', 'pre', 'dd', 'dt']);

/** Containers that, in order of preference, hold the challenge body. */
const CONTAINER_SELECTORS = [
  '#challenge-details',
  '.challenge-details',
  '#hackathon-details',
  '.hackathon-details',
  '.about-section',
  '.challenge-description',
  '.hackathon-description',
  'article',
  'main',
  'body',
];

/**
 * Heading text -> canonical section key. Order matters: the first rule that
 * matches wins, so the more specific phrases come first.
 */
const SECTION_RULES: Array<{ key: ChallengeSectionKey; test: RegExp }> = [
  {
    key: 'what_to_build',
    test: /what\s+to\s+(build|create|prototype)|what\s+you(?:'re|’re| are)\s+(going\s+to\s+)?build|project\s+ideas?|build\s+something/i,
  },
  {
    key: 'why_join',
    test: /^(why|who\s+should)|why\s+(join|participate|should|attend|take\s+part)|benefits?\b/i,
  },
  {
    key: 'requirements',
    test: /requirement|eligibilit|restriction|you\s+must/i,
  },
  {
    key: 'what_to_submit',
    test: /what\s+to\s+submit|submission|deliverable|what\s+to\s+share|entry\s+criteria/i,
  },
  {
    key: 'technologies',
    test: /technolog|tech\s*stack|toolchain|tools?\s+to\s+use|starter\s+code/i,
  },
  {
    key: 'themes',
    test: /theme|track|categor|domain/i,
  },
  {
    key: 'judging',
    test: /judg|evaluat|scor|criteri/i,
  },
  {
    key: 'prizes',
    test: /prize|reward/i,
  },
  {
    key: 'get_started',
    test: /get\s+started|how\s+to\b|participat|registrat|sign\s+up/i,
  },
  {
    key: 'about',
    test: /about|overview|introduction|what\s+is|the\s+challenge/i,
  },
];

const MAX_SECTION_CHARS = 6000;
const MAX_TAGS = 20;
const MAX_TECHNOLOGIES = 12;

interface Block {
  kind: 'heading' | 'text';
  text: string;
  level: number;
}
export interface ParsedHackathon {
  title: string;
  description: string;
  theme: string;
  tags: string[];
  technologies: string[];
  deadline: string | null;
  sections: ChallengeSection[];
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Map a heading to one of the canonical section keys, or 'other'. */
export function matchSectionKey(title: string): ChallengeSectionKey {
  const normalized = title.replace(/[:#*]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const rule of SECTION_RULES) {
    if (rule.test.test(normalized)) return rule.key;
  }
  return 'other';
}

function normalizeText(value: string): string {
  return value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Devpost renders `**What to build**` as a paragraph that only contains a
 * bold run. Treat that as a heading so the section still gets separated.
 */
function isBoldOnlyHeading(fullText: string, boldText: string): string | null {
  const bold = boldText.replace(/\s+/g, ' ').trim();
  if (!bold || bold.length > 120) return null;
  const full = fullText.replace(/\s+/g, ' ').trim();
  const strip = (s: string) => s.replace(/[:：\s]+$/, '');
  if (strip(full) === strip(bold)) return bold;
  return null;
}

function collectBlocks($: CheerioAPI, root: Selection, blocks: Block[]): void {
  root.children().each((_, child) => {
    const tag = (child as { tagName?: string }).tagName?.toLowerCase();
    if (!tag) return;

    if (HEADING_TAGS.has(tag)) {
      const text = $(child).text().replace(/\s+/g, ' ').trim();
      if (text) blocks.push({ kind: 'heading', text, level: Number(tag[1]) });
      return;
    }

    if (tag === 'ul' || tag === 'ol') {
      const items = $(child)
        .children('li')
        .map((__, li) => `- ${$(li).text().replace(/\s+/g, ' ').trim()}`)
        .get()
        .filter((text) => text.length > 2);
      if (items.length) blocks.push({ kind: 'text', text: items.join('\n'), level: 0 });
      return;
    }

    if (tag === 'table') {
      const rows = $(child)
        .find('tr')
        .map((__, tr) =>
          $(tr)
            .find('th, td')
            .map((___, cell) => $(cell).text().replace(/\s+/g, ' ').trim())
            .get()
            .join(' | ')
        )
        .get()
        .filter(Boolean);
      if (rows.length) blocks.push({ kind: 'text', text: rows.join('\n'), level: 0 });
      return;
    }

    if (TEXT_TAGS.has(tag)) {
      const element = $(child);
      const text = normalizeText(element.text());
      if (!text) return;
      const strong = element.find('strong, b').first();
      const heading =
        strong.length > 0 ? isBoldOnlyHeading(text, strong.text()) : null;
      if (heading) {
        blocks.push({ kind: 'heading', text: heading, level: 4 });
      } else {
        blocks.push({ kind: 'text', text, level: 0 });
      }
      return;
    }

    collectBlocks($, $(child), blocks);
  });
}

function pickContainer($: CheerioAPI): { root: Selection; blocks: Block[] } {
  let best: { root: Selection; blocks: Block[]; score: number } | null = null;

  for (const selector of CONTAINER_SELECTORS) {
    const root = $(selector).first();
    if (root.length === 0) continue;

    const blocks: Block[] = [];
    collectBlocks($, root, blocks);

    const score = blocks.filter(
      (b) => b.kind === 'heading' && matchSectionKey(b.text) !== 'other'
    ).length;

    if (score > 0 && (!best || score > best.score)) {
      best = { root, blocks, score };
    }
    if (best && best.score > 0) break;
  }

  if (best) return { root: best.root, blocks: best.blocks };

  // Nothing matched — fall back to the whole body so we still surface
  // something rather than an empty brief.
  const root = $('body');
  const blocks: Block[] = [];
  collectBlocks($, root, blocks);
  return { root, blocks };
}

export function buildSections(blocks: Block[]): ChallengeSection[] {
  const raw: ChallengeSection[] = [];
  let current: ChallengeSection | null = null;

  for (const block of blocks) {
    if (block.kind === 'heading') {
      const key = matchSectionKey(block.text);
      const title = block.text.replace(/[:：\s]+$/, '');
      const id = key === 'other' ? slugify(title) || 'section' : key;
      current = {
        id: raw.some((s) => s.id === id) ? `${id}-${raw.length}` : id,
        key,
        title,
        content: '',
        level: block.level,
      };
      raw.push(current);
      continue;
    }

    if (!current) {
      // Body text that appears before the first heading.
      current = {
        id: 'overview',
        key: 'about',
        title: 'Overview',
        content: block.text,
        level: 2,
      };
      raw.push(current);
      continue;
    }

    current.content = current.content
      ? `${current.content}\n\n${block.text}`
      : block.text;
  }

  // Drop the empty sections, but keep their children: a heading with no body
  // (e.g. "Requirements" straight followed by "What to build") must not
  // orphan the sections underneath it, so they get promoted to its level.
  const sections: ChallengeSection[] = [];
  for (let i = 0; i < raw.length; i++) {
    const section = raw[i];
    if (section.content.trim().length > 0) {
      sections.push(section);
      continue;
    }

    let j = i + 1;
    const promoted: ChallengeSection[] = [];
    while (j < raw.length && raw[j].level > section.level) {
      promoted.push(raw[j]);
      j++;
    }
    for (const child of promoted) {
      sections.push({ ...child, level: section.level });
    }
    i = j - 1;
  }

  return sections.map((section) => ({
    ...section,
    content: section.content.slice(0, MAX_SECTION_CHARS),
  }));
}

export function extractTechnologies($: CheerioAPI): string[] {
  const found: string[] = [];

  const push = (value: string) => {
    const v = value.replace(/\s+/g, ' ').replace(/^[-–—•\s]+|[-–—•\s]+$/g, '').trim();
    if (!v || v.length > 40) return;
    if (found.some((f) => f.toLowerCase() === v.toLowerCase())) return;
    found.push(v);
  };

  // 1. Explicit "Technologies" section, if the organizers wrote one.
  const techSection = $('h1, h2, h3, h4, h5, h6')
    .filter((_, el) => matchSectionKey($(el).text()) === 'technologies')
    .first();
  if (techSection.length > 0) {
    let sibling = techSection.next();
    let guard = 0;
    while (sibling.length > 0 && guard < 12) {
      const tag = (sibling.get(0) as { tagName?: string }).tagName?.toLowerCase();
      if (tag && HEADING_TAGS.has(tag)) break;
      sibling
        .text()
        .split(/[,·•|\n]/)
        .forEach(push);
      sibling = sibling.next();
      guard += 1;
    }
  }

  // 2. Elements whose class mentions technology.
  $('[class*="technolog"], [id*="technolog"]').each((_, el) => {
    const text = $(el).text();
    if (text.length > 300) return;
    text.split(/[,·•|\n]/).forEach(push);
  });

  return found.slice(0, MAX_TECHNOLOGIES);
}

/** Timezone abbreviations DevPost pages use, in minutes offset from UTC. */
const TZ_OFFSETS: Record<string, number> = {
  UTC: 0,
  GMT: 0,
  Z: 0,
  EST: -300,
  EDT: -240,
  CST: -360,
  CDT: -300,
  MST: -420,
  MDT: -360,
  PST: -480,
  PDT: -420,
  AKST: -540,
  AKDT: -480,
  HST: -600,
  IST: 330,
  CET: 60,
  CEST: 120,
  BST: 60,
  WET: 0,
  WEST: 60,
  EET: 120,
  EEST: 180,
  JST: 540,
  SGT: 480,
  AEST: 600,
  AEDT: 660,
};

const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Split "Oct 11, 2026" + "7:00pm" into calendar parts. */
function splitDateTime(dateText: string, timeText: string): DateParts | null {
  let year: number;
  let month: number;
  let day: number;

  const monthFirst = dateText.match(/([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  const dayFirst = dateText.match(/(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/);
  const iso = dateText.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);

  if (monthFirst) {
    month = MONTH_INDEX[monthFirst[1].toLowerCase().slice(0, 3)];
    day = Number(monthFirst[2]);
    year = Number(monthFirst[3]);
  } else if (dayFirst) {
    month = MONTH_INDEX[dayFirst[2].toLowerCase().slice(0, 3)];
    day = Number(dayFirst[1]);
    year = Number(dayFirst[3]);
  } else if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]) - 1;
    day = Number(iso[3]);
  } else {
    return null;
  }

  if (month === undefined || Number.isNaN(month)) return null;

  let hour = 0;
  let minute = 0;
  const time = timeText.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (time) {
    hour = Number(time[1]);
    minute = Number(time[2]);
    const meridiem = time[3]?.toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  }

  return { year, month, day, hour, minute };
}

function parseDeadlineText(dateText: string, timeText?: string): string | null {
  const base = dateText.replace(/\./g, '').replace(/\s+/g, ' ').trim();
  const rawTime = (timeText || '').replace(/\s+/g, ' ').trim();

  // Split a trailing timezone abbreviation off the time, e.g. "7:00pm EDT".
  let timezone: string | null = null;
  let time = rawTime;
  const tzMatch = rawTime.match(/\b([A-Z]{2,5})\b\s*$/);
  if (tzMatch && TZ_OFFSETS[tzMatch[1].toUpperCase()] !== undefined) {
    timezone = tzMatch[1].toUpperCase();
    time = rawTime.slice(0, tzMatch.index).trim();
  }

  // V8 only parses "7:00 pm", not "7:00pm".
  time = time.replace(/(\d{1,2}:\d{2})\s*(am|pm)/i, '$1 $2');

  const parts = splitDateTime(base, time);

  // With an explicit offset we can build the UTC instant exactly.
  if (parts && timezone) {
    const offset = TZ_OFFSETS[timezone];
    const utc =
      Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute) -
      offset * 60000;
    return new Date(utc).toISOString();
  }

  // Otherwise fall back to the runtime's (local time) parsing.
  if (time) {
    const parsed = new Date(`${base} ${time}`);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const plain = new Date(base);
  if (!isNaN(plain.getTime())) return plain.toISOString();
  return null;
}

export function extractDeadline($: CheerioAPI): string | null {
  const meta =
    $('meta[property="og:event:end_time"]').attr('content') ||
    $('meta[name="deadline"]').attr('content') ||
    '';
  if (meta) {
    const parsed = new Date(meta);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const ldJson = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).text())
    .get()
    .join('\n');
  const ldMatch = ldJson.match(/"endDate"\s*:\s*"([^"]+)"/);
  if (ldMatch) {
    const parsed = new Date(ldMatch[1]);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const body = $('body').text();
  const KEYWORD =
    '(?:submission\\s+deadline|\\bdeadline\\b|\\bends?\\b\\s+on\\b|\\bends?\\b|\\bcloses?\\b\\s+on\\b|\\bcloses?\\b|\\bdue\\b\\s+on\\b|\\bdue\\b)';
  const DATE =
    '(?:[A-Za-z]{3,}\\.?\\s+\\d{1,2},?\\s*\\d{4}|\\d{1,2}\\s+[A-Za-z]{3,}\\.?,?\\s*\\d{4}|\\d{4}-\\d{1,2}-\\d{1,2})';
  const TIME = '\\d{1,2}:\\d{2}(?::\\d{2})?\\s*(?:am|pm)?\\s*(?:[A-Z]{2,5})?';

  const patterns = [
    new RegExp(
      `${KEYWORD}\\s*[:\\-]?\\s*(${DATE})(?:(?:\\s*(?:@|at)\\s*|\\s+)(${TIME})?)?`,
      'i'
    ),
    new RegExp(`(${DATE})\\s*[-–—]\\s*(?:end|deadline)`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (!match) continue;
    const iso = parseDeadlineText(match[1], match[2]);
    if (iso) return iso;
  }

  return null;
}

/** Parse a DevPost page into everything DAVE needs to brief a team. */
export function parseDevpostPage(html: string): ParsedHackathon {
  const $ = cheerio.load(html);

  const title =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').text().trim() ||
    '';

  const description =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    '';

  const tags: string[] = [];
  const keywords = $('meta[name="keywords"]').attr('content');
  if (keywords) {
    tags.push(
      ...keywords
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    );
  }
  $('[class*="tag"], [class*="category"], [class*="skill"], [data-testid*="tag"]').each(
    (_, el) => {
      const text = $(el).text().trim();
      if (text && tags.length < MAX_TAGS && !tags.includes(text)) tags.push(text);
    }
  );

  const themeCandidates = $(
    '[class*="theme"], [class*="track"], [class*="category"], [class*="challenge-type"]'
  )
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  const theme = themeCandidates[0] || (tags.length > 0 ? tags[0] : '');

  const { blocks } = pickContainer($);
  const sections = buildSections(blocks);

  return {
    title,
    description,
    theme,
    tags: tags.slice(0, MAX_TAGS),
    technologies: extractTechnologies($),
    deadline: extractDeadline($),
    sections,
  };
}
