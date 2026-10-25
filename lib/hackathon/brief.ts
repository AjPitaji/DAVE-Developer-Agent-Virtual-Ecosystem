import type {
  ChallengeSection,
  ChallengeSectionKey,
  HackathonBrief,
} from '@/lib/types/hackathon';

const MAX_SECTIONS = 20;
const MAX_SECTION_CHARS = 4000;
const MAX_DESCRIPTION_CHARS = 4000;
const MAX_ITEMS = 20;

const KNOWN_KEYS: ChallengeSectionKey[] = [
  'about',
  'why_join',
  'what_to_build',
  'requirements',
  'what_to_submit',
  'judging',
  'prizes',
  'get_started',
  'technologies',
  'themes',
  'other',
];

function asString(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, max);
}

function asStringList(value: unknown, maxItems = MAX_ITEMS): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const cleaned = item.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    if (out.some((existing) => existing.toLowerCase() === cleaned.toLowerCase())) continue;
    out.push(cleaned.slice(0, 120));
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeSections(value: unknown): ChallengeSection[] {
  if (!Array.isArray(value)) return [];
  const out: ChallengeSection[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;

    const title = asString(record.title, 200).trim();
    const content = asString(record.content, MAX_SECTION_CHARS).trim();
    if (!title || !content) continue;

    const key = KNOWN_KEYS.includes(record.key as ChallengeSectionKey)
      ? (record.key as ChallengeSectionKey)
      : 'other';

    const level =
      typeof record.level === 'number' && record.level >= 1 && record.level <= 6
        ? Math.floor(record.level)
        : 2;

    const id =
      typeof record.id === 'string' && record.id.trim()
        ? record.id.trim().slice(0, 60)
        : key;

    out.push({ id, key, title, content, level });
    if (out.length >= MAX_SECTIONS) break;
  }

  return out;
}

/**
 * The brief is produced by our own scraper but travels through the client,
 * so treat it as untrusted input: clamp every field before it reaches a prompt.
 */
export function normalizeBrief(input: unknown): HackathonBrief {
  const record = (input && typeof input === 'object' ? input : {}) as Record<
    string,
    unknown
  >;

  return {
    title: asString(record.title, 300),
    description: asString(record.description, MAX_DESCRIPTION_CHARS),
    theme: asString(record.theme, 200),
    tags: asStringList(record.tags),
    technologies: asStringList(record.technologies),
    deadline: typeof record.deadline === 'string' ? record.deadline : null,
    url: asString(record.url, 500),
    sections: normalizeSections(record.sections),
  };
}
