// Multi-Document Policy Comparison Controller (Feature C)
(function () {
  window.PolicyApp = window.PolicyApp || {};

  function initCompare() {
    const compareFloatingBar = document.getElementById('compareFloatingBar');
    const compareSelectedCount = document.getElementById('compareSelectedCount');
    const compareSelectedNames = document.getElementById('compareSelectedNames');
    const compareClearBtn = document.getElementById('compareClearBtn');
    const compareTriggerBtn = document.getElementById('compareTriggerBtn');
    const compareModal = document.getElementById('compareModal');
    const closeCompareModal = document.getElementById('closeCompareModal');
    const compareSelectedPills = document.getElementById('compareSelectedPills');
    const compareAspectChips = document.querySelectorAll('.compare-aspect-chip');
    const compareAspectInput = document.getElementById('compareAspectInput');
    const runCompareBtn = document.getElementById('runCompareBtn');
    const loadingCompare = document.getElementById('loadingCompare');
    const compareErrorMsg = document.getElementById('compareErrorMsg');
    const compareResultContainer = document.getElementById('compareResultContainer');
    const compareResultMarkdown = document.getElementById('compareResultMarkdown');
    const compareCitationsList = document.getElementById('compareCitationsList');
    const compareCitationsContainer = document.getElementById('compareCitationsContainer');
    const compareFooterActions = document.getElementById('compareFooterActions');
    const copyCompareResultBtn = document.getElementById('copyCompareResultBtn');
    const copyCompareText = document.getElementById('copyCompareText');
    const compareFollowupSection = document.getElementById('compareFollowupSection');
    const compareChatThread = document.getElementById('compareChatThread');
    const compareFollowupForm = document.getElementById('compareFollowupForm');
    const compareFollowupInput = document.getElementById('compareFollowupInput');

    const selectedCompareFiles = new Map();
    let latestComparisonMarkdown = '';
    let currentComparisonConversationId = null;
    let currentComparisonFileIds = [];

    function updateCompareBar() {
      if (!compareFloatingBar) return;
      const count = selectedCompareFiles.size;

      if (count === 0) {
        compareFloatingBar.style.display = 'none';
        compareFloatingBar.setAttribute('aria-hidden', 'true');
        if (compareTriggerBtn) compareTriggerBtn.disabled = true;
        return;
      }

      compareFloatingBar.style.display = 'block';
      compareFloatingBar.setAttribute('aria-hidden', 'false');

      if (compareSelectedCount) {
        compareSelectedCount.textContent = `${count} selected`;
      }

      if (compareSelectedNames) {
        if (count === 1) {
          compareSelectedNames.textContent = 'Select at least 1 more policy to compare';
          if (compareTriggerBtn) compareTriggerBtn.disabled = true;
        } else {
          const names = Array.from(selectedCompareFiles.values()).map((f) => f.name);
          compareSelectedNames.textContent = names.join(' vs ');
          if (compareTriggerBtn) compareTriggerBtn.disabled = false;
        }
      }
    }

    // Checkbox event bindings
    document.querySelectorAll('.compare-checkbox').forEach((checkbox) => {
      checkbox.addEventListener('change', (e) => {
        const fileId = e.target.dataset.fileId;
        const fileName = e.target.dataset.fileName || 'Document';

        if (e.target.checked) {
          if (selectedCompareFiles.size >= 3) {
            e.target.checked = false;
            (window.PolicyApp?.toast?.warning || window.showToast || alert)('You can compare a maximum of 3 policies simultaneously.');
            return;
          }
          selectedCompareFiles.set(fileId, { id: fileId, name: fileName });
        } else {
          selectedCompareFiles.delete(fileId);
        }
        updateCompareBar();
      });
    });

    // Clear selection
    compareClearBtn?.addEventListener('click', () => {
      selectedCompareFiles.clear();
      document.querySelectorAll('.compare-checkbox').forEach((cb) => {
        cb.checked = false;
      });
      updateCompareBar();
    });

    // Trigger compare modal
    compareTriggerBtn?.addEventListener('click', () => {
      if (selectedCompareFiles.size < 2 || !compareModal) return;

      if (compareSelectedPills) {
        compareSelectedPills.innerHTML = '';
        let idx = 1;
        selectedCompareFiles.forEach((file) => {
          const pill = document.createElement('div');
          pill.className = 'compare-pill';
          pill.innerHTML = `<span class="compare-pill-num">Policy ${idx++}</span><span>${file.name}</span>`;
          compareSelectedPills.appendChild(pill);
        });
      }

      if (compareErrorMsg) compareErrorMsg.style.display = 'none';
      if (compareResultContainer) compareResultContainer.style.display = 'none';
      if (compareFooterActions) compareFooterActions.style.display = 'none';
      if (loadingCompare) loadingCompare.style.display = 'none';
      if (runCompareBtn) runCompareBtn.disabled = false;

      compareModal.classList.add('open');
      compareModal.setAttribute('aria-hidden', 'false');
    });

    closeCompareModal?.addEventListener('click', () => {
      compareModal?.classList.remove('open');
      compareModal?.setAttribute('aria-hidden', 'true');
    });

    compareModal?.querySelector('.modal-card')?.addEventListener('click', (e) => e.stopPropagation());
    compareModal?.addEventListener('click', (e) => {
      if (e.target === compareModal) {
        compareModal.classList.remove('open');
        compareModal.setAttribute('aria-hidden', 'true');
      }
    });

    // Aspect chips
    compareAspectChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        compareAspectChips.forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        if (compareAspectInput && chip.dataset.aspect) {
          compareAspectInput.value = chip.dataset.aspect;
        }
      });
    });

    // Execute comparison
    runCompareBtn?.addEventListener('click', async () => {
      if (selectedCompareFiles.size < 2) {
        if (compareErrorMsg) {
          compareErrorMsg.textContent = 'Please select at least 2 policies to compare.';
          compareErrorMsg.style.display = 'block';
        }
        return;
      }

      const fileIds = Array.from(selectedCompareFiles.keys());
      const aspect = compareAspectInput ? compareAspectInput.value.trim() : '';

      if (loadingCompare) loadingCompare.style.display = 'inline-block';
      if (runCompareBtn) runCompareBtn.disabled = true;
      if (compareErrorMsg) compareErrorMsg.style.display = 'none';
      if (compareResultContainer) compareResultContainer.style.display = 'none';
      if (compareFooterActions) compareFooterActions.style.display = 'none';

      try {
        const response = await fetch('/compare-policies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileIds, aspect }),
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.message || 'Comparison request failed.');
        }

        latestComparisonMarkdown = data.comparisonResult || '';
        currentComparisonConversationId = data.conversationId || null;
        currentComparisonFileIds = fileIds;

        if (compareResultMarkdown) {
          if (window.marked && window.DOMPurify) {
            window.marked.setOptions({ gfm: true, breaks: true });
            compareResultMarkdown.innerHTML = window.DOMPurify.sanitize(
              window.marked.parse(latestComparisonMarkdown)
            );
          } else {
            compareResultMarkdown.textContent = latestComparisonMarkdown;
          }
        }

        if (compareCitationsContainer && compareCitationsList) {
          compareCitationsContainer.innerHTML = '';
          if (Array.isArray(data.citations) && data.citations.length > 0) {
            data.citations.forEach((c) => {
              const item = document.createElement('div');
              item.className = 'compare-citation-item';
              const pageStr = c.pageNumber ? `Page ${c.pageNumber}` : 'General';
              item.innerHTML = `
                <div class="compare-citation-meta">
                  <span>${c.documentName}</span>
                  <span>&bull;</span>
                  <span>${pageStr}</span>
                  <span>&bull;</span>
                  <span style="color:#a5d6a7;">FACTUM Verified</span>
                </div>
                <p class="compare-citation-excerpt">&ldquo;${c.excerpt}&rdquo;</p>
              `;
              compareCitationsContainer.appendChild(item);
            });
            compareCitationsList.style.display = 'block';
          } else {
            compareCitationsList.style.display = 'none';
          }
        }

        if (compareResultContainer) compareResultContainer.style.display = 'block';
        if (compareFooterActions) compareFooterActions.style.display = 'flex';
        window.PolicyApp.updateQuotaBadge?.();

        // Enable follow-up section if conversation was created
        if (compareFollowupSection && currentComparisonConversationId) {
          if (compareChatThread) compareChatThread.innerHTML = '';
          compareFollowupSection.style.display = 'flex';
        }
      } catch (err) {
        if (compareErrorMsg) {
          compareErrorMsg.textContent = err.message || 'An error occurred during comparison.';
          compareErrorMsg.style.display = 'block';
        }
      } finally {
        if (loadingCompare) loadingCompare.style.display = 'none';
        if (runCompareBtn) runCompareBtn.disabled = false;
      }
    });

    // Follow-up chat submission
    compareFollowupForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const question = compareFollowupInput?.value?.trim();
      if (!question || !currentComparisonConversationId) return;

      compareFollowupInput.value = '';

      // Append user bubble
      const userBubble = document.createElement('div');
      userBubble.className = 'chat-message chat-message-user';
      userBubble.style.alignSelf = 'flex-end';
      userBubble.style.background = 'rgba(197,160,89,0.15)';
      userBubble.style.padding = '8px 12px';
      userBubble.style.borderRadius = '8px';
      userBubble.style.maxWidth = '80%';
      userBubble.style.fontSize = '12.5px';
      userBubble.textContent = question;
      compareChatThread?.appendChild(userBubble);

      // Append loading bubble
      const loadingBubble = document.createElement('div');
      loadingBubble.className = 'chat-message chat-message-model';
      loadingBubble.style.alignSelf = 'flex-start';
      loadingBubble.style.background = 'rgba(255,255,255,0.04)';
      loadingBubble.style.padding = '8px 12px';
      loadingBubble.style.borderRadius = '8px';
      loadingBubble.style.maxWidth = '90%';
      loadingBubble.style.fontSize = '12px';
      loadingBubble.style.color = 'var(--text-muted)';
      loadingBubble.textContent = 'Analyzing compared policies...';
      compareChatThread?.appendChild(loadingBubble);
      compareChatThread.scrollTop = compareChatThread.scrollHeight;

      try {
        const res = await fetch('/compare-policies/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId: currentComparisonConversationId,
            fileIds: currentComparisonFileIds,
            userMessageText: question,
          }),
        });

        const chatData = await res.json();
        if (!res.ok || !chatData.success) {
          throw new Error(chatData.message || 'Follow-up query failed.');
        }

        const answerText = chatData.assistantMessage?.text || 'No response returned.';
        let formattedHtml = answerText;
        if (window.marked && window.DOMPurify) {
          formattedHtml = window.DOMPurify.sanitize(window.marked.parse(answerText));
        }

        loadingBubble.style.color = 'var(--text-primary)';
        loadingBubble.innerHTML = formattedHtml;
        window.PolicyApp.updateQuotaBadge?.();
      } catch (chatErr) {
        loadingBubble.style.color = '#ef9a9a';
        loadingBubble.textContent = chatErr.message || 'Failed to process follow-up.';
      } finally {
        compareChatThread.scrollTop = compareChatThread.scrollHeight;
      }
    });

    copyCompareResultBtn?.addEventListener('click', () => {
      if (!latestComparisonMarkdown) return;
      navigator.clipboard
        .writeText(latestComparisonMarkdown)
        .then(() => {
          if (copyCompareText) copyCompareText.textContent = 'Copied!';
          setTimeout(() => {
            if (copyCompareText) copyCompareText.textContent = 'Copy';
          }, 2000);
        })
        .catch((err) => console.error('Failed to copy comparison text:', err));
    });
  }

  window.PolicyApp.initCompare = initCompare;
})();
