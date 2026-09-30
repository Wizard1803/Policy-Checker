// Document management controller: Upload, Rename, Delete, Reprocess, and Status Polling
(function () {
  window.PolicyApp = window.PolicyApp || {};

  function initFileManager() {
    // --- UPLOAD MODAL LOGIC ---
    const openUploadBtn = document.getElementById('openUploadBtn');
    const uploadModal = document.getElementById('uploadModal');
    const closeUploadModal = document.getElementById('closeUploadModal');
    const cancelUpload = document.getElementById('cancelUpload');
    const uploadForm = document.getElementById('uploadForm');
    const uploadFileInput = document.getElementById('uploadFileInput');
    const submitUploadBtn = document.getElementById('submitUploadBtn');
    const uploadProgressContainer = document.getElementById('uploadProgressContainer');

    function resetUploadModal() {
      if (uploadForm) uploadForm.reset();
      if (submitUploadBtn) {
        submitUploadBtn.disabled = false;
        submitUploadBtn.innerHTML = 'Submit';
      }
      if (cancelUpload) cancelUpload.disabled = false;
      if (uploadFileInput) uploadFileInput.disabled = false;
      if (uploadProgressContainer) uploadProgressContainer.style.display = 'none';
    }

    if (openUploadBtn && uploadModal) {
      openUploadBtn.addEventListener('click', () => {
        resetUploadModal();
        uploadModal.classList.add('open');
        uploadModal.setAttribute('aria-hidden', 'false');
        uploadModal.querySelector('input[type="file"]')?.focus();
      });
    }

    closeUploadModal?.addEventListener('click', () => {
      uploadModal?.classList.remove('open');
      uploadModal?.setAttribute('aria-hidden', 'true');
      resetUploadModal();
    });
    cancelUpload?.addEventListener('click', () => {
      uploadModal?.classList.remove('open');
      uploadModal?.setAttribute('aria-hidden', 'true');
      resetUploadModal();
    });

    uploadModal?.querySelector('.modal-card')?.addEventListener('click', (e) => e.stopPropagation());
    uploadModal?.addEventListener('click', (e) => {
      if (e.target === uploadModal) {
        uploadModal.classList.remove('open');
        uploadModal.setAttribute('aria-hidden', 'true');
        resetUploadModal();
      }
    });

    uploadForm?.addEventListener('submit', (e) => {
      const file = uploadFileInput?.files?.[0];
      if (!file) {
        e.preventDefault();
        (window.PolicyApp?.toast?.warning || window.showToast || alert)('Please select a PDF document to upload.');
        return;
      }
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        e.preventDefault();
        (window.PolicyApp?.toast?.warning || window.showToast || alert)('Only PDF documents are supported.');
        return;
      }

      // Transition to Submitting state
      if (submitUploadBtn) {
        submitUploadBtn.disabled = true;
        submitUploadBtn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span> Uploading...';
      }
      if (cancelUpload) cancelUpload.disabled = true;
      if (uploadProgressContainer) uploadProgressContainer.style.display = 'block';
    });

    // Pause orbit animation while hovering
    const orbit = document.querySelector('.orbit');
    if (openUploadBtn && orbit) {
      openUploadBtn.addEventListener('mouseenter', () => (orbit.style.animationPlayState = 'paused'));
      openUploadBtn.addEventListener('mouseleave', () => (orbit.style.animationPlayState = 'running'));
    }

    // --- RENAME MODAL LOGIC ---
    const renameModal = document.getElementById('renameModal');
    const closeRenameModal = document.getElementById('closeRenameModal');
    const cancelRename = document.getElementById('cancelRename');
    const renameForm = document.getElementById('renameForm');
    const renameFileId = document.getElementById('renameFileId');
    const renameInput = document.getElementById('renameInput');

    document.querySelectorAll('.rename-file-btn').forEach((button) => {
      button.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        if (renameFileId) renameFileId.value = btn.dataset.fileId;
        if (renameInput) renameInput.value = btn.dataset.fileName || '';
        renameModal?.classList.add('open');
        renameModal?.setAttribute('aria-hidden', 'false');
        renameInput?.focus();
      });
    });

    const closeRename = () => {
      renameModal?.classList.remove('open');
      renameModal?.setAttribute('aria-hidden', 'true');
    };
    closeRenameModal?.addEventListener('click', closeRename);
    cancelRename?.addEventListener('click', closeRename);
    renameModal?.addEventListener('click', (e) => {
      if (e.target === renameModal) closeRename();
    });

    renameForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fileId = renameFileId?.value;
      const newName = renameInput?.value.trim();
      if (!fileId || !newName) return;

      try {
        const res = await fetch(`/files/${fileId}/rename`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: newName }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to rename document.');

        const titleElem = document.getElementById(`file-title-${fileId}`);
        if (titleElem) titleElem.textContent = data.fileName;

        const card = document.getElementById(`file-card-${fileId}`);
        if (card) {
          card.querySelectorAll('[data-file-name]').forEach((el) => {
            el.dataset.fileName = data.fileName;
          });
        }
        closeRename();
        window.PolicyApp?.toast?.success?.('Document renamed successfully.');
      } catch (err) {
        (window.PolicyApp?.toast?.error || window.showToast || alert)(err.message || 'Rename failed.');
      }
    });

    // --- DELETE MODAL LOGIC ---
    const deleteModal = document.getElementById('deleteModal');
    const closeDeleteModal = document.getElementById('closeDeleteModal');
    const cancelDelete = document.getElementById('cancelDelete');
    const confirmDeleteBtn = document.getElementById('confirmDelete');
    const deleteFileName = document.getElementById('deleteFileName');
    const deleteFileId = document.getElementById('deleteFileId');

    document.querySelectorAll('.delete-file-btn').forEach((button) => {
      button.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        if (deleteFileId) deleteFileId.value = btn.dataset.fileId;
        if (deleteFileName) deleteFileName.textContent = btn.dataset.fileName || 'this document';
        deleteModal?.classList.add('open');
        deleteModal?.setAttribute('aria-hidden', 'false');
      });
    });

    const closeDelete = () => {
      deleteModal?.classList.remove('open');
      deleteModal?.setAttribute('aria-hidden', 'true');
    };
    closeDeleteModal?.addEventListener('click', closeDelete);
    cancelDelete?.addEventListener('click', closeDelete);
    deleteModal?.addEventListener('click', (e) => {
      if (e.target === deleteModal) closeDelete();
    });

    confirmDeleteBtn?.addEventListener('click', async () => {
      const fileId = deleteFileId?.value;
      if (!fileId) return;

      confirmDeleteBtn.disabled = true;
      confirmDeleteBtn.textContent = 'Deleting...';

      try {
        const res = await fetch(`/files/${fileId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to delete document.');

        const card = document.getElementById(`file-card-${fileId}`);
        if (card) {
          card.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
          card.style.opacity = '0';
          card.style.transform = 'scale(0.95)';
          setTimeout(() => card.remove(), 250);
        }
        closeDelete();
        window.PolicyApp?.toast?.info?.('Document deleted.');
      } catch (err) {
        (window.PolicyApp?.toast?.error || window.showToast || alert)(err.message || 'Delete failed.');
      } finally {
        confirmDeleteBtn.disabled = false;
        confirmDeleteBtn.textContent = 'Confirm Delete';
      }
    });

    // --- RETRY / REPROCESS LOGIC ---
    const bindRetryButton = (button) => {
      button.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const fileId = btn.dataset.fileId;
        if (!fileId) return;

        const isReprocess = btn.textContent.trim().toLowerCase() === 'reprocess';
        btn.disabled = true;
        btn.textContent = isReprocess ? 'Reprocessing...' : 'Retrying...';

        try {
          const res = await fetch(`/files/${fileId}/reprocess`, { method: 'POST' });
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || 'Failed to trigger retry.');

          const card = document.getElementById(`file-card-${fileId}`);
          if (card) {
            card.dataset.state = 'processing';
            const badgeContainer = document.getElementById(`badge-container-${fileId}`);
            if (badgeContainer) {
              badgeContainer.innerHTML = '<span class="badge badge-processing badge-pulse"><span class="badge-dot"></span> Processing&hellip;</span>';
            }
            btn.style.display = 'none';
            pollFileStatus(fileId);
            window.PolicyApp?.toast?.info?.('Reprocessing started...');
          }
        } catch (err) {
          (window.PolicyApp?.toast?.error || window.showToast || alert)(err.message || 'Retry failed.');
          btn.disabled = false;
          btn.textContent = isReprocess ? 'Reprocess' : 'Retry';
        }
      });
    };

    document.querySelectorAll('.retry-file-btn').forEach(bindRetryButton);

    // --- ATOMIC CARD STATE HYDRATOR ---
    function transitionCardToReady(fileId, data) {
      const card = document.getElementById(`file-card-${fileId}`);
      if (!card) return;

      // 1. Core Visual Transition: data-state, green border accent, ready badge
      card.dataset.state = 'ready';
      card.style.borderLeftColor = 'var(--success-text)';

      const badgeContainer = document.getElementById(`badge-container-${fileId}`);
      if (badgeContainer) {
        const pageText = data.pageCount > 0 ? `${data.pageCount} pages` : 'Indexed';
        const tableText = data.tableCount && data.tableCount > 0
          ? ` &bull; ${data.tableCount} ${data.tableCount === 1 ? 'table' : 'tables'}`
          : '';
        badgeContainer.innerHTML = `<span class="badge badge-ready">Ready &bull; ${pageText}${tableText}</span>`;
      }

      // 2. Enable primary actions
      const checkBtn = card.querySelector('.check-policy-btn');
      if (checkBtn) checkBtn.removeAttribute('disabled');

      const compareCheckbox = card.querySelector('.compare-checkbox');
      if (compareCheckbox) compareCheckbox.removeAttribute('disabled');

      // 3. Ensure Reprocess button exists and is active
      let retryBtn = card.querySelector('.retry-file-btn');
      const actions = card.querySelector('.file-card-actions');
      if (!retryBtn && actions) {
        retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'btn-secondary retry-file-btn';
        retryBtn.dataset.fileId = fileId;
        const deleteBtn = actions.querySelector('.delete-file-btn');
        if (deleteBtn && deleteBtn.nextSibling) {
          actions.insertBefore(retryBtn, deleteBtn.nextSibling);
        } else {
          actions.appendChild(retryBtn);
        }
        bindRetryButton(retryBtn);
      }
      if (retryBtn) {
        retryBtn.disabled = false;
        retryBtn.style.display = '';
        retryBtn.textContent = 'Reprocess';
        const fileName = card.querySelector('.file-card-title')?.textContent?.trim() || 'document';
        retryBtn.setAttribute('aria-label', `Reprocess ${fileName}`);
        retryBtn.setAttribute('title', 'Re-extract tables and text');
      }

      // 4. Hydrate missing action buttons defensively
      if (actions) {
        const fileName = card.querySelector('.file-card-title')?.textContent?.trim() || 'Document';

        if (data.tableCount > 0 && !actions.querySelector('.view-tables-btn')) {
          try {
            const tablesBtn = document.createElement('button');
            tablesBtn.type = 'button';
            tablesBtn.className = 'btn-secondary view-tables-btn';
            tablesBtn.dataset.fileId = fileId;
            tablesBtn.dataset.fileName = fileName;
            tablesBtn.setAttribute('aria-label', `View structured tables for ${fileName}`);
            tablesBtn.textContent = 'Tables';
            if (window.PolicyApp.bindTableInspectorButton) {
              window.PolicyApp.bindTableInspectorButton(tablesBtn);
            }
            actions.insertBefore(tablesBtn, actions.firstChild);
          } catch (e) {
            console.warn('Could not inject tables button:', e);
          }
        }

        if (!actions.querySelector('.search-clauses-btn')) {
          try {
            const searchBtn = document.createElement('button');
            searchBtn.type = 'button';
            searchBtn.className = 'btn-secondary search-clauses-btn';
            searchBtn.dataset.fileId = fileId;
            searchBtn.dataset.fileName = fileName;
            searchBtn.setAttribute('aria-label', `Search clauses in ${fileName}`);
            searchBtn.textContent = 'Search';
            if (window.PolicyApp.bindSearchButton) {
              window.PolicyApp.bindSearchButton(searchBtn);
            }
            actions.insertBefore(searchBtn, checkBtn);
          } catch (e) {
            console.warn('Could not inject search button:', e);
          }
        }

        if (!actions.querySelector('.audit-report-btn')) {
          try {
            const auditBtn = document.createElement('button');
            auditBtn.type = 'button';
            auditBtn.className = 'btn-secondary audit-report-btn';
            auditBtn.dataset.fileId = fileId;
            auditBtn.dataset.fileName = fileName;
            auditBtn.setAttribute('aria-label', `View actuarial audit report for ${fileName}`);
            auditBtn.textContent = 'Audit Report';
            if (window.PolicyApp.bindSummaryButton) {
              window.PolicyApp.bindSummaryButton(auditBtn);
            }
            actions.insertBefore(auditBtn, checkBtn);
          } catch (e) {
            console.warn('Could not inject audit report button:', e);
          }
        }
      }
    }

    // --- REAL-TIME STATUS POLLING (Recursive setTimeout) ---
    function pollFileStatus(fileId) {
      let attempts = 0;
      const maxAttempts = 180; // Up to 7.5 minutes
      let isPolling = false;

      const scheduleNext = (delayMs) => {
        if (attempts >= maxAttempts) {
          const card = document.getElementById(`file-card-${fileId}`);
          const badgeContainer = document.getElementById(`badge-container-${fileId}`);
          if (badgeContainer && card?.dataset.state !== 'ready' && card?.dataset.state !== 'failed') {
            badgeContainer.innerHTML = `
              <span class="badge badge-processing" style="cursor:pointer;" onclick="window.location.reload()" title="Click to refresh document status">
                <span class="badge-dot"></span> Still indexing&hellip; (Click to refresh)
              </span>
            `;
          }
          return;
        }
        setTimeout(checkStatus, delayMs);
      };

      const checkStatus = async () => {
        if (isPolling) return;
        isPolling = true;
        attempts++;

        try {
          const res = await fetch(`/files/${fileId}/status`);
          if (!res.ok) {
            scheduleNext(3000);
            return;
          }

          const data = await res.json();
          if (!data || !data.success) {
            scheduleNext(3000);
            return;
          }

          const state = data.processingState;

          if (state === 'ready') {
            transitionCardToReady(fileId, data);
            window.PolicyApp.updateQuotaBadge?.();
            return; // Terminal state reached
          }

          if (state === 'failed') {
            const card = document.getElementById(`file-card-${fileId}`);
            if (card) {
              card.dataset.state = 'failed';
              card.style.borderLeftColor = 'var(--danger-text)';
            }
            const badgeContainer = document.getElementById(`badge-container-${fileId}`);
            if (badgeContainer) {
              badgeContainer.innerHTML = `<span class="badge badge-failed" title="${data.processingError || ''}">Failed</span>`;
            }
            const actions = card?.querySelector('.file-card-actions');
            const checkBtn = card?.querySelector('.check-policy-btn');
            const retryBtn = actions?.querySelector('.retry-file-btn');
            if (retryBtn) {
              retryBtn.style.display = '';
              retryBtn.disabled = false;
              retryBtn.textContent = 'Retry';
            } else if (actions) {
              const newBtn = document.createElement('button');
              newBtn.type = 'button';
              newBtn.className = 'btn-secondary retry-file-btn';
              newBtn.dataset.fileId = fileId;
              newBtn.setAttribute('aria-label', 'Retry processing for document');
              newBtn.textContent = 'Retry';
              bindRetryButton(newBtn);
              actions.insertBefore(newBtn, checkBtn);
            }
            return; // Terminal state reached
          }

          scheduleNext(2500);
        } catch (_err) {
          scheduleNext(3000);
        } finally {
          isPolling = false;
        }
      };

      scheduleNext(1000);
    }

    // Auto-poll files currently in indexing state
    document.querySelectorAll('.file-card').forEach((card) => {
      const state = card.dataset.state;
      const fileId = card.dataset.fileId;
      if ((state === 'uploaded' || state === 'processing') && fileId) {
        pollFileStatus(fileId);
      }
    });

    window.PolicyApp.transitionCardToReady = transitionCardToReady;
    window.PolicyApp.pollFileStatus = pollFileStatus;
  }

  window.PolicyApp.initFileManager = initFileManager;
})();
