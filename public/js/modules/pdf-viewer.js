// In-App Split-Screen PDF Viewer & Clause Navigator (Feature I)
(function () {
  window.PolicyApp = window.PolicyApp || {};

  function initPdfViewer() {
    const modalCardChat = document.querySelector('.modal-card-chat');
    const pdfViewerPane = document.getElementById('pdfViewerPane');
    const pdfViewerDocTitle = document.getElementById('pdfViewerDocTitle');
    const pdfCurrentPage = document.getElementById('pdfCurrentPage');
    const pdfTotalPages = document.getElementById('pdfTotalPages');
    const pdfPrevPageBtn = document.getElementById('pdfPrevPageBtn');
    const pdfNextPageBtn = document.getElementById('pdfNextPageBtn');
    const pdfPageInput = document.getElementById('pdfPageInput');
    const pdfPopoutBtn = document.getElementById('pdfPopoutBtn');
    const closePdfViewerBtn = document.getElementById('closePdfViewerBtn');
    const pdfCitationCallout = document.getElementById('pdfCitationCallout');
    const pdfCitationPageLabel = document.getElementById('pdfCitationPageLabel');
    const pdfCitationText = document.getElementById('pdfCitationText');
    const pdfViewerIframe = document.getElementById('pdfViewerIframe');
    const toggleSplitViewBtn = document.getElementById('toggleSplitViewBtn');
    const toggleSplitViewText = document.getElementById('toggleSplitViewText');

    let currentFileId = null;
    let currentFileName = '';
    let currentPage = 1;
    let totalPagesCount = null;
    let isPaneOpen = false;

    function jumpToPage(pageNum) {
      let p = parseInt(pageNum, 10);
      if (isNaN(p) || p < 1) p = 1;
      if (totalPagesCount && typeof totalPagesCount === 'number' && p > totalPagesCount) {
        p = totalPagesCount;
      }
      currentPage = p;

      if (pdfCurrentPage) pdfCurrentPage.textContent = currentPage;
      if (pdfPageInput) pdfPageInput.value = currentPage;

      if (currentFileId) {
        const streamUrl = `/files/${encodeURIComponent(currentFileId)}/view-pdf#page=${currentPage}`;
        if (pdfPopoutBtn) pdfPopoutBtn.href = streamUrl;
        if (pdfViewerIframe) {
          pdfViewerIframe.src = `${streamUrl}&zoom=page-width`;
        }
      }
    }

    function openViewer(fileId, fileName, pageNum = 1, excerpt = '', totalPages = null) {
      if (!fileId) return;

      currentFileId = fileId;
      if (fileName) currentFileName = fileName;
      if (totalPages) {
        totalPagesCount = parseInt(totalPages, 10) || null;
        if (pdfTotalPages) pdfTotalPages.textContent = totalPagesCount || '--';
      }

      const p = parseInt(pageNum, 10) || 1;
      currentPage = p;

      if (pdfViewerDocTitle) {
        pdfViewerDocTitle.textContent = currentFileName || 'Policy Document';
      }
      if (pdfCurrentPage) pdfCurrentPage.textContent = currentPage;
      if (pdfPageInput) pdfPageInput.value = currentPage;

      const streamUrl = `/files/${encodeURIComponent(fileId)}/view-pdf#page=${currentPage}`;
      if (pdfPopoutBtn) pdfPopoutBtn.href = streamUrl;

      // Update excerpt callout banner
      if (excerpt && excerpt.trim().length > 0) {
        if (pdfCitationPageLabel) pdfCitationPageLabel.textContent = `Page ${currentPage}`;
        if (pdfCitationText) pdfCitationText.textContent = `\u201C${excerpt.trim()}\u201D`;
        if (pdfCitationCallout) pdfCitationCallout.style.display = 'block';
      } else {
        if (pdfCitationCallout) pdfCitationCallout.style.display = 'none';
      }

      // Expand modal to split view layout
      if (modalCardChat) modalCardChat.classList.add('split-active');
      if (pdfViewerPane) pdfViewerPane.style.display = 'flex';

      // Load native stream in iframe
      if (pdfViewerIframe) {
        pdfViewerIframe.src = `${streamUrl}&zoom=page-width`;
      }

      if (toggleSplitViewText) toggleSplitViewText.textContent = 'Close PDF';
      if (toggleSplitViewBtn) toggleSplitViewBtn.classList.add('active');
      isPaneOpen = true;
    }

    function closeViewer() {
      if (pdfViewerPane) pdfViewerPane.style.display = 'none';
      if (modalCardChat) modalCardChat.classList.remove('split-active');
      if (pdfViewerIframe) pdfViewerIframe.src = 'about:blank';
      if (pdfCitationCallout) pdfCitationCallout.style.display = 'none';
      if (toggleSplitViewText) toggleSplitViewText.textContent = 'Split View';
      if (toggleSplitViewBtn) toggleSplitViewBtn.classList.remove('active');
      isPaneOpen = false;
    }

    function toggleViewer(fileId, fileName) {
      if (isPaneOpen) {
        closeViewer();
      } else {
        const targetId = fileId || currentFileId;
        const targetName = fileName || currentFileName;
        if (targetId) {
          openViewer(targetId, targetName, currentPage);
        }
      }
    }

    // Prev / Next Page Buttons
    pdfPrevPageBtn?.addEventListener('click', () => {
      if (currentPage > 1) {
        jumpToPage(currentPage - 1);
      }
    });

    pdfNextPageBtn?.addEventListener('click', () => {
      jumpToPage(currentPage + 1);
    });

    // Page Number Input Jump
    pdfPageInput?.addEventListener('change', () => {
      jumpToPage(pdfPageInput.value);
    });

    pdfPageInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        jumpToPage(pdfPageInput.value);
      }
    });

    // Close Button on PDF Pane
    closePdfViewerBtn?.addEventListener('click', () => {
      closeViewer();
    });

    // Toggle Button on Chat Modal Header
    toggleSplitViewBtn?.addEventListener('click', () => {
      const fileNameEl = document.getElementById('policyCheckFileName');
      const activeFileName = fileNameEl ? fileNameEl.textContent.trim() : '';
      toggleViewer(currentFileId, activeFileName);
    });

    const controller = {
      openViewer,
      closeViewer,
      jumpToPage,
      toggleViewer,
      isOpen: () => isPaneOpen,
      setCurrentFile: (fileId, fileName) => {
        currentFileId = fileId;
        if (fileName) currentFileName = fileName;
      },
    };

    window.PolicyApp.pdfViewer = controller;
    return controller;
  }

  window.PolicyApp.initPdfViewer = initPdfViewer;
})();
