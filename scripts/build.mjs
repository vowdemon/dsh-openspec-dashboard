import { build } from 'esbuild-wasm';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = (path) => resolve(root, path);
// esbuild-wasm runs a Node worker; explicit Node installations need not be on PATH.
process.env.PATH = `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`;

await Promise.all([
  build({
    entryPoints: [from('src/host/index.ts')], outfile: from('dist/index.js'),
    bundle: true, platform: 'node', format: 'esm', target: 'node24',
    minify: true, legalComments: 'none', logLevel: 'info',
  }),
  build({
    entryPoints: [from('src/host/watch.ts')], outfile: from('dist/watch.js'),
    bundle: true, platform: 'node', format: 'esm', target: 'node24',
    legalComments: 'none', logLevel: 'info',
  }),
  build({
    entryPoints: [from('src/client/entry.ts')], outfile: from('dist/client.js'),
    bundle: true, platform: 'browser', format: 'iife', target: 'chrome124',
    charset: 'utf8', minify: true, legalComments: 'none', logLevel: 'info',
  }),
]);
