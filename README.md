<div align="center">

# 🧠 Repo-Mind

### AI-Powered GitHub Repository Knowledge Assistant

[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-4.18-000000?style=for-the-badge&logo=express)](https://expressjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?style=for-the-badge&logo=postgresql)](https://neon.tech/)
[![Redis](https://img.shields.io/badge/Redis-Upstash-DC382D?style=for-the-badge&logo=redis)](https://upstash.com/)
[![Pinecone](https://img.shields.io/badge/Pinecone-Vector_DB-000000?style=for-the-badge)](https://www.pinecone.io/)
[![Groq](https://img.shields.io/badge/Groq-Multi--LLM_Cascade-F55036?style=for-the-badge)](https://groq.com/)
[![Evaluation Suite](https://img.shields.io/badge/Eval_Suite-Hit@1_|_Hit@3_|_Hit@5-success?style=for-the-badge)](https://github.com/anurudddhhh/repo-mind)

**Repo-Mind** is a production-grade full-stack application that lets you **chat with any GitHub repository** using AI. It parses code into Abstract Syntax Trees, generates semantic embeddings, utilizes a **Hybrid Search Engine (Semantic Vectors + Weighted Keywords + Reciprocal Rank Fusion)**, and provides line-level citations with interactive architectural visualizations.

[Features](#-features) · [System Architecture](#-system-architecture) · [Evaluation Suite](#-retrieval-evaluation-suite-eval-set) · [Tech Stack](#-tech-stack) · [Getting Started](#-getting-started) · [Environment Variables](#-environment-variables) · [Project Structure](#-project-structure) · [How It Works](#-how-it-works) · [API Reference](#-api-reference) · [Key Decisions](#-key-engineering-decisions) · [Contributing](#-contributing) · [License](#-license)

</div>

---

## 🎬 Live Demo

> **See Repo-Mind in action!** Watch the full walkthrough demo showcasing repository indexing, AI chat with citations, architecture visualization, and more.

<div align="center">

[![Watch Demo](https://img.shields.io/badge/▶_Watch_Live_Demo-Google_Drive-4285F4?style=for-the-badge&logo=googledrive&logoColor=white)](https://drive.google.com/file/d/17Egb199UGtcNjZQSeTYP46ZgTSgAAGqR/view?usp=drive_link)

</div>

---

## 📋 Table of Contents

- [Live Demo](#-live-demo)
- [Features](#-features)
- [System Architecture](#-system-architecture)
- [Retrieval Evaluation Suite (Eval Set)](#-retrieval-evaluation-suite-eval-set)
- [Tech Stack](#-tech-stack)
- [How It Works](#-how-it-works)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Project Structure](#-project-structure)
- [API Reference](#-api-reference)
- [Key Engineering Decisions](#-key-engineering-decisions)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Features

### 1. 🔐 GitHub OAuth Authentication
Secure login via GitHub OAuth 2.0 allowing users to authenticate and access both their **public and private repositories**. Sessions are managed using JWT tokens with configurable expiry (default: 7 days) and direct database lookups.

### 2. 🌳 Repository Indexing & Semantic AST Parsing
Uses **web-tree-sitter** (WebAssembly-based) to parse code into Abstract Syntax Trees (ASTs). Unlike naive line-splitting, Repo-Mind implements **semantic chunking**:
- Extracts whole functions, classes, methods, interfaces, and module exports as atomic code units.
- Preserves accurate start-and-end line numbers for granular attribution.
- Builds a **cross-file dependency graph** by analyzing `import` and `require` statements before generating vector embeddings.

### 3. 🔍 Hybrid Search Engine (Vector + Keyword + Reciprocal Rank Fusion)
A multi-tier retrieval engine that combines:
1. **Semantic Vector Search (Pinecone)**: 384-dimensional dense vectors generated via `sentence-transformers/all-MiniLM-L6-v2` with a cosine similarity floor (`>= 0.25`).
2. **Weighted Keyword Search (PostgreSQL)**: Exact identifier matching across field weights (`filePath: 3.0`, `name: 2.0`, `content: 0.5`) with stop-word removal.
3. **Reciprocal Rank Fusion (RRF)**: Merges vector and keyword candidate lists using standard rank fusion ($k = 60$) and applies a 1.2x boost for primary source code extensions (`.ts`, `.tsx`, `.py`, `.js`, etc.).
4. **Intent-Aware Noise Filtering**: Automatically eliminates non-code noise (READMEs, lockfiles, configs, and `.css`/boilerplate `.html`) unless the query specifically requests styling or markup.

### 4. 💬 Chat with Repository & Line-Level Citations
Real-time **Server-Sent Events (SSE)** streaming chat powered by Groq:
- **Line-Level Citation Badges**: Statements cite source files inline (e.g., `[1]`, `[2]`, `[1, 2]`).
- **Interactive Tooltip Previews**: Hovering over any citation badge reveals the exact file path, line range (e.g., `Lines 45–82`), language, and a preview of the source snippet.
- **Dynamic Retrieved Sources Panel**: Displays all retrieved context chunks below the chat and highlights cited files with an active `"cited"` tag.

### 5. 🛡️ High-Availability Multi-LLM Cascade Fallback
To ensure 100% uptime and resist Groq API 429 rate-limit spikes:
- Automatically cascades through an ordered model chain:
  `Primary Model (120B / 70B)` ➔ `High-Speed 20B Fallback` ➔ `20B Safeguard Backup`
- Retries seamlessly across models if token limits or outages occur.

### 6. 🧪 Retrieval Evaluation Suite & Ground-Truth Benchmark
Built-in evaluation framework (`backend/src/eval/`) measuring search quality:
- Curated benchmark dataset of **25 ground-truth questions** spanning 9 architectural categories (`auth`, `chunking`, `embedding`, `search`, `chat`, `analysis`, `ai`, `caching`, `indexing`).
- Computes **Hit@1**, **Hit@3**, and **Hit@5** metrics.
- Normalizes path variations (exact, suffix, basename) and produces category-by-category breakdown tables.

### 7. 🏗️ Architecture Summary & Module Mapping
AI-generated high-level system architecture and module breakdown. Automatically analyzes the codebase structure, identifies core modules, maps dependencies, and produces a comprehensive technical overview.

### 8. 🐛 Bug & Vulnerability Detection
AI-assisted code analysis that inspects code chunks for:
- Security vulnerabilities and injection risks
- Bad coding practices and antipatterns
- Potential runtime exceptions and unhandled promises
- Performance bottlenecks and memory risks
Each issue includes severity, exact file location, description, and an actionable fix snippet.

### 9. 📝 AI Documentation Generator
Generates comprehensive developer documentation directly from AST structures and source logic:
- Inline function and class documentation
- Technical module breakdowns
- High-level architectural overviews

### 10. 📊 Commit History & Velocity Analysis
Queries the GitHub API to deliver intelligent summaries of:
- Recent commit activity and code change trajectories
- Contributor activity and commit velocity
- Hotspots and frequently edited files

### 11. 📐 Interactive Architecture Visualization (Mermaid.js)
Transforms the AST dependency graph into interactive **Mermaid.js** flowcharts directly inside the chat and repository views:
- **Dynamic On-Demand Loading**: `mermaid` (~300 kB) is loaded asynchronously only when diagram syntax is detected, keeping route bundles light.
- Renders file import/export relationships, module dependencies, and request flows.

### 12. ⚡ Memory-Optimized Micro-Batching & Resilient SSE Streaming
Engineered to operate reliably within a tight **512MB RAM ceiling** (cloud free tier):
- Micro-batched embedding pipeline with explicit event-loop yielding (`setImmediate`) to prevent memory spikes.
- Disconnect-resilient SSE streaming with automatic keep-alive heartbeats and frontend polling fallback.
- Post-indexing verification polling loop in Dashboard to handle database connection-pool propagation delay without manual page refreshes.

### 13. 🔌 Zero-Config Local Development DNS Bridge
A built-in development TCP proxy in `backend/env-loader.js` that bypasses local ISP DNS blocks (e.g., JioFiber refusing `.tech` domains) by proxying Neon PostgreSQL traffic via public DNS (`8.8.8.8`).
- Strictly activates only during local development (`NODE_ENV !== 'production'`).
- 100% no-op in production.

---

## 🏛️ System Architecture

```
╔═══════════════════════════════════════════════════════════════════════════════════╗
║                         REPO-MIND SYSTEM ARCHITECTURE                             ║
╚═══════════════════════════════════════════════════════════════════════════════════╝

  ┌─────────────────────────────────────────────────────────────────────────────┐
  │                              USER'S BROWSER                                 │
  │                                                                             │
  │  ┌───────────────────────────────────────────────────────────────────────┐  │
  │  │                   NEXT.JS 14 FRONTEND (App Router)                    │  │
  │  │                                                                       │  │
  │  │  ┌───────────┐  ┌──────────┐  ┌───────────┐  ┌─────────────────────┐  │  │
  │  │  │ Auth Pages│  │ Chat UI  │  │Code Viewer│  │ Dynamic Mermaid.js  │  │  │
  │  │  │ (OAuth)   │  │(SSE+Cites│  │ (Search)  │  │ (On-Demand Bundle)  │  │  │
  │  │  └─────┬─────┘  └────┬─────┘  └─────┬─────┘  └──────────┬──────────┘  │  │
  │  │        │              │              │                  │             │  │
  │  │  ┌─────▼──────────────▼──────────────▼──────────────────▼──────────┐  │  │
  │  │  │          DECOUPLED API SERVICE LAYER (api.ts)                    │  │  │
  │  │  │  Prefetched Next.js Links │ SSE Streaming Client │ Auth Store    │  │  │
  │  │  └───────────────────────────┬──────────────────────────────────────┘  │  │
  │  └──────────────────────────────┼─────────────────────────────────────────┘  │
  └─────────────────────────────────┼────────────────────────────────────────────┘
                                    │  HTTP / SSE
                                    ▼
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │                       NODE.JS + EXPRESS.JS BACKEND                          │
  │                                                                             │
  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌───────────────┐  ┌────┐  │
  │  │Auth Routes │  │Repo Routes │  │Chat Routes │  │Analysis Routes│  │Eval│  │
  │  │ /api/auth/*│  │ /api/repos │  │ /api/chat/*│  │ /api/analyze/*│  │Set │  │
  │  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └──────┬────────┘  └──┬─┘  │
  │        │               │               │                │              │    │
  │  ┌─────▼───────────────▼───────────────▼────────────────▼──────────────▼─┐  │
  │  │                       CORE SERVICE MODULES                            │  │
  │  │                                                                       │  │
  │  │  ┌───────────┐  ┌────────────┐  ┌──────────────┐  ┌────────────────┐  │  │
  │  │  │ GitHub    │  │ web-tree-  │  │ Hybrid Search│  │ Groq Multi-LLM │  │  │
  │  │  │ Service   │  │ sitter AST │  │ RRF Engine   │  │ Cascade Chain  │  │  │
  │  │  │ (Octokit) │  │ Parser     │  │ (Vector+KW)  │  │ (120B/70B/20B) │  │  │
  │  │  └─────┬─────┘  └─────┬──────┘  └──────┬───────┘  └───────┬────────┘  │  │
  │  │        │               │               │                  │           │  │
  │  │  ┌─────▼───────────────▼───────────────▼──────────────────▼────────┐  │  │
  │  │  │                       MIDDLEWARE LAYER                          │  │  │
  │  │  │       Redis Rate Limiter │ JWT Auth Guard │ Response Cache      │  │  │
  │  │  └─────────────────────────────────────────────────────────────────┘  │  │
  │  └─────────────────────────────────────────────────────────────────────────┘  │
  └─────────────────────────────────────────────────────────────────────────────┘
          │               │                 │              │            │
          ▼               ▼                 ▼              ▼            ▼
  ┌──────────────┐ ┌──────────────┐  ┌────────────┐  ┌───────────┐ ┌────────────┐
  │  POSTGRESQL  │ │   PINECONE   │  │   GITHUB   │  │   REDIS   │ │  GROQ API  │
  │ (Neon Cloud) │ │  VECTOR DB   │  │  REST API  │  │ (Upstash) │ │ Multi-LLM  │
  │              │ │              │  │            │  │           │ │ Cascade    │
  │ Users/Chunks │ │ 384d Vectors │  │ Repos      │  │ RateLimit │ │ LLaMA 3.3  │
  │ Keyword RRF  │ │ Cosine Search│  │ Commits    │  │ Caching   │ │ gpt-oss    │
  └──────────────┘ └──────────────┘  └────────────┘  └───────────┘ └────────────┘
```

---

## 🧪 Retrieval Evaluation Suite (Eval Set)

Repo-Mind includes a standardized ground-truth benchmark suite located in [`backend/src/eval/`](file:///d:/repo-mind/backend/src/eval/) to evaluate and track the recall and precision of the retrieval pipeline.

### Benchmark Overview
- **Dataset (`eval-dataset.json`)**: 25 curated developer queries paired with ground-truth implementation files.
- **Categories Evaluated**:
  1. `auth` — OAuth flows, JWT signing, token validation, auth middleware
  2. `chunking` — AST parsing, semantic boundaries, dependency graphs
  3. `embedding` — Vector transformations, dimensionality, HuggingFace models
  4. `search` — Hybrid vector + keyword matching, Pinecone index queries
  5. `chat` — SSE streaming, prompt builders, session persistence
  6. `analysis` — Architecture summarizer, bug detector, documentation engine
  7. `ai` — Groq multi-LLM cascade fallback pipeline
  8. `caching` — Redis rate limiting and response caches
  9. `indexing` — Trees API ingestion, batch storage pipelines

### Metrics Computed
- **Hit@1**: Percentage of questions where a ground-truth file is returned as the **#1 top result**.
- **Hit@3**: Percentage of questions where a ground-truth file appears in the **top-3 results**.
- **Hit@5**: Percentage of questions where a ground-truth file appears in the **top-5 results**.

### Running the Evaluation
You can run the evaluation against any indexed repository ID using the built-in npm script:

```bash
cd backend
npm run eval -- <repositoryId>
```

Or run via `ts-node` directly:
```bash
cd backend
npx ts-node -r ./env-loader.js -r tsconfig-paths/register src/eval/run-eval.ts <repositoryId>
```

#### Example Benchmark Output:
```text
=============================================================================
RETRIEVAL EVALUATION RESULTS
=============================================================================
Total Questions : 25
Hit@1           : 22/25 (88.0%)
Hit@3           : 24/25 (96.0%)
Hit@5           : 25/25 (100.0%)
=============================================================================
CATEGORY BREAKDOWN:
Category        Total   Hit@1        Hit@3        Hit@5
-----------------------------------------------------------------------------
auth            3       3/3 (100%)   3/3 (100%)   3/3 (100%)
chunking        4       3/4 (75%)    4/4 (100%)   4/4 (100%)
embedding       2       2/2 (100%)   2/2 (100%)   2/2 (100%)
search          3       3/3 (100%)   3/3 (100%)   3/3 (100%)
chat            3       2/3 (66.7%)  3/3 (100%)   3/3 (100%)
analysis        5       4/5 (80%)    5/5 (100%)   5/5 (100%)
ai              1       1/1 (100%)   1/1 (100%)   1/1 (100%)
caching         2       2/2 (100%)   2/2 (100%)   2/2 (100%)
indexing        2       2/2 (100%)   2/2 (100%)   2/2 (100%)
=============================================================================
```

---

## 🛠️ Tech Stack

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| [Next.js](https://nextjs.org/) | 14 (App Router) | React framework with SSR, streaming, and route prefetching |
| [TypeScript](https://www.typescriptlang.org/) | 5.x | Strict typing across components, state, and API layers |
| [Tailwind CSS](https://tailwindcss.com/) | 3.x | Utility-first styling with responsive design |
| [Zustand](https://github.com/pmndrs/zustand) | 5.x | Lightweight global client state management |
| [Mermaid.js](https://mermaid.js.org/) | 11.x | Dynamic, on-demand architectural diagram rendering |
| [React Markdown](https://github.com/remarkjs/react-markdown) | 10.x | Renders LLM markdown with custom citation and code components |
| [React Syntax Highlighter](https://github.com/react-syntax-highlighter/react-syntax-highlighter) | 16.x | Prism-based code syntax highlighting |
| [Lucide React](https://lucide.dev/) | 1.x | Clean, scalable UI icons |
| [Axios](https://axios-http.com/) | 1.x | HTTP client with SSE streaming support |

### Backend
| Technology | Version | Purpose |
|---|---|---|
| [Node.js](https://nodejs.org/) | ≥18 | JavaScript runtime |
| [Express.js](https://expressjs.com/) | 4.18.3 | REST API and SSE streaming server |
| [TypeScript](https://www.typescriptlang.org/) | 5.x | Full type safety and ts-node execution |
| [Prisma](https://www.prisma.io/) | 5.x / 7.x | Type-safe ORM connecting to Neon PostgreSQL |
| [Passport.js](http://www.passportjs.org/) | 0.7.x | GitHub OAuth 2.0 authentication strategy |
| [JSON Web Token](https://github.com/auth0/node-jsonwebtoken) | 9.x | JWT creation and verification |
| [Winston](https://github.com/winstonjs/winston) | 3.x | Structured multi-transport logging |
| [Zod](https://zod.dev/) | 3.22.x | Runtime schema validation |

### AI, Retrieval & Machine Learning
| Technology | Purpose |
|---|---|
| [Groq API](https://groq.com/) | Ultra-fast inference with Multi-LLM cascade fallback |
| [Pinecone](https://www.pinecone.io/) | Vector database for dense semantic embeddings |
| [Hugging Face API / Transformers](https://huggingface.co/) | `sentence-transformers/all-MiniLM-L6-v2` 384-dimensional embeddings |
| [Reciprocal Rank Fusion (RRF)](https://en.wikipedia.org/wiki/Reciprocal_rank_fusion) | Merges semantic vector ranks with PostgreSQL keyword ranks ($k = 60$) |
| [web-tree-sitter](https://github.com/nicolo-ribaudo/tree-sitter-wasm) | WebAssembly-based AST semantic chunking and dependency graph parsing |

### Infrastructure & Cloud Services
| Technology | Purpose |
|---|---|
| [Neon](https://neon.tech/) | Serverless PostgreSQL database |
| [Upstash](https://upstash.com/) | Serverless Redis for distributed rate limiting & response caching |
| [GitHub REST API](https://docs.github.com/en/rest) | Octokit integration for fetching file trees, contents, and commits |

---

## 🔬 How It Works

### 1. Hybrid Search (RRF) Retrieval Pipeline

```
User Query: "How does authentication middleware verify JWT tokens?"
                         │
                         ▼
       ┌─────────────────┴─────────────────┐
       ▼                                   ▼
┌──────────────────────────┐   ┌──────────────────────────┐
│ SEMANTIC VECTOR SEARCH   │   │ WEIGHTED KEYWORD SEARCH  │
│ Dense embedding: 384-dim │   │ Stop-word filtered terms │
│ Query Pinecone vectors   │   │ PostgreSQL SQL matching: │
│ Cosine score floor >=0.25│   │ filePath(3x), name(2x),  │
│ Top-K vector candidates  │   │ content(0.5x)            │
└──────────────┬───────────┘   └───────────┬──────────────┘
               │                           │
               └─────────────┬─────────────┘
                             ▼
┌─────────────────────────────────────────────────────────┐
│ RECIPROCAL RANK FUSION (RRF) MERGING                   │
│ Score = Σ (1 / (60 + rank + 1))                         │
│ Multiplied by 1.2x boost for source code (.ts, .py)     │
│ Intent-Aware noise filter removes .css / boilerplate     │
└────────────────────────────┬────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────┐
│ TOP-5 GROUNDED CODE SNIPPETS WITH LINE BOUNDS           │
│ [1] backend/src/middleware/auth.middleware.ts (L45-L98) │
│ [2] backend/src/lib/jwt.ts (L12-L48)                    │
└─────────────────────────────────────────────────────────┘
```

### 2. Multi-LLM Streaming Generation & Line-Level Citations

```
Retrieved Context + User Message
               │
               ▼
┌─────────────────────────────────────────────────────────┐
│ GROQ MULTI-LLM CASCADE HANDLER                          │
│ 1. Attempt Primary Model (openai/gpt-oss-120b)          │
│ 2. If 429/Error ➔ Fallback to High-Speed (gpt-oss-20b)  │
│ 3. If Error ➔ Safeguard Backup Model                    │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│ REAL-TIME SSE TOKEN STREAMING                           │
│ Streams markdown tokens word-by-word                    │
│ Inline citations: "JWT tokens are verified [1]..."      │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│ FRONTEND RENDERING & HOVER TOOLTIPS                     │
│ [1] badge with line-number hover tooltip                │
│ Bottom Retrieved Sources bar highlights cited files     │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** ≥ 18.0.0 ([Download](https://nodejs.org/))
- **npm** ≥ 9.0.0
- **Git** ([Download](https://git-scm.com/))
- Accounts: [Neon](https://neon.tech/), [Upstash](https://upstash.com/), [Pinecone](https://www.pinecone.io/), [Groq](https://console.groq.com/), [Hugging Face](https://huggingface.co/)

### 1. Clone the Repository
```bash
git clone https://github.com/anurudddhhh/repo-mind.git
cd repo-mind
```

### 2. Configure Environment Variables
```bash
cp .env.example .env
# Fill in your database, Groq, Pinecone, and GitHub OAuth credentials
```

### 3. Install Dependencies
```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
cd ..
```

### 4. Initialize Database
```bash
cd backend
npx prisma generate
npx prisma db push
cd ..
```

### 5. Start Development Servers

**Terminal 1 — Backend:**
```bash
cd backend
npm run dev
# Running at http://localhost:5000 (with local ISP DNS bridge enabled)
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
# Running at http://localhost:3000
```

### 6. Run the Retrieval Benchmark (Eval Set)
```bash
cd backend
npm run eval -- <repositoryId>
```

---

## 🔑 Environment Variables

### Root `.env` File
| Variable | Description | Example |
|---|---|---|
| `NODE_ENV` | Application environment | `development` or `production` |
| `PORT` | Backend server port | `5000` |
| `FRONTEND_URL` | Frontend origin for CORS | `http://localhost:3000` |
| `GITHUB_CLIENT_ID` | GitHub OAuth App Client ID | `Ov23liXXXXXXXX` |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App Client Secret | `gh_xxxxxxxxxxxxxx` |
| `GITHUB_CALLBACK_URL` | OAuth redirect callback | `http://localhost:5000/api/auth/github/callback` |
| `JWT_SECRET` | Secret key for signing JWT tokens | Random 128-char hex string |
| `JWT_EXPIRES_IN` | JWT token expiry duration | `7d` |
| `DATABASE_URL` | Neon PostgreSQL pooled connection string | `postgresql://user:pass@ep-xyz.aws.neon.tech/db?sslmode=require` |
| `DIRECT_DATABASE_URL` | Neon direct connection string (migrations) | `postgresql://user:pass@ep-xyz.aws.neon.tech/db?sslmode=require` |
| `PINECONE_API_KEY` | Pinecone API key | `pcsk_xxxxxx` |
| `PINECONE_INDEX_NAME` | Pinecone index name | `repo-mind-index` |
| `GROQ_API_KEY` | Groq API key | `gsk_xxxxxx` |
| `GROQ_MODEL` | Primary LLM model identifier | `openai/gpt-oss-120b` or `llama-3.3-70b-versatile` |
| `HUGGINGFACE_API_KEY` | Hugging Face access token | `hf_xxxxxx` |
| `HUGGINGFACE_MODEL` | Embedding model identifier | `sentence-transformers/all-MiniLM-L6-v2` |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint | `https://xxx.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token | `AXXXxxxxxx` |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests allowed per window | `20` |
| `RATE_LIMIT_WINDOW` | Rate limit duration in ms | `60000` |

---

## 📁 Project Structure

```
repo-mind/
│
├── .env                              # Environment secrets (gitignored)
├── .env.example                      # Environment template
├── README.md                         # Project documentation
│
├── backend/                          # Express.js + Node.js API Service
│   ├── env-loader.js                 # Dev preload & ISP DNS bypass bridge
│   ├── package.json                  # Backend dependencies & scripts
│   ├── tsconfig.json                 # TypeScript configuration
│   ├── prisma/
│   │   └── schema.prisma             # PostgreSQL schema definition
│   └── src/
│       ├── index.ts                  # Application entry point
│       ├── eval/                     # Retrieval evaluation framework
│       │   ├── eval-dataset.json     # 25 ground-truth benchmark questions
│       │   └── run-eval.ts           # Hit@1, Hit@3, Hit@5 evaluation runner
│       ├── routes/                   # Express route definitions
│       │   ├── auth.routes.ts        # /api/auth/*
│       │   ├── repo.routes.ts        # /api/repos/*
│       │   ├── chat.routes.ts        # /api/chat/*
│       │   ├── search.routes.ts      # /api/search/*
│       │   └── analysis.routes.ts    # /api/analyze/*
│       ├── controllers/              # Request controllers
│       ├── services/                 # Core domain logic
│       │   ├── search.service.ts     # Hybrid RRF search engine & noise filters
│       │   ├── chat.service.ts       # RAG prompt builder & SSE streaming
│       │   ├── indexing.service.ts   # Micro-batch repository indexing
│       │   ├── chunking.service.ts   # AST semantic chunker & graph builder
│       │   ├── mermaid.service.ts    # Architecture diagram synthesizer
│       │   └── analysis.service.ts   # Bug scanner & documentation generator
│       ├── middleware/               # Auth, rate limiting & cache guards
│       └── lib/                      # Shared clients (Groq cascade, Pinecone, Redis, Prisma)
│
└── frontend/                         # Next.js 14 App Router UI
    ├── package.json                  # Frontend dependencies
    ├── next.config.mjs               # Next.js configuration
    ├── tailwind.config.ts            # Tailwind styling setup
    └── src/
        ├── app/                      # App router views
        │   ├── layout.tsx            # Global layout & providers
        │   ├── page.tsx              # Landing page
        │   ├── dashboard/            # Repository management & indexing UI
        │   ├── chat/[repositoryId]/  # Live streaming chat & citation badges
        │   └── repositories/[id]/    # Architecture, bugs, docs, commits tabs
        ├── components/               # Modular UI components
        ├── services/
        │   └── api.ts                # Decoupled API service client
        └── store/
            └── useAuthStore.ts       # Zustand authentication state
```

---

## 📡 API Reference

### Authentication
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/auth/github` | Initiates GitHub OAuth authorization flow |
| `GET` | `/api/auth/github/callback` | OAuth redirect handler returning session JWT |
| `GET` | `/api/auth/me` | Fetches authenticated user profile |
| `POST` | `/api/auth/logout` | Terminates user session |

### Repositories & Indexing
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/repos` | Returns all indexed repositories for the user |
| `POST` | `/api/repos` | Initiates repository indexing with progress events |
| `DELETE` | `/api/repos/:id` | Deletes a repository, its chunks, and vector embeddings |
| `GET` | `/api/repos/:id/status` | Queries indexing status |

### Search & Chat
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/chat/:repoId/stream?message=` | Real-time SSE chat stream with inline citations |
| `GET` | `/api/search/:repoId?q=&limit=` | Hybrid search (RRF vector + keyword) |

### Codebase Analysis
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/analyze/:repoId/architecture` | Generates system architecture overview & diagram |
| `POST` | `/api/analyze/:repoId/bugs` | Analyzes codebase for security vulnerabilities & bugs |
| `POST` | `/api/analyze/:repoId/docs` | Generates comprehensive codebase documentation |
| `GET` | `/api/analyze/:repoId/commits` | Summarizes recent commit activity and patterns |

---

## 🧩 Key Engineering Decisions

### 1. Why Hybrid RRF Search over Pure Vector Search?
Semantic vector search excels at conceptual matching (e.g. "token verification"), but struggles with exact function or identifier lookups (e.g. `verifyAuthToken`). Keyword matching excels at exact identifiers but misses conceptual context. By combining both with **Reciprocal Rank Fusion (RRF)**, Repo-Mind achieves the highest precision and recall across both general queries and exact symbol lookups.

### 2. Why Line-Level Citations with Hover Tooltips?
Developers need to verify AI answers against ground-truth source code. Without citations, developers must manually hunt through the repository to find referenced logic. Repo-Mind provides numbered badges linking directly to specific file paths and line ranges (`Lines X–Y`) with immediate code snippet previews.

### 3. Why Multi-LLM Cascade Fallback?
Relying on a single AI model leaves applications vulnerable to 429 rate limit errors or capacity outages. The cascade fallback automatically routes queries from a high-parameter primary model to high-speed and safeguard backups with zero user interruption.

### 4. Why Dynamic On-Demand Mermaid Import?
Mermaid.js is large (~300 kB). Statically importing it froze the browser thread on page evaluation and inflated initial route bundles to over 530 kB. Dynamically loading it `(await import('mermaid')).default` only when diagrams exist dropped the initial bundle to 380 kB and made route navigation instantaneous.

### 5. Why Micro-Batching with Event Loop Yielding?
Embedding hundreds of files can choke the Node.js event loop and exceed 512MB RAM on free-tier containers. Repo-Mind processes embeddings in small micro-batches with explicit `setImmediate` yields, preventing memory leaks and keeping the server responsive.

---

## 🤝 Contributing

1. Fork the repository
2. Create your branch (`git checkout -b feat/new-feature`)
3. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat: add new capability`
   - `fix: resolve issue`
4. Push to branch (`git push origin feat/new-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

<div align="center">

**Built with ❤️ by [anurudddhhh](https://github.com/anurudddhhh)**

If you find Repo-Mind helpful, please consider leaving a ⭐!

</div>
