/**
 * Build script — LovoCRM NubeSDK Fase A
 *
 * Produz: dist/main.min.js (bundle para Web Worker da Nuvemshop)
 * Deploy: copiar dist/main.min.js para ../public/nube-app/main.min.js
 */

import { build, context } from 'esbuild';
import { cp, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const isWatch = process.argv.includes('--watch');
const outDir = 'dist';
const publicDest = '../public/nube-app';

const config = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2020'],
  outfile: `${outDir}/main.min.js`,
  // NubeSDK types são apenas dev — não incluir no bundle
  external: [],
  logLevel: 'info',
};

async function copyToPublic() {
  if (!existsSync(publicDest)) {
    await mkdir(publicDest, { recursive: true });
  }
  await cp(`${outDir}/main.min.js`, path.join(publicDest, 'main.min.js'));
  console.log(`[build] Copiado para ${publicDest}/main.min.js`);
}

if (isWatch) {
  const ctx = await context({
    ...config,
    plugins: [{
      name: 'copy-on-build',
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length === 0) await copyToPublic();
        });
      },
    }],
  });
  await ctx.watch();
  console.log('[build] Watching...');
} else {
  await build(config);
  await copyToPublic();
  console.log('[build] Concluído.');
}
