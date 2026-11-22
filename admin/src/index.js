/**
 * zayedart-admin — API for the photography dashboard.
 *
 * Runs behind Cloudflare Access (admin.zayedart.com). It never trusts the
 * network alone: every /api/* call re-verifies the Access JWT.
 *
 * All writes go to GitHub as ONE commit per request (images + data/photography.json),
 * so each dashboard action triggers a single site deploy.
 */

const DATA_PATH = 'data/photography.json';
const PHOTO_DIR = 'assets/photography';

const MAX_FILES = 20;
const MAX_FILE_BYTES = 8 * 1024 * 1024;      // per image
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;    // per request
const MAX_TITLE = 200;
const MAX_DESC = 2000;

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });


/* =========================================================
   AUTH — Cloudflare Access JWT
   ========================================================= */

const b64uToBytes = (s) => {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

const decodePart = (s) => JSON.parse(new TextDecoder().decode(b64uToBytes(s)));

let jwksCache = { at: 0, keys: null };

async function getKeys(env, force = false) {
    if (force || !jwksCache.keys || Date.now() - jwksCache.at > 3600_000) {
        const res = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
        if (!res.ok) throw new HttpError(500, 'Could not load Access certificates');
        jwksCache = { at: Date.now(), keys: (await res.json()).keys || [] };
    }
    return jwksCache.keys;
}

async function verifyAccess(request, env) {
    // Local `wrangler dev` only (set in .dev.vars, never in production).
    if (env.DEV_BYPASS_AUTH === '1') return { email: 'dev@localhost' };

    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!token) throw new HttpError(401, 'Unauthorized');

    const [h, p, s] = token.split('.');
    if (!h || !p || !s) throw new HttpError(401, 'Unauthorized');

    let header, payload;
    try {
        header = decodePart(h);
        payload = decodePart(p);
    } catch {
        throw new HttpError(401, 'Unauthorized');
    }

    if (header.alg !== 'RS256') throw new HttpError(401, 'Unauthorized');

    let jwk = (await getKeys(env)).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await getKeys(env, true)).find((k) => k.kid === header.kid);
    if (!jwk) throw new HttpError(401, 'Unauthorized');

    const key = await crypto.subtle.importKey(
        'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );

    const valid = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5', key, b64uToBytes(s), new TextEncoder().encode(`${h}.${p}`)
    );

    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];

    if (
        !valid ||
        payload.exp * 1000 < Date.now() ||
        !aud.includes(env.ACCESS_AUD) ||
        payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`
    ) {
        throw new HttpError(401, 'Unauthorized');
    }

    // Optional extra allow-list: `wrangler secret put ALLOWED_EMAILS` (comma separated)
    if (env.ALLOWED_EMAILS) {
        const allowed = env.ALLOWED_EMAILS.split(',').map((e) => e.trim().toLowerCase());
        if (!allowed.includes(String(payload.email || '').toLowerCase())) {
            throw new HttpError(403, 'Forbidden');
        }
    }

    return payload;
}


/* =========================================================
   GITHUB — single-commit writes
   ========================================================= */

async function gh(env, path, init = {}) {
    const res = await fetch(
        `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}${path}`,
        {
            ...init,
            headers: {
                Authorization: `Bearer ${env.GITHUB_TOKEN}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'zayedart-admin',
                ...(init.headers || {})
            }
        }
    );

    if (!res.ok) {
        const err = new Error(`GitHub ${res.status} on ${path}`);
        err.status = res.status;
        throw err;
    }

    return res;
}

const ghJson = async (env, path, init) => (await gh(env, path, init)).json();

const post = (body) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
});

async function readData(env, ref) {
    const res = await gh(env, `/contents/${DATA_PATH}?ref=${ref}`, {
        headers: { Accept: 'application/vnd.github.raw+json' }
    });
    const data = JSON.parse(await res.text());
    data.categories ||= [];
    data.photos ||= [];
    return data;
}

const toBase64 = (bytes) => {
    if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
};

/**
 * Read data/photography.json at the current head, let `build` change it, and
 * push everything as one commit. Retries if someone else pushed in between.
 *
 * build(data, ctx) mutates `data` and returns:
 *   { files: [{ path, bytes }],           // files to add/replace
 *     deletes: [path],                    // files to remove
 *     moves: [{ from, to }],              // files to rename (keeps the blob)
 *     result }                            // returned to the caller
 */
async function commitChange(env, message, build) {
    const branch = env.GITHUB_BRANCH || 'main';

    for (let attempt = 0; attempt < 3; attempt++) {
        const ref = await ghJson(env, `/git/ref/heads/${branch}`);
        const headSha = ref.object.sha;
        const head = await ghJson(env, `/git/commits/${headSha}`);

        const data = await readData(env, headSha);
        const out = await build(data, { env, headSha });

        const entries = [];

        await Promise.all((out.files || []).map(async (f) => {
            const blob = await ghJson(env, '/git/blobs', post({ content: toBase64(f.bytes), encoding: 'base64' }));
            entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
        }));

        for (const m of out.moves || []) {
            const meta = await ghJson(env, `/contents/${encodePath(m.from)}?ref=${headSha}`);
            entries.push({ path: m.from, mode: '100644', type: 'blob', sha: null });
            entries.push({ path: m.to, mode: '100644', type: 'blob', sha: meta.sha });
        }

        for (const path of out.deletes || []) {
            entries.push({ path, mode: '100644', type: 'blob', sha: null });
        }

        const jsonBlob = await ghJson(env, '/git/blobs', post({
            content: JSON.stringify(data, null, 2) + '\n',
            encoding: 'utf-8'
        }));
        entries.push({ path: DATA_PATH, mode: '100644', type: 'blob', sha: jsonBlob.sha });

        const tree = await ghJson(env, '/git/trees', post({ base_tree: head.tree.sha, tree: entries }));
        const commit = await ghJson(env, '/git/commits', post({ message, tree: tree.sha, parents: [headSha] }));

        try {
            await gh(env, `/git/refs/heads/${branch}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sha: commit.sha, force: false })
            });
            return out.result;
        } catch (err) {
            if (err.status === 422 && attempt < 2) continue; // branch moved, try again
            throw err;
        }
    }

    throw new HttpError(409, 'Repository changed while saving. Please try again.');
}


/* =========================================================
   VALIDATION HELPERS
   ========================================================= */

const isDate = (v) => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(v + 'T00:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === v;
};

const cleanText = (v, max, label) => {
    const s = String(v ?? '').trim();
    if (s.length > max) throw new HttpError(400, `${label} is too long (max ${max})`);
    return s;
};

const cleanBilingual = (v, max, label) => ({
    en: cleanText(v?.en, max, label),
    ar: cleanText(v?.ar, max, label)
});

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const srcToPath = (src) => {
    let path;
    try {
        path = decodeURIComponent(String(src)).replace(/^\//, '');
    } catch {
        throw new HttpError(400, 'Bad photo path');
    }
    if (!path.startsWith(`${PHOTO_DIR}/`) || path.includes('..')) {
        throw new HttpError(400, 'Bad photo path');
    }
    return path;
};

const pathToSrc = (path) => '/' + path.split('/').map(encodeURIComponent).join('/');

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

const isWebp = (b) =>
    b.length > 12 &&
    String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...b.subarray(8, 12)) === 'WEBP';

function safeFileName(name) {
    const stem = name.replace(/\.[^.]+$/, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 60);
    return (stem || 'photo') + '.webp';
}

function uniquePath(dir, fileName, taken) {
    const dot = fileName.lastIndexOf('.');
    const stem = fileName.slice(0, dot);
    let candidate = `${dir}/${fileName}`;
    let n = 2;
    while (taken.has(candidate)) candidate = `${dir}/${stem}-${n++}${fileName.slice(dot)}`;
    taken.add(candidate);
    return candidate;
}

const takenPaths = (data) => new Set(data.photos.map((p) => srcToPath(p.src)));

const today = () => new Date().toISOString().slice(0, 10);


/* =========================================================
   ROUTE HANDLERS
   ========================================================= */

async function uploadPhotos(request, env) {
    const form = await request.formData();
    const files = form.getAll('file').filter((f) => typeof f !== 'string');

    let meta;
    try {
        meta = JSON.parse(form.get('meta') || '[]');
    } catch {
        throw new HttpError(400, 'Bad metadata');
    }

    if (!files.length) throw new HttpError(400, 'No files');
    if (files.length > MAX_FILES) throw new HttpError(400, `Max ${MAX_FILES} files per upload`);
    if (meta.length !== files.length) throw new HttpError(400, 'Metadata does not match files');

    const total = files.reduce((sum, f) => sum + f.size, 0);
    if (total > MAX_TOTAL_BYTES) throw new HttpError(413, 'Upload is too large');

    const prepared = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > MAX_FILE_BYTES) throw new HttpError(413, `${file.name} is larger than 8 MB`);

        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!isWebp(bytes)) throw new HttpError(400, `${file.name} is not a WebP image`);

        const m = meta[i] || {};
        if (m.takenAt && !isDate(m.takenAt)) throw new HttpError(400, `Bad date for ${file.name}`);

        prepared.push({
            file,
            bytes,
            category: String(m.category || ''),
            title: cleanBilingual(m.title, MAX_TITLE, 'Title'),
            description: cleanBilingual(m.description, MAX_DESC, 'Description'),
            takenAt: m.takenAt || null
        });
    }

    return commitChange(env, `photos: add ${prepared.length} via dashboard`, async (data) => {
        const taken = takenPaths(data);
        const added = [];
        const filesOut = [];

        for (const p of prepared) {
            if (!data.categories.some((c) => c.id === p.category)) {
                throw new HttpError(400, `Unknown category "${p.category}"`);
            }

            const path = uniquePath(`${PHOTO_DIR}/${p.category}`, safeFileName(p.file.name), taken);
            filesOut.push({ path, bytes: p.bytes });

            added.push({
                src: `/${path}`,
                category: p.category,
                title: p.title,
                description: p.description,
                takenAt: p.takenAt,
                uploadedAt: today()
            });
        }

        data.photos.unshift(...added);

        return { files: filesOut, result: { added: added.length, photos: added } };
    });
}

/** Body: { items: [{ src, title?, description?, takenAt?, category? }] } */
async function updatePhotos(request, env) {
    const { items } = await request.json();
    if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'No items');
    if (items.length > 200) throw new HttpError(400, 'Too many items');

    return commitChange(env, `photos: update ${items.length} via dashboard`, async (data) => {
        const taken = takenPaths(data);
        const moves = [];

        for (const item of items) {
            const photo = data.photos.find((p) => p.src === item.src);
            if (!photo) throw new HttpError(404, `Photo not found: ${item.src}`);

            if ('title' in item) photo.title = cleanBilingual(item.title, MAX_TITLE, 'Title');
            if ('description' in item) photo.description = cleanBilingual(item.description, MAX_DESC, 'Description');

            if ('takenAt' in item) {
                if (item.takenAt && !isDate(item.takenAt)) throw new HttpError(400, 'Bad date');
                photo.takenAt = item.takenAt || null;
            }

            if (item.category && item.category !== photo.category) {
                if (!data.categories.some((c) => c.id === item.category)) {
                    throw new HttpError(400, `Unknown category "${item.category}"`);
                }

                const from = srcToPath(photo.src);
                const fileName = from.split('/').pop();
                const to = uniquePath(`${PHOTO_DIR}/${item.category}`, fileName, taken);

                moves.push({ from, to });
                photo.src = pathToSrc(to);
                photo.category = item.category;
            }
        }

        if (moves.length > 30) throw new HttpError(400, 'Move at most 30 photos between categories at once');

        return { moves, result: { updated: items.length } };
    });
}

/** Body: { srcs: [...] } */
async function deletePhotos(request, env) {
    const { srcs } = await request.json();
    if (!Array.isArray(srcs) || !srcs.length) throw new HttpError(400, 'No items');

    return commitChange(env, `photos: delete ${srcs.length} via dashboard`, async (data) => {
        const deletes = [];

        for (const src of srcs) {
            const index = data.photos.findIndex((p) => p.src === src);
            if (index === -1) throw new HttpError(404, `Photo not found: ${src}`);
            deletes.push(srcToPath(src));
            data.photos.splice(index, 1);
        }

        return { deletes, result: { deleted: srcs.length } };
    });
}

async function addCategory(request, env) {
    const body = await request.json();
    const id = String(body.id || '').trim();
    const name = cleanBilingual(body.name, 60, 'Name');

    if (!SLUG.test(id) || id.length > 40) {
        throw new HttpError(400, 'Category id must be lowercase letters, numbers and dashes');
    }
    if (!name.en || !name.ar) throw new HttpError(400, 'Name is required in both languages');

    return commitChange(env, `photos: add category ${id}`, async (data) => {
        if (data.categories.some((c) => c.id === id)) throw new HttpError(409, 'Category already exists');
        data.categories.push({ id, name });
        return { result: { id } };
    });
}

async function renameCategory(request, env) {
    const body = await request.json();
    const name = cleanBilingual(body.name, 60, 'Name');
    if (!name.en || !name.ar) throw new HttpError(400, 'Name is required in both languages');

    return commitChange(env, `photos: rename category ${body.id}`, async (data) => {
        const cat = data.categories.find((c) => c.id === body.id);
        if (!cat) throw new HttpError(404, 'Category not found');
        cat.name = name;
        return { result: { id: cat.id } };
    });
}

async function deleteCategory(request, env) {
    const { id } = await request.json();

    return commitChange(env, `photos: delete category ${id}`, async (data) => {
        if (data.photos.some((p) => p.category === id)) {
            throw new HttpError(409, 'Category still has photos. Move or delete them first.');
        }
        const index = data.categories.findIndex((c) => c.id === id);
        if (index === -1) throw new HttpError(404, 'Category not found');
        data.categories.splice(index, 1);
        return { result: { id } };
    });
}

async function getState(env) {
    const branch = env.GITHUB_BRANCH || 'main';
    const ref = await ghJson(env, `/git/ref/heads/${branch}`);
    const data = await readData(env, ref.object.sha);

    return {
        data,
        config: {
            siteOrigin: env.SITE_ORIGIN || '',
            maxFiles: MAX_FILES,
            maxFileMB: MAX_FILE_BYTES / 1024 / 1024
        }
    };
}


/* =========================================================
   ROUTER
   ========================================================= */

const routes = {
    'POST /api/photos': uploadPhotos,
    'PATCH /api/photos': updatePhotos,
    'DELETE /api/photos': deletePhotos,
    'POST /api/categories': addCategory,
    'PATCH /api/categories': renameCategory,
    'DELETE /api/categories': deleteCategory
};

export default {
    async fetch(request, env) {
        try {
            const url = new URL(request.url);

            await verifyAccess(request, env);

            // CSRF guard: writes must come from the dashboard page itself.
            if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin) {
                throw new HttpError(403, 'Bad origin');
            }

            if (request.method === 'GET' && url.pathname === '/api/state') {
                return json(await getState(env));
            }

            const handler = routes[`${request.method} ${url.pathname}`];
            if (!handler) throw new HttpError(404, 'Not found');

            return json(await handler(request, env));
        } catch (err) {
            if (err instanceof HttpError) return json({ error: err.message }, err.status);
            console.error(err);
            return json({ error: 'Server error' }, 500);
        }
    }
};
