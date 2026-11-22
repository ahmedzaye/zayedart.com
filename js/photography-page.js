/* =========================================================
   Photography page
   Data source: /data/photography.json (managed by the admin dashboard)
   ========================================================= */

const DATA_URL = '/data/photography.json';

const photoGrid = document.getElementById('photoGrid');
const photoCount = document.getElementById('photoCount');
const filtersBox = document.getElementById('photoFilters');

const lightbox = document.getElementById('lightbox');
const lightboxImage = document.getElementById('lightboxImage');
const lightboxTitle = document.getElementById('lightboxTitle');
const lightboxDesc = document.getElementById('lightboxDesc');
const lightboxMeta = document.getElementById('lightboxMeta');

const lightboxClose = document.getElementById('lightboxClose');
const lightboxPrev = document.getElementById('lightboxPrev');
const lightboxNext = document.getElementById('lightboxNext');

let categories = [];
let allPhotos = [];
let activeCategory = 'all';
let loaded = false;


/* =====================================================
   HELPERS
   ===================================================== */

function currentLang() {
    return document.documentElement.lang === 'ar' ? 'ar' : 'en';
}

/* Localized value with fallback to the other language */
function pick(obj) {
    if (!obj) return '';
    return obj[currentLang()] || obj.en || obj.ar || '';
}

function categoryName(id) {
    const cat = categories.find(c => c.id === id);
    return cat ? pick(cat.name) || id : id;
}

function buildCountText(n) {
    if (currentLang() === 'ar') return `${n} صورة`;
    return `${n} photograph${n === 1 ? '' : 's'}`;
}

function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00Z');
    if (isNaN(d)) return '';
    return new Intl.DateTimeFormat(
        currentLang() === 'ar' ? 'ar-EG' : 'en-GB',
        { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }
    ).format(d);
}

function photoAlt(photo) {
    return pick(photo.title) || `${categoryName(photo.category)} photography`;
}

/* Newest capture date first. No date -> last. Ties: newest upload, then file order. */
function byDate(a, b) {
    const ak = a.takenAt || '';
    const bk = b.takenAt || '';

    if (ak !== bk) {
        if (!ak) return 1;
        if (!bk) return -1;
        return bk.localeCompare(ak);
    }

    const au = a.uploadedAt || '';
    const bu = b.uploadedAt || '';

    if (au !== bu) return bu.localeCompare(au);

    return a._i - b._i;
}


/* =====================================================
   FILTERS (built from categories in the JSON)
   ===================================================== */

function renderFilters() {
    filtersBox.querySelectorAll('[data-dynamic]').forEach(el => el.remove());

    categories.forEach(cat => {
        const btn = document.createElement('button');

        btn.type = 'button';
        btn.className = 'za-photo-filter';
        btn.dataset.category = cat.id;
        btn.dataset.dynamic = '1';
        btn.textContent = pick(cat.name) || cat.id;

        if (cat.id === activeCategory) btn.classList.add('active');

        filtersBox.appendChild(btn);
    });

    filtersBox.querySelector('[data-category="all"]')
        .classList.toggle('active', activeCategory === 'all');
}

filtersBox.addEventListener('click', event => {
    const btn = event.target.closest('.za-photo-filter');
    if (!btn) return;

    activeCategory = btn.dataset.category;

    filtersBox.querySelectorAll('.za-photo-filter').forEach(f => {
        f.classList.toggle('active', f === btn);
    });

    renderGallery();
});


/* =====================================================
   GALLERY
   ===================================================== */

function renderGallery() {
    photoGrid.innerHTML = '';

    const visible = activeCategory === 'all'
        ? allPhotos
        : allPhotos.filter(p => p.category === activeCategory);

    photoCount.textContent = buildCountText(visible.length);

    visible.forEach((photo, index) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('aria-label', photoAlt(photo));
        item.className = 'za-photo-item';
        item.dataset.category = photo.category;

        const image = document.createElement('img');
        image.src = photo.thumbnail || photo.src;
        image.onerror = () => { image.onerror = null; if (image.src !== new URL(photo.src, location.origin).href) image.src = photo.src; };
        if (photo.width && photo.height) { image.width = photo.width; image.height = photo.height; }
        image.alt = photoAlt(photo);
        image.loading = index < 3 ? 'eager' : 'lazy';
        image.decoding = 'async';
        image.draggable = false;

        const watermark = document.createElement('span');
        watermark.className = 'za-photo-watermark';
        watermark.textContent = 'ZAYED ART';

        item.appendChild(image);
        item.appendChild(watermark);

        item.addEventListener('click', () => openLightbox(visible, index));

        photoGrid.appendChild(item);
    });
}


/* =====================================================
   LIGHTBOX
   ===================================================== */

let currentPhotos = [];
let currentIndex = 0;
let previousFocus = null;

function openLightbox(photos, index) {
    previousFocus = document.activeElement;
    currentPhotos = photos;
    currentIndex = index;

    updateLightbox();

    lightbox.classList.add('open');
    lightbox.setAttribute('aria-hidden', 'false');
    document.querySelector('.za-photo-page').inert = true;
    lightboxClose.focus();
    document.body.style.overflow = 'hidden';
}

function updateLightbox() {
    const photo = currentPhotos[currentIndex];
    if (!photo) return;

    lightboxImage.src = photo.src;
    lightboxImage.alt = photoAlt(photo);

    const title = pick(photo.title);
    const desc = pick(photo.description);

    lightboxTitle.textContent = title;
    lightboxTitle.hidden = !title;

    lightboxDesc.textContent = desc;
    lightboxDesc.hidden = !desc;

    const parts = [
        categoryName(photo.category),
        formatDate(photo.takenAt),
        `${currentIndex + 1} / ${currentPhotos.length}`
    ].filter(Boolean);

    lightboxMeta.textContent = parts.join(' · ');
}

function closeLightbox() {
    lightbox.classList.remove('open');
    lightbox.setAttribute('aria-hidden', 'true');
    document.querySelector('.za-photo-page').inert = false;
    previousFocus?.focus();
    document.body.style.overflow = '';

    setTimeout(() => {
        if (!lightbox.classList.contains('open')) {
            lightboxImage.src = '';
        }
    }, 200);
}

function showPrevious() {
    if (!currentPhotos.length) return;
    currentIndex = (currentIndex - 1 + currentPhotos.length) % currentPhotos.length;
    updateLightbox();
}

function showNext() {
    if (!currentPhotos.length) return;
    currentIndex = (currentIndex + 1) % currentPhotos.length;
    updateLightbox();
}

lightboxClose.addEventListener('click', closeLightbox);
lightboxPrev.addEventListener('click', showPrevious);
lightboxNext.addEventListener('click', showNext);

lightbox.addEventListener('click', event => {
    if (event.target === lightbox) closeLightbox();
});

document.addEventListener('keydown', event => {
    if (!lightbox.classList.contains('open')) return;

    if (event.key === 'Tab') {
        const controls = [lightboxClose, lightboxPrev, lightboxNext];
        const current = controls.indexOf(document.activeElement);
        event.preventDefault();
        controls[(current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
    }
    if (event.key === 'Escape') closeLightbox();
    if (event.key === 'ArrowLeft') showPrevious();
    if (event.key === 'ArrowRight') showNext();
});


/* =====================================================
   LANGUAGE (called from the EN / عربي button)
   ===================================================== */

function toggleLanguage() {
    setLanguage(currentLang() === 'ar' ? 'en' : 'ar');

    if (!loaded) return;

    renderFilters();
    renderGallery();

    if (lightbox.classList.contains('open')) updateLightbox();
}


/* =====================================================
   BASIC IMAGE PROTECTION
   ===================================================== */

document.addEventListener('contextmenu', event => {
    if (
        event.target.tagName === 'IMG' ||
        event.target.closest('.za-photo-item') ||
        event.target.closest('.za-lightbox')
    ) {
        event.preventDefault();
    }
});

document.addEventListener('dragstart', event => {
    if (event.target.tagName === 'IMG') event.preventDefault();
});


/* =====================================================
   INITIAL LOAD
   (registered after lang.js, so the saved language is applied first)
   ===================================================== */

async function init() {
    try {
        const res = await fetch(DATA_URL, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();

        categories = Array.isArray(data.categories) ? data.categories : [];

        allPhotos = (Array.isArray(data.photos) ? data.photos : [])
            .map((p, i) => ({ ...p, _i: i }))
            .sort(byDate);

        loaded = true;
        photoCount.removeAttribute('data-i18n');

        renderFilters();
        renderGallery();
    } catch (err) {
        console.error('Failed to load photography data:', err);

        photoCount.removeAttribute('data-i18n');
        photoCount.textContent = currentLang() === 'ar'
            ? 'تعذّر تحميل الصور. حاول مرة أخرى لاحقًا.'
            : 'Could not load photographs. Please try again later.';
    }
}

document.addEventListener('DOMContentLoaded', init);
