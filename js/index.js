
  // Smooth scroll for nav links

document.querySelectorAll('a[href^="/#"]').forEach(link => {

    link.addEventListener('click', (e) => {

        const href = link.getAttribute('href');

        const targetId = href.split('#')[1];

        if (targetId) {

            e.preventDefault();

            const target = document.getElementById(targetId);

            if (target) {

                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });

            }

        }

    });

});


// Active nav link on scroll

const sections = document.querySelectorAll('section[id]');

const navLinks = document.querySelectorAll('.za-nav-link');

window.addEventListener('scroll', () => {

    const scrollPos = window.scrollY + 100;

    sections.forEach(section => {

        const top = section.offsetTop;

        const height = section.offsetHeight;

        const id = section.getAttribute('id');

        if (
            scrollPos >= top &&
            scrollPos < top + height
        ) {

            navLinks.forEach(link => {

                link.classList.remove('active');

                if (
                    link.getAttribute('href')
                    .includes('#' + id)
                ) {
                    link.classList.add('active');
                }

            });

        }

    });

});


// Nav scroll state

const nav = document.getElementById('nav');

const onScroll = () =>
    nav.classList.toggle(
        'scrolled',
        window.scrollY > 30
    );

window.addEventListener(
    'scroll',
    onScroll,
    { passive: true }
);

onScroll();


// Mobile menu

const menuBtn = document.getElementById('menuBtn');

const mobileMenu = document.getElementById('mobileMenu');

menuBtn.addEventListener('click', () =>
    mobileMenu.classList.toggle('open')
);

mobileMenu.querySelectorAll('a').forEach(a =>
    a.addEventListener('click', () =>
        mobileMenu.classList.remove('open')
    )
);


// Reveal on scroll

const observer = new IntersectionObserver(
    (entries) => {

        entries.forEach(entry => {

            if (entry.isIntersecting) {

                entry.target.classList.add('visible');

                observer.unobserve(entry.target);

            }

        });

    },
    {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    }
);

document
    .querySelectorAll('.za-reveal')
    .forEach(el => observer.observe(el));
