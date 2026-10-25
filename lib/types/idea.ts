/** A project idea the consultant suggests, based on the challenge brief. */
export interface ProjectIdea {
  id: string;
  /** Short, memorable project name. */
  name: string;
  /** One-line pitch shown under the name. */
  tagline: string;
  /** 2-4 sentence description of what gets built. */
  description: string;
  /** Suggested tech stack for this idea. */
  techStack: string[];
  /** Why this idea scores well against the challenge. */
  whyItFits: string;
}

/** The working draft the consultant keeps refining with the user. */
export interface ConsultantDraft {
  name: string;
  description: string;
  techStack: string[];
}

/** A single turn in the consultant conversation. */
export interface ConsultantMessage {
  role: 'user' | 'assistant';
  content: string;
}
