// Document Table Inspector Controller
(function () {
  window.PolicyApp = window.PolicyApp || {};

  function initTables() {
    const tableInspectorModal = document.getElementById('tableInspectorModal');
    const closeTableInspectorModal = document.getElementById('closeTableInspectorModal');
    const tableInspectorFileName = document.getElementById('tableInspectorFileName');
    const tableInspectorLoading = document.getElementById('tableInspectorLoading');
    const tableInspectorContent = document.getElementById('tableInspectorContent');

    function openTableModal() {
      if (tableInspectorModal) {
        tableInspectorModal.classList.add('open');
        tableInspectorModal.setAttribute('aria-hidden', 'false');
      }
    }

    function closeTableModal() {
      if (tableInspectorModal) {
        tableInspectorModal.classList.remove('open');
        tableInspectorModal.setAttribute('aria-hidden', 'true');
      }
    }

    if (closeTableInspectorModal) {
      closeTableInspectorModal.addEventListener('click', closeTableModal);
    }
    if (tableInspectorModal) {
      tableInspectorModal.addEventListener('click', (e) => {
        if (e.target === tableInspectorModal) closeTableModal();
      });
    }

    function renderTablesList(tables) {
      if (!tableInspectorContent) return;
      tableInspectorContent.innerHTML = '';

      tables.forEach((tbl) => {
        const card = document.createElement('div');
        card.className = 'table-inspector-card';

        const header = document.createElement('div');
        header.className = 'table-inspector-header';

        const title = document.createElement('div');
        title.className = 'table-inspector-title';
        title.textContent = tbl.title || 'Document Table';

        const badge = document.createElement('span');
        badge.className = 'badge badge-page';
        badge.textContent = `Page ${tbl.pageNumber}`;

        header.appendChild(title);
        header.appendChild(badge);
        card.appendChild(header);

        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'table-wrapper';

        const tableEl = document.createElement('table');
        if (Array.isArray(tbl.headers) && tbl.headers.length > 0) {
          const thead = document.createElement('thead');
          const tr = document.createElement('tr');
          tbl.headers.forEach((h) => {
            const th = document.createElement('th');
            th.textContent = h;
            tr.appendChild(th);
          });
          thead.appendChild(tr);
          tableEl.appendChild(thead);
        }

        if (Array.isArray(tbl.rows) && tbl.rows.length > 0) {
          const tbody = document.createElement('tbody');
          tbl.rows.forEach((row) => {
            const tr = document.createElement('tr');
            if (Array.isArray(row)) {
              row.forEach((cell) => {
                const td = document.createElement('td');
                td.textContent = cell;
                tr.appendChild(td);
              });
            }
            tbody.appendChild(tr);
          });
          tableEl.appendChild(tbody);
        }

        tableWrapper.appendChild(tableEl);
        card.appendChild(tableWrapper);
        tableInspectorContent.appendChild(card);
      });
    }

    function bindTableInspectorButton(btn) {
      btn.addEventListener('click', async () => {
        const fileId = btn.dataset.fileId;
        const fileName = btn.dataset.fileName || 'Document';

        if (tableInspectorFileName) tableInspectorFileName.textContent = fileName;
        if (tableInspectorContent) {
          tableInspectorContent.innerHTML = `
            <div class="table-inspector-card">
              <div class="skeleton-loader" role="status" aria-label="Loading document tables…">
                <div style="font-family:var(--font-mono);font-size:11.5px;color:var(--champagne-300);margin-bottom:8px;letter-spacing:0.04em;text-transform:uppercase;">Extracting structured tables&hellip;</div>
                <div class="skeleton-bar title"></div>
                <div class="skeleton-bar w-90"></div>
                <div class="skeleton-bar w-75"></div>
                <div class="skeleton-bar w-60"></div>
              </div>
            </div>
          `;
        }
        if (tableInspectorLoading) tableInspectorLoading.style.display = 'none';

        openTableModal();

        try {
          const res = await fetch(`/files/${fileId}/tables`);
          if (!res.ok) throw new Error('Failed to load tables');
          const data = await res.json();

          if (tableInspectorLoading) tableInspectorLoading.style.display = 'none';

          if (!data.success || !data.tables || data.tables.length === 0) {
            if (tableInspectorContent) {
              tableInspectorContent.innerHTML = '<p style="color:var(--muted);text-align:center;margin:24px 0;">No structured tables found for this document.</p>';
            }
            return;
          }

          renderTablesList(data.tables);
        } catch (_err) {
          if (tableInspectorLoading) tableInspectorLoading.style.display = 'none';
          if (tableInspectorContent) {
            tableInspectorContent.innerHTML = '<p style="color:#e57373;text-align:center;margin:24px 0;">Unable to fetch document tables. Please try again.</p>';
          }
        }
      });
    }

    document.querySelectorAll('.view-tables-btn').forEach(bindTableInspectorButton);

    window.PolicyApp.bindTableInspectorButton = bindTableInspectorButton;
  }

  window.PolicyApp.initTables = initTables;
})();
