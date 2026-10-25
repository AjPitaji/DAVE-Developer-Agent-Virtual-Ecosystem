/**
 * Canonical section keys we try to pull out of a DevPost challenge page.
 * Anything we cannot map lands on 'other' and is still shown, just unlabelled.
 */
export type ChallengeSectionKey =
  | 'about'
  | 'why_join'
  | 'what_to_build'
  | 'requirements'
  | 'what_to_submit'
  | 'judging'
  | 'prizes'
  | 'get_started'
  | 'technologies'
  | 'themes'
  | 'other';

export interface ChallengeSection {
  /** Unique id, e.g. "what-to-build". For unmapped sections it's a slug of the title. */
  id: string;
  /** Canonical key, 'other' when the heading didn't map to anything we know. */
  key: ChallengeSectionKey;
  /** The heading text as it appeared on the page. */
  title: string;
  /** Plain-text body that followed the heading. */
  content: string;
  /** Heading depth (h2 => 2). Used to nest subsections under their parent. */
  level: number;
}

export interface HackathonInfo {
  title: string;
  description: string;
  theme: string;
  tags: string[];
  /** Technologies / stack the organizers list on the page. */
  technologies: string[];
  deadline: string | null;
  url: string;
  /** Parsed "About the challenge", "Why join", "What to build", ... sections. */
  sections: ChallengeSection[];
}

/** The subset of HackathonInfo the AI consultant needs. */
export interface HackathonBrief {
  title: string;
  description: string;
  theme: string;
  tags: string[];
  technologies: string[];
  deadline: string | null;
  url: string;
  sections: ChallengeSection[];
}
