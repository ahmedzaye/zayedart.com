// Validates data/photography.json against the files in assets/photography.
// Errors fail the check; photos on disk that are missing from the JSON only warn.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/photography.json'), 'utf8'));
const errors = [];
const warnings = [];

const isDate = (v) => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(v + 'T00:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === v;
};
const bilingual = (o) => o && typeof o.en === 'string' && typeof o.ar === 'string';

const ids = new Set();
for (const c of data.categories ?? []) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id ?? '')) errors.push(`Bad category id: ${c.id}`);
    if (ids.has(c.id)) errors.push(`Duplicate category: ${c.id}`);
    if (!bilingual(c.name) || !c.name.en || !c.name.ar) errors.push(`Category ${c.id} needs name.en and name.ar`);
    ids.add(c.id);
}

const seen = new Set();
for (const p of data.photos ?? []) {
    const file = decodeURIComponent(String(p.src ?? '')).replace(/^\//, '');
    if (!file.startsWith('assets/photography/') || file.includes('..')) { errors.push(`Bad src: ${p.src}`); continue; }
    if (seen.has(file)) errors.push(`Duplicate photo: ${file}`);
    seen.add(file);
    if (!fs.existsSync(path.join(root, file))) errors.push(`Missing file: ${file}`);
    if (!ids.has(p.category)) errors.push(`Unknown category "${p.category}" in ${file}`);
    else if (file.split('/')[2] !== p.category) errors.push(`Folder/category mismatch: ${file} (${p.category})`);
    if (!bilingual(p.title) || !bilingual(p.description)) errors.push(`title/description must be {en, ar}: ${file}`);
    if (p.takenAt != null && !isDate(p.takenAt)) errors.push(`Bad takenAt in ${file}: ${p.takenAt}`);
    if (p.uploadedAt != null && !isDate(p.uploadedAt)) errors.push(`Bad uploadedAt in ${file}: ${p.uploadedAt}`);
}

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
for (const f of walk(path.join(root, 'assets/photography'))) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    if (/\.(webp|jpe?g|png)$/i.test(rel) && !seen.has(rel)) warnings.push(`Not listed in JSON (won't appear on site): ${rel}`);
}

warnings.forEach((w) => console.log(`::warning::${w}`));
errors.forEach((e) => console.log(`::error::${e}`));
console.log(`${data.photos.length} photos, ${data.categories.length} categories: ${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
