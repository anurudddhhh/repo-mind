
<div align="center">

# 🧠 Repo-Mind

### AI-Powered GitHub Repository Knowledge Assistant

[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-4.18-000000?style=for-the-badge&logo=express)](https://expressjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?style=for-the-badge&logo=postgresql)](https://neon.tech/)
[![Redis](https://img.shields.io/badge/Redis-Upstash-DC382D?style=for-the-badge&logo=redis)](https://upstash.com/)
[![Pinecone](https://img.shields.io/badge/Pinecone-Vector_DB-000000?style=for-the-badge)](https://www.pinecone.io/)
[![Groq](https://img.shields.io/badge/Groq-LLaMA_3.3-F55036?style=for-the-badge)](https://groq.com/)

**Repo-Mind** is a production-grade full-stack application that lets you **chat with any GitHub repository** using AI. It parses code into Abstract Syntax Trees, generates semantic embeddings, and uses Retrieval-Augmented Generation (RAG) to answer questions about codebases with pinpoint accuracy.

[Features](#-features) · [Architecture](#-system-architecture) · [Tech Stack](#-tech-stack) · [Getting Started](#-getting-started) · [Environment Variables](#-environment-variables) · [Project Structure](#-project-structure) · [How It Works](#-how-it-works) · [API Reference](#-api-reference) · [Contributing](#-contributing) · [License](#-license)

</div>


## 📋 Table of Contents

- [Features](#-features)
- [System Architecture](#-system-architecture)
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
Secure login via GitHub OAuth 2.0 allowing users to authenticate and access both their **public and private repositories**. Sessions are managed using JWT tokens with configurable expiry (default: 7 days).

### 2. 🌳 Repository Indexing & AST Parsing
Uses **web-tree-sitter** (WebAssembly-based) to parse code into Abstract Syntax Trees (ASTs). Unlike naive line-splitting, Repo-Mind implements **semantic chunking** — it extracts whole functions, classes, methods, and modules as meaningful code units. It also builds a **cross-file dependency graph** by analyzing import/export statements before generating vector embeddings.

### 3. 🔍 Semantic Code Search
High-speed vector search powered by **Pinecone** that retrieves relevant code snippets based on **meaning** rather than keywords. Ask "how does authentication work?" and it finds all auth-related code, even if the word "authentication" never appears in the source.

### 4. 💬 Chat with Repository
Real-time **Server-Sent Events (SSE)** streaming chat that answers questions about the codebase word-by-word, just like ChatGPT. Powered by **Groq's LLaMA 3.3 70B** model with RAG context from the indexed repository.

### 5. 🏗️ Architecture Summary
AI-generated high-level system architecture and module breakdown. Automatically analyzes the codebase structure, identifies core modules, maps dependencies, and produces a comprehensive technical overview.

### 6. 🐛 Bug Detection
AI-assisted code analysis that identifies:
- Security vulnerabilities
- Bad coding practices
- Potential runtime errors
- Performance issues
- Code smells

Each issue includes severity level, file location, description, and actionable fix suggestions.

### 7. 📝 AI Documentation Generator
Automatically generates:
- Inline code documentation
- README files
- Technical explanations
- Function/class descriptions
- Module overviews

### 8. 📊 Commit History Analysis
Queries the GitHub API to provide intelligent summaries of:
- Recent commit activity
- Change patterns and trends
- Contributor activity and statistics
- Development velocity

### 9. 📂 File & Directory Search
Fast lookup for specific files, directories, and repository structures. Navigate large codebases instantly without cloning the repo locally.

### 10. 🛡️ Resiliency & Caching
- **Redis Rate Limiting** — Prevents API abuse with configurable request limits (default: 20 requests/minute per user)
- **Response Caching** — Caches expensive API responses to avoid hitting GitHub API rate limits (default TTL: 1 hour)

### 11. 📐 Interactive Architecture Visualization
Leverages the AST dependency graph to generate interactive **Mermaid.js** flowcharts and architecture diagrams directly inside the chat interface. Users can visually explore:
- File import/export relationships
- Module dependencies
- System architecture
- Data flow diagrams

---

## 🏛️ System Architecture

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                      REPO-MIND SYSTEM ARCHITECTURE                         ║
╚══════════════════════════════════════════════════════════════════════════════╝

  ┌───────────────────────────────────────────────────────────────────────┐
  │                         USER'S BROWSER                               │
  │                                                                       │
  │  ┌─────────────────────────────────────────────────────────────────┐  │
  │  │                 NEXT.JS 14 FRONTEND (App Router)                │  │
  │  │                                                                  │  │
  │  │  ┌───────────┐  ┌──────────┐  ┌───────────┐  ┌──────────────┐  │  │
  │  │  │ Auth Pages│  │ Chat UI  │  │Code Viewer│  │  Mermaid.js  │  │  │
  │  │  │ (OAuth)   │  │(SSE)     │  │ (Search)  │  │  Diagrams    │  │  │
  │  │  └─────┬─────┘  └────┬─────┘  └─────┬─────┘  └──────┬───────┘  │  │
  │  │        │              │              │               │          │  │
  │  │  ┌─────▼──────────────▼──────────────▼───────────────▼───────┐  │  │
  │  │  │         DECOUPLED API SERVICE LAYER (api.ts)              │  │  │
  │  │  │     All fetch calls, state, business logic live here      │  │  │
  │  │  └────────────────────────┬──────────────────────────────────┘  │  │
  │  └───────────────────────────┼─────────────────────────────────────┘  │
  └──────────────────────────────┼────────────────────────────────────────┘
                                 │  HTTP / SSE
                                 ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │                    NODE.JS + EXPRESS.JS BACKEND                      │
  │                                                                      │
  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌───────────────┐  │
  │  │Auth Routes │  │Repo Routes │  │Chat Routes │  │Analysis Routes│  │
  │  │ /auth/*    │  │ /repo/*    │  │ /chat/*    │  │ /analyze/*    │  │
  │  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └──────┬────────┘  │
  │        │               │               │                │           │
  │  ┌─────▼───────────────▼───────────────▼────────────────▼────────┐  │
  │  │                    CORE SERVICE MODULES                        │  │
  │  │                                                                │  │
  │  │  ┌───────────┐  ┌────────────┐  ┌──────────┐  ┌────────────┐  │  │
  │  │  │ GitHub    │  │ web-tree-  │  │Embedding │  │ Groq LLM   │  │  │
  │  │  │ Service   │  │ sitter AST │  │ Service  │  │ Service    │  │  │
  │  │  │ (Octokit) │  │ Parser     │  │(HF API)  │  │(Streaming) │  │  │
  │  │  └─────┬─────┘  └─────┬──────┘  └────┬─────┘  └─────┬──────┘  │  │
  │  │        │               │              │              │         │  │
  │  │  ┌─────▼───────────────▼──────────────▼──────────────▼──────┐  │  │
  │  │  │                 MIDDLEWARE LAYER                          │  │  │
  │  │  │       Redis Rate Limiter │ Auth Guard │ Response Cache    │  │  │
  │  │  └─────────────────────────────────────────────────────────  ┘  │  │
  │  └────────────────────────────────────────────────────────────────┘  │
  └──────────────────────────────────────────────────────────────────────┘
          │           │              │               │              │
          ▼           ▼              ▼               ▼              ▼
  ┌──────────┐ ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌────────────┐
  │POSTGRESQL│ │ PINECONE │  │  GITHUB    │  │  REDIS   │  │ GROQ API   │
  │  (Neon)  │ │ VECTOR   │  │  REST API  │  │(Upstash) │  │+ HuggingFace│
  │          │ │   DB     │  │            │  │          │  │            │
  │ Users    │ │ Code     │  │ Repos      │  │ Rate     │  │ LLaMA 3.3 │
  │ Sessions │ │ Chunks   │  │ Files      │  │ Limits   │  │  70B Model │
  │ Repos    │ │(Vectors) │  │ Commits    │  │ Caching  │  │ MiniLM-L6  │
  └──────────┘ └──────────┘  └────────────┘  └──────────┘  └────────────┘
```

---

## 🛠️ Tech Stack

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| [Next.js](https://nextjs.org/) | 14 (App Router) | React framework with SSR, routing, and API proxying |
| [TypeScript](https://www.typescriptlang.org/) | 5.x | Static typing for safer, self-documenting code |
| [Tailwind CSS](https://tailwindcss.com/) | 3.x | Utility-first CSS framework |
| [Zustand](https://github.com/pmndrs/zustand) | 5.x | Lightweight global state management |
| [TanStack React Query](https://tanstack.com/query) | 5.x | Server state management with caching |
| [Mermaid.js](https://mermaid.js.org/) | 11.x | Diagram and flowchart generation from text |
| [React Markdown](https://github.com/remarkjs/react-markdown) | 10.x | Render AI responses as formatted markdown |
| [React Syntax Highlighter](https://github.com/react-syntax-highlighter/react-syntax-highlighter) | 16.x | Code block syntax highlighting |
| [Lucide React](https://lucide.dev/) | 1.x | Icon library |
| [Axios](https://axios-http.com/) | 1.x | HTTP client for API communication |

### Backend
| Technology | Version | Purpose |
|---|---|---|
| [Node.js](https://nodejs.org/) | ≥18 | JavaScript runtime |
| [Express.js](https://expressjs.com/) | 4.18.3 | Web framework for REST API |
| [TypeScript](https://www.typescriptlang.org/) | 7.x | Static typing |
| [Prisma](https://www.prisma.io/) | 7.x | Type-safe ORM for PostgreSQL |
| [Passport.js](http://www.passportjs.org/) | 0.7.x | Authentication middleware (GitHub OAuth strategy) |
| [JSON Web Token](https://github.com/auth0/node-jsonwebtoken) | 9.x | JWT creation and verification |
| [Winston](https://github.com/winstonjs/winston) | 3.x | Professional logging |
| [Zod](https://zod.dev/) | 3.22.0 | Request validation and schema parsing |

### AI & Machine Learning
| Technology | Version | Purpose |
|---|---|---|
| [Groq API](https://groq.com/) | — | Ultra-fast LLM inference (LLaMA 3.3 70B) |
| [LangChain](https://js.langchain.com/) | 0.3.37 | AI orchestration and RAG pipeline |
| [Hugging Face API](https://huggingface.co/) | — | Text embeddings (all-MiniLM-L6-v2, 384d) |
| [Pinecone](https://www.pinecone.io/) | 8.x SDK | Vector database for semantic search |
| [web-tree-sitter](https://github.com/nicolo-ribaudo/tree-sitter-wasm) | 0.26.x | WebAssembly-based AST parser |

### Infrastructure & Services
| Technology | Purpose |
|---|---|
| [Neon](https://neon.tech/) | Serverless PostgreSQL (cloud) |
| [Upstash](https://upstash.com/) | Serverless Redis for caching & rate limiting (cloud) |
| [GitHub API](https://docs.github.com/en/rest) | Repository data, files, commits via Octokit |

---

## 🔬 How It Works

### 1. Authentication Flow

```
User clicks "Login with GitHub"
        │
        ▼
Browser redirects to GitHub OAuth consent page
        │
        ▼
User authorizes Repo-Mind
        │
        ▼
GitHub redirects back with authorization code
        │
        ▼
Backend exchanges code for access token
        │
        ▼
Backend creates/updates user in PostgreSQL
        │
        ▼
Backend generates JWT token (valid 7 days)
        │
        ▼
JWT sent to frontend → stored in localStorage
        │
        ▼
All subsequent API requests include JWT in Authorization header
```

### 2. Repository Indexing Pipeline

```
User submits GitHub repo URL (e.g., "facebook/react")
        │
        ▼
┌─── STAGE 1: FETCHING ──────────────────────────────────┐
│  GitHub Service fetches repository metadata via API     │
│  Downloads all source files (decoded from base64)       │
│  Detects programming language per file                  │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─── STAGE 2: AST PARSING ───────────────────────────────┐
│  web-tree-sitter loads language-specific WASM grammar   │
│  Each file is parsed into an Abstract Syntax Tree       │
│                                                          │
│  SEMANTIC CHUNKING (not naive line-splitting):           │
│  ┌──────────────────────────────────────────────┐       │
│  │  • Extracts whole FUNCTIONS as chunks         │       │
│  │  • Extracts whole CLASSES as chunks           │       │
│  │  • Extracts whole METHODS as chunks           │       │
│  │  • Extracts INTERFACES & TYPE definitions     │       │
│  │  • Extracts MODULE-level exports              │       │
│  │  • Preserves start/end line numbers           │       │
│  └──────────────────────────────────────────────┘       │
│                                                          │
│  DEPENDENCY GRAPH BUILDING:                              │
│  ┌──────────────────────────────────────────────┐       │
│  │  • Analyzes import/require statements         │       │
│  │  • Maps which file depends on which           │       │
│  │  • Tracks export statements per file          │       │
│  │  • Builds a complete dependency DAG           │       │
│  └──────────────────────────────────────────────┘       │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─── STAGE 3: EMBEDDING ─────────────────────────────────┐
│  Each semantic chunk is sent to Hugging Face API        │
│  Model: sentence-transformers/all-MiniLM-L6-v2         │
│  Each chunk → 384-dimensional vector                    │
│                                                          │
│  "function authenticate(user) { ... }"                   │
│       ↓                                                  │
│  [0.12, -0.45, 0.87, ..., 0.33]  (384 numbers)         │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─── STAGE 4: STORING ───────────────────────────────────┐
│  Vectors + metadata upserted into Pinecone              │
│  Metadata includes: filePath, chunkType, name,          │
│  language, startLine, endLine, repositoryId             │
│                                                          │
│  Repository marked as "indexed" in PostgreSQL           │
└─────────────────────────────────────────────────────────┘
```

### 3. RAG Chat Pipeline (Question → Answer)

```
User asks: "How does the authenticate() function work?"
        │
        ▼
┌─── STEP 1: RATE CHECK ─────────────────────────────────┐
│  Redis checks if user has exceeded rate limit            │
│  (20 requests/minute)                                    │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─── STEP 2: CACHE CHECK ────────────────────────────────┐
│  Redis checks if this exact query was answered recently  │
│  Cache hit → return cached response instantly            │
│  Cache miss → continue to next step                      │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─── STEP 3: EMBED THE QUESTION ─────────────────────────┐
│  "How does authenticate() work?"                         │
│       ↓ Hugging Face API                                 │
│  [0.15, -0.42, 0.85, ..., 0.31]  (384-dim vector)      │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─── STEP 4: SEMANTIC SEARCH ────────────────────────────┐
│  Query Pinecone with the question vector                 │
│  Find top-K most similar code chunks                     │
│  Returns chunks ranked by cosine similarity (0-1)        │
│                                                          │
│  Result: [                                               │
│    { score: 0.92, chunk: "function authenticate..." },   │
│    { score: 0.87, chunk: "class AuthService..." },       │
│    { score: 0.81, chunk: "const verifyToken..." }        │
│  ]                                                       │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─── STEP 5: LLM GENERATION (STREAMING) ─────────────────┐
│  Build prompt:                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │ SYSTEM: You are a code expert. Use the following    │  │
│  │ code context to answer the user's question.         │  │
│  │                                                      │  │
│  │ CONTEXT:                                             │  │
│  │ [Retrieved code chunks from Pinecone]                │  │
│  │                                                      │  │
│  │ USER: How does authenticate() function work?         │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Send to Groq API (LLaMA 3.3 70B) with streaming=true   │
│  Tokens stream back at 500+ tokens/second                │
│                                                          │
│  Streamed via SSE to the frontend word-by-word:          │
│  "The" → "authenticate" → "function" → "validates" → …  │
└─────────────────────────────────────────────────────────┘
```

### 4. Architecture Visualization Pipeline

```
User requests architecture diagram
        │
        ▼
┌─── STEP 1 ──────────────────────────────────────────────┐
│  Retrieve dependency graph (built during indexing)       │
│  Graph shows: FileA imports FileB, FileB imports FileC   │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─── STEP 2 ──────────────────────────────────────────────┐
│  Convert dependency graph to Mermaid.js syntax           │
│                                                          │
│  graph TD                                                │
│    A[src/auth/login.ts] --> B[src/auth/service.ts]       │
│    B --> C[src/lib/database.ts]                           │
│    A --> D[src/middleware/jwt.ts]                         │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─── STEP 3 ──────────────────────────────────────────────┐
│  Frontend renders Mermaid.js syntax as interactive       │
│  SVG diagram in the chat interface                       │
│  Users can click nodes, zoom, and explore                │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18.0.0 ([Download](https://nodejs.org/))
- **npm** ≥ 9.0.0 (comes with Node.js)
- **Git** ([Download](https://git-scm.com/))
- Accounts on: [Neon](https://neon.tech/), [Upstash](https://upstash.com/), [Pinecone](https://www.pinecone.io/), [Groq](https://console.groq.com/), [Hugging Face](https://huggingface.co/)

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/repo-mind.git
cd repo-mind
```

### 2. Set Up Environment Variables

```bash
# Copy the template
cp .env.example .env

# Open .env and fill in ALL values
# See the "Environment Variables" section below for details
```

### 3. Install Backend Dependencies

```bash
cd backend
npm install
cd ..
```

### 4. Install Frontend Dependencies

```bash
cd frontend
npm install
cd ..
```

### 5. Set Up the Database

```bash
cd backend
npx prisma generate
npx prisma migrate dev
cd ..
```

### 6. Start the Development Servers

**Terminal 1 — Backend:**
```bash
cd backend
npm run dev
# Server starts at http://localhost:5000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
# App starts at http://localhost:3000
```

### 7. Open the App

Navigate to [http://localhost:3000](http://localhost:3000) and click **"Login with GitHub"** to get started!

---

## 🔑 Environment Variables

### Root `.env` File

Create a `.env` file in the project root with the following variables:

| Variable | Description | Example |
|---|---|---|
| `NODE_ENV` | Application environment | `development` |
| `PORT` | Backend server port | `5000` |
| `FRONTEND_URL` | Frontend URL for CORS | `http://localhost:3000` |
| `GITHUB_CLIENT_ID` | GitHub OAuth App Client ID | `Ov23liXXXXXXXX` |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App Client Secret | `gh_xxxxxxxxxxxxxx` |
| `GITHUB_CALLBACK_URL` | OAuth callback URL | `http://localhost:5000/api/auth/github/callback` |
| `JWT_SECRET` | Secret key for signing JWT tokens | Random 128-char hex string |
| `JWT_EXPIRES_IN` | JWT token expiry duration | `7d` |
| `DATABASE_URL` | Neon PostgreSQL connection string | `postgresql://user:pass@host/db?sslmode=require` |
| `PINECONE_API_KEY` | Pinecone API key | `pcsk_xxxxxx` |
| `PINECONE_INDEX_NAME` | Pinecone index name | `repo-mind-index` |
| `GROQ_API_KEY` | Groq API key | `gsk_xxxxxx` |
| `GROQ_MODEL` | Groq model identifier | `llama-3.3-70b-versatile` |
| `HUGGINGFACE_API_KEY` | Hugging Face access token | `hf_xxxxxx` |
| `HUGGINGFACE_MODEL` | Embedding model name | `sentence-transformers/all-MiniLM-L6-v2` |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL | `https://xxx.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token | `AXXXxxxxxx` |
| `REDIS_TTL` | Cache TTL in seconds | `3600` |
| `RATE_LIMIT_WINDOW` | Rate limit window (ms) | `60000` |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | `20` |
| `SESSION_SECRET` | Express session encryption key | Random 64-char hex string |

### Frontend `.env.local` File

Located at `frontend/.env.local`:

| Variable | Description | Example |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Backend API URL | `http://localhost:5000` |
| `NEXT_PUBLIC_APP_URL` | Frontend app URL | `http://localhost:3000` |
| `NEXT_PUBLIC_APP_NAME` | Application display name | `Repo-Mind` |

### Generating Secret Keys

```bash
# Generate JWT_SECRET (128 characters)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Generate SESSION_SECRET (64 characters)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 📁 Project Structure

```
repo-mind/
│
├── .env                              # Real environment variables (gitignored)
├── .env.example                      # Template with placeholder values
├── .gitignore                        # Git ignore rules
├── README.md                         # This file
│
├── backend/                          # Node.js + Express API Server
│   ├── .npmrc                        # npm config (legacy-peer-deps)
│   ├── package.json                  # Backend dependencies
│   ├── tsconfig.json                 # TypeScript configuration
│   ├── prisma/
│   │   └── schema.prisma             # Database schema definition
│   └── src/
│       ├── index.ts                  # Express server entry point
│       ├── types/
│       │   └── index.ts              # Shared TypeScript type definitions
│       ├── routes/                   # API endpoint definitions
│       │   ├── auth.routes.ts        # /api/auth/* routes
│       │   ├── repo.routes.ts        # /api/repos/* routes
│       │   ├── chat.routes.ts        # /api/chat/* routes
│       │   ├── search.routes.ts      # /api/search/* routes
│       │   └── analysis.routes.ts    # /api/analyze/* routes
│       ├── controllers/              # Route handler logic
│       │   ├── auth.controller.ts
│       │   ├── repo.controller.ts
│       │   ├── chat.controller.ts
│       │   ├── search.controller.ts
│       │   └── analysis.controller.ts
│       ├── services/                 # Business logic & external APIs
│       │   ├── github.service.ts     # GitHub API interactions
│       │   ├── embedding.service.ts  # Hugging Face embeddings
│       │   ├── groq.service.ts       # Groq LLM interactions
│       │   ├── pinecone.service.ts   # Vector DB operations
│       │   └── indexing.service.ts   # Repository indexing pipeline
│       ├── middleware/               # Express middleware
│       │   ├── auth.middleware.ts    # JWT verification
│       │   ├── rateLimit.middleware.ts # Redis rate limiting
│       │   └── cache.middleware.ts   # Response caching
│       ├── lib/                      # Shared utilities & clients
│       │   ├── prisma.ts             # Prisma client instance
│       │   ├── redis.ts              # Upstash Redis client
│       │   ├── pinecone.ts           # Pinecone client instance
│       │   └── logger.ts            # Winston logger configuration
│       └── parsers/                  # AST parsing logic
│           ├── treeSitter.parser.ts  # web-tree-sitter initialization
│           ├── chunker.ts           # Semantic code chunking
│           └── dependencyGraph.ts   # Cross-file dependency analysis
│
├── frontend/                         # Next.js 14 Application
│   ├── .npmrc                        # npm config (legacy-peer-deps)
│   ├── .env.local                    # Frontend environment variables
│   ├── next.config.mjs               # Next.js configuration (ES module)
│   ├── tailwind.config.ts            # Tailwind CSS configuration
│   ├── tsconfig.json                 # TypeScript configuration
│   ├── postcss.config.mjs            # PostCSS configuration
│   ├── package.json                  # Frontend dependencies
│   ├── public/                       # Static assets
│   └── src/
│       ├── app/                      # Next.js App Router pages
│       │   ├── layout.tsx            # Root layout
│       │   ├── page.tsx              # Home page
│       │   ├── globals.css           # Global styles (Tailwind)
│       │   ├── login/                # Login page
│       │   ├── dashboard/            # Dashboard page
│       │   └── repo/[id]/            # Repository detail page
│       ├── components/
│       │   ├── ui/                   # Pure visual components (buttons, inputs)
│       │   └── features/             # Smart components with business logic
│       ├── services/
│       │   └── api.ts                # Decoupled API service layer
│       ├── hooks/                    # Custom React hooks
│       ├── lib/                      # Frontend utilities
│       ├── types/
│       │   └── index.ts              # Frontend TypeScript types
│       └── store/                    # Zustand state management
```

---

## 📡 API Reference

### Authentication
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/auth/github` | Initiate GitHub OAuth flow |
| `GET` | `/api/auth/github/callback` | GitHub OAuth callback handler |
| `GET` | `/api/auth/me` | Get current user profile |
| `POST` | `/api/auth/logout` | Log out current user |

### Repositories
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/repos` | List user's indexed repositories |
| `GET` | `/api/repos/:id` | Get single repository details |
| `POST` | `/api/repos` | Add a new repository |
| `DELETE` | `/api/repos/:id` | Remove a repository |
| `GET` | `/api/repos/github/search?q=` | Search user's GitHub repos |
| `GET` | `/api/repos/:id/index` | Start indexing (SSE stream) |
| `GET` | `/api/repos/:id/index/status` | Get indexing status |

### Chat
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/chat/:repoId/stream?message=` | Stream chat response (SSE) |

### Search
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/search/:repoId?q=&limit=` | Semantic code search |
| `GET` | `/api/search/:repoId/files?q=` | File/directory name search |

### Analysis
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/analyze/:repoId/architecture` | Generate architecture summary |
| `POST` | `/api/analyze/:repoId/bugs` | Run bug detection |
| `POST` | `/api/analyze/:repoId/docs` | Generate documentation |
| `GET` | `/api/analyze/:repoId/commits` | Analyze commit history |

---

## 🧩 Key Engineering Decisions

### Why web-tree-sitter instead of native tree-sitter?
Native `tree-sitter` npm packages (`tree-sitter-javascript`, `tree-sitter-typescript`, `tree-sitter-python`) have severe **peer dependency version conflicts** on Windows. The TypeScript grammar requires `tree-sitter@^0.21.0` while JavaScript/Python grammars require `tree-sitter@^0.25.0`. `web-tree-sitter` uses WebAssembly, eliminating all native compilation issues while providing identical parsing functionality.

### Why LangChain v0.3.37 (not v1.x)?
LangChain recently released v1.0 with breaking changes. Version 0.3.37 is the **last stable 0.3.x release** where `langchain`, `@langchain/core`, and `@langchain/community` all have matching version numbers, ensuring internal compatibility.

### Why Express v4 (not v5)?
`express-async-errors` — a critical middleware that automatically catches async errors — only supports Express v4 (`peer express@"^4.16.2"`). Express v5 is still relatively new and some ecosystem packages haven't caught up.

### Why Cloud-Only (No Docker)?
For simplicity on Windows development environments. Neon (PostgreSQL) and Upstash (Redis) provide generous free tiers with zero configuration overhead, identical behavior to local instances, and the same setup used in production.

### Why Semantic Chunking over Line-Splitting?
Traditional RAG systems split code into fixed-size chunks (e.g., 500 characters), which often cuts functions in half, losing context. Repo-Mind uses AST parsing to extract **complete semantic units** (whole functions, classes, methods), preserving code meaning and producing significantly better AI responses.

### Why SSE over WebSockets?
Server-Sent Events (SSE) are:
- Simpler to implement (HTTP-based, no upgrade needed)
- Natively supported by browsers (`EventSource` API)
- Perfect for our use case (one-way server → client streaming)
- WebSockets would be overkill — we don't need bidirectional real-time communication

### Why Decoupled API Service Layer?
All API calls live in `frontend/src/services/api.ts`, completely separated from UI components. This allows the **entire frontend UI to be redesigned or replaced** without modifying any business logic or data-fetching code.

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Commit Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Usage |
|---|---|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `chore:` | Maintenance (deps, config) |
| `docs:` | Documentation changes |
| `refactor:` | Code restructuring |
| `test:` | Adding tests |

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built with ❤️ by [Your Name]**

If you find this project useful, please consider giving it a ⭐

</div>
