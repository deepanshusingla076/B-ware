# B-ware

**B-ware** checks if economic claims are true, false, misleading, or unverifiable.

Example claim:

> “India’s GDP grew by 10% in 2023.”

B-ware extracts the numbers, compares them with official data (World Bank), and — if needed — uses AI (Hugging Face / Groq) to explain the result.

![Architecture](architecture-diagram.png)

---

## What this project does

| Feature | What you get |
|---------|----------------|
| **Verify claim** | Paste text → get verdict + confidence + explanation |
| **Batch verify** | Check many claims at once (one per line) |
| **Trending** | See risky economic stories (demo seed + optional live news) |
| **History** | Your past verifications |
| **Analytics** | Counts of accurate / misleading / false claims |
| **Auth** | Sign up / login with Firebase (email or Google) |

---

## How verification works (3 tiers)

```
User claim
    │
    ▼
Tier 1 — Extract metric, value, year → compare with World Bank numbers
    │ (if unclear)
    ▼
Tier 2 — Hugging Face NLI model (facebook/bart-large-mnli)
    │ (if still unsure / deep mode)
    ▼
Tier 3 — Groq LLM (optional; needs GROQ_API_KEY)
    │
    ▼
Verdict: accurate | misleading | false | unverifiable
```

- **Without Groq**, Tier 1 + Tier 2 still work.
- First Tier 2 call can take **1–2 minutes** while the model downloads/loads. Later calls are faster.

---

## Tech stack

| Part | Technology |
|------|------------|
| Frontend | Next.js, Tailwind, Firebase Auth |
| Backend | Node.js, Express |
| Database | MySQL (Docker) |
| Cache / sessions | Redis |
| NLP service | Python, FastAPI |
| AI models | Hugging Face (BART), optional Groq |
| Auth | Firebase ID tokens + Redis logout blacklist |

**Request flow:**

`Browser (Next.js)` → `Express (:5000)` → `MySQL / Redis` + `NLP FastAPI (:5001)`

---

## Project folders

```
B-ware/
├── frontend/          # Website (Next.js)
├── backend/           # API (Express) + Jest tests
├── nlp-service/       # AI verification (FastAPI)
├── database/
│   └── init_local.sql # Tables + demo trending stories
├── docs/images/       # Screenshots
├── start.bat          # Start all services on Windows
└── README.md
```

---

## What you need installed

1. **Node.js** (18+)
2. **Python** (3.10+)
3. **Docker Desktop** (for MySQL)
4. **Redis** running on `localhost:6379`
5. A **Firebase** project (for login)

---

## Setup (first time only)

### 1. Clone / open the project

```bash
cd B-ware
```

### 2. Create env files

```bash
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env
copy nlp-service\.env.example nlp-service\.env
```

### 3. Fill Firebase (required for login)

**Frontend** (`frontend/.env`) — from Firebase Console → Project settings → Your apps:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_API_URL=http://localhost:5000/api`

**Backend** (`backend/.env`) — from Firebase Console → Project settings → Service accounts → Generate new private key:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (keep the `\n` characters as in the JSON)

Local DB defaults in `backend/.env` are already set for Docker MySQL:

- host `127.0.0.1`, port `3307`, user `root`, password `bwaredev`, database `bware_ai`

### 4. Install frontend & backend packages

```bash
cd backend
npm install
cd ..\frontend
npm install
cd ..
```

### 5. Set up NLP (Python)

```bash
cd nlp-service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
pip install torch
cd ..
```

`torch` is required for Hugging Face models. CPU version is fine.

### 6. Start Redis

Make sure Redis is running on port **6379** (Memurai, Redis for Windows, WSL, or Docker).

---

## Run the project

1. Start **Docker Desktop**.
2. Double-click **`start.bat`** (or run it from the project root).

What `start.bat` does:

- Starts / creates MySQL Docker container (`bware-mysql` on port **3307**)
- Waits until MySQL is ready
- Applies `database/init_local.sql` (tables + demo trending stories)
- Opens 3 terminals: NLP `:5001`, backend `:5000`, frontend `:3000`

| Service | URL |
|---------|-----|
| App (UI) | http://localhost:3000 |
| Backend health | http://localhost:5000/api/health |
| NLP API docs | http://localhost:5001/docs |

---

## How to try it (demo path)

1. Open http://localhost:3000
2. **Register** or **Login**
3. Go to **Verify** → paste:

   `India GDP grew by 10% in 2023`

4. Click analyze → see verdict, confidence, explanation
5. Open **Trending** → see demo stories (live news needs API keys)
6. Open **History** / **Analytics** → your past results

---

## Optional API keys

These are **not required** for basic verify (Tier 1 + Tier 2).

| Key | Put in | Used for |
|-----|--------|----------|
| `GROQ_API_KEY` | `nlp-service/.env` | Tier 3 deeper AI reasoning |
| `NEWS_API_KEY` | `backend/.env` | Live news on Trending |
| `GOOGLE_FACT_CHECK_API_KEY` | `backend/.env` | Fact-check items on Trending |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | `backend/.env` | Password reset & email verify emails |

Get Groq key: https://console.groq.com/keys  

---

## Tests

```bash
cd backend
npm test
```

```bash
cd nlp-service
.venv\Scripts\activate
pytest
```

---

## Common problems

| Problem | Fix |
|---------|-----|
| Login fails / backend exits | Fill Firebase vars in `backend/.env` and `frontend/.env` |
| Verify says NLP unavailable | Check NLP window is running on port 5001 |
| First verify is very slow | Normal — Hugging Face model is loading; wait 1–2 min |
| MySQL connection error | Start Docker Desktop, then run `start.bat` again |
| Redis errors / degraded health | Start Redis on `localhost:6379` |
| Trending looks empty | Re-run `start.bat` so demo seed is applied, or add news API keys |


