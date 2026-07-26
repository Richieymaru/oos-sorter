(function () {
  function init(root) {
    if (root.__oosInit) return;
    root.__oosInit = true;

    var form = root.querySelector('.oos-notify__form');
    var email = root.querySelector('.oos-notify__email');
    var hp = root.querySelector('.oos-notify__hp');
    var consent = root.querySelector('.oos-notify__consent-cb');
    var btn = root.querySelector('.oos-notify__btn');
    var msg = root.querySelector('.oos-notify__msg');
    var endpoint = root.getAttribute('data-endpoint');
    var productId = root.getAttribute('data-product-id');
    var successText = root.getAttribute('data-success') || "Done! We'll email you when it's back.";

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      msg.style.color = '';
      msg.textContent = '';
      if (!email.value || !email.checkValidity()) { msg.textContent = 'Please enter a valid email.'; return; }
      if (!consent.checked) { msg.textContent = 'Please tick the consent box.'; return; }

      btn.disabled = true;
      var old = btn.textContent;
      btn.textContent = '...';

      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.value.trim(), productId: productId, consent: true, hp: hp.value })
      })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.ok) {
            form.style.display = 'none';
            msg.textContent = j.already ? "You're already on the list - we'll email you." : successText;
          } else {
            msg.style.color = '#b12626';
            msg.textContent = (j && j.error) || 'Something went wrong. Please try again.';
            btn.disabled = false;
            btn.textContent = old;
          }
        })
        .catch(function () {
          msg.style.color = '#b12626';
          msg.textContent = 'Network error. Please try again.';
          btn.disabled = false;
          btn.textContent = old;
        });
    });
  }

  function boot() {
    var nodes = document.querySelectorAll('[data-oos-notify]');
    for (var i = 0; i < nodes.length; i++) init(nodes[i]);
  }

  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
  // Re-init when the theme editor re-renders a section.
  document.addEventListener('shopify:section:load', boot);
})();
