// Policy Conversational Inspector & Multi-Turn Chat Controller
(function () {
  window.PolicyApp = window.PolicyApp || {};

  function initChat() {
    const { renderMessageContent } = window.PolicyApp.markdownUtils || {
      renderMessageContent: (t) => t,
    };

    const policyCheckModal = document.getElementById('policyCheckModal');
    const closePolicyCheckModal = document.getElementById('closePolicyCheckModal');
    const policyCheckFileName = document.getElementById('policyCheckFileName');
    const policyQuestionInput = document.getElementById('policyQuestionInput');
    const submitPolicyCheckBtn = document.getElementById('submitPolicyCheck');
    const policyResultArea = document.getElementById('policyResultArea');
    const loadingPolicyCheck = document.getElementById('loadingPolicyCheck');
    const chatMessagesStream = document.getElementById('chatMessagesStream');
    const chatWelcomeCard = document.getElementById('chatWelcomeCard');
    const newChatBtn = document.getElementById('newChatBtn');
    const chatSessionSelect = document.getElementById('chatSessionSelect');
    const citationInspectorCard = document.getElementById('citationInspectorCard');
    const closeCitationInspector = document.getElementById('closeCitationInspector');
    const citationInspectorBadgeText = document.getElementById('citationInspectorBadgeText');
    const citationInspectorPage = document.getElementById('citationInspectorPage');
    const citationInspectorQuote = document.getElementById('citationInspectorQuote');

    let currentFileId = null;
    let currentConversationId = null;
    let latestAssistantText = '';

    const showCitationInspector = (citation) => {
      if (!citationInspectorCard) return;
      if (citationInspectorBadgeText) {
        citationInspectorBadgeText.textContent = citation.verified
          ? 'FACTUM Verified Citation'
          : 'Unverified Citation';
      }
      if (citationInspectorPage) {
        citationInspectorPage.textContent = citation.pageNumber
          ? `Document Source: Page ${citation.pageNumber}`
          : 'Document Source: Structured Table';
      }
      if (citationInspectorQuote) {
        citationInspectorQuote.textContent = citation.excerpt
          ? `\u201C${citation.excerpt}\u201D`
          : 'Verbatim extract unavailable.';
      }
      citationInspectorCard.style.display = 'block';
    };

    closeCitationInspector?.addEventListener('click', () => {
      if (citationInspectorCard) citationInspectorCard.style.display = 'none';
    });

    const appendUserMessage = (text) => {
      if (!chatMessagesStream) return;
      if (chatWelcomeCard) chatWelcomeCard.style.display = 'none';

      const msgEl = document.createElement('div');
      msgEl.className = 'chat-msg-user';
      msgEl.innerHTML = `
        <div class="chat-msg-user-text"></div>
        <div class="chat-msg-user-meta">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      `;
      msgEl.querySelector('.chat-msg-user-text').textContent = text;
      chatMessagesStream.appendChild(msgEl);
      chatMessagesStream.scrollTop = chatMessagesStream.scrollHeight;
    };

    const appendModelMessage = (text, citations = []) => {
      if (!chatMessagesStream) return;
      latestAssistantText = text;

      const msgEl = document.createElement('div');
      msgEl.className = 'chat-msg-model';

      let citationsHtml = '';
      if (Array.isArray(citations) && citations.length > 0) {
        const pills = citations
          .map((cit, idx) => {
            const verifiedClass = cit.verified ? 'verified' : 'unverified';
            const iconSvg = cit.verified
              ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`
              : `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
            const pageLabel = cit.pageNumber ? `Page ${cit.pageNumber}` : 'Table';
            return `<button type="button" class="citation-pill ${verifiedClass}" data-citation-index="${idx}">
              ${iconSvg}
              <span>${pageLabel} &bull; ${cit.verified ? 'Verified' : 'Flagged'}</span>
            </button>`;
          })
          .join('');

        citationsHtml = `
          <div class="chat-citations-bar">
            <span class="chat-citations-label">Citations:</span>
            ${pills}
          </div>
        `;
      }

      msgEl.innerHTML = `
        <div class="chat-msg-model-header">
          <span class="chat-msg-model-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
            Statutory Findings
          </span>
          <span style="font-family:var(--font-mono);font-size:10.5px;color:var(--text-muted);">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="chat-msg-model-content">${renderMessageContent(text)}</div>
        ${citationsHtml}
      `;

      msgEl.querySelectorAll('.citation-pill').forEach((pill) => {
        pill.addEventListener('click', () => {
          const idx = parseInt(pill.dataset.citationIndex, 10);
          const cit = citations[idx];
          if (cit) {
            showCitationInspector(cit);
            if (window.PolicyApp?.pdfViewer && currentFileId) {
              const activeDocTitle = policyCheckFileName?.textContent?.trim() || '';
              window.PolicyApp.pdfViewer.openViewer(
                currentFileId,
                activeDocTitle,
                cit.pageNumber || 1,
                cit.excerpt || ''
              );
            }
          }
        });
      });

      chatMessagesStream.appendChild(msgEl);
      chatMessagesStream.scrollTop = chatMessagesStream.scrollHeight;

      if (policyResultArea) {
        policyResultArea.innerHTML = renderMessageContent(text);
      }
    };

    const escapeOptionText = (str) => {
      if (!str) return '';
      return String(str).slice(0, 45);
    };

    const loadSessionsForFile = async (fileId, selectConvId = null) => {
      if (!chatSessionSelect || !fileId) return;
      try {
        const res = await fetch(`/files/${fileId}/conversations`);
        if (!res.ok) return;
        const data = await res.json();
        const conversations = data.conversations || [];

        chatSessionSelect.innerHTML = '';
        const newOption = document.createElement('option');
        newOption.value = 'new';
        newOption.textContent = '+ New Session';
        chatSessionSelect.appendChild(newOption);

        conversations.forEach((c) => {
          const opt = document.createElement('option');
          opt.value = c._id;
          const count = c.messageCount || 0;
          const title = escapeOptionText(c.title || 'Inquiry Session');
          opt.textContent = `${title} (${count} msg${count === 1 ? '' : 's'})`;
          chatSessionSelect.appendChild(opt);
        });

        if (selectConvId && conversations.some((c) => c._id === selectConvId)) {
          chatSessionSelect.value = selectConvId;
          currentConversationId = selectConvId;
        } else if (!selectConvId && conversations.length > 0) {
          chatSessionSelect.value = conversations[0]._id;
          currentConversationId = conversations[0]._id;
        } else {
          chatSessionSelect.value = 'new';
          currentConversationId = null;
        }
      } catch (err) {
        console.warn('Failed to load conversation sessions:', err.message);
      }
    };

    const loadChatHistory = async (fileId, convId = null) => {
      if (!chatMessagesStream) return;
      try {
        const url = convId
          ? `/files/${fileId}/chat/history?conversationId=${encodeURIComponent(convId)}`
          : `/files/${fileId}/chat/history`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && data.conversationId && Array.isArray(data.messages) && data.messages.length > 0) {
          currentConversationId = data.conversationId;
          if (chatSessionSelect && chatSessionSelect.value !== currentConversationId) {
            chatSessionSelect.value = currentConversationId;
          }
          if (chatWelcomeCard) chatWelcomeCard.style.display = 'none';

          chatMessagesStream.querySelectorAll('.chat-msg-user, .chat-msg-model').forEach((el) => el.remove());

          for (const msg of data.messages) {
            if (msg.sender === 'user') {
              appendUserMessage(msg.text);
            } else {
              appendModelMessage(msg.text, msg.citations);
            }
          }
        } else {
          currentConversationId = null;
          chatMessagesStream.querySelectorAll('.chat-msg-user, .chat-msg-model').forEach((el) => el.remove());
          if (chatWelcomeCard) chatWelcomeCard.style.display = 'flex';
          if (chatSessionSelect) chatSessionSelect.value = 'new';
        }
      } catch (err) {
        console.warn('Could not load chat history:', err.message);
      }
    };

    // Session Switcher Dropdown Change
    chatSessionSelect?.addEventListener('change', async () => {
      const selectedId = chatSessionSelect.value;
      if (selectedId === 'new') {
        currentConversationId = null;
        chatMessagesStream?.querySelectorAll('.chat-msg-user, .chat-msg-model')?.forEach((el) => el.remove());
        if (chatWelcomeCard) chatWelcomeCard.style.display = 'flex';
        if (citationInspectorCard) citationInspectorCard.style.display = 'none';
        if (policyQuestionInput) {
          policyQuestionInput.value = '';
          policyQuestionInput.focus();
        }
      } else if (currentFileId) {
        currentConversationId = selectedId;
        await loadChatHistory(currentFileId, selectedId);
      }
    });

    // Open modal from card (event delegation for dynamically hydrated cards)
    document.addEventListener('click', (event) => {
      const button = event.target.closest('.check-policy-btn');
      if (!button) return;

      currentFileId = button.dataset.fileId;
      const card = button.closest('.file-card');
      const fileName = card?.querySelector('a div, .file-card-title')?.textContent?.trim() || 'Document';

      if (policyCheckFileName) policyCheckFileName.textContent = fileName;
      if (policyQuestionInput) policyQuestionInput.value = '';
      if (citationInspectorCard) citationInspectorCard.style.display = 'none';

      policyCheckModal?.classList.add('open');
      policyCheckModal?.setAttribute('aria-hidden', 'false');
      policyQuestionInput?.focus();

      if (currentFileId) {
        window.PolicyApp?.pdfViewer?.setCurrentFile(currentFileId, fileName);
        (async () => {
          await loadSessionsForFile(currentFileId);
          if (currentConversationId) {
            await loadChatHistory(currentFileId, currentConversationId);
          } else {
            chatMessagesStream?.querySelectorAll('.chat-msg-user, .chat-msg-model')?.forEach((el) => el.remove());
            if (chatWelcomeCard) chatWelcomeCard.style.display = 'flex';
          }
        })();
      }
    });

    // New Chat Session Button
    newChatBtn?.addEventListener('click', () => {
      currentConversationId = null;
      if (chatSessionSelect) chatSessionSelect.value = 'new';
      chatMessagesStream?.querySelectorAll('.chat-msg-user, .chat-msg-model')?.forEach((el) => el.remove());
      if (chatWelcomeCard) chatWelcomeCard.style.display = 'flex';
      if (citationInspectorCard) citationInspectorCard.style.display = 'none';
      if (policyQuestionInput) {
        policyQuestionInput.value = '';
        policyQuestionInput.focus();
      }
    });

    const handleCloseModal = () => {
      policyCheckModal?.classList.remove('open');
      policyCheckModal?.setAttribute('aria-hidden', 'true');
      window.PolicyApp?.pdfViewer?.closeViewer();
    };

    closePolicyCheckModal?.addEventListener('click', handleCloseModal);

    policyCheckModal?.querySelector('.modal-card')?.addEventListener('click', (e) => e.stopPropagation());
    policyCheckModal?.addEventListener('click', (e) => {
      if (e.target === policyCheckModal) {
        handleCloseModal();
      }
    });

    // Submit Turn
    submitPolicyCheckBtn?.addEventListener('click', async () => {
      const question = policyQuestionInput?.value.trim();
      if (!question) {
        (window.PolicyApp?.toast?.warning || window.showToast || alert)('Please enter a question to analyze the policy.');
        return;
      }
      if (!currentFileId) {
        (window.PolicyApp?.toast?.warning || window.showToast || alert)('No file selected for policy check.');
        return;
      }

      appendUserMessage(question);
      if (policyQuestionInput) policyQuestionInput.value = '';

      const skeletonEl = document.createElement('div');
      skeletonEl.className = 'chat-msg-model';
      skeletonEl.id = 'chatSkeletonLoader';
      skeletonEl.innerHTML = `
        <div class="skeleton-loader" role="status" aria-label="Analyzing policy…">
          <div style="font-family:var(--font-mono);font-size:11.5px;color:var(--champagne-300);margin-bottom:8px;letter-spacing:0.04em;text-transform:uppercase;">Retrieving Grounded Clauses &bull; Vector RAG&hellip;</div>
          <div class="skeleton-bar title"></div>
          <div class="skeleton-bar w-90"></div>
          <div class="skeleton-bar w-75"></div>
          <div class="skeleton-bar w-60"></div>
        </div>
      `;
      chatMessagesStream?.appendChild(skeletonEl);
      if (chatMessagesStream) chatMessagesStream.scrollTop = chatMessagesStream.scrollHeight;

      if (loadingPolicyCheck) loadingPolicyCheck.style.display = 'inline-block';
      if (submitPolicyCheckBtn) submitPolicyCheckBtn.disabled = true;
      if (chatSessionSelect) chatSessionSelect.disabled = true;

      try {
        const response = await fetch(`/files/${currentFileId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: question, conversationId: currentConversationId }),
        });

        if (!response.ok) {
          if (response.status === 404) {
            const fallbackRes = await fetch(`/check-policy/${currentFileId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ policyQuestion: question }),
            });
            if (!fallbackRes.ok) {
              const errData = await fallbackRes.json().catch(() => ({}));
              throw new Error(errData.message || 'Policy analysis failed.');
            }
            const fbData = await fallbackRes.json();
            skeletonEl.remove();
            appendModelMessage(fbData.policyResult || '');
            window.PolicyApp.updateQuotaBadge?.();
            return;
          }

          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.message || 'Failed to process inquiry.');
        }

        const data = await response.json();
        skeletonEl.remove();

        if (data.conversationId) {
          currentConversationId = data.conversationId;
          await loadSessionsForFile(currentFileId, currentConversationId);
        }

        const replyText = data.reply?.text || '';
        const citations = data.reply?.citations || [];
        appendModelMessage(replyText, citations);
        window.PolicyApp.updateQuotaBadge?.();
      } catch (error) {
        console.error('Policy chat error:', error);
        skeletonEl.remove();
        const errEl = document.createElement('div');
        errEl.className = 'chat-msg-model';
        errEl.style.borderColor = 'rgba(239, 83, 80, 0.4)';
        errEl.innerHTML = `<div style="color:#ef9a9a;font-size:13px;">Error: ${error.message}</div>`;
        chatMessagesStream?.appendChild(errEl);
        if (chatMessagesStream) chatMessagesStream.scrollTop = chatMessagesStream.scrollHeight;
      } finally {
        if (loadingPolicyCheck) loadingPolicyCheck.style.display = 'none';
        if (submitPolicyCheckBtn) submitPolicyCheckBtn.disabled = false;
        if (chatSessionSelect) chatSessionSelect.disabled = false;
        policyQuestionInput?.focus();
      }
    });

    policyQuestionInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitPolicyCheckBtn?.click();
      }
    });

    document.querySelectorAll('.prompt-chip').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        const prompt = e.currentTarget.dataset.prompt;
        if (prompt && policyQuestionInput) {
          policyQuestionInput.value = prompt;
          policyQuestionInput.focus();
        }
      });
    });

    const copyPolicyResultBtn = document.getElementById('copyPolicyResult');
    const copyBtnText = document.getElementById('copyBtnText');
    if (copyPolicyResultBtn) {
      copyPolicyResultBtn.addEventListener('click', async () => {
        const textToCopy = latestAssistantText.trim();
        if (!textToCopy) return;

        try {
          await navigator.clipboard.writeText(textToCopy);
          copyPolicyResultBtn.classList.add('copied');
          if (copyBtnText) copyBtnText.textContent = 'Copied!';
          setTimeout(() => {
            copyPolicyResultBtn.classList.remove('copied');
            if (copyBtnText) copyBtnText.textContent = 'Copy';
          }, 2000);
        } catch (err) {
          console.warn('Clipboard write failed:', err);
        }
      });
    }

    return {
      openWithQuery: (fileId, docTitle, query) => {
        currentFileId = fileId;
        if (policyCheckFileName) policyCheckFileName.textContent = docTitle;
        window.PolicyApp?.pdfViewer?.setCurrentFile(fileId, docTitle);
        policyCheckModal?.classList.add('open');
        policyCheckModal?.setAttribute('aria-hidden', 'false');
        if (policyQuestionInput) {
          policyQuestionInput.value = query || '';
          policyQuestionInput.focus();
        }
        if (fileId) {
          (async () => {
            await loadSessionsForFile(fileId);
            if (currentConversationId) {
              await loadChatHistory(fileId, currentConversationId);
            }
          })();
        }
      },
    };
  }

  window.PolicyApp.initChat = initChat;
})();
