import fs from 'node:fs';
import path from 'node:path';
import { validateData, photoPath, webpInfo } from '../shared/photography.mjs';

const root = process.cwd();
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/photography.json'), 'utf8'));
const errors = validateData(data, file => fs.existsSync(path.join(root, file)));
for (const photo of data.photos || []) {
    try {
        const file = photoPath(photo.src);
        if (fs.existsSync(path.join(root, file))) webpInfo(new Uint8Array(fs.readFileSync(path.join(root, file))));
    } catch (error) { errors.push(photo.src + ': ' + error.message); }
}
errors.forEach(error => console.error('::error::' + error));
console.log((data.photos?.length || 0) + ' photos, ' + (data.categories?.length || 0) + ' categories: ' + errors.length + ' errors');
if (errors.length) process.exitCode = 1;

