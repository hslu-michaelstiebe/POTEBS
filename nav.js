// Mobile hamburger toggle — works on both index.html and methods.html.
// Adds .nav-open to the <nav> element when the burger is clicked, and closes
// the drawer when a nav link is followed.
(function () {
  var nav = document.querySelector('nav');
  var burger = document.querySelector('.nav-burger');
  if (!nav || !burger) return;

  function setOpen(open) {
    nav.classList.toggle('nav-open', open);
    burger.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  }

  burger.addEventListener('click', function () {
    setOpen(!nav.classList.contains('nav-open'));
  });

  // Close drawer after clicking any nav link
  nav.querySelectorAll('.links a').forEach(function (a) {
    a.addEventListener('click', function () { setOpen(false); });
  });

  // Close on Escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('nav-open')) setOpen(false);
  });

  // Close drawer if viewport grows back above the breakpoint
  var mq = window.matchMedia('(min-width: 901px)');
  function handle() { if (mq.matches) setOpen(false); }
  if (mq.addEventListener) mq.addEventListener('change', handle);
  else if (mq.addListener) mq.addListener(handle);
})();
