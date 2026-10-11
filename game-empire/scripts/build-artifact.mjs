// Assemble the hosted Artifact version of the game.
//
// The Artifact host only runs scripts from a few public CDNs, so libraries are
// not bundled. React, ReactDOM, react-is and Recharts load as their published
// UMD builds; Zustand and the individual Lucide icon modules load as ES
// modules straight from jsDelivr. An import map points the bundle's bare
// imports at small local modules that re-export those globals.
//
// Usage: node scripts/build-artifact.mjs [outDir]
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, process.argv[2] ?? 'dist-artifact/page');
const CDN = 'https://cdn.jsdelivr.net/npm';

// Exact versions, each published more than two weeks before this build.
const V = { react: '18.3.1', reactIs: '18.3.1', recharts: '3.10.1', zustand: '5.0.15', lucide: '1.47.0' };

// 1. Build the app with libraries left external.
execSync('npx vite build --config vite.artifact.config.ts --mode artifact', { cwd: root, stdio: 'inherit' });
const buildDir = join(root, 'dist-artifact/build');
const appJs = readFileSync(join(buildDir, 'app.js'), 'utf8');
const appCss = readFileSync(join(buildDir, 'app.css'), 'utf8');

// 2. Collect the named imports the bundle takes from each library.
function namedImports(from) {
  const names = new Set();
  const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${from.replace('/', '\\/')}["']`, 'g');
  for (const m of appJs.matchAll(re)) for (const n of m[1].split(',')) if (n.trim()) names.add(n.trim().split(/\s+as\s+/)[0]);
  return [...names];
}

// 3. Map Lucide icon names to their module files in the pinned version.
const cache = join(tmpdir(), `lucide-react-${V.lucide}`);
if (!existsSync(join(cache, 'package/dist/esm/lucide-react.mjs'))) {
  mkdirSync(cache, { recursive: true });
  execSync(`npm pack lucide-react@${V.lucide} --silent`, { cwd: cache });
  execSync(`tar -xzf lucide-react-${V.lucide}.tgz`, { cwd: cache });
}
const lucideIndex = readFileSync(join(cache, 'package/dist/esm/lucide-react.mjs'), 'utf8');
const iconFile = new Map();
for (const m of lucideIndex.matchAll(/export \{([^}]*)\} from '\.\/icons\/([^']+)'/g)) {
  for (const part of m[1].split(',')) {
    const name = part.trim().replace(/^default as /, '');
    if (name) iconFile.set(name, m[2]);
  }
}
const icons = namedImports('lucide-react');
const missing = icons.filter((n) => !iconFile.has(n));
if (missing.length) throw new Error(`Icons not in lucide-react@${V.lucide}: ${missing.join(', ')}`);

// 4. Write the local shim modules.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'vendor'), { recursive: true });

const REACT_API = [
  'Children', 'Component', 'Fragment', 'Profiler', 'PureComponent', 'StrictMode', 'Suspense', 'cloneElement',
  'createContext', 'createElement', 'createRef', 'forwardRef', 'isValidElement', 'lazy', 'memo', 'startTransition',
  'useCallback', 'useContext', 'useDebugValue', 'useDeferredValue', 'useEffect', 'useId', 'useImperativeHandle',
  'useInsertionEffect', 'useLayoutEffect', 'useMemo', 'useReducer', 'useRef', 'useState', 'useSyncExternalStore',
  'useTransition', 'version',
];
const reactNames = [...new Set([...REACT_API, ...namedImports('react')])];
const shim = (global, names) => `const lib = globalThis.${global};\nexport default lib;\nexport const { ${names.join(', ')} } = lib;\n`;

writeFileSync(join(outDir, 'vendor/react.js'), shim('React', reactNames));
writeFileSync(join(outDir, 'vendor/react-dom.js'), shim('ReactDOM', ['createRoot', 'hydrateRoot', 'createPortal', 'flushSync']));
writeFileSync(join(outDir, 'vendor/recharts.js'), shim('Recharts', namedImports('recharts')));
writeFileSync(
  join(outDir, 'vendor/jsx-runtime.js'),
  `// Automatic JSX runtime on top of the React UMD build.
const React = globalThis.React;
export const Fragment = React.Fragment;
export function jsx(type, props, key) {
  return key === undefined ? React.createElement(type, props) : React.createElement(type, { ...props, key });
}
export const jsxs = jsx;
`,
);
writeFileSync(
  join(outDir, 'vendor/lucide.js'),
  icons.map((n) => `export { default as ${n} } from '${CDN}/lucide-react@${V.lucide}/dist/esm/icons/${iconFile.get(n)}';`).join('\n') + '\n',
);
copyFileSync(join(buildDir, 'app.js'), join(outDir, 'app.js'));

// 5. The page itself. The Artifact host wraps it in <html>/<head>/<body>.
const importMap = {
  imports: {
    react: './vendor/react.js',
    'react/jsx-runtime': './vendor/jsx-runtime.js',
    'react-dom': './vendor/react-dom.js',
    'react-dom/client': './vendor/react-dom.js',
    recharts: './vendor/recharts.js',
    'lucide-react': './vendor/lucide.js',
    zustand: `${CDN}/zustand@${V.zustand}/esm/index.mjs`,
    'zustand/vanilla': `${CDN}/zustand@${V.zustand}/esm/vanilla.mjs`,
    'zustand/react': `${CDN}/zustand@${V.zustand}/esm/react.mjs`,
  },
};
const page = `<title>Game Empire</title>
<style>
${appCss}
</style>
<div id="root"></div>
<noscript><p style="color:#e6edf3;padding:16px">Game Empire needs JavaScript to run.</p></noscript>
<script src="${CDN}/react@${V.react}/umd/react.production.min.js"></script>
<script src="${CDN}/react-dom@${V.react}/umd/react-dom.production.min.js"></script>
<script src="${CDN}/react-is@${V.reactIs}/umd/react-is.production.min.js"></script>
<script src="${CDN}/recharts@${V.recharts}/umd/Recharts.js"></script>
<script type="importmap">
${JSON.stringify(importMap, null, 2)}
</script>
<script type="module" src="./app.js"></script>
`;
writeFileSync(join(outDir, 'game-empire.html'), page);
console.log(`Artifact page written to ${outDir} (${icons.length} icons, ${(appJs.length / 1024).toFixed(0)} KB app code)`);
