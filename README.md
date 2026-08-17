# Easy DSH Plugins

A curated collection of native plugins for DeepSeek Harness. Each plugin is
independently installable and owns its runtime code, configuration, tests, and
package boundary. The repository root is a catalog and pnpm workspace, not an
installable DSH bundle.

## Catalog

### Search & Data Extraction

| Plugin | Description | Status |
| --- | --- | --- |
| [Easy Search](plugins/easy-search) | Web, X, YouTube, Scholar search and page extraction | Preview |

Machine-readable category, tag, package, and source-path metadata lives in
`catalog.json`. Categories organize discovery without becoming part of a
plugin's stable installation path.

## Repository layout

~~~text
easy-dsh-plugin/
├── catalog.json
├── plugins/
│   └── easy-search/
│       ├── src/
│       ├── tests/
│       ├── package.json
│       └── cordis.patch.yml
├── pnpm-workspace.yaml
└── README.md
~~~

Each directory under plugins is a complete DSH bundle with its own package
manifest, dependencies, tests, build output, and documentation. Adding one
plugin does not install or activate the others.

## Collection conventions

- `plugins/<id>` is the stable install boundary and does not encode mutable
  categorization.
- Every plugin is a complete, independently testable DSH bundle.
- `catalog.json` owns primary categories, discovery tags, and source paths.
- A plugin has one primary category and may have multiple tags.

## Development

~~~sh
pnpm install --frozen-lockfile
node scripts/validate-catalog.mjs
pnpm --filter './plugins/**' --if-present run check
~~~

The recursive check runs each plugin's own typecheck, tests, and build.

## Discovery

GitHub's /topics/dsh-plugin page is populated from the repository's GitHub
topics, not from package.json keywords. This repository should use the
dsh-plugin, deepseek-harness, and web-search topics.

## License

MIT
