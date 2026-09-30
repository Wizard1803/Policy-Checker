const geminiClient = require('./gemini.client');
const chunkService = require('./chunk.service');
const tableService = require('./table.service');

const PASSAGE_QUOTA = 3;
const TABLE_QUOTA = 3;

/**
 * Retrieves symmetric passage and table quotas for each policy.
 *
 * @param {string|Object} userId
 * @param {Array<Object>} files
 * @param {string} aspect
 * @returns {Promise<{retrievedDocs: Array<Object>, formattedContextBlock: string}>}
 */
async function retrieveSymmetricContext(userId, files, aspect) {
  const retrievalPromises = files.map(async (file, index) => {
    const [chunks, tables] = await Promise.all([
      chunkService.findSimilarChunks(file._id, userId, aspect, PASSAGE_QUOTA),
      tableService.findRelevantTables(file._id, userId, aspect, TABLE_QUOTA),
    ]);

    return {
      file,
      index: index + 1,
      chunks,
      tables,
    };
  });

  const retrievedDocs = await Promise.all(retrievalPromises);

  const contextBlocks = retrievedDocs.map(({ file, index, chunks, tables }) => {
    const policyNamespace = `POLICY-${index}`;
    let tablesBlock = '';
    if (tables && tables.length > 0) {
      const tableEntries = tables.map((t, tIdx) => {
        const title = t.title || 'Actuarial Matrix';
        const page = t.pageNumber ? `Page ${t.pageNumber}` : 'Unspecified Page';
        return `[${policyNamespace}:TABLE-${tIdx + 1} | ${page} | ${title}]:\n${t.markdownRepresentation}`;
      });
      tablesBlock = `[STRUCTURED 2D TABLES]:\n${tableEntries.join('\n\n')}`;
    }

    let passagesBlock = '';
    if (chunks && chunks.length > 0) {
      const passageEntries = chunks.map((c, cIdx) => {
        const page = c.pageNumber ? `Page ${c.pageNumber}` : 'Page N/A';
        return `[${policyNamespace}:REF-${cIdx + 1} | ${page}]: "${c.text}"`;
      });
      passagesBlock = `[DOCUMENT PASSAGES]:\n${passageEntries.join('\n\n')}`;
    } else if (file.extractedText) {
      passagesBlock = `[DOCUMENT PASSAGES]:\n[${policyNamespace}:EXTRACT]: """\n${file.extractedText.slice(0, 8000)}\n"""`;
    }

    const sections = [tablesBlock, passagesBlock].filter(Boolean).join('\n\n');

    return [
      '============================================================',
      `[${policyNamespace}: ${file.fileName} (Document ID: ${file._id})]`,
      sections || 'No relevant passages or tables retrieved.',
      '============================================================',
    ].join('\n');
  });

  return {
    retrievedDocs,
    formattedContextBlock: contextBlocks.join('\n\n'),
  };
}

/**
 * Extracts and verifies cross-document citations (FACTUM Protocol).
 *
 * @param {string} text
 * @param {Array<Object>} retrievedDocs
 * @returns {Array<Object>}
 */
function parseAndVerifyMultiDocCitations(text, retrievedDocs) {
  if (!text || typeof text !== 'string') return [];

  const verifiedCitations = [];
  const seenExcerpts = new Set();
  const citationTokenRegex = /\[POLICY-(\d+)(?::(?:REF|TABLE)-\d+)?\s*\|\s*Page\s+(\d+)\]/gi;
  let match;

  while ((match = citationTokenRegex.exec(text)) !== null) {
    const policyIndex = parseInt(match[1], 10);
    const pageNum = parseInt(match[2], 10);
    const docData = retrievedDocs.find((d) => d.index === policyIndex);
    if (!docData) continue;

    const surrounding = text.slice(match.index, match.index + 250);
    const quoteMatch = surrounding.match(/"([^"]{10,250})"/);
    const excerpt = quoteMatch ? quoteMatch[1] : '';

    if (excerpt && !seenExcerpts.has(excerpt.toLowerCase())) {
      seenExcerpts.add(excerpt.toLowerCase());
      const normalizedExcerpt = excerpt.toLowerCase().replace(/\s+/g, ' ');
      let isVerified = false;

      for (const chunk of docData.chunks) {
        if ((chunk.text || '').toLowerCase().replace(/\s+/g, ' ').includes(normalizedExcerpt)) {
          isVerified = true;
          break;
        }
      }

      if (!isVerified && docData.tables) {
        for (const table of docData.tables) {
          if ((table.markdownRepresentation || '').toLowerCase().replace(/\s+/g, ' ').includes(normalizedExcerpt)) {
            isVerified = true;
            break;
          }
        }
      }

      if (!isVerified && docData.file.extractedText) {
        if (docData.file.extractedText.toLowerCase().replace(/\s+/g, ' ').includes(normalizedExcerpt)) {
          isVerified = true;
        }
      }

      if (isVerified) {
        verifiedCitations.push({
          documentId: docData.file._id,
          documentName: docData.file.fileName,
          pageNumber: pageNum,
          excerpt,
          clauseTitle: `${docData.file.fileName} - Page ${pageNum}`,
          verified: true,
        });
      }
    }
  }

  for (const docData of retrievedDocs) {
    const docNameRegex = new RegExp(`\\[${docData.file.fileName}[^\\]]*Page\\s*(\\d+)[^\\]]*\\]`, 'gi');
    let docMatch;
    while ((docMatch = docNameRegex.exec(text)) !== null) {
      const pageNum = parseInt(docMatch[1], 10);
      const surrounding = text.slice(docMatch.index, docMatch.index + 250);
      const quoteMatch = surrounding.match(/"([^"]{10,250})"/);
      const excerpt = quoteMatch ? quoteMatch[1] : '';

      if (excerpt && !seenExcerpts.has(excerpt.toLowerCase())) {
        seenExcerpts.add(excerpt.toLowerCase());
        verifiedCitations.push({
          documentId: docData.file._id,
          documentName: docData.file.fileName,
          pageNumber: pageNum,
          excerpt,
          clauseTitle: `${docData.file.fileName} - Page ${pageNum}`,
          verified: true,
        });
      }
    }
  }

  return verifiedCitations;
}

/**
 * Builds the initial comparison prompt.
 */
function buildComparisonPrompt(sanitizedAspect, formattedContextBlock, orderedFiles) {
  const policyHeaders = orderedFiles.map((f, i) => `Policy ${i + 1}: "${f.fileName}"`).join('\n');
  return `You are a senior insurance actuarial and legal document analyst.
Your task is to conduct an objective, side-by-side comparative analysis of the following policies:
${policyHeaders}

COMPARISON ASPECT: "${sanitizedAspect}"

CRITICAL REASONING RULES:
1. Parity & Fairness: You must explicitly evaluate every single policy on this aspect. Never omit a policy.
2. Grounded Truth: Answer strictly and only using the provided structured tables and passages.
3. Not Specified Indicator: If a policy document does not specify or cover a parameter, state: "Not specified in policy document".
4. Numeric Precision: Actuarial limits must be cited verbatim from structured tables or text.
5. Citation Tagging: When citing a clause or figure, tag it with its reference, e.g., [POLICY-1 | Page 4] or [POLICY-2 | Page 12], and quote key phrases in "double quotation marks".

REQUIRED OUTPUT STRUCTURE (Markdown):
### 1. Executive Summary
Provide a 2-3 sentence synthesis contrasting the policies for this aspect.

### 2. Side-by-Side Comparison Matrix
| Parameter / Feature | ${orderedFiles.map((f, i) => `Policy ${i + 1} (${f.fileName})`).join(' | ')} | Advantage / Analysis |
| :--- | ${orderedFiles.map(() => ':---').join(' | ')} | :--- |

### 3. Detailed Clause Analysis
In-depth breakdown citing references like [POLICY-1 | Page X].

### 4. Critical Exclusions & Waiting Period Discrepancies
Highlight hidden exclusions, waiting periods, sub-limits, or restrictive clauses.

CONTEXT EVIDENCE:
${formattedContextBlock}

Please generate the complete comparative evaluation now:`;
}

/**
 * Builds the follow-up multi-turn comparison prompt.
 */
function buildFollowupPrompt(userMessageText, formattedContextBlock, orderedFiles, recentTurns = []) {
  const policyHeaders = orderedFiles.map((f, i) => `Policy ${i + 1}: "${f.fileName}"`).join('\n');
  const historyText = recentTurns.length > 0
    ? recentTurns.map((m) => `${m.sender === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n\n')
    : 'No prior conversation turns.';

  return `You are a senior insurance actuarial analyst assisting a user in comparing the following policies:
${policyHeaders}

RECENT CONVERSATION HISTORY:
${historyText}

NEW USER QUESTION:
"${userMessageText}"

CRITICAL INSTRUCTIONS:
1. Grounding: Answer strictly from the provided passages and tables for the policies.
2. Cross-Document Contrast: Address all policies in the comparison where relevant to the question.
3. Citation Tokens: When referring to a specific clause or limit, cite the source using [POLICY-N | Page X] and include the exact quote in "double quotation marks".
4. Tone: Concise, professional, and actuarially precise.

CONTEXT EVIDENCE:
${formattedContextBlock}

Please answer the user's question now:`;
}

/**
 * Calls the Gemini API with model cascade fallback.
 */
async function callGeminiCascade(prompt) {
  const apiResult = await geminiClient.generateContent({
    prompt,
    priority: 'high',
    timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS) || 35000,
  });

  const blockReason = apiResult?.promptFeedback?.blockReason;
  if (blockReason) {
    const err = new Error(`Model blocked the request (${blockReason}).`);
    err.statusCode = 422;
    throw err;
  }

  let text = apiResult?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text && Array.isArray(apiResult?.candidates?.[0]?.content?.parts)) {
    text = apiResult.candidates[0].content.parts.map((p) => p.text).filter(Boolean).join('\n');
  }

  if (!text) {
    const err = new Error('No response returned from model.');
    err.statusCode = 502;
    throw err;
  }

  return text.trim();
}

module.exports = {
  retrieveSymmetricContext,
  parseAndVerifyMultiDocCitations,
  buildComparisonPrompt,
  buildFollowupPrompt,
  callGeminiCascade,
  PASSAGE_QUOTA,
  TABLE_QUOTA,
};
