// Direct Semantic Clause Search Controller (Feature F)
(function () {
  window.PolicyApp = window.PolicyApp || {};

  function initSearch(options = {}) {
    const { onAskInChat } = options;

    const clauseSearchModal = document.getElementById('clauseSearchModal');
    const closeClauseSearchModal = document.getElementById('closeClauseSearchModal');
    const clauseSearchFileName = document.getElementById('clauseSearchFileName');
    const clauseSearchInput = document.getElementById('clauseSearchInput');
    const submitClauseSearchBtn = document.getElementById('submitClauseSearchBtn');
    const clauseSearchStats = document.getElementById('clauseSearchStats');
    const clauseSearchCountText = document.getElementById('clauseSearchCountText');
    const clauseSearchErrorMsg = document.getElementById('clauseSearchErrorMsg');
    const clauseSearchLoading = document.getElementById('clauseSearchLoading');
    const clauseSearchResults = document.getElementById('clauseSearchResults');
    const clauseSearchWelcome = document.getElementById('clauseSearchWelcome');

    let currentSearchFileId = null;
    let currentSearchDocTitle = '';

    const highlightSnippet = (text, query) => {
      if (!text) return '';
      const terms = (query || '')
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 2)
        .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

      const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      if (terms.length === 0) return escaped;

      const regex = new RegExp(`(${terms.join('|')})`, 'gi');
      return escaped.replace(regex, '<mark>$1</mark>');
    };

    const executeClauseSearch = async (query) => {
      if (!currentSearchFileId) return;
      const cleanQ = (query || '').trim();
      if (!cleanQ) return;

      if (clauseSearchWelcome) clauseSearchWelcome.style.display = 'none';
      if (clauseSearchErrorMsg) {
        clauseSearchErrorMsg.style.display = 'none';
        clauseSearchErrorMsg.textContent = '';
      }
      if (clauseSearchStats) clauseSearchStats.style.display = 'none';
      if (clauseSearchLoading) clauseSearchLoading.style.display = 'block';

      clauseSearchResults?.querySelectorAll('.clause-result-card')?.forEach((el) => el.remove());

      try {
        const res = await fetch(`/files/${currentSearchFileId}/search?q=${encodeURIComponent(cleanQ)}&limit=12`);
        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.message || 'Search failed.');
        }

        if (clauseSearchLoading) clauseSearchLoading.style.display = 'none';

        const results = Array.isArray(data.results) ? data.results : [];

        if (clauseSearchStats && clauseSearchCountText) {
          clauseSearchCountText.textContent = `${results.length} match${results.length === 1 ? '' : 'es'} found (${data.executionTimeMs || 0}ms)`;
          clauseSearchStats.style.display = 'flex';
        }

        if (results.length === 0) {
          const emptyEl = document.createElement('div');
          emptyEl.className = 'clause-result-card';
          emptyEl.innerHTML = `
            <div style="font-size:13px;color:var(--text-secondary);text-align:center;padding:16px 0;">
              No verbatim clauses matched &ldquo;<strong>${cleanQ}</strong>&rdquo;. Try searching different terms (e.g. &ldquo;waiting period&rdquo;, &ldquo;room rent&rdquo;, &ldquo;copay&rdquo;).
            </div>
          `;
          clauseSearchResults?.appendChild(emptyEl);
          return;
        }

        results.forEach((item) => {
          const cardEl = document.createElement('div');
          cardEl.className = 'clause-result-card';

          const pageLabel = item.type === 'table'
            ? `Actuarial Table &bull; Page ${item.pageNumber || 1}`
            : `Page ${item.pageNumber || 1}`;

          const scorePill = item.relevancePercent
            ? `<span class="clause-match-pill">${item.relevancePercent}% Match</span>`
            : '';

          const highlightedText = highlightSnippet(item.snippet || item.text || '', cleanQ);

          cardEl.innerHTML = `
            <div class="clause-result-header">
              <span class="clause-page-badge">${pageLabel}</span>
              ${scorePill}
            </div>
            <div class="clause-result-snippet">${highlightedText}</div>
            <div class="clause-result-actions">
              <button type="button" class="clause-action-btn copy-clause-btn" aria-label="Copy clause text">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                <span>Copy</span>
              </button>
              <button type="button" class="clause-action-btn ask-in-chat-btn" aria-label="Ask about this clause in policy chat">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                <span>Ask in Chat</span>
              </button>
            </div>
          `;

          // Copy clause action
          const copyBtn = cardEl.querySelector('.copy-clause-btn');
          copyBtn?.addEventListener('click', () => {
            navigator.clipboard.writeText(item.text || item.snippet || '')
              .then(() => {
                const span = copyBtn.querySelector('span');
                if (span) span.textContent = 'Copied!';
                setTimeout(() => { if (span) span.textContent = 'Copy'; }, 1800);
              })
              .catch((err) => console.error('Copy failed:', err));
          });

          // Ask in chat action
          const askBtn = cardEl.querySelector('.ask-in-chat-btn');
          askBtn?.addEventListener('click', () => {
            clauseSearchModal?.classList.remove('open');
            clauseSearchModal?.setAttribute('aria-hidden', 'true');

            if (typeof onAskInChat === 'function') {
              onAskInChat(currentSearchFileId, currentSearchDocTitle, cleanQ);
            }
          });

          clauseSearchResults?.appendChild(cardEl);
        });
      } catch (err) {
        if (clauseSearchLoading) clauseSearchLoading.style.display = 'none';
        if (clauseSearchErrorMsg) {
          clauseSearchErrorMsg.textContent = err.message || 'Search failed. Please try again.';
          clauseSearchErrorMsg.style.display = 'block';
        }
      }
    };

    function bindSearchButton(btn) {
      btn.addEventListener('click', (e) => {
        currentSearchFileId = e.currentTarget.dataset.fileId;
        currentSearchDocTitle = e.currentTarget.dataset.fileName || 'Policy Document';

        if (clauseSearchFileName) clauseSearchFileName.textContent = currentSearchDocTitle;
        if (clauseSearchInput) clauseSearchInput.value = '';
        if (clauseSearchStats) clauseSearchStats.style.display = 'none';
        if (clauseSearchErrorMsg) clauseSearchErrorMsg.style.display = 'none';
        if (clauseSearchWelcome) clauseSearchWelcome.style.display = 'flex';
        clauseSearchResults?.querySelectorAll('.clause-result-card')?.forEach((el) => el.remove());

        clauseSearchModal?.classList.add('open');
        clauseSearchModal?.setAttribute('aria-hidden', 'false');
        clauseSearchInput?.focus();
      });
    }

    // Wire up Search button on file cards
    document.querySelectorAll('.search-clauses-btn').forEach(bindSearchButton);
    window.PolicyApp.bindSearchButton = bindSearchButton;

    submitClauseSearchBtn?.addEventListener('click', () => {
      if (clauseSearchInput) executeClauseSearch(clauseSearchInput.value);
    });

    clauseSearchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        executeClauseSearch(clauseSearchInput.value);
      }
    });

    document.querySelectorAll('.clause-chip').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        const query = e.currentTarget.dataset.query;
        if (clauseSearchInput && query) {
          clauseSearchInput.value = query;
          executeClauseSearch(query);
        }
      });
    });

    closeClauseSearchModal?.addEventListener('click', () => {
      clauseSearchModal?.classList.remove('open');
      clauseSearchModal?.setAttribute('aria-hidden', 'true');
    });

    clauseSearchModal?.querySelector('.modal-card')?.addEventListener('click', (e) => e.stopPropagation());
    clauseSearchModal?.addEventListener('click', (e) => {
      if (e.target === clauseSearchModal) {
        clauseSearchModal.classList.remove('open');
        clauseSearchModal.setAttribute('aria-hidden', 'true');
      }
    });
  }

  window.PolicyApp.initSearch = initSearch;
})();
