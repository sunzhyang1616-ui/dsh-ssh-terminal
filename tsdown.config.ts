import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'tsdown'

// Mirrors packages/client/web/src/platform.ts in deepseek-harness: the shell
// seeds these specifiers into the frozen browser module table, so client
// bundles leave them to the injected `require` instead of inlining.
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
const requested = new Set([...PLATFORM_MODULES, ...(pkg.dsh?.client?.external ?? [])])
const isRequested = (specifier) => requested.has(specifier)

const NODE_ENV = process.env.NODE_ENV ?? 'production'

export default defineConfig([{
  name: `${pkg.name}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: isRequested,
    alwaysBundle: (specifier) => !isRequested(specifier),
  },
  define: {
    'process.env': '{}',
    'process.env.NODE_ENV': JSON.stringify(NODE_ENV),
    'import.meta.env.MODE': JSON.stringify(NODE_ENV),
    'import.meta.env': JSON.stringify({ MODE: NODE_ENV }),
  },
  plugins: [{
    name: 'dsh-client-bundle-purity',
    resolveId(source) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (isRequested(source)) return null
      throw new Error(`client bundle purity: "${source}" is not in the default client externals or ${pkg.name}'s dsh.client.external`)
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
}])
