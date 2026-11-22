import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { validateData, photoPath } from '../shared/photography.mjs';

const root = process.cwd();
const dist = path.join(root, 'dist');
const source = JSON.parse(await fs.readFile(path.join(root, 'data/photography.json'), 'utf8'));
const errors = validateData(source);
if (errors.length) throw new Error(errors.join('\n'));
// dist is a fixed child of this checkout; never accept an external output path.
await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });
const publicPages = (await fs.readdir(root)).filter(name => name.endsWith('.html'));
for (const name of [...publicPages, 'css', 'js', 'assets', 'zasnake', 'og-image.png']) {
    await fs.cp(path.join(root, name), path.join(dist, name), { recursive: true });
}
const data = structuredClone(source);
let originalBytes = 0, thumbnailBytes = 0;
for (const photo of data.photos) {
    const file = photoPath(photo.src);
    const input = path.join(root, file);
    const meta = await sharp(input, { failOn: 'warning', limitInputPixels: 40_000_000 }).metadata();
    if (meta.format !== 'webp' || (meta.pages || 1) !== 1) throw new Error('Unsupported image: ' + file);
    const thumb = file.replace('assets/photography/', 'assets/photography-thumbnails/');
    await fs.mkdir(path.dirname(path.join(dist, thumb)), { recursive: true });
    const result = await sharp(input, { failOn: 'warning', limitInputPixels: 40_000_000 })
        .rotate().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78 }).toFile(path.join(dist, thumb));
    photo.thumbnail = '/' + thumb.split('/').map(encodeURIComponent).join('/');
    photo.width = meta.width;
    photo.height = meta.height;
    originalBytes += (await fs.stat(input)).size;
    thumbnailBytes += result.size;
}
await fs.mkdir(path.join(dist, 'data'), { recursive: true });
await fs.writeFile(path.join(dist, 'data/photography.json'), JSON.stringify(data));
let commit = process.env.WORKERS_CI_COMMIT_SHA || process.env.GITHUB_SHA || '';
if (!commit) { try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* local preview without git */ } }
await fs.mkdir(path.join(dist, '_site'), { recursive: true });
await fs.writeFile(path.join(dist, '_site/version.json'), JSON.stringify({ commit: /^[a-f0-9]{40}$/.test(commit) ? commit : null, builtAt: new Date().toISOString() }));
await fs.writeFile(path.join(dist, '_headers'), '/_site/*\n  Cache-Control: no-store\n/data/*\n  Cache-Control: no-cache\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n');
await fs.writeFile(path.join(dist, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://zayedart.com/sitemap.xml\n');
const urls = ['/', '/portfolio', '/photography', '/zasnake/', '/zasnakeprivacy', '/zasnaketerms'];
await fs.writeFile(path.join(dist, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls.map(url => '<url><loc>https://zayedart.com' + url + '</loc></url>').join('') + '</urlset>\n');
console.log('Built ' + data.photos.length + ' photos: originals ' + (originalBytes / 1048576).toFixed(1) + ' MiB, thumbnails ' + (thumbnailBytes / 1048576).toFixed(1) + ' MiB');

