# B-ware NLP Service

FastAPI microservice for claim extraction and economic fact verification.

**Local docs:** http://localhost:5001/docs

## Pipeline

1. Claim detection + metric/value/year extraction  
2. **Tier 1** — World Bank numeric check  
3. **Tier 2** — Hugging Face NLI (`facebook/bart-large-mnli`)  
4. **Tier 3** — optional Groq LLM (needs `GROQ_API_KEY`)

## Run

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
pip install torch
copy .env.example .env
uvicorn main:app --reload --port 5001
```

First `/verify` that hits Tier 2 may take 1–2 minutes while BART downloads/loads.

## Tests

```bash
pytest
```
