// Markdown normalization and sanitization utilities
(function () {
  window.PolicyApp = window.PolicyApp || {};

  function normalizeModelTextToMarkdown(text) {
    if (typeof text !== 'string') return '';
    const t = text.replace(/\r\n/g, '\n').trim();

    const sectionRegex =
      /(?:^|\s)(?:1\s*[.)]\s*)?\*\*Answer:\*\*\s*([\s\S]*?)(?=\s(?:2\s*[.)]\s*)?\*\*Reasoning:\*\*|\s(?:2\s*[.)]\s*)?Reasoning:|$)/i;
    const reasoningRegex =
      /(?:^|\s)(?:2\s*[.)]\s*)?\*\*Reasoning:\*\*\s*([\s\S]*?)(?=\s(?:3\s*[.)]\s*)?\*\*(?:Key\s*Extracts?|Evidence|Extracts?):\*\*|\s(?:3\s*[.)]\s*)?(?:Key\s*Extracts?|Evidence|Extracts?):|$)/i;
    const extractsRegex =
      /(?:^|\s)(?:3\s*[.)]\s*)?\*\*(?:Key\s*Extracts?|Evidence|Extracts?):\*\*\s*([\s\S]*?)$/i;

    const answerMatch = t.match(sectionRegex);
    const reasoningMatch = t.match(reasoningRegex);
    const extractsMatch = t.match(extractsRegex);

    const answer2 = answerMatch?.[1] ?? t.match(/(?:^|\n)\s*(?:1\s*[.)]\s*)?Answer:\s*([\s\S]*?)(?=(?:\n| )\s*(?:2\s*[.)]\s*)?Reasoning:|$)/i)?.[1];
    const reasoning2 = reasoningMatch?.[1] ?? t.match(/(?:^|\n)\s*(?:2\s*[.)]\s*)?Reasoning:\s*([\s\S]*?)(?=(?:\n| )\s*(?:3\s*[.)]\s*)?(?:Key\s*Extracts?|Evidence|Extracts?):|$)/i)?.[1];
    const extracts2 = extractsMatch?.[1] ?? t.match(/(?:^|\n)\s*(?:3\s*[.)]\s*)?(?:Key\s*Extracts?|Evidence|Extracts?):\s*([\s\S]*?)$/i)?.[1];

    const answer = (answer2 ?? '').trim();
    const reasoning = (reasoning2 ?? '').trim();
    let extracts = (extracts2 ?? '').trim();

    if (!answer && !reasoning && !extracts) {
      return t;
    }

    if (extracts && !/\n\s*[-*]\s+/.test(extracts)) {
      extracts = extracts
        .replace(/^\*\s+/g, '- ')
        .replace(/\s+\*\s+/g, '\n- ');
    }

    const parts = [];
    if (answer) parts.push(`**Answer**\n\n${answer}`);
    if (reasoning) parts.push(`**Reasoning**\n\n${reasoning}`);
    if (extracts) parts.push(`**Key Extracts**\n\n${extracts}`);

    return parts.join('\n\n');
  }

  function renderMessageContent(rawText) {
    const markdown = normalizeModelTextToMarkdown(rawText);
    if (window.marked && window.DOMPurify) {
      window.marked.setOptions({ gfm: true, breaks: true });
      return window.DOMPurify.sanitize(window.marked.parse(markdown));
    }
    const div = document.createElement('div');
    div.textContent = rawText;
    return div.innerHTML;
  }

  window.PolicyApp.markdownUtils = {
    normalizeModelTextToMarkdown,
    renderMessageContent,
  };
})();
