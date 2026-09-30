// Actuarial Policy Audit Report Controller (Feature E)
(function () {
  window.PolicyApp = window.PolicyApp || {};

  function initSummary() {
    const { renderMessageContent } = window.PolicyApp.markdownUtils || {
      renderMessageContent: (t) => t,
    };

    const auditReportModal = document.getElementById('auditReportModal');
    const closeAuditReportModal = document.getElementById('closeAuditReportModal');
    const auditModalFileName = document.getElementById('auditModalFileName');
    const auditParametersGrid = document.getElementById('auditParametersGrid');
    const auditReportLoading = document.getElementById('auditReportLoading');
    const auditErrorMsg = document.getElementById('auditErrorMsg');
    const auditReportContent = document.getElementById('auditReportContent');
    const auditReportMarkdown = document.getElementById('auditReportMarkdown');
    const auditCitationsList = document.getElementById('auditCitationsList');
    const auditCitationsContainer = document.getElementById('auditCitationsContainer');
    const auditFooterActions = document.getElementById('auditFooterActions');
    const printAuditReportBtn = document.getElementById('printAuditReportBtn');
    const copyAuditReportBtn = document.getElementById('copyAuditReportBtn');
    const copyAuditText = document.getElementById('copyAuditText');
    const downloadAuditMdBtn = document.getElementById('downloadAuditMdBtn');
    const downloadAuditPdfBtn = document.getElementById('downloadAuditPdfBtn');

    const paramPED = document.getElementById('paramPED');
    const paramRoomRent = document.getElementById('paramRoomRent');
    const paramCopay = document.getElementById('paramCopay');
    const paramPrePost = document.getElementById('paramPrePost');
    const paramSpecificWait = document.getElementById('paramSpecificWait');
    const paramICU = document.getElementById('paramICU');

    let currentAuditMarkdown = '';

    const openAuditModal = async (fileId, fileName) => {
      if (!auditReportModal) return;

      if (auditModalFileName) auditModalFileName.textContent = fileName;
      if (downloadAuditMdBtn) {
        downloadAuditMdBtn.href = `/files/${fileId}/export-summary`;
      }
      if (downloadAuditPdfBtn) {
        downloadAuditPdfBtn.href = `/files/${fileId}/export-summary?format=pdf`;
      }

      if (auditErrorMsg) {
        auditErrorMsg.style.display = 'none';
        auditErrorMsg.textContent = '';
      }
      if (auditParametersGrid) auditParametersGrid.style.display = 'none';
      if (auditReportContent) auditReportContent.style.display = 'none';
      if (auditFooterActions) auditFooterActions.style.display = 'none';
      if (auditReportLoading) auditReportLoading.style.display = 'block';

      auditReportModal.classList.add('open');
      auditReportModal.setAttribute('aria-hidden', 'false');

      try {
        const res = await fetch(`/files/${fileId}/export-summary?format=json`);
        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.message || 'Failed to generate actuarial audit report.');
        }

        currentAuditMarkdown = data.downloadMarkdown || data.reportMarkdown || '';
        window.PolicyApp.updateQuotaBadge?.();

        // Populate parameters
        const p = data.parameters || {};
        if (paramPED) paramPED.textContent = p.waitingPeriodPED || 'Per policy terms';
        if (paramRoomRent) paramRoomRent.textContent = p.roomRentLimit || 'See schedule';
        if (paramCopay) paramCopay.textContent = p.copay || 'Nil';
        if (paramPrePost) {
          const pre = p.preHospitalization || '60 days';
          const post = p.postHospitalization || '90 days';
          paramPrePost.textContent = `${pre} / ${post}`;
        }
        if (paramSpecificWait) paramSpecificWait.textContent = p.waitingPeriodSpecific || '24 months';
        if (paramICU) paramICU.textContent = p.icuLimit || 'No sub-limit';

        if (auditReportMarkdown) {
          auditReportMarkdown.innerHTML = renderMessageContent(data.reportMarkdown);
        }

        if (auditCitationsContainer && Array.isArray(data.citations) && data.citations.length > 0) {
          auditCitationsContainer.innerHTML = '';
          data.citations.forEach((cit) => {
            const citEl = document.createElement('div');
            citEl.className = 'compare-citation-item';
            const verifiedClass = cit.verified ? 'verified' : 'unverified';
            const pageLabel = cit.pageNumber ? `Page ${cit.pageNumber}` : 'Schedule Table';
            citEl.innerHTML = `
              <div class="compare-citation-meta">
                <span class="citation-pill ${verifiedClass}" style="cursor:default;">
                  <span>${cit.verified ? 'FACTUM Verified' : 'Flagged'}</span>
                </span>
                <span>${pageLabel}</span>
              </div>
              <p class="compare-citation-excerpt">&ldquo;${cit.excerpt || ''}&rdquo;</p>
            `;
            auditCitationsContainer.appendChild(citEl);
          });
          if (auditCitationsList) auditCitationsList.style.display = 'block';
        } else if (auditCitationsList) {
          auditCitationsList.style.display = 'none';
        }

        if (auditReportLoading) auditReportLoading.style.display = 'none';
        if (auditParametersGrid) auditParametersGrid.style.display = 'grid';
        if (auditReportContent) auditReportContent.style.display = 'block';
        if (auditFooterActions) auditFooterActions.style.display = 'flex';
      } catch (err) {
        if (auditReportLoading) auditReportLoading.style.display = 'none';
        if (auditErrorMsg) {
          auditErrorMsg.textContent = err.message || 'An error occurred while loading audit report.';
          auditErrorMsg.style.display = 'block';
        }
      }
    };

    function bindSummaryButton(btn) {
      btn.addEventListener('click', (e) => {
        const fileId = e.currentTarget.dataset.fileId;
        const fileName = e.currentTarget.dataset.fileName || 'Policy Document';
        if (fileId) {
          openAuditModal(fileId, fileName);
        }
      });
    }

    // Wire up card buttons
    document.querySelectorAll('.audit-report-btn').forEach(bindSummaryButton);
    window.PolicyApp.bindSummaryButton = bindSummaryButton;

    closeAuditReportModal?.addEventListener('click', () => {
      auditReportModal?.classList.remove('open');
      auditReportModal?.setAttribute('aria-hidden', 'true');
    });

    auditReportModal?.querySelector('.modal-card')?.addEventListener('click', (e) => e.stopPropagation());
    auditReportModal?.addEventListener('click', (e) => {
      if (e.target === auditReportModal) {
        auditReportModal.classList.remove('open');
        auditReportModal.setAttribute('aria-hidden', 'true');
      }
    });

    printAuditReportBtn?.addEventListener('click', () => {
      window.print();
    });

    copyAuditReportBtn?.addEventListener('click', () => {
      if (!currentAuditMarkdown) return;
      navigator.clipboard
        .writeText(currentAuditMarkdown)
        .then(() => {
          if (copyAuditText) copyAuditText.textContent = 'Copied!';
          setTimeout(() => {
            if (copyAuditText) copyAuditText.textContent = 'Copy';
          }, 2000);
        })
        .catch((err) => console.error('Failed to copy audit report:', err));
    });
  }

  window.PolicyApp.initSummary = initSummary;
})();
