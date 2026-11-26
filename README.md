# Buscador Jurisprudencial Live v2 (Serverless + Linguagem Natural)

Metabuscador jurídico sob demanda para **STF, STJ, TJBA, TJMG e TJSP**, sem banco de dados e sem servidor local. Suporta pesquisa por **palavras-chave** ou descrevendo a **situação fática do processo em linguagem natural**.

## Arquitetura (Clean Architecture na Vercel)

```text
buscador-jurisprudencia-live/
├── .env.example
├── .gitignore
├── package.json
├── vercel.json
├── README.md
├── public/
│   └── index.html              # Frontend (Modo Palavras-chave & Situação Fática, Dark/Light)
├── api/
│   └── search.js               # Único endpoint Serverless (POST/GET /api/search)
└── lib/
    ├── nlp.js                  # Extração jurídica com Gemini (JSON estruturado) + fallback PT-BR
    ├── utils.js                # HTTP com timeout, detecção de WAF/CAPTCHA e higienização
    └── scrapers/
        ├── stf.js
        ├── stj.js
        ├── tjba.js
        ├── tjmg.js
        └── tjsp.js
```

## Como publicar gratuitamente (GitHub + Vercel)

1. Crie um repositório no GitHub e suba o conteúdo desta pasta na raiz do repositório.
2. Acesse [vercel.com](https://vercel.com), clique em **Add New Project**, importe o repositório e clique em **Deploy**.
3. Para ativar a interpretação avançada por IA de situações fáticas:
   - Gere uma chave gratuita em [Google AI Studio](https://aistudio.google.com/apikey).
   - Na Vercel, vá em **Settings > Environment Variables**, adicione `GEMINI_API_KEY` e faça um **Redeploy**.
   - *(Sem a chave, o sistema continua funcionando usando o extrator heurístico local em PT-BR).*
