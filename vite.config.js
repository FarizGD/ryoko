import { copyFile, mkdir, access, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname, sep } from 'node:path';
import { defineConfig } from 'vite';
import JSZip from 'jszip';

const optionalChartArt = ['cover.png', 'pause-art.png'];
const chartsDir=resolve('charts');

async function findRyokoFiles(directory=chartsDir) {
  const found=[];
  let entries=[];
  try { entries=await readdir(directory,{withFileTypes:true}); } catch { return found; }
  for (const entry of entries) {
    const path=resolve(directory,entry.name);
    if (entry.isDirectory()) found.push(...await findRyokoFiles(path));
    else if (entry.isFile()&&entry.name.toLowerCase().endsWith('.ryoko')) found.push(path);
  }
  return found.sort((a,b)=>a.localeCompare(b));
}

async function buildChartCatalog() {
  const packages=[];
  for (const path of await findRyokoFiles()) {
    try {
      const zip=await JSZip.loadAsync(await readFile(path));
      const manifestEntry=zip.file('manifest.json');
      if (!manifestEntry) continue;
      const manifest=JSON.parse(await manifestEntry.async('text'));
      if (manifest.format!=='ryoko-song-package') continue;
      const selected=manifest.charts?.find(chart=>chart.id===manifest.defaultChart)||manifest.charts?.[0];
      const difficulties=(manifest.charts||[]).filter(chart=>chart?.id&&chart?.file).map(chart=>({
        id:String(chart.id),name:String(chart.name||chart.id),format:String(chart.format||'auto'),
        modchart:Boolean(chart.modchart||(chart.modchart!==false&&(manifest.modchart||manifest.song?.modchart||zip.file('modchart.js'))))
      }));
      if (!difficulties.length) continue;
      const info=await stat(path);
      packages.push({
        path:relative(chartsDir,path).split(sep).join('/'),
        title:manifest.song?.title||path.split(/[\\/]/).pop().replace(/\.ryoko$/i,''),
        artist:manifest.song?.artist||'Unknown',
        bpm:Number(manifest.song?.bpm)||120,
        difficulty:selected?.name||selected?.id||'Default',
        defaultChart:selected?.id||difficulties[0].id,
        difficulties,
        size:info.size,
        modchart:Boolean(selected?.modchart||manifest.modchart||manifest.song?.modchart||zip.file('modchart.js'))
      });
    } catch (error) { console.warn(`Skipping invalid package ${path}: ${error.message}`); }
  }
  return {version:1,packages};
}

export default defineConfig({
  // Keep production assets relative so the same dist works from GitHub Pages
  // (/ryoko/) and from a local Apache/Python subdirectory (/dist/).
  base: './',
  // Local HTTP servers on Windows can hold dist/charts open. Vite can safely
  // emit hashed assets and refresh the catalog without deleting that folder.
  build:{emptyOutDir:false},
  plugins: [{
    name: 'ryoko-chart-catalog',
    configureServer(server) {
      server.middlewares.use(async (request,response,next) => {
        const pathname=new URL(request.url,'http://localhost').pathname;
        if (!pathname.endsWith('/charts/catalog.json')) return next();
        response.setHeader('Content-Type','application/json; charset=utf-8');
        response.setHeader('Cache-Control','no-store');
        response.end(JSON.stringify(await buildChartCatalog()));
      });
    },
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
      const catalog=await buildChartCatalog();
      await mkdir(resolve('dist/charts'),{recursive:true});
      await Promise.all(catalog.packages.map(async entry => {
        const source=resolve(chartsDir,entry.path);
        const destination=resolve('dist/charts',entry.path);
        await mkdir(dirname(destination),{recursive:true});
        await copyFile(source,destination);
      }));
      await writeFile(resolve('dist/charts/catalog.json'),JSON.stringify(catalog,null,2));
    }
  }]
});
