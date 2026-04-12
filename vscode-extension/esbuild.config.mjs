import * as esbuild from 'esbuild'

await esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode', '@libsql/client'],
  platform: 'node',
  format: 'cjs',
  minify: false,
  sourcemap: true,
  target: 'node18',
  logLevel: 'info',
})
