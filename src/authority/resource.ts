/** Canonical ASCII workspace URI grammar; length limits are enforced separately and dot segments are forbidden. */
export const WORKSPACE_RESOURCE_PATTERN =
  "^workspace://[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:/(?!\\.{1,2}(?:/|$))[A-Za-z0-9._~-]+)*$";

const workspaceResource = new RegExp(WORKSPACE_RESOURCE_PATTERN);

/** Accept canonical workspace URIs up to 512 ASCII characters, excluding dot segments and encoded path ambiguity. */
export function isCanonicalWorkspaceResource(resource: string): boolean {
  if (resource.length > 512 || !workspaceResource.test(resource)) {
    return false;
  }
  const pathStart = resource.indexOf("/", "workspace://".length);
  if (pathStart === -1) {
    return true;
  }
  return resource
    .slice(pathStart + 1)
    .split("/")
    .every((segment) => segment !== "." && segment !== "..");
}

/** Match exact resources, all resources with *, or descendants with /**; a descendant grant excludes the base itself. */
export function workspaceResourceMatches(pattern: string, resource: string): boolean {
  if (!isCanonicalWorkspaceResource(resource)) {
    return false;
  }
  if (pattern === "*") {
    return true;
  }
  if (pattern.endsWith("/**")) {
    const base = pattern.slice(0, -3);
    return isCanonicalWorkspaceResource(base) && resource.startsWith(`${base}/`);
  }
  return isCanonicalWorkspaceResource(pattern) && pattern === resource;
}
