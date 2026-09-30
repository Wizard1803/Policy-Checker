// Accessible, Non-Blocking Toast Notification System (Vanilla JS, Zero Dependencies)
(function () {
  const root = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : {});
  root.PolicyApp = root.PolicyApp || {};

  const ICONS = {
    success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
    error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
    warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
  };

  let container = null;

  function getOrCreateContainer() {
    if (!container || !document.body.contains(container)) {
      container = document.getElementById('toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        container.setAttribute('role', 'region');
        container.setAttribute('aria-label', 'Notifications');
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'true');
        document.body.appendChild(container);
      }
    }
    return container;
  }

  function show({ message = '', title = '', type = 'info', duration = 4000 } = {}) {
    if (typeof document === 'undefined') return null;
    const parent = getOrCreateContainer();
    const normalizedType = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';

    const toastEl = document.createElement('div');
    toastEl.className = `policy-toast policy-toast-${normalizedType}`;
    toastEl.setAttribute('role', normalizedType === 'error' ? 'alert' : 'status');

    const iconHtml = ICONS[normalizedType] || ICONS.info;
    const titleHtml = title ? `<div class="toast-title">${escapeHtml(title)}</div>` : '';
    const messageHtml = `<div class="toast-message">${escapeHtml(message)}</div>`;

    toastEl.innerHTML = `
      <div class="toast-icon-wrap" aria-hidden="true">${iconHtml}</div>
      <div class="toast-content">
        ${titleHtml}
        ${messageHtml}
      </div>
      <button type="button" class="toast-close-btn" aria-label="Close notification">&times;</button>
    `;

    let dismissTimer = null;
    let remainingTime = duration;
    let startTime = Date.now();

    function dismiss() {
      if (toastEl.classList.contains('toast-exit')) return;
      clearTimeout(dismissTimer);
      toastEl.classList.add('toast-exit');
      setTimeout(() => {
        toastEl.remove();
        if (parent && parent.children.length === 0) {
          // Keep container ready
        }
      }, 200);
    }

    function startTimer(time) {
      if (time <= 0) return;
      startTime = Date.now();
      dismissTimer = setTimeout(dismiss, time);
    }

    function pauseTimer() {
      clearTimeout(dismissTimer);
      remainingTime -= Date.now() - startTime;
    }

    function resumeTimer() {
      if (remainingTime > 0) {
        startTimer(remainingTime);
      }
    }

    toastEl.querySelector('.toast-close-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
    });

    toastEl.addEventListener('mouseenter', pauseTimer);
    toastEl.addEventListener('mouseleave', resumeTimer);

    parent.appendChild(toastEl);
    startTimer(duration);

    return { dismiss, el: toastEl };
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  const toast = {
    show,
    success: (msg, title) => show({ message: msg, title, type: 'success' }),
    error: (msg, title) => show({ message: msg, title, type: 'error', duration: 5500 }),
    warning: (msg, title) => show({ message: msg, title, type: 'warning', duration: 4500 }),
    info: (msg, title) => show({ message: msg, title, type: 'info' }),
  };

  if (typeof window !== 'undefined') {
    window.PolicyApp = window.PolicyApp || {};
    window.PolicyApp.toast = toast;
    window.showToast = (message, type = 'info') => toast.show({ message, type });
  } else if (typeof global !== 'undefined') {
    global.PolicyApp = global.PolicyApp || {};
    global.PolicyApp.toast = toast;
  }

  // Export for testing in Node/Jest environment if module exists
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = toast;
  }
})();
