/* Photography dashboard — talks to /api/* (same origin, protected by Cloudflare Access) */

const $ = (id) => document.getElementById(id);

/* tiny DOM builder: text always goes through textContent (no HTML injection) */
function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
        if (kid != null && kid !== false) el.append(kid);
    }
    return el;
}

let state = { data: { categories: [], photos: [] }, config: {} };
let selected = new Set();
let queue = [];            // pending uploads: { file, url, category, date, titleEn, titleAr, descEn, descAr, error }
let saving = false;
let publicationTimer;
let publicationGeneration = 0;
let editing = null;        // photo being edited

/* =====================================================
   API
   ===================================================== */

async function api(method, path, body) {
    const write = method !== 'GET';
    if (write && saving) throw new Error('A save is already running. Please wait.');
    const controls = write ? [...document.querySelectorAll('button, input, select, textarea')] : [];
    const disabled = controls.map(control => control.disabled);
    if (write) { saving = true; controls.forEach(control => control.disabled = true); }
    try {
        const init = { method, headers: {} };
        if (body instanceof FormData) init.body = body;
        else if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
        const res = await fetch(path, init);
        if (!(res.headers.get('Content-Type') || '').includes('application/json')) throw new Error('Session expired. Reload this page to sign in again.');
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || 'Request failed (' + res.status + ')');
        if (write && payload.commitSha) trackPublication(payload.commitSha);
        return payload;
    } finally {
        if (write) { saving = false; controls.forEach((control, i) => control.disabled = disabled[i]); }
    }
}

async function trackPublication(commit) {
    clearTimeout(publicationTimer);
    const generation = ++publicationGeneration;
    try { sessionStorage.setItem('pending-publication', commit); } catch { /* optional */ }
    let attempts = 0;
    const check = async () => {
        if (generation !== publicationGeneration) return;
        try {
            const result = await api('GET', '/api/publication?commit=' + encodeURIComponent(commit));
            if (generation !== publicationGeneration) return;
            if (result.status === 'published') {
                $('deployNote').textContent = '\u062a\u0645 \u0627\u0644\u0646\u0634\u0631 \u0639\u0644\u0649 \u0627\u0644\u0645\u0648\u0642\u0639 \u0628\u0646\u062c\u0627\u062d.';
                $('deployNote').hidden = false;
                try { sessionStorage.removeItem('pending-publication'); } catch { /* optional */ }
                return;
            }
        } catch { /* keep the saved GitHub state; a check failure is not a save failure */ }
        if (++attempts < 36) publicationTimer = setTimeout(check, 5000);
        else {
            $('deployNote').textContent = '\u062a\u0645 \u0627\u0644\u062d\u0641\u0638 \u0639\u0644\u0649 GitHub\u060c \u0644\u0643\u0646 \u0644\u0645 \u064a\u062a\u0623\u0643\u062f \u0627\u0644\u0646\u0634\u0631 \u0628\u0639\u062f. \u0631\u0627\u062c\u0639 \u062d\u0627\u0644\u0629 Cloudflare.';
        }
    };
    publicationTimer = setTimeout(check, 1500);
}

async function load() {
    state = await api('GET', '/api/state');
    $('maxFiles').textContent = state.config.maxFiles;
    $('maxMB').textContent = state.config.maxFileMB;
    $('siteLink').href = (state.config.siteOrigin || '') + '/photography.html';
    selected = new Set([...selected].filter((s) => state.data.photos.some((p) => p.src === s)));
    renderAll();
}

/* =====================================================
   HELPERS
   ===================================================== */

let toastTimer;
function toast(msg, isErr = false) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('err', isErr);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), isErr ? 6000 : 3500);
}

const DEPLOY_MSG = '\u062a\u0645 \u0627\u0644\u062d\u0641\u0638 \u0639\u0644\u0649 GitHub. \u062c\u0627\u0631\u064a \u0627\u0644\u062a\u062d\u0642\u0642 \u0645\u0646 \u0646\u0634\u0631 \u0627\u0644\u062a\u0639\u062f\u064a\u0644 \u0639\u0644\u0649 \u0627\u0644\u0645\u0648\u0642\u0639...';

function saved(msg) {
    toast(msg);
    $('deployNote').textContent = DEPLOY_MSG;
    $('deployNote').hidden = false;
}

const catName = (id) => state.data.categories.find((c) => c.id === id)?.name.ar || id;
const fileName = (src) => decodeURIComponent(src.split('/').pop());

/* same order as the public gallery: capture date desc, undated last, then newest upload */
function sortedPhotos() {
    return state.data.photos
        .map((p, i) => ({ ...p, _i: i }))
        .sort((a, b) => {
            const ak = a.takenAt || '', bk = b.takenAt || '';
            if (ak !== bk) return !ak ? 1 : !bk ? -1 : bk.localeCompare(ak);
            const au = a.uploadedAt || '', bu = b.uploadedAt || '';
            return au !== bu ? bu.localeCompare(au) : a._i - b._i;
        });
}

function fillCategorySelect(select, { all = false, placeholder = '' } = {}) {
    const current = select.value;
    select.replaceChildren();
    if (all) select.append(h('option', { value: '' }, 'كل الأقسام'));
    if (placeholder) select.append(h('option', { value: '' }, placeholder));
    state.data.categories.forEach((c) => select.append(h('option', { value: c.id }, `${c.name.ar} — ${c.name.en}`)));
    if ([...select.options].some((o) => o.value === current)) select.value = current;
}

const setBusy = (btns, busy) => btns.forEach((b) => (b.disabled = busy));

/* =====================================================
   UPLOAD
   ===================================================== */

async function addFiles(fileList) {
    if (saving) return;
    const max = state.config.maxFiles || 20;
    const limit = (state.config.maxFileMB || 8) * 1024 * 1024;

    for (const file of fileList) {
        if (queue.length >= max) { toast(`الحد الأقصى ${max} صورة في المرة`, true); break; }

        let error = '';
        if (!/\.webp$/i.test(file.name) || (file.type && file.type !== 'image/webp')) error = 'الملف لازم يكون WebP';
        else if (file.size > limit) error = `الحجم أكبر من ${state.config.maxFileMB} ميجا`;

        queue.push({
            file, url: URL.createObjectURL(file), error,
            category: $('bulkCategory').value || state.data.categories[0]?.id || '',
            date: $('bulkDate').value || '', titleEn: '', titleAr: '', descEn: '', descAr: ''
        });
    }

    for (const item of queue.filter(item => !item.error && !item.validated)) {
        try {
            const image = await createImageBitmap(item.file);
            if (image.width * image.height > 40_000_000) item.error = 'Image exceeds 40 megapixels';
            image.close();
            item.validated = true;
        } catch { item.error = 'Invalid WebP image'; }
    }
    renderQueue();
}

function renderQueue() {
    const q = $('queue');
    q.replaceChildren();

    queue.forEach((item, i) => {
        const bind = (key) => (e) => { item[key] = e.target.value; };

        const catSel = h('select', { onchange: bind('category') },
            state.data.categories.map((c) => h('option', { value: c.id, selected: c.id === item.category }, c.name.ar)));

        q.append(h('div', { class: 'qrow' },
            h('img', { src: item.url, alt: '' }),
            h('div', { class: 'f' },
                h('small', { dir: 'ltr' }, 'GitHub folder: assets/photography/' + item.category + '/'),
                h('div', { class: 'name' },
                    h('span', {}, `${item.file.name} · ${(item.file.size / 1024).toFixed(0)} KB`),
                    h('button', { type: 'button', title: 'إزالة', onclick: () => { URL.revokeObjectURL(item.url); queue.splice(i, 1); renderQueue(); } }, '×')),
                catSel,
                h('input', { type: 'date', value: item.date, oninput: bind('date'), 'aria-label': 'تاريخ الالتقاط' }),
                h('input', { placeholder: 'العنوان (EN)', dir: 'ltr', maxlength: 200, value: item.titleEn, oninput: bind('titleEn') }),
                h('input', { placeholder: 'العنوان (AR)', maxlength: 200, value: item.titleAr, oninput: bind('titleAr') }),
                h('input', { placeholder: 'الوصف (EN)', dir: 'ltr', maxlength: 2000, value: item.descEn, oninput: bind('descEn') }),
                h('input', { placeholder: 'الوصف (AR)', maxlength: 2000, value: item.descAr, oninput: bind('descAr') }),
                item.error && h('div', { class: 'err' }, item.error))));
    });

    $('uploadBulk').hidden = $('uploadActions').hidden = !queue.length;
}

async function upload() {
    if (!queue.length || queue.some(i => !i.validated && !i.error)) return toast('Wait for image validation', true);
    if (queue.reduce((sum, item) => sum + item.file.size, 0) > (state.config.maxTotalMB || 40) * 1024 * 1024) return toast('Upload exceeds the total size limit', true);
    if (queue.some((i) => i.error)) return toast('امسح الصور اللي فيها أخطاء الأول', true);
    if (queue.some((i) => !i.category)) return toast('اختار قسم لكل صورة', true);

    const fd = new FormData();
    queue.forEach((i) => fd.append('file', i.file));
    fd.append('meta', JSON.stringify(queue.map((i) => ({
        category: i.category,
        takenAt: i.date || null,
        title: { en: i.titleEn, ar: i.titleAr },
        description: { en: i.descEn, ar: i.descAr }
    }))));

    const btns = [$('uploadBtn'), $('clearQueue')];
    setBusy(btns, true);
    $('uploadStatus').className = 'status';
    $('uploadStatus').textContent = 'جاري الرفع...';

    try {
        const r = await api('POST', '/api/photos', fd);
        queue.forEach((i) => URL.revokeObjectURL(i.url));
        queue = [];
        $('uploadStatus').textContent = '';
        saved(`تم رفع ${r.added} صورة. ${DEPLOY_MSG}`);
        await load();
        renderQueue();
    } catch (err) {
        $('uploadStatus').className = 'status err';
        $('uploadStatus').textContent = err.message;
    } finally {
        setBusy(btns, false);
    }
}

/* =====================================================
   CATEGORIES
   ===================================================== */

function renderCategories() {
    const box = $('catList');
    box.replaceChildren();

    state.data.categories.forEach((c) => {
        const count = state.data.photos.filter((p) => p.category === c.id).length;

        box.append(h('span', { class: 'cat' },
            `${c.name.ar} · ${c.name.en}`,
            h('em', {}, `${c.id} (${count})`),
            h('button', { type: 'button', title: 'تعديل الاسم', onclick: () => renameCat(c) }, '✎'),
            h('button', { type: 'button', title: 'حذف القسم', onclick: () => deleteCat(c, count) }, '🗑')));
    });
}

async function renameCat(c) {
    const en = prompt('الاسم بالإنجليزي', c.name.en);
    if (en === null) return;
    const ar = prompt('الاسم بالعربي', c.name.ar);
    if (ar === null) return;

    try {
        await api('PATCH', '/api/categories', { id: c.id, name: { en, ar } });
        saved('تم تعديل اسم القسم.');
        await load();
    } catch (err) { toast(err.message, true); }
}

async function deleteCat(c, count) {
    if (count) return toast('القسم فيه صور. انقلها أو احذفها الأول.', true);
    if (!confirm(`حذف قسم "${c.name.ar}"؟`)) return;

    try {
        await api('DELETE', '/api/categories', { id: c.id });
        saved('تم حذف القسم.');
        await load();
    } catch (err) { toast(err.message, true); }
}

/* =====================================================
   LIBRARY
   ===================================================== */

function visiblePhotos() {
    const cat = $('fCategory').value;
    const q = $('fSearch').value.trim().toLowerCase();
    const noDate = $('fNoDate').checked;
    const noTitle = $('fNoTitle').checked;

    return sortedPhotos().filter((p) => {
        if (cat && p.category !== cat) return false;
        if (noDate && p.takenAt) return false;
        if (noTitle && (p.title.en || p.title.ar)) return false;
        if (q && !`${p.title.en} ${p.title.ar} ${fileName(p.src)}`.toLowerCase().includes(q)) return false;
        return true;
    });
}

function renderLibrary() {
    const list = visiblePhotos();
    const grid = $('grid');
    grid.replaceChildren();

    $('libCount').textContent = `${list.length} من ${state.data.photos.length}`;

    if (!list.length) grid.append(h('p', { class: 'empty-state' }, 'مفيش صور مطابقة.'));

    const origin = state.config.siteOrigin || '';

    list.forEach((p) => {
        const title = p.title.ar || p.title.en;
        const thumb = h('div', { class: 'thumb' });
        thumb.append(h('img', {
            src: origin + p.src.replace('/assets/photography/', '/assets/photography-thumbnails/'), alt: '', loading: 'lazy',
            onerror: (e) => { if (!e.target.dataset.fallback) { e.target.dataset.fallback = '1'; e.target.src = origin + p.src; return; } e.target.replaceWith(document.createTextNode('قيد النشر…')); }
        }));

        const card = h('div', { class: 'pcard' + (selected.has(p.src) ? ' sel' : ''), onclick: () => openEdit(p) },
            h('input', {
                type: 'checkbox', class: 'pick', checked: selected.has(p.src), 'aria-label': 'تحديد',
                onclick: (e) => e.stopPropagation(),
                onchange: (e) => {
                    e.target.checked ? selected.add(p.src) : selected.delete(p.src);
                    card.classList.toggle('sel', e.target.checked);
                    renderSelBar();
                }
            }),
            thumb,
            h('div', { class: 'meta' },
                h('div', { class: 't' + (title ? '' : ' empty') }, title || fileName(p.src)),
                h('span', { class: 'tag' }, catName(p.category)),
                h('div', { class: 'd' }, p.takenAt || '— no date —')));

        grid.append(card);
    });

    renderSelBar();
}

function renderSelBar() {
    $('selBar').hidden = !selected.size;
    $('selCount').textContent = `${selected.size} محددة`;
}

async function bulkUpdate(fields, doneMsg) {
    const items = [...selected].map((src) => ({ src, ...fields }));
    try {
        await api('PATCH', '/api/photos', { items });
        selected.clear();
        saved(doneMsg);
        await load();
    } catch (err) { toast(err.message, true); }
}

/* ----- edit dialog ----- */

function openEdit(p) {
    editing = p;
    fillCategorySelect($('eCategory'));
    $('eCategory').value = p.category;
    $('eDate').value = p.takenAt || '';
    $('eTitleEn').value = p.title.en;
    $('eTitleAr').value = p.title.ar;
    $('eDescEn').value = p.description.en;
    $('eDescAr').value = p.description.ar;
    $('ePath').textContent = decodeURIComponent(p.src);
    $('editImg').src = (state.config.siteOrigin || '') + p.src;
    $('eStatus').textContent = '';
    $('editDialog').showModal();
}

async function saveEdit() {
    const btns = [$('eSave'), $('eDelete'), $('eCancel')];
    setBusy(btns, true);
    $('eStatus').className = 'status';
    $('eStatus').textContent = 'جاري الحفظ...';

    try {
        await api('PATCH', '/api/photos', { items: [{
            src: editing.src,
            category: $('eCategory').value,
            takenAt: $('eDate').value || null,
            title: { en: $('eTitleEn').value, ar: $('eTitleAr').value },
            description: { en: $('eDescEn').value, ar: $('eDescAr').value }
        }] });
        $('editDialog').close();
        saved('تم حفظ التعديل.');
        await load();
    } catch (err) {
        $('eStatus').className = 'status err';
        $('eStatus').textContent = err.message;
    } finally {
        setBusy(btns, false);
    }
}

async function deleteSrcs(srcs) {
    if (!confirm(`حذف ${srcs.length} صورة نهائيًا من الموقع والريبو؟`)) return;
    try {
        await api('DELETE', '/api/photos', { srcs });
        srcs.forEach((s) => selected.delete(s));
        if ($('editDialog').open) $('editDialog').close();
        saved('تم الحذف.');
        await load();
    } catch (err) { toast(err.message, true); }
}

/* =====================================================
   INIT
   ===================================================== */

function renderAll() {
    ['bulkCategory', 'selCategory'].forEach((id) => fillCategorySelect($(id)));
    fillCategorySelect($('fCategory'), { all: true });
    renderCategories();
    renderQueue();
    renderLibrary();
}

/* upload */
$('fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
['dragenter', 'dragover'].forEach((ev) => $('drop').addEventListener(ev, (e) => { e.preventDefault(); $('drop').classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => $('drop').addEventListener(ev, (e) => { e.preventDefault(); $('drop').classList.remove('over'); }));
$('drop').addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
$('applyBulk').addEventListener('click', () => {
    queue.forEach((i) => {
        if ($('bulkCategory').value) i.category = $('bulkCategory').value;
        if ($('bulkDate').value) i.date = $('bulkDate').value;
    });
    renderQueue();
});
$('uploadBtn').addEventListener('click', upload);
$('clearQueue').addEventListener('click', () => { queue.forEach((i) => URL.revokeObjectURL(i.url)); queue = []; renderQueue(); });

/* categories */
$('catForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
        await api('POST', '/api/categories', { id: f.get('id').trim(), name: { en: f.get('en').trim(), ar: f.get('ar').trim() } });
        e.target.reset();
        saved('تمت إضافة القسم.');
        await load();
    } catch (err) { toast(err.message, true); }
});

/* library filters + bulk bar */
['fCategory', 'fSearch', 'fNoDate', 'fNoTitle'].forEach((id) => $(id).addEventListener('input', renderLibrary));
$('selApplyDate').addEventListener('click', () => {
    if (!$('selDate').value) return toast('اختار التاريخ الأول', true);
    bulkUpdate({ takenAt: $('selDate').value }, 'تم تعيين التاريخ.');
});
$('selMove').addEventListener('click', () => {
    if (!$('selCategory').value) return toast('اختار القسم الأول', true);
    bulkUpdate({ category: $('selCategory').value }, 'تم نقل الصور.');
});
$('selDelete').addEventListener('click', () => deleteSrcs([...selected]));
$('selClear').addEventListener('click', () => { selected.clear(); renderLibrary(); });

/* edit dialog */
$('eSave').addEventListener('click', saveEdit);
$('eCancel').addEventListener('click', () => $('editDialog').close());
$('eDelete').addEventListener('click', () => deleteSrcs([editing.src]));

load().then(() => { try { const pending = sessionStorage.getItem('pending-publication'); if (pending) trackPublication(pending); } catch { /* optional */ } }).catch((err) => toast(err.message, true));
