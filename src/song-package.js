import JSZip from 'jszip';

export const RYOKO_PACKAGE_FORMAT = 'ryoko-song-package';
export const RYOKO_PACKAGE_VERSION = 1;

function assertPath(zip, path, label) {
  if (!path || typeof path !== 'string') throw new Error(`${label} path is missing.`);
  const entry = zip.file(path);
  if (!entry) throw new Error(`${label} file "${path}" is missing from the package.`);
  return entry;
}

export async function readRyokoPackage(file,{chartId}={}) {
  if (!file || file.size > 300 * 1024 * 1024) throw new Error('Package is missing or larger than 300 MB.');
  const zip = await JSZip.loadAsync(typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : file);
  const manifestEntry = zip.file('manifest.json');
  if (!manifestEntry) throw new Error('manifest.json is missing.');
  const manifest = JSON.parse(await manifestEntry.async('text'));
  if (manifest.format !== RYOKO_PACKAGE_FORMAT) throw new Error('Not a RYŌKO song package.');
  if (manifest.version !== RYOKO_PACKAGE_VERSION) throw new Error(`Unsupported package version: ${manifest.version}.`);
  if (!Array.isArray(manifest.charts) || !manifest.charts.length) throw new Error('The package contains no charts.');

  const selected = (chartId&&manifest.charts.find(chart=>chart.id===chartId)) || manifest.charts.find(chart => chart.id === manifest.defaultChart) || manifest.charts[0];
  const chartData = JSON.parse(await assertPath(zip, selected.file, 'Chart').async('text'));
  const audioBlob = await assertPath(zip, manifest.song?.audio, 'Audio').async('blob');
  const coverBlob = manifest.song?.cover && zip.file(manifest.song.cover) ? await zip.file(manifest.song.cover).async('blob') : null;
  const pauseArtBlob = manifest.song?.pauseArt && zip.file(manifest.song.pauseArt) ? await zip.file(manifest.song.pauseArt).async('blob') : null;
  let modchartSource=null;
  let modchartPath;
  if (Object.hasOwn(selected,'modchart')) modchartPath=selected.modchart;
  else if (Object.hasOwn(manifest,'modchart')) modchartPath=manifest.modchart;
  else if (Object.hasOwn(manifest.song||{},'modchart')) modchartPath=manifest.song.modchart;
  else if (zip.file('modchart.js')) modchartPath='modchart.js';
  if (modchartPath) {
    const modchartEntry=assertPath(zip,modchartPath,'Modchart');
    if (modchartEntry._data?.uncompressedSize>1024*1024) throw new Error('Modchart is larger than 1 MB.');
    modchartSource=await modchartEntry.async('text');
    if (modchartSource.length>1024*1024) throw new Error('Modchart is larger than 1 MB.');
  }
  const urls = {
    audio: URL.createObjectURL(audioBlob),
    cover: coverBlob ? URL.createObjectURL(coverBlob) : null,
    pauseArt: pauseArtBlob ? URL.createObjectURL(pauseArtBlob) : null
  };
  return {
    manifest, chartData, selectedChart:selected, audioBlob, coverBlob, pauseArtBlob, modchartSource, modchartPath:modchartPath||null, urls,
    revoke() { Object.values(urls).forEach(url => { if (url) URL.revokeObjectURL(url); }); }
  };
}

function extensionFor(file, fallback) {
  const extension = file?.name?.match(/\.[a-z0-9]+$/i)?.[0];
  return extension || fallback;
}

export async function createRyokoPackage({ chart, audio, cover, pauseArt, modchartSource, title, artist, difficulty='hard' }) {
  if (!audio) throw new Error('Load an audio file before exporting a package.');
  const zip = new JSZip();
  const audioPath = `audio/song${extensionFor(audio,'.ogg')}`;
  const coverPath = cover ? `art/cover${extensionFor(cover,'.png')}` : null;
  const pausePath = pauseArt ? `art/pause${extensionFor(pauseArt,'.png')}` : null;
  const chartPath = `charts/${difficulty}.json`;
  const modchartPath=modchartSource?`modcharts/${difficulty}.js`:null;
  const manifest = {
    format:RYOKO_PACKAGE_FORMAT,
    version:RYOKO_PACKAGE_VERSION,
    song:{ title:title||chart.title||'Untitled', artist:artist||chart.artist||'Unknown', bpm:chart.bpm, offset:chart.offset, scrollSpeed:chart.scrollSpeed, audio:audioPath, ...(coverPath?{cover:coverPath}:{}), ...(pausePath?{pauseArt:pausePath}:{}) },
    defaultChart:difficulty,
    charts:[{ id:difficulty, name:difficulty[0].toUpperCase()+difficulty.slice(1), file:chartPath, format:'ryoko-v1', ...(modchartPath?{modchart:modchartPath}:{}) }]
  };
  zip.file('manifest.json',JSON.stringify(manifest,null,2));
  zip.file(chartPath,chart.toJSON());
  if (modchartPath) zip.file(modchartPath,modchartSource);
  zip.file(audioPath,typeof audio.arrayBuffer === 'function' ? await audio.arrayBuffer() : audio);
  if (cover) zip.file(coverPath,typeof cover.arrayBuffer === 'function' ? await cover.arrayBuffer() : cover);
  if (pauseArt) zip.file(pausePath,typeof pauseArt.arrayBuffer === 'function' ? await pauseArt.arrayBuffer() : pauseArt);
  return zip.generateAsync({ type:'blob', compression:'DEFLATE', compressionOptions:{level:6} });
}
