import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function copyRepertoireData() {
  const source = resolve('data/repertoire.json');
  const target = resolve('dist/data/repertoire.json');

  return {
    name: 'copy-repertoire-data',
    closeBundle() {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [copyRepertoireData()],
});
