(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function init(root) {
    if (root.__oosInit) return;
    root.__oosInit = true;

    var openBtn = root.querySelector('.oos-notify__open');
    var d = {
      endpoint: root.getAttribute('data-endpoint'),
      productId: root.getAttribute('data-product-id'),
      heading: root.getAttribute('data-heading') || "Get notified when it's back",
      subtitle: root.getAttribute('data-subtitle') || '',
      placeholder: root.getAttribute('data-placeholder') || 'you@email.com',
      submit: root.getAttribute('data-submit') || 'Notify me',
      success: root.getAttribute('data-success') || "You're on the list!"
    };

    openBtn.addEventListener('click', function () { openModal(root, openBtn, d); });
  }

  function openModal(root, openBtn, d) {
    var overlay = document.createElement('div');
    overlay.className = 'oos-modal';
    overlay.innerHTML =
      '<div class="oos-modal__card" role="dialog" aria-modal="true" aria-label="' + esc(d.heading) + '">' +
        '<button type="button" class="oos-modal__close" aria-label="Close">&times;</button>' +
        '<h3 class="oos-modal__title">' + esc(d.heading) + '</h3>' +
        (d.subtitle ? '<p class="oos-modal__sub">' + esc(d.subtitle) + '</p>' : '') +
        '<form class="oos-modal__form" novalidate>' +
          '<input type="email" class="oos-modal__email" placeholder="' + esc(d.placeholder) + '" autocomplete="email" required>' +
          '<input type="text" class="oos-modal__hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
          '<button type="submit" class="oos-modal__submit">' + esc(d.submit) + '</button>' +
        '</form>' +
        '<p class="oos-modal__msg" role="status" aria-live="polite"></p>' +
      '</div>';
    document.body.appendChild(overlay);
    document.documentElement.style.overflow = 'hidden';

    var card = overlay.querySelector('.oos-modal__card');
    var email = overlay.querySelector('.oos-modal__email');
    var hp = overlay.querySelector('.oos-modal__hp');
    var form = overlay.querySelector('.oos-modal__form');
    var submit = overlay.querySelector('.oos-modal__submit');
    var msg = overlay.querySelector('.oos-modal__msg');
    setTimeout(function () { email.focus(); }, 40);

    function close() {
      overlay.remove();
      document.documentElement.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    overlay.querySelector('.oos-modal__close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      msg.style.color = '';
      msg.textContent = '';
      if (!email.value || !email.checkValidity()) { msg.style.color = '#b12626'; msg.textContent = 'Please enter a valid email.'; return; }
      submit.disabled = true;
      var old = submit.textContent;
      submit.textContent = '…';
      fetch(d.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.value.trim(), productId: d.productId, consent: true, hp: hp.value })
      })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.ok) {
            form.style.display = 'none';
            msg.style.color = '#0a6b4a';
            msg.textContent = j.already ? "You're already on the list — we'll email you." : d.success;
            openBtn.textContent = "You're on the list ✓";
            openBtn.disabled = true;
            setTimeout(close, 2400);
          } else {
            msg.style.color = '#b12626';
            msg.textContent = (j && j.error) || 'Something went wrong. Please try again.';
            submit.disabled = false;
            submit.textContent = old;
          }
        })
        .catch(function () {
          msg.style.color = '#b12626';
          msg.textContent = 'Network error. Please try again.';
          submit.disabled = false;
          submit.textContent = old;
        });
    });
  }

  function boot() {
    var nodes = document.querySelectorAll('[data-oos-notify]');
    for (var i = 0; i < nodes.length; i++) init(nodes[i]);
  }
  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
  document.addEventListener('shopify:section:load', boot);
})();
