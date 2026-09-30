// Main entry point for Policy Checker dashboard
document.addEventListener('DOMContentLoaded', () => {
  const {
    initFileManager,
    initPdfViewer,
    initChat,
    initCompare,
    initSummary,
    initSearch,
    initTables,
  } = window.PolicyApp || {};

  // Initialize individual feature controllers
  initFileManager?.();
  initPdfViewer?.();
  const chatController = initChat?.();
  initCompare?.();
  initSummary?.();
  initSearch?.({
    onAskInChat: (fileId, docTitle, query) => {
      chatController?.openWithQuery(fileId, docTitle, query);
    },
  });
  initTables?.();

  // Accessibility: Allow close buttons to be triggered by Enter / Space
  document.querySelectorAll('.close-x').forEach((btn) => {
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        btn.click();
      }
    });
  });

  // Accessibility: Close active modals on Escape key press
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal.open').forEach((m) => {
        m.classList.remove('open');
        m.setAttribute('aria-hidden', 'true');
      });
    }
  });

  // User Quota Indicator (Feature G3 & Group 3 Live Updates)
  async function updateQuotaBadge() {
    const quotaBadge = document.getElementById('quotaBadge');
    const quotaQueriesCounter = document.getElementById('quotaQueriesCounter');
    if (!quotaBadge) return;

    try {
      const res = await fetch('/user/quota');
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.success) return;

      const qLimit = data.queriesLimit === Infinity ? 'Unlimited' : data.queriesLimit;
      const uLimit = data.uploadsLimit === Infinity ? 'Unlimited' : data.uploadsLimit;
      if (quotaQueriesCounter) {
        quotaQueriesCounter.textContent = `\u00B7 ${data.queriesUsed}/${qLimit} queries`;
      }
      quotaBadge.title = `Monthly Usage: ${data.queriesUsed}/${qLimit} AI queries, ${data.uploadsUsed}/${uLimit} uploads.`;
    } catch (_err) {
      // Ignore transient network errors
    }
  }

  window.PolicyApp = window.PolicyApp || {};
  window.PolicyApp.updateQuotaBadge = updateQuotaBadge;

  updateQuotaBadge();
});
