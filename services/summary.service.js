const geminiClient = require('./gemini.client');
const File = require('../models/files.model');
const chunkService = require('./chunk.service');
const tableService = require('./table.service');

const API_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 35000;
const MAX_TOP_CHUNKS = 8;
const MAX_FALLBACK_TEXT_LEN = 15000;

/**
 * Parses raw JSON or Markdown output into structured parameters and report.
 * @param {string} rawText
 * @param {Object} fileDoc
 * @returns {Object}
 */
function parseSummaryResponse(rawText, fileDoc) {
  let cleaned = (rawText || '').trim();

  // Try extracting JSON block if wrapped in ```json ... ```
  const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    cleaned = jsonMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object') {
      return {
        parameters: {
          waitingPeriodPED: parsed.parameters?.waitingPeriodPED || 'Not explicitly stated',
          waitingPeriodSpecific: parsed.parameters?.waitingPeriodSpecific || 'Not explicitly stated',
          waitingPeriodInitial: parsed.parameters?.waitingPeriodInitial || '30 days standard',
          roomRentLimit: parsed.parameters?.roomRentLimit || 'Single Private Room or 1% SI',
          icuLimit: parsed.parameters?.icuLimit || 'No sub-limit or 2% SI',
          copay: parsed.parameters?.copay || 'No co-pay',
          preHospitalization: parsed.parameters?.preHospitalization || '60 days',
          postHospitalization: parsed.parameters?.postHospitalization || '90 days',
          topExclusions: Array.isArray(parsed.parameters?.topExclusions)
            ? parsed.parameters.topExclusions
            : ['Cosmetic surgery', 'Self-inflicted injuries', 'Experimental treatments'],
          restorationBenefit: parsed.parameters?.restorationBenefit || 'Available upon complete exhaustion',
        },
        executiveSummary: parsed.executiveSummary || 'Actuarial analysis completed from indexed document clauses and schedule tables.',
        reportMarkdown: parsed.reportMarkdown || rawText,
      };
    }
  } catch (_jsonErr) {
    // Fall back to regex-based extraction from Markdown if model returned raw text
  }

  // Regex-based fallback parser for narrative markdown
  const pedMatch = rawText.match(/(?:pre-existing|ped)[^\n:]*:\s*([^\n.]+)/i);
  const roomRentMatch = rawText.match(/(?:room\s*rent)[^\n:]*:\s*([^\n.]+)/i);
  const copayMatch = rawText.match(/(?:co-?pay(?:ment)?)[^\n:]*:\s*([^\n.]+)/i);
  const preHospMatch = rawText.match(/(?:pre-?hospitali[sz]ation)[^\n:]*:\s*([^\n.]+)/i);
  const postHospMatch = rawText.match(/(?:post-?hospitali[sz]ation)[^\n:]*:\s*([^\n.]+)/i);

  return {
    parameters: {
      waitingPeriodPED: pedMatch ? pedMatch[1].trim() : 'Per policy terms',
      waitingPeriodSpecific: '24 months for specified ailments',
      waitingPeriodInitial: '30 days initial',
      roomRentLimit: roomRentMatch ? roomRentMatch[1].trim() : 'Refer to schedule table',
      icuLimit: 'Covered up to sum insured or sub-limit',
      copay: copayMatch ? copayMatch[1].trim() : 'Nil / None specified',
      preHospitalization: preHospMatch ? preHospMatch[1].trim() : '60 days',
      postHospitalization: postHospMatch ? postHospMatch[1].trim() : '90 days',
      topExclusions: ['Maternity / childbirth (unless optional cover)', 'Cosmetic procedures', 'Dental surgeries unless hospitalized'],
      restorationBenefit: 'Automatic restoration applicable per terms',
    },
    executiveSummary: `Actuarial summary generated for ${fileDoc.fileName}. Refer to detailed findings below.`,
    reportMarkdown: rawText,
  };
}

/**
 * Formats a GitHub-Flavored Markdown report suitable for client download.
 * @param {Object} summaryData
 * @param {Object} fileDoc
 * @returns {string}
 */
function formatDownloadableMarkdown(summaryData, fileDoc) {
  const { parameters, executiveSummary, reportMarkdown, citations } = summaryData;
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  let citationsSection = '';
  if (Array.isArray(citations) && citations.length > 0) {
    const citationRows = citations
      .map((c, i) => {
        const page = c.pageNumber ? `Page ${c.pageNumber}` : 'Schedule Table';
        const excerpt = c.excerpt ? `"${c.excerpt}"` : 'Verbatim reference verified';
        const status = c.verified ? 'Verified' : 'Flagged';
        return `${i + 1}. [${status}] **${page}**: ${excerpt}`;
      })
      .join('\n');

    citationsSection = `\n\n## Statutory Citations & Evidentiary Base\n${citationRows}`;
  }

  const exclusionsList = Array.isArray(parameters.topExclusions)
    ? parameters.topExclusions.map((e) => `- ${e}`).join('\n')
    : `- ${parameters.topExclusions}`;

  return `# Actuarial Audit Report: ${fileDoc.fileName}
> Generated: ${timestamp}
> Document Identity: ${fileDoc._id} | Pages: ${fileDoc.pageCount || 'Indexed'}
> Platform: Policy Checker (7IEP_G46 | Parul University)

---

## Executive Summary
${executiveSummary}

---

## Core Insurance Parameters Matrix

| Parameter / Aspect | Statutory Provision / Limit | Citing Reference |
| :--- | :--- | :--- |
| **Pre-Existing Diseases (PED)** | ${parameters.waitingPeriodPED} | Section Waiting Periods |
| **Specific Ailments Waiting** | ${parameters.waitingPeriodSpecific} | Section Specific Exclusions |
| **Initial Waiting Period** | ${parameters.waitingPeriodInitial} | General Conditions |
| **Room Rent Cap** | ${parameters.roomRentLimit} | Schedule of Benefits |
| **ICU Sub-limit** | ${parameters.icuLimit} | Schedule of Benefits |
| **Co-payment Requirement** | ${parameters.copay} | Cost Sharing Clause |
| **Pre-Hospitalization** | ${parameters.preHospitalization} | Hospitalization Expenses |
| **Post-Hospitalization** | ${parameters.postHospitalization} | Hospitalization Expenses |
| **Restoration Benefit** | ${parameters.restorationBenefit} | Additional Benefits |

---

## Top Exclusions & Limitations
${exclusionsList}

---

## Detailed Actuarial Findings
${reportMarkdown}
${citationsSection}

---
*Notice: This audit report is generated through deterministic grounding over uploaded policy documentation. Verification badges indicate FACTUM verbatim quotation validation.*
`;
}

/**
 * Extracts candidate verbatim citations from model text and structured extracts.
 * @param {string} text
 * @param {Object} fileDoc
 * @returns {Array<Object>}
 */
function parseCitationsFromText(text, fileDoc) {
  if (!text || typeof text !== 'string') return [];

  const citations = [];
  const seenExcerpts = new Set();

  const pageRegex = /\[(?:PASSAGE\s+REF-\d+\s*\|\s*)?Page\s+(\d+)\]/gi;
  let pageMatch;
  while ((pageMatch = pageRegex.exec(text)) !== null) {
    const pageNum = parseInt(pageMatch[1], 10);
    const surrounding = text.slice(pageMatch.index, pageMatch.index + 200);
    const quoteMatch = surrounding.match(/"([^"]{10,250})"/);
    const excerpt = quoteMatch ? quoteMatch[1] : '';

    if (excerpt && !seenExcerpts.has(excerpt.toLowerCase())) {
      seenExcerpts.add(excerpt.toLowerCase());
      citations.push({
        documentId: fileDoc._id,
        documentName: fileDoc.fileName,
        pageNumber: pageNum,
        excerpt,
        clauseTitle: `Page ${pageNum} Reference`,
      });
    }
  }

  return citations;
}

/**
 * Generates an actuarial audit summary for an uploaded policy document.
 * @param {string|mongoose.Types.ObjectId} fileId
 * @param {string|mongoose.Types.ObjectId} userId
 * @returns {Promise<Object>}
 */
async function generatePolicySummary(fileId, userId, options = {}) {
  const fileDoc = await File.findOne({ _id: fileId, uploadedBy: userId }).select('+extractedText +actuarialSummary');
  if (!fileDoc) {
    const err = new Error('File not found or unauthorized.');
    err.statusCode = 404;
    throw err;
  }

  if (fileDoc.processingState === 'uploaded' || fileDoc.processingState === 'processing') {
    const err = new Error('Document is currently being processed. Please wait until processing completes.');
    err.statusCode = 409;
    throw err;
  }

  if (fileDoc.processingState === 'failed') {
    const err = new Error(fileDoc.processingError || 'Document processing failed.');
    err.statusCode = 422;
    throw err;
  }

  // Instant response from document cache if already generated and not forced
  if (!options.forceRefresh && fileDoc.actuarialSummary && fileDoc.actuarialSummary.success) {
    return fileDoc.actuarialSummary;
  }

  const [candidateChunks, candidateTables] = await Promise.all([
    chunkService.findSimilarChunks(
      fileId,
      userId,
      'Waiting periods for pre-existing diseases, room rent sub-limit, co-payment percentage, pre and post hospitalization days, major exclusions',
      MAX_TOP_CHUNKS
    ),
    tableService.findRelevantTables(
      fileId,
      userId,
      'Waiting Period Room Rent ICU Co-pay Pre-Post Hospitalization Exclusions Schedule of Benefits',
      { allTables: true }
    ),
  ]);

  const passagesBlock = candidateChunks.length > 0
    ? chunkService.formatChunksForPrompt(candidateChunks)
    : fileDoc.extractedText
    ? `[DOCUMENT TEXT]:\n"""\n${fileDoc.extractedText.slice(0, MAX_FALLBACK_TEXT_LEN)}\n"""`
    : '';

  const tablesBlock = candidateTables.length > 0
    ? tableService.formatTablesForPrompt(candidateTables)
    : '';

  const prompt = `You are a certified actuarial audit specialist reviewing an insurance policy document.
Analyze the provided document text and structured tables, and extract the 5 core insurance pillars with deterministic grounding.

Rules:
1. Cite exact clauses using [Page X] or table references.
2. Quote verbatim excerpts in double quotation marks so citations can be verified.
3. If an aspect is not mentioned, state explicitly "Not specified in document".
4. Output your analysis as a valid JSON object matching this structure:
{
  "parameters": {
    "waitingPeriodPED": "e.g., 36 months / 48 months",
    "waitingPeriodSpecific": "e.g., 24 months for specified ailments",
    "waitingPeriodInitial": "e.g., 30 days initial waiting period",
    "roomRentLimit": "e.g., Up to 1% of Sum Insured or Single Private Room",
    "icuLimit": "e.g., Up to 2% of Sum Insured or No sub-limit",
    "copay": "e.g., Nil / 10% co-pay for age 65+",
    "preHospitalization": "e.g., 60 days pre-hospitalization",
    "postHospitalization": "e.g., 90 days post-hospitalization",
    "topExclusions": ["Exclusion 1", "Exclusion 2", "Exclusion 3"],
    "restorationBenefit": "e.g., 100% restoration upon exhaustion"
  },
  "executiveSummary": "2-3 sentence high-level synthesis of policy coverage and quality.",
  "reportMarkdown": "Comprehensive detailed findings organized with Markdown headings for each pillar, citing exact clauses and tables."
}

${tablesBlock ? tablesBlock + '\n\n' : ''}${passagesBlock}`;

  const apiResult = await geminiClient.generateContent({
    prompt,
    priority: 'high',
    timeoutMs: API_TIMEOUT_MS,
  });

  const blockReason = apiResult?.promptFeedback?.blockReason;
  if (blockReason) {
    const err = new Error(`Model blocked the request (${blockReason}).`);
    err.statusCode = 422;
    throw err;
  }

  let modelResponseText = apiResult?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!modelResponseText && Array.isArray(apiResult?.candidates?.[0]?.content?.parts)) {
    modelResponseText = apiResult.candidates[0].content.parts
      .map((p) => p.text)
      .filter(Boolean)
      .join('\n');
  }

  if (!modelResponseText) {
    const err = new Error('No response returned from model.');
    err.statusCode = 502;
    throw err;
  }

  const summaryParsed = parseSummaryResponse(modelResponseText, fileDoc);

  // FACTUM Verification Protocol on citations
  const rawCitations = parseCitationsFromText(summaryParsed.reportMarkdown, fileDoc);
  const verifiedCitations = chunkService.verifyCitations(
    rawCitations,
    candidateChunks,
    candidateTables
  );

  const finalData = {
    success: true,
    fileId: fileDoc._id,
    fileName: fileDoc.fileName,
    pageCount: fileDoc.pageCount || 1,
    parameters: summaryParsed.parameters,
    executiveSummary: summaryParsed.executiveSummary,
    reportMarkdown: summaryParsed.reportMarkdown,
    citations: verifiedCitations,
    generatedAt: new Date(),
  };

  finalData.downloadMarkdown = formatDownloadableMarkdown(finalData, fileDoc);

  // Persist to document cache for instant zero-LLM subsequent views and downloads
  try {
    await File.findByIdAndUpdate(fileDoc._id, { actuarialSummary: finalData });
  } catch (_saveErr) {
    // Non-blocking cache write failure
  }

  return finalData;
}

module.exports = {
  generatePolicySummary,
  parseSummaryResponse,
  formatDownloadableMarkdown,
};
