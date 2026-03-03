// Hide loading screen once the page is loaded
window.addEventListener('load', function () {
  var el = document.getElementById('initial-loading');
  if (el) {
    setTimeout(function () {
      el.classList.add('hidden');
      setTimeout(function () {
        el.remove();
      }, 300);
    }, 100);
  }
});

// Fallback: remove loading screen after maximum wait time
setTimeout(function () {
  var el = document.getElementById('initial-loading');
  if (el) {
    el.remove();
  }
}, 5000);
