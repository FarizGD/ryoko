import { copyFile, mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const optionalChartArt = ['cover.png', 'pause-art.png'];

export default defineConfig({
  base: '/ryoko/',
  plugins: [{
    name: 'copy-chart-art',
    async closeBundle() {
      const sourceDir = resolve('charts/monochrome');
      const outputDir = resolve('dist/charts/monochrome');
      await mkdir(outputDir, { recursive: true });
      await Promise.all(optionalChartArt.map(async file => {
        const source = resolve(sourceDir, file);
        try {
          await access(source);
          await copyFile(source, resolve(outputDir, file));
        } catch {
          // Art is optional during development; the UI has a visual fallback.
        }
      }));
    }
  }]
});
