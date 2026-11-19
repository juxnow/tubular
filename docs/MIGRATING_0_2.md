# Migrating the private 0.1.0 prototype to 0.2.0

Tubular 0.2.0 records the breaking Perspective rename. The package and the reference runtime manifest both move to 0.2.0. The package remains private; this change does not publish a release or resolve licensing. Perspective remains experimental, and MCCP is not a finalized specification.

## Source and wire names

Update imports and consumers together. There are no compatibility aliases for the former public names or wire keys.

| 0.1.0 prototype | 0.2.0 |
| --- | --- |
| `PortAuthority*`, `*PortAuthority*`, `PORT_AUTHORITY_*` | Corresponding `Perspective*`, `*Perspective*`, `PERSPECTIVE_*` exports |
| `portAuthorityFromRegistry`, `createDefaultPortAuthority` | `perspectiveFromRegistry`, `createDefaultPerspective` |
| `compileSecondService`, `SecondServiceCompilation` | `compileLookingGlass`, `LookingGlassCompilation` |
| `port-authority/v0` | `perspective/v0` |
| `port-authority.invocation/v0`, `port-authority.outcome/v0` | `perspective.invocation/v0`, `perspective.outcome/v0` |
| `port_authority_` content-address prefix | `perspective_` content-address prefix |
| Message field `portAuthority` | `perspective` |
| Compilation and projection field `sourcePortAuthority` | `sourcePerspective` |
| `second-service.compilation/v0`, `second-service.contract-catalog/v0`, `second-service.mcp-tools/v0` | Corresponding `looking-glass.*` discriminators |
| OpenAPI `x-port-authority-*` extensions | Corresponding `x-perspective-*` extensions |

Regenerate manifests, discovery artifacts, bindings, and message references from the new declarations. The description and protocol vocabulary participate in canonical content, so the resulting digests change too. A text replacement in an already sealed manifest does not produce a valid new manifest. Do not treat approvals or context bindings for an old digest as authority for a new one.

The protocol vocabulary remains v0. Capability versions are independent: the existing append-note capability remains at 1.0.0 because its execution contract has not changed. The typed capability-manifest format version also remains 0.1.0. Host-selected application and MCP display versions are independent of the library package version.

## Compiler hosts

Custom compiler filesystems must provide the standard-library entry path through `getDefaultLibFileName`. The compiler resolves library dependencies, project files, and diagnostics through that host. The default Node filesystem is now created lazily; `createNodeCompilerFileSystem` is available from the compiler entry point for host composition.

TypeScript 6 enables strict checking by default. Omitting both strictness flags now preserves that default; explicitly disabling strict null checking is still rejected because it would erase contract nullability. See the [TypeScript 6 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html).

Repeated tool-schema selections within a compiler snapshot reuse the derivation and return independent copies. Create a new snapshot when source files change. Relative paths use the current directory at snapshot creation, including after a host changes directories.

CLI artifact checks compare exact UTF-8 bytes. BOMs, UTF-16 encodings, changed line endings, and malformed bytes are drift. A missing artifact is drift; other filesystem read failures remain errors. The internal generation host therefore separates raw artifact reads from TypeScript source-text reads.

Lazy filesystem initialization removes a load-time regression. It does not establish general browser or Worker compatibility: the package still contains Node dependencies, and no browser bundle or Worker adapter is certified by this change.
