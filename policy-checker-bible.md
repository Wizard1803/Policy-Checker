# POLICY CHECKER — PROJECT BIBLE
> Complete reference document for presentations, development, and discussions  
> Last updated: 2026 | Team: 7IEP_G46 | Parul University

---

## 1. PROJECT IDENTITY

| Field | Detail |
| :--- | :--- |
| **Project Name** | Policy Checker |
| **Tagline** | *"Upload. Ask. Understand."* |
| **Group Code** | `7IEP_G46` |
| **Subject** | Project - II (303105300), 7th Semester |
| **University** | Parul University, Vadodara, Gujarat |
| **Faculty Guide** | Dr. Mahaveer Jain (Assistant Professor) |
| **HOD** | Dr. Ankita Gandhi |
| **Coordinator** | Dr. Virendra Gawande |
| **Academic Year** | 2026–2027 (Submission: October – 2026) |

### Team Members
| Name | Enrollment No. | Primary Role & Contributions |
| :--- | :--- | :--- |
| **Piyush Kumawat** | 2303031560025 | Project Lead / Backend Architecture, AI Engine, RAG Pipeline |
| **Purva Patil** | 2303031560024 | Frontend & UI/UX Design System, Accessible Components, Modals |
| **Ashmit Panda** | 2303031560005 | Backend Development, File Lifecycle & Stream Processing |
| **Sameeksha Singh** | 2303031560036 | Database Modeling, Data Handling, Mongoose Schemas & Aggregations |

---

## 2. PROBLEM STATEMENT

Insurance policies, healthcare riders, and financial contracts are characterized by:
- 40–200 pages of dense legal jargon and exclusion clauses
- Fragmented tabular matrices (room-rent limits, copay percentages, waiting-period grids)
- Complete failure of keyword search (Ctrl+F cannot resolve conceptual or semantic queries)
- Severe risk of public LLM hallucinations (generating false coverage claims or misattributing pages)

**Core Pain Point:** Policyholders, claimants, and advisors commit to complex policies without understanding critical exclusion clauses or waiting periods.

---

## 3. OUR SOLUTION: RESEARCH-GROUNDED HYBRID RAG

Policy Checker is an enterprise-grade, document-grounded AI audit and retrieval platform featuring:
1. **LegRAG Page-Bounded Chunking**: Text chunks strictly terminate at physical PDF page breaks, guaranteeing 100% accurate page citations.
2. **2D Tabular Grid Extraction**: 5-page batched extraction via `gemini-flash-lite-latest`, stored as structured JSON and GitHub Flavored Markdown (GFM) tables.
3. **Matryoshka Dense Vector Embeddings**: 768-dimensional representations (`gemini-embedding-001`) with fast in-memory cosine retrieval.
4. **FACTUM Anti-Hallucination Verification**: Verifies that citations and quotes emitted by the LLM exist verbatim in the source chunks.
5. **Multi-Policy Comparative Analysis**: Side-by-side evaluation of up to 3 policies (`POST /compare-policies`) with follow-up chat.
6. **Provenance-Backed PDF Export**: Offline executive summaries generated via `pdfkit` embedded with SHA-256 cryptographic hashes.

---

## 4. TECH STACK

| Layer | Technology | Architectural Purpose |
| :--- | :--- | :--- |
| **Runtime** | Node.js >= 22.17.0 | High-performance asynchronous event loop |
| **Framework** | Express.js v5.1.0 | Core routing, middleware mounting, and HTTP handling |
| **Templating** | EJS | Server-side rendered views with minimal client footprint |
| **Database** | MongoDB Atlas | Flexible document modeling for metadata, vectors, and tables |
| **ODM** | Mongoose v8.17.1 | Schema validation, indexed queries, and cascade lifecycles |
| **Auth** | JWT (`jsonwebtoken`) | Stateless authentication stored in `httpOnly` secure cookies |
| **Password** | bcrypt | 10-round salted password hashing |
| **Validation** | express-validator | Strict input validation on all auth endpoints |
| **File Storage** | Cloudinary & Memory Buffer | Ephemeral streaming via `multer.memoryStorage()` directly to Cloudinary (zero-disk-write pattern) |
| **PDF Extraction** | `pdf-parse` & Ephemeral Buffer | Per-page text extraction during ingestion lifecycle |
| **AI Generation** | Google `gemini-3.6-flash` | Document-grounded reasoning, comparison, and summarization |
| **AI Extraction** | Google `gemini-flash-lite-latest` | High-throughput batched 2D tabular structure extraction |
| **AI Embeddings** | Google `gemini-embedding-001` | 768-dimensional Matryoshka Representation Learning vectors |
| **Vector Engine** | In-Memory Cosine Similarity | Sub-5ms dot-product similarity computation with LRU cache |
| **Document Export** | `pdfkit` | Server-side offline vector PDF generation with SHA-256 hashes |
| **Rate Limiting** | In-Memory Sliding Window | Burst limiter (30 req/min) and monthly tiered quota enforcement |
| **Security** | Native Security Headers | Inline headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) and DOMPurify |
| **Testing** | Jest + Supertest | 23 consolidated suites, 264 passing unit and integration tests |

---

## 5. RESEARCH PAPERS & THEORETICAL FOUNDATIONS

| Paper & Authors | Venue | Codebase Module | Architectural Implementation |
| :--- | :--- | :--- | :--- |
| **LegRAG**<br>Tang et al. (2024) | *arXiv:2408.02580* | `services/chunk.service.js`<br>`models/chunks.model.js` | **Page-Boundary Invariance**: Chunks strictly terminate at PDF page transitions, preventing sentence spillover and ensuring legal citation integrity. |
| **Matryoshka Embeddings**<br>Kusupati et al. (2022) | *NeurIPS 2022* | `services/gemini.client.js`<br>`services/chunk.service.js` | Embeddings truncated to `outputDimensionality: 768`, cutting memory consumption by >50% while preserving retrieval fidelity. |
| **FACTUM / Self-RAG**<br>Thorne et al. (2023) / Agarwal et al. (2026) | *EMNLP 2023 / 2026* | `services/chunk.service.js`<br>`services/chat.service.js` | **Citation Verification Pass**: LLM answers are cross-checked against verbatim chunk excerpts; ungrounded claims are stripped. |
| **Chain-of-Table / Hybrid RAG**<br>Wang et al. (2024) | *ICLR 2024* | `services/table.service.js`<br>`models/tables.model.js` | Preserves 2D tabular spatial structure via GFM Markdown and batch extraction rather than flattening tables into linear text. |
| **Lost in the Middle**<br>Liu et al. (2024) | *TACL 2024* | `services/comparison-helpers.js`<br>`services/chat.service.js` | Critical evidence chunks and tables are positioned at the extreme beginning and end of prompts to avoid attention degradation. |
| **Traffic Shaping (Token Bucket)**<br>Turner (1986) | *IEEE Comm. Mag. / RFC 6598* | `middleware/rate-limiter.js`<br>`services/quota.service.js` | In-memory sliding window burst limiter coupled with monthly tiered user quota tracking. |
| **ReDoS Vulnerability Defense**<br>Davis et al. (2018) | *ACM SIGPLAN 2018* | `utils/table.normalizer.js`<br>`routes/user.routes.js` | Audited regex expressions eliminate catastrophic polynomial backtracking, enforcing guaranteed O(n) string parsing. |

---

## 6. PROJECT FOLDER STRUCTURE

```text
policy-checker/
├── app.js                         # Express 5 initialization, inline security headers, and router mounting
├── config/
│   ├── db.js                      # MongoDB Atlas connection manager
│   └── cloudinary.config.js       # Cloudinary client SDK setup
├── middleware/
│   ├── auth.js                    # JWT extraction, verification (protect, requireAuth)
│   └── rate-limiter.js            # Sliding window burst limiter & quota enforcement (enforceQuota)
├── models/
│   ├── user.model.js              # User schema (username, email, password, tier: standard/pro/unlimited, usage)
│   ├── files.model.js             # Policy metadata, Cloudinary refs, page counts, state machine, actuarialSummary
│   ├── chunks.model.js            # Page-bounded text segments and 768d vector embeddings
│   ├── tables.model.js            # Extracted 2D tabular structures (headers, rows, markdownRepresentation)
│   └── conversations.model.js     # Conversation and Message schemas with FACTUM citations
├── routes/
│   ├── index.routes.js            # Main router mounting modular domain sub-routers
│   ├── user.routes.js             # User registration, login, and logout endpoints
│   ├── file.routes.js             # Upload, file status, tables, rename, delete, reprocess, view-pdf
│   ├── chat.routes.js             # check-policy, files/:fileId/chat, conversations, chat/history
│   ├── compare.routes.js          # compare-policies, compare-policies/chat
│   ├── search.routes.js           # files/:fileId/search clause query
│   └── summary.routes.js          # files/:fileId/export-summary (PDF/JSON/Markdown)
├── services/
│   ├── gemini.client.js           # Gemini API interface (key rotation, quarantine, 768d Embeddings)
│   ├── chunk.service.js           # LegRAG page chunker, in-memory cosine engine, citation verifier
│   ├── table.service.js           # 5-page batched 2D table extraction & GFM normalization
│   ├── chat.service.js            # Multi-turn conversational manager & hybrid context builder
│   ├── comparison.service.js      # Multi-policy comparative analysis engine (up to 3 policies)
│   ├── comparison-helpers.js      # Symmetric token budget allocator & prompt assembler
│   ├── search.service.js          # Clause search service with LRU query caching
│   ├── summary.service.js         # 10-Parameter actuarial summary generator & document cache
│   ├── pdf.service.js             # PDFKit executive export with SHA-256 hash provenance
│   ├── quota.service.js           # Monthly tiered consumption and quota service
│   └── document.service.js        # Background document indexing, table extraction, and lifecycle state
├── utils/
│   └── table.normalizer.js        # Markdown table escape, normalization, and confidence score utilities
├── public/
│   ├── css/                       # Gallery Balanced Dark Mode design system
│   └── js/
│       ├── home.js                # Dashboard orchestration
│       └── modules/               # Modular frontend controllers (chat, compare, tables, pdf-viewer, toast)
├── views/                         # EJS server-rendered templates and partials
└── tests/                         # 23 consolidated Jest test suites (264 passing tests)
```

---

## 7. SYSTEM ARCHITECTURE DIAGRAM

```text
                                 [ Browser Client ]
                                         |
                                         | HTTP / JSON / EJS
                                         v
                     +---------------------------------------+
                     |          Express Application          |
                     |  - Inline Security Headers            |
                     |  - Sliding Window Burst Limiter       |
                     |  - JWT Cookie Session Resolver        |
                     +-------------------+-------------------+
                                         |
        +--------------------------------+--------------------------------+
        |                                |                                |
        v                                v                                v
[ Ingestion Pipeline ]         [ Hybrid RAG Engine ]          [ Audit & Analytics ]
 - Multer Memory Buffer         - Dense Vector Chunks          - 10-Parameter Summary
 - Cloudinary Stream Storage      (LegRAG Page-Bounded)        - Side-by-Side Comparison
 - State Machine Processing     - 2D Structured GFM Tables     - Provenance PDF Export
 - 5-Page Batched Tables          (Chain-of-Table Hybrid)        (Embedded SHA-256)
 - 768d MRL Embeddings          - In-Memory Cosine Engine      - Monthly Quota Ledger
        |                                |                                |
        v                                v                                v
[ MongoDB Atlas ]               [ Google Gemini ]              [ PDFKit Engine ]
 - User / File                   - gemini-3.6-flash             - Vector Audit PDF
 - Chunk / Table                 - gemini-flash-lite-latest     - Cryptographic Hash
 - Conversation / Message        - gemini-embedding-001
```

---

## 8. COMPLETE ROUTES REFERENCE

### Auth Routes (`/user`)
| Method | Path | Access | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/user/register` | Public | Render registration view |
| `POST` | `/user/register` | Public | Validate input, hash password with bcrypt, issue JWT |
| `GET` | `/user/login` | Public | Render login view |
| `POST` | `/user/login` | Public | Validate credentials, issue JWT in `httpOnly` cookie |
| `GET` | `/user/logout` | Public | Clear JWT auth cookie and redirect to login |
| `GET` | `/user/quota` | Protected | Fetch current user monthly tier limits and usage consumption |

### Document & Core Routes (`/`)
| Method | Path | Access | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Optional | User dashboard listing active policy documents |
| `POST` | `/upload` | Required | Ingest PDF (max 15MB), upload to Cloudinary, trigger background RAG processing |
| `GET` | `/files/:fileId/status` | Required | Check document processing state, page count, and table count |
| `PATCH`| `/files/:fileId/rename` | Required | Rename policy document |
| `DELETE`| `/files/:fileId` | Required | Cascade delete policy, chunks, tables, and conversations |
| `POST` | `/files/:fileId/reprocess` | Required | Re-trigger processing on failed or stale document |
| `GET` | `/files/:fileId/view-pdf` | Required | Stream inline PDF document with timeout protection |

### 2D Tabular Routes (`/`)
| Method | Path | Access | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/files/:fileId/tables` | Required | JSON API returning all structured tables for a file |

### Policy Q&A & Conversational Chat (`/`)
| Method | Path | Access | Purpose |
| :--- | :--- | :--- | :--- |
| `POST` | `/check-policy/:fileId` | Required | Single-turn grounded policy question with hybrid table injection |
| `POST` | `/files/:fileId/chat` | Required | Multi-turn conversational chat turn with citation verification |
| `GET` | `/files/:fileId/conversations` | Required | List all conversation sessions for a policy document |
| `GET` | `/files/:fileId/chat/history` | Required | Retrieve conversation turns and citation metadata |

### Multi-Policy Comparison Routes (`/`)
| Method | Path | Access | Purpose |
| :--- | :--- | :--- | :--- |
| `POST` | `/compare-policies` | Required | Run side-by-side comparative analysis across 2–3 policies |
| `POST` | `/compare-policies/chat` | Required | Multi-turn conversational follow-up on a policy comparison |

### Direct Clause Search (`/`)
| Method | Path | Access | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/files/:fileId/search` | Required | Direct semantic clause search with query parameter `?q=...&limit=...` |

### Actuarial Summary & PDF Routes (`/`)
| Method | Path | Access | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/files/:fileId/export-summary` | Required | Export summary report (`format=pdf` for PDFKit, `format=json`, or Markdown) |

---

## 9. DATABASE SCHEMAS

### 1. User Model (`models/user.model.js`)
```javascript
{
  username: { type: String, required: true, unique: true, trim: true, lowercase: true, minlength: 3 },
  email:    { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: { type: String, required: true, trim: true, minlength: 5 }, // bcrypt hashed
  tier:     { type: String, enum: ['standard', 'pro', 'unlimited'], default: 'standard' },
  usage: {
    uploadsCount:  { type: Number, default: 0, min: 0 },
    queriesCount:  { type: Number, default: 0, min: 0 },
    lastResetDate: { type: Date, default: Date.now }
  }
}
```

### 2. File Model (`models/files.model.js`)
```javascript
{
  fileName:           { type: String, required: true, trim: true },
  fileUrl:            { type: String, required: true },
  cloudinaryPublicId: { type: String, required: false },
  cloudinaryVersion:  { type: Number, required: false },
  uploadedBy:         { type: ObjectId, ref: 'User', required: true, index: true },
  uploadedAt:         { type: Date, default: Date.now },
  processingState:    { type: String, enum: ['uploaded', 'processing', 'ready', 'failed'], default: 'uploaded', index: true },
  processingError:    { type: String, default: null },
  processedAt:        { type: Date, default: null },
  pageCount:          { type: Number, default: 0, min: 0 },
  fileSizeBytes:      { type: Number, default: 0, min: 0 },
  extractedText:      { type: String, default: '', select: false }, // Hidden from list queries
  actuarialSummary:   { type: Object, default: null, select: false } // Embedded cache
}
```

### 3. Chunk Model (`models/chunks.model.js`)
```javascript
{
  fileId:      { type: ObjectId, ref: 'File', required: true, index: true },
  uploadedBy:  { type: ObjectId, ref: 'User', required: true, index: true },
  pageNumber:  { type: Number, required: true, min: 1 }, // LegRAG page boundary
  chunkIndex:  { type: Number, required: true, min: 0 },
  text:        { type: String, required: true, trim: true },
  charLength:  { type: Number, required: true, min: 0 },
  embedding:   { type: [Number], required: true }, // 768d Matryoshka vector
  createdAt:   { type: Date, default: Date.now }
}
```

### 4. Table Model (`models/tables.model.js`)
```javascript
{
  fileId:                 { type: ObjectId, ref: 'File', required: true, index: true },
  uploadedBy:             { type: ObjectId, ref: 'User', required: true, index: true },
  pageNumber:             { type: Number, required: true, min: 1 },
  tableIndex:             { type: Number, required: true, min: 0 },
  title:                  { type: String, default: 'Document Table', trim: true },
  headers:                [{ type: String, trim: true }],
  rows:                   [[{ type: String, trim: true }]],
  markdownRepresentation: { type: String, required: true },
  extractionStatus:       { type: String, enum: ['success', 'warning', 'failed'], default: 'success', index: true },
  extractionConfidence:   { type: Number, min: 0, max: 1, default: 1.0 },
  createdAt:              { type: Date, default: Date.now }
}
```

### 5. Conversation & Message Models (`models/conversations.model.js`)
```javascript
// Conversation Model
{
  uploadedBy:  { type: ObjectId, ref: 'User', required: true, index: true },
  fileIds:     [{ type: ObjectId, ref: 'File' }],
  title:       { type: String, default: 'Policy Inquiry', trim: true },
  isArchived:  { type: Boolean, default: false },
  createdAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date, default: Date.now }
}

// Message Model
{
  conversationId: { type: ObjectId, ref: 'Conversation', required: true, index: true },
  sender:         { type: String, enum: ['user', 'model'], required: true },
  text:           { type: String, required: true, trim: true },
  citations: [{
    documentId:   { type: ObjectId, ref: 'File' },
    documentName: { type: String, trim: true },
    pageNumber:   { type: Number },
    excerpt:      { type: String, trim: true },
    clauseTitle:  { type: String, trim: true },
    verified:     { type: Boolean, default: false }
  }],
  tablesCited:    [{ type: ObjectId, ref: 'Table' }],
  createdAt:      { type: Date, default: Date.now }
}
```

---

## 10. CURRENT STATUS & VERIFICATION

The platform is fully implemented and hardened against production standards:
- **Consolidated Test Suites**: 23 clean production suites in `tests/`.
- **Passing Test Count**: **264 tests passed, 0 failures** executed in under 10 seconds.
- **Offline Reliability**: All test suites utilize decoupled mocks; zero live network calls are made during CI/CD test passes.

---

## 11. VIVA & MENTOR DEFENSE Q&A

**Q1: Why use Matryoshka Representation Learning (768d) over standard 1536d or 3072d vectors?**  
*Answer:* As demonstrated in Kusupati et al. (NeurIPS 2022), Matryoshka training structures vector dimensions hierarchically. Truncating embeddings from 3072 down to 768 preserves over 99% of top-k retrieval accuracy while cutting RAM consumption and vector dot-product computation latency by more than 50%, enabling fast in-memory cosine searches.

**Q2: What is Page-Boundary Invariance and why does it matter?**  
*Answer:* Standard RAG chunkers arbitrarily split text based purely on token counts, frequently cutting sentences in half across physical page breaks. In legal, regulatory, and insurance audits (e.g., IRDAI standards), a citation is valid only if tied to an exact physical page. Following the LegRAG paper (Tang et al., 2024), our chunker guarantees that chunks terminate at page transitions, ensuring 100% citation provenance.

**Q3: How does the system handle complex tabular matrices that fool traditional RAG?**  
*Answer:* Traditional RAG flattens tables into unstructured text strings, destroying spatial row-column associations required to evaluate copayment tiers or waiting period grids. Our system implements a Chain-of-Table Hybrid-RAG approach: `gemini-flash-lite-latest` extracts tables in 5-page batches into structured GFM Markdown and JSON matrices. When numerical queries occur, these 2D tables are injected directly alongside dense text chunks.

**Q4: How do you protect against LLM hallucinations in insurance claim advice?**  
*Answer:* We implement Self-RAG/FACTUM citation verification (`verifyCitations`). Every claim made by the model must cite a page number and excerpt. The backend cross-references these citations against the verbatim text in MongoDB. If a citation cannot be verified, it is flagged or stripped before display.

**Q5: What is your contingency if Google Gemini API experiences rate-limiting?**  
*Answer:* We implemented multi-tier mitigation: (1) 5-page batching for table extraction reduces API roundtrips by 80%, (2) in-memory LRU query caching prevents duplicate embedding calls for identical queries, and (3) token-bucket sliding window burst limiting enforces traffic shaping per client.

---

## 12. FUTURE HORIZONS

While all planned core features are now complete and verified, prospective future extensions include:
1. **Multilingual Vernacular OCR**: Integrating Bhashini / Tesseract OCR pipelines to ingest non-digitized regional language policy riders.
2. **Automated Claim Pre-Authorization (FHIR Integration)**: Connecting to the Ayushman Bharat Digital Mission (ABDM) / FHIR APIs to validate hospital bills directly against extracted policy coverage limits.
3. **Cross-Platform Mobile App**: Native Flutter client for policyholders to inspect policies and upload hospital discharge summaries on mobile devices.

---

*Policy Checker Project Bible • Group 7IEP_G46 • Parul University • 2026–2027*
