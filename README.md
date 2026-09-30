# Policy Checker

> **Enterprise-Grade AI Insurance Policy Audit, Comparison & Retrieval Platform**  
> **Academic Identity:** Group `7IEP_G46` • Parul University • Project - II (303105300), 7th Semester • Academic Year 2026–2027  
> **Core Stack:** Node.js 22+, Express 5, MongoDB Atlas (Mongoose 8), Cloudinary, Google Gemini (`gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-flash-lite-latest`, `gemini-embedding-001`)

---

## 1. Executive Overview

**Policy Checker** is a document-grounded artificial intelligence platform designed to eliminate hallucinations when analyzing complex insurance policies, healthcare riders, and financial contracts.

Unlike standard conversational models that fabricate clauses or lose contextual accuracy over long documents, Policy Checker implements **Page-Bounded Vector RAG (LegRAG)**, **2D Structured Tabular Extraction (Chain-of-Table)**, and **FACTUM-style Citation Verification** to produce actuarially sound answers, multi-policy comparisons, and provenance-backed executive PDF audit reports.

---

## 2. Implemented Features

### Document Ingestion & Lifecycle
- **Multi-Tenant Ingestion**: Enforces strict MIME validation (`application/pdf`) and size ceiling limits (15MB via Multer memory storage).
- **Dual-Storage Pipeline**: Streams raw PDF assets directly to Cloudinary while buffering ephemeral memory streams.
- **Asynchronous State Machine**: Tracks document processing states (`uploaded` -> `processing` -> `ready` / `failed`) in `models/files.model.js`.
- **Inline PDF Streaming**: Dedicated streaming endpoint (`GET /files/:fileId/view-pdf`) serving raw documents with `AbortController` timeouts, cache control, and `X-Frame-Options: SAMEORIGIN` for seamless in-modal viewing.
- **Cascading Deletion**: Automatically cleans up associated vector chunks, 2D tabular grids, conversation threads, and remote Cloudinary files upon document deletion.
- **Background Pipeline & Recovery**: Startup orphan reconciliation (`reconcileOrphanedFiles`), document renaming (`PATCH /files/:fileId/rename`), and reprocessing (`POST /files/:fileId/reprocess`).

### 2D Structured Tabular Extraction & Normalization
- **Batched Vision/Text Table Extraction**: Detects candidate table pages via heuristic scoring (pipe/tab density, columnar alignment, insurance keywords) and extracts tables using `gemini-flash-lite-latest` in `services/table.service.js`.
- **Dual Representation**: Normalizes tabular grids into both queryable JSON row/column objects and clean GitHub Flavored Markdown (GFM) tables in `models/tables.model.js`.
- **Interactive Table Modal**: Real-time frontend inspection tool (`views/partials/modals/table-inspector-modal.ejs`, `public/js/modules/tables.js`) featuring responsive pagination and structured inspection (`GET /files/:fileId/tables`).

### Page-Bounded Vector Retrieval-Augmented Generation (RAG)
- **LegRAG Page-Boundary Invariance**: Chunks documents into ~350 word segments with 50 word overlap, **never crossing physical page boundaries** (`services/chunk.service.js`) to guarantee exact citation fidelity.
- **768-Dimensional Matryoshka Embeddings**: Generates dense semantic representations via `gemini-embedding-001` with `outputDimensionality: 768`, cutting memory overhead by over 50% without loss of retrieval precision.
- **In-Memory Cosine Similarity Engine**: Computes vector similarity in Node.js in sub-5ms without external vector database daemons.
- **Dual-Mode Hybrid Context Assembly**: Combines top-k dense semantic chunks with relevant structured 2D GFM tables and applies Lost-in-the-Middle re-ranking.
- **LRU In-Memory Cache**: High-performance LRU cache for query embeddings and top-k search results.

### Multi-Turn Conversational Policy Assistant (Chat)
- **Session-Scoped History**: Preserves conversation state and messages per document in MongoDB (`models/conversations.model.js`).
- **Sliding Context Window**: Injects the last 3 conversation turns (6 messages) into RAG context for coherent multi-turn reasoning (`services/chat.service.js`).
- **Autonomous Titling**: Automatically generates descriptive conversation titles on turn 1.
- **FACTUM Anti-Hallucination Verification**: Verifies citations and quotes emitted by the LLM against verbatim source text chunks.

### Multi-Policy Comparative Analysis
- **Side-by-Side Comparison**: Concurrently compares 2 to 3 insurance policies (`services/comparison.service.js`).
- **Interactive Floating Selection Bar**: Floating UI controller on dashboard for selecting candidate policies (`public/js/modules/compare.js`).
- **Symmetric Token Allocation**: Allocates equal context budgets across all compared policies to eliminate retrieval bias.
- **Structured Comparative Dimensions**: Evaluates Scope of Coverage, Key Limits, Room Rent Limits, Co-pays, Waiting Periods, Restoration Benefits, and Critical Exclusions.
- **Comparative Follow-Up Chat**: Enables interactive conversational follow-ups across the compared policies (`POST /compare-policies/chat`).

### Standalone Semantic Clause Search
- **Sub-Second Clause Querying**: Fast-path search engine (`services/search.service.js`, `GET /files/:fileId/search`).
- **Attribution & Scoring**: Provides relevance scoring, extracted text snippets, and verified page numbers.

### Actuarial Audit & PDF Provenance Export
- **10-Parameter Actuarial Summary**: Deep structural analysis across Scope of Coverage, Waiting Periods (Initial, Specific, Pre-Existing), Room Rent/ICU Caps, Co-payments, Pre/Post Hospitalization, and Critical Exclusions (`services/summary.service.js`).
- **Branded Offline PDF Generation**: Generates styled audit reports via `pdfkit` (`services/pdf.service.js`) using the Obsidian & Champagne visual theme.
- **Cryptographic Provenance**: Computes and embeds deterministic SHA-256 integrity hashes directly into report metadata and citations.
- **Multi-Format Export**: Supports export in `json`, `markdown`, and `pdf` (`GET /files/:fileId/export-summary`).

### Security, Multi-Tenancy & Quota Enforcement
- **Authentication & Tenant Isolation**: Stateless JWT auth in `httpOnly` secure cookies with bcrypt password hashing (10 salt rounds); all derived records scoped by `uploadedBy`.
- **Tiered Quota Ledger**: Enforces monthly tenant limits (`standard`: 15 uploads / 100 queries; `pro`: 50 uploads / 500 queries; `unlimited`) in `services/quota.service.js` with automated refunds on errors.
- **Sliding-Window Rate Limiting**: In-memory rate limiter (30 req/min default, 5-minute memory sweep) protecting public endpoints and AI inference paths (`middleware/rate-limiter.js`).
- **Security Headers & ReDoS Hardening**: Inline HTTP security headers (nosniff, SAMEORIGIN, strict referrer) and audited linear-time regular expressions.

---

## 3. Academic Foundations & Research Papers

| Theoretical Concept | Research Paper & Authors | Architecture Application in Codebase |
| :--- | :--- | :--- |
| **Page-Bounded Chunking** | *LegRAG: Retrieval-Augmented Generation for Legal Case Retrieval and Analysis* (Tang et al., 2024) | `services/chunk.service.js`<br>Chunks strictly terminate at physical PDF page breaks for legally sound citations. |
| **Compact Vector Embeddings** | *Matryoshka Representation Learning* (Kusupati et al., NeurIPS 2022) | `services/gemini.client.js`<br>Embeddings truncated to 768 dimensions using `gemini-embedding-001`. |
| **Hallucination Verification** | *Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection* (Asai et al., ICLR 2024) | `services/chunk.service.js`<br>`verifyCitations()` cross-checks LLM citations against verbatim source chunks. |
| **Tabular Reasoning** | *Chain-of-Table: Evolving Tables in the Reasoning Step* (Wang et al., ICLR 2024) / Hybrid-RAG | `services/table.service.js`<br>Preserves 2D tabular spatial structure via GFM Markdown and batch extraction. |
| **Attention Distribution** | *Lost in the Middle: How Language Models Use Long Contexts* (Liu et al., TACL 2024) | `services/comparison-helpers.js`<br>Places high-priority evidence and tables at outer prompt boundaries. |
| **Traffic Shaping** | *An Algorithm for Traffic Shaping and Policing* (Turner, 1986 / RFC 6598) | `middleware/rate-limiter.js`<br>Token-bucket algorithm for per-IP burst protection and quota policing. |
| **ReDoS Defense** | *Why Aren't Regular Expressions Safe?* (Davis et al., ACM SIGPLAN 2018) | `utils/table.normalizer.js`<br>Guarantees O(n) evaluation time against catastrophic backtracking attacks. |

---

## 4. API & Route Reference

### Authentication & Account (`/user`)
| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/user/register` | Public | Render user registration form |
| `POST` | `/user/register` | Public | Create new account, hash password, set JWT cookie |
| `GET` | `/user/login` | Public | Render user login form |
| `POST` | `/user/login` | Public | Verify credentials, set JWT cookie, redirect to dashboard |
| `GET` | `/user/logout` | Public | Clear JWT authentication cookie |
| `GET` | `/user/quota` | Protected | Fetch current user monthly tier limits and usage consumption |

### Document Management & Inline Viewer (`/`)
| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Protected | Dashboard: Displays user policies, table counts, and usage stats |
| `POST` | `/upload` | Protected | Multipart PDF upload (max 15MB), Cloudinary stream, and chunk ingestion |
| `GET` | `/files/:fileId/status` | Protected | Fetch current processing state, page count, and table count |
| `GET` | `/files/:fileId/tables` | Protected | JSON API returning all extracted 2D tables for a document |
| `PATCH` | `/files/:fileId/rename` | Protected | Rename document metadata |
| `POST` | `/files/:fileId/reprocess` | Protected | Reset state and re-trigger extraction pipeline |
| `DELETE`| `/files/:fileId` | Protected | Cascade delete policy, Cloudinary file, chunks, tables, and conversations |
| `GET` | `/files/:fileId/view-pdf` | Protected | Stream raw PDF inline with `X-Frame-Options: SAMEORIGIN` for modal inspection |

### Conversational Chat & Q&A (`/`)
| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/files/:fileId/chat` | Protected | Multi-turn RAG chat turn with hybrid retrieval and verified citations |
| `GET` | `/files/:fileId/conversations` | Protected | List all conversation sessions for a policy document |
| `GET` | `/files/:fileId/chat/history` | Protected | Fetch conversation history and turn metadata |
| `POST` | `/check-policy/:fileId` | Protected | Single-turn grounded policy question endpoint (legacy fallback) |

### Multi-Policy Comparison (`/`)
| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/compare-policies` | Protected | Side-by-side comparison across 2 to 3 selected policies |
| `POST` | `/compare-policies/chat` | Protected | Multi-document follow-up chat turn across compared policies |

### Semantic Clause Search (`/`)
| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/files/:fileId/search` | Protected | Sub-second clause search with relevance attribution and page numbers |

### Actuarial Summary & PDF Export (`/`)
| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/files/:fileId/export-summary` | Protected | Export 10-parameter actuarial summary in `json`, `markdown`, or `pdf` (PDFKit) |

---

## 5. Environment Configuration

Create a `.env` file in the project root:

```ini
# Server Configuration
PORT=3000
NODE_ENV=development

# Database
ATLAS_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/policy-checker?retryWrites=true&w=majority

# Authentication
JWT_SECRET=your_super_secret_jwt_signing_key_here

# Cloudinary Storage
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret

# Google Gemini AI
GEMINI_API_KEY=your_google_gemini_api_key
GEMINI_MODEL=gemini-3.6-flash
```

---

## 6. Local Setup & Testing

### Installation
```bash
# Clone the repository
git clone https://github.com/Piyush-770/Policy-Checker.git
cd policy-checker

# Install dependencies
npm install
```

### Running the Application
```bash
# Start the production server
npm start

# Or start with nodemon during development
npx nodemon app.js
```
The application will be accessible at `http://localhost:3000`.

### Running Verification Tests
The project features **23 consolidated production test suites** covering unit, integration, and security paths with 100% offline mocks (no live API consumption):

```bash
npm test
```

Expected output:
```text
Test Suites: 23 passed, 23 total
Tests:       264 passed, 264 total
Snapshots:   0 total
Time:        ~25 s
```

---

## 7. Project Structure

```text
policy-checker/
├── app.js                         # Application entry point & middleware mounting
├── config/
│   ├── db.js                      # MongoDB Atlas connection lifecycle
│   └── cloudinary.config.js       # Cloudinary SDK client configuration
├── middleware/
│   ├── auth.js                    # JWT verification & session resolution
│   └── rate-limiter.js            # Sliding-window rate limiter & quota enforcement
├── models/
│   ├── user.model.js              # User credentials, tier, and usage ledger
│   ├── files.model.js             # Policy document metadata & lifecycle state
│   ├── chunks.model.js            # Page-bounded text chunks & 768d vector embeddings
│   ├── tables.model.js            # Extracted 2D tabular structures (JSON & Markdown)
│   └── conversations.model.js     # Multi-turn conversation sessions & messages
├── routes/
│   ├── index.routes.js            # Main dashboard route & router aggregator
│   ├── file.routes.js             # Document upload, status, tables, view-pdf, rename, delete
│   ├── chat.routes.js             # Multi-turn chat, history, and single Q&A
│   ├── compare.routes.js          # Multi-policy comparison & follow-up chat
│   ├── summary.routes.js          # Actuarial audit export (json, markdown, pdf)
│   ├── search.routes.js           # Semantic clause search endpoint
│   └── user.routes.js             # Authentication endpoints (register, login, logout)
├── services/
│   ├── gemini.client.js           # Gemini API client (Flash 3.6/3.5, Flash Lite, 768d Embeddings)
│   ├── document.service.js        # Ingestion pipeline, PDF extraction, reprocess, cascade delete
│   ├── chunk.service.js           # Page-bounded chunker, cosine engine & citation verification
│   ├── table.service.js           # Batched 2D table extraction & GFM normalization
│   ├── chat.service.js            # Multi-turn dialogue management & context builder
│   ├── comparison.service.js      # Cross-policy comparative evaluation engine
│   ├── comparison-helpers.js      # Symmetric token allocation & prompt layout
│   ├── search.service.js          # Clause search engine with LRU caching
│   ├── summary.service.js         # 10-parameter actuarial analysis generator
│   ├── pdf.service.js             # PDFKit executive export with SHA-256 provenance
│   └── quota.service.js           # Tiered monthly consumption tracker
├── utils/
│   └── table.normalizer.js        # Markdown table escaping, confidence scoring, and normalization
├── public/
│   ├── css/                       # Vanilla CSS design system (Obsidian & Champagne theme)
│   └── js/
│       ├── home.js                # Dashboard orchestration
│       └── modules/               # Modular frontend controllers (chat, compare, tables, pdf-viewer, toast)
├── views/                         # EJS server-rendered views & partials
└── tests/                         # 23 Consolidated Jest test suites (264 tests)
```

---

## 8. Academic Attribution

- **Institution**: Parul University, Vadodara, Gujarat
- **Department**: Department of Computer Science & Engineering (CSE-IEP), PIET
- **Subject**: Project - II (303105300), 7th Semester Major Project
- **Group Code**: `7IEP_G46`
- **Academic Year**: 2026–2027 (Submission: October – 2026)
- **Faculty Guide**: Dr. Mahaveer Jain (Assistant Professor)
- **Coordinator**: Dr. Virendra Gawande
- **Head of Department**: Dr. Ankita Gandhi

### Team Members & Contributions
| Name | Enrollment No. | Role & Core Contributions |
| :--- | :--- | :--- |
| **Purva Patil** | 2303031560024 | Frontend & UI/UX Design System, Accessible Components, Client Modals |
| **Piyush Kumawat** | 2303031560025 | Project Lead / Backend Architecture, AI Engine, Security, Authentication, RAG Pipeline |
| **Ashmit Panda** | 2303031560005 | Backend Development, Route Controllers, File Lifecycle & Stream Processing |
| **Sameeksha Singh** | 2303031560036 | Database Modeling, Data Handling, Mongoose Schemas & Aggregation Pipelines |
