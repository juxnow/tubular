export interface ProjectQuery {
  /** Words to match in a project name. */
  query: string;
  limit?: number;
}

export interface ProjectMatches {
  projects: string[];
}

export interface WorkspaceContext {
  projects: readonly string[];
}

/** @tubular */
export function findProjects(input: ProjectQuery, context: WorkspaceContext): ProjectMatches {
  const query = input.query.toLowerCase();
  return { projects: context.projects.filter(name => name.toLowerCase().includes(query)).slice(0, input.limit ?? 10) };
}
