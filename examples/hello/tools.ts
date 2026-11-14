/** Case-insensitive search over the project names explicitly supplied by the host. */
export interface ProjectQuery {
  /**
   * Text to find within a project name; empty searches are rejected.
   * @minLength 1
   * @maxLength 100
   * @example "tubular"
   */
  query: string;
  /**
   * Maximum returned matches. Omission uses the handler's limit of 10.
   * @isInt
   * @minimum 1
   * @maximum 100
   * @default 10
   * @example 5
   */
  limit?: number;
}

/** Matching names in the host's original order; an empty list is a successful search. */
export interface ProjectMatches {
  /** Names within the selected host context. No project metadata is fetched. */
  projects: string[];
}

/** Trusted host selection. Model arguments cannot extend this list or select another tenant. */
export interface WorkspaceContext {
  /** Project names the host has already authorized the current session to inspect. */
  projects: readonly string[];
}

/**
 * Find projects in the selected workspace without fetching additional context.
 * @tubular
 * @summary Find projects
 * @example {"query":"tubular","limit":5}
 * @returns Matching project names, capped by the requested limit.
 */
export function findProjects(input: ProjectQuery, context: WorkspaceContext): ProjectMatches {
  const query = input.query.toLowerCase();
  return {
    projects: context.projects
      .filter((name) => name.toLowerCase().includes(query))
      .slice(0, input.limit ?? 10),
  };
}
