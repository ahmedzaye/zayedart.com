export const PHOTO_DIR = 'assets/photography';
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const RESERVED_CATEGORIES = new Set(['all']);
export const MAX_PIXELS = 40_000_000;

export function isDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return !isNaN(date) && date.toISOString().slice(0, 10) === value;
}

export function photoPath(src) {
    if (typeof src !== 'string' || !src.startsWith('/')) throw new Error('Invalid photo path');
    let decoded;
    try { decoded = decodeURIComponent(src.slice(1)); } catch { throw new Error('Invalid path encoding'); }
    const parts = decoded.split('/');
    if (parts.length !== 4 || parts[0] !== 'assets' || parts[1] !== 'photography' ||
        !SLUG.test(parts[2]) || !parts[3] || !/\.webp$/i.test(parts[3]) ||
        parts.some(p => p === '.' || p === '..') || /[\\\x00-\x1f?#]/.test(decoded)) {
        throw new Error('Invalid photo path');
    }
    return decoded;
}

const bilingual = value => value && typeof value === 'object' && !Array.isArray(value) &&
    typeof value.en === 'string' && typeof value.ar === 'string';

export function validateData(data, exists = () => true) {
    const errors = [];
    if (!data || !Array.isArray(data.categories) || !Array.isArray(data.photos)) {
        return ['Data must contain categories and photos arrays'];
    }
    const ids = new Set();
    for (const category of data.categories) {
        if (!category || !SLUG.test(category.id || '') || category.id.length > 40 || RESERVED_CATEGORIES.has(category.id)) {
            errors.push('Invalid or reserved category id: ' + category?.id);
        }
        if (ids.has(category?.id)) errors.push('Duplicate category: ' + category.id);
        ids.add(category?.id);
        if (!bilingual(category?.name) || !category.name.en.trim() || !category.name.ar.trim() ||
            category.name.en.length > 60 || category.name.ar.length > 60) errors.push('Invalid category name');
    }
    const seen = new Set();
    for (const photo of data.photos) {
        let file;
        try { file = photoPath(photo?.src); } catch { errors.push('Invalid photo src: ' + photo?.src); continue; }
        if (seen.has(file)) errors.push('Duplicate photo: ' + file);
        seen.add(file);
        if (!exists(file)) errors.push('Missing file: ' + file);
        if (!ids.has(photo.category) || file.split('/')[2] !== photo.category) errors.push('Category/path mismatch: ' + file);
        for (const [key, limit] of [['title', 200], ['description', 2000]]) {
            if (!bilingual(photo[key]) || photo[key].en.length > limit || photo[key].ar.length > limit) errors.push('Invalid ' + key + ': ' + file);
        }
        for (const key of ['takenAt', 'uploadedAt']) {
            if (photo[key] != null && !isDate(photo[key])) errors.push('Invalid ' + key + ': ' + file);
        }
    }
    return errors;
}

// Container/frame validation here; full decoding runs in the browser and build.
export function webpInfo(bytes) {
    const fail = () => { throw new Error('Invalid or unsupported WebP image'); };
    if (!(bytes instanceof Uint8Array) || bytes.length < 20) return fail();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = pos => String.fromCharCode(...bytes.subarray(pos, pos + 4));
    const u24 = pos => bytes[pos] | bytes[pos + 1] << 8 | bytes[pos + 2] << 16;
    if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length) return fail();
    let offset = 12, frame = null, canvas = null, chunks = 0;
    while (offset < bytes.length) {
        if (offset + 8 > bytes.length || ++chunks > 64) return fail();
        const kind = tag(offset), size = view.getUint32(offset + 4, true), start = offset + 8;
        if (start + size + (size & 1) > bytes.length) return fail();
        if (kind === 'ANIM' || kind === 'ANMF') return fail();
        if (kind === 'VP8X') {
            if (canvas || size !== 10 || bytes[start] & 2) return fail();
            canvas = { width: 1 + u24(start + 4), height: 1 + u24(start + 7) };
        } else if (kind === 'VP8 ') {
            if (frame || size < 10 || bytes[start] & 1 || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 1 || bytes[start + 5] !== 0x2a) return fail();
            frame = { width: view.getUint16(start + 6, true) & 0x3fff, height: view.getUint16(start + 8, true) & 0x3fff };
        } else if (kind === 'VP8L') {
            if (frame || size < 5 || bytes[start] !== 0x2f || bytes[start + 4] >> 5) return fail();
            const bits = view.getUint32(start + 1, true);
            frame = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
        }
        offset = start + size + (size & 1);
    }
    if (!frame || !frame.width || !frame.height || frame.width * frame.height > MAX_PIXELS ||
        (canvas && (canvas.width !== frame.width || canvas.height !== frame.height))) return fail();
    return frame;
}

