const COURT_DOMAINS = {
  STF: 'stf.jus.br',
  STJ: 'stj.jus.br',
  TJBA: 'tjba.jus.br',
  TJMG: 'tjmg.jus.br',
  TJSP: 'tjsp.jus.br'
};

const VALID_COURTS = Object.keys(COURT_DOMAINS);
const MAX_QUERY_LENGTH = 3000;
const MODELS = ['gemini-flash-latest', 'gemini-2.5-flash'];

function cleanText(str) {
  return String(str || '').replace(/\s+/g, ' ').trim();
}

function sanitizeHttpUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(String(rawUrl).trim());
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.href;
    }
  } catch {
    return '';
  }
  return '';
}

function getSanitizedApiKey() {
  const raw = process.env.GEMINI_API_KEY;
  if (!raw || typeof raw !== 'string') return '';
  return raw.replace(/[\r\n\t\s]+/g, '').trim();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 24000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractJsonObject(rawText) {
  if (!rawText) return null;
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function searchWithGeminiGrounding({ query, mode, courts, apiKey }) {
  const domainFilter = courts.map(c => `site:${COURT_DOMAINS[c]}`).join(' OR ');

  const prompt = [
    'Você é um pesquisador jurídico sênior especialista em jurisprudência brasileira.',
    'Use obrigatoriamente a ferramenta de busca na web (Google Search) para encontrar acórdãos e ementas REAIS nos tribunais selecionados.',
    `Tribunais permitidos: ${courts.join(', ')} (priorize fontes oficiais: ${domainFilter}).`,
    `Modo de entrada: ${mode === 'keywords' ? 'palavras-chave' : 'situação fática em linguagem natural'}.`,
    `Consulta do usuário: "${query}"`,
    '',
    'REGRAS ESTRITAS:',
    '1. Retorne APENAS um objeto JSON válido (sem texto antes ou depois).',
    '2. Nunca invente números de processos, relatores ou ementas. Retorne somente julgados reais encontrados na busca.',
    '3. Limite de 2 a 3 julgados mais relevantes por tribunal selecionado (máximo de 10 no total).',
    '4. Use exatamente esta estrutura JSON:',
    '{',
    '  "area": "Ramo do Direito (ex: Direito Processual Civil)",',
    '  "legalThesis": "Resumo da tese jurídica central em até 14 palavras",',
    '  "keywords": ["termo1", "termo2", "termo3"],',
    '  "results": [',
    '    {',
    '      "tribunal": "STJ",',
    '      "processo": "REsp 1.234.567/SP",',
    '      "relator": "Min. Nome do Relator",',
    '      "data": "DD/MM/AAAA",',
    '      "ementa": "Texto fiel ou síntese objetiva da ementa encontrada",',
    '      "link": "https://..."',
    '    }',
    '  ]',
    '}'
  ].join('\n');

  let lastError = null;

  for (const model of MODELS) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const resp = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048
          }
        })
      });

      if (!resp.ok) {
        let reason = '';
        try {
          const errJson = await resp.json();
          reason = errJson?.error?.status || errJson?.error?.message?.slice(0, 120) || '';
        } catch {}
        const err = new Error(`HTTP ${resp.status}${reason ? ` (${reason})` : ''}`);
        err.httpStatus = resp.status;
        throw err;
      }

      const data = await resp.json();
      const candidate = data?.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const textPart = parts.find(p => !p.thought && typeof p.text === 'string' && p.text.trim());
      const parsed = extractJsonObject(textPart?.text || '');

      if (!parsed || !Array.isArray(parsed.results)) {
        throw new Error('A IA não retornou um JSON estruturado válido.');
      }

      // Coleta URLs reais retornadas pelo Grounding como fallback de link
      const groundingChunks = candidate?.groundingMetadata?.groundingChunks || [];
      const groundedUrls = groundingChunks
        .map(ch => ch?.web?.uri)
        .filter(Boolean);

      const results = parsed.results
        .map(item => {
          const tribunal = cleanText(item.tribunal).toUpperCase();
          if (!courts.includes(tribunal)) return null;

          let link = sanitizeHttpUrl(item.link);
          if (!link) {
            const domain = COURT_DOMAINS[tribunal];
            const matchUrl = groundedUrls.find(u => u.toLowerCase().includes(domain));
            link = sanitizeHttpUrl(matchUrl || `https://${domain}`);
          }

          const ementa = cleanText(item.ementa);
          if (!ementa) return null;

          return {
            tribunal,
            processo: cleanText(item.processo) || `Acórdão ${tribunal}`,
            relator: cleanText(item.relator),
            data: cleanText(item.data),
            ementa,
            link
          };
        })
        .filter(Boolean);

      const keywords = (Array.isArray(parsed.keywords) ? parsed.keywords : [])
        .map(k => cleanText(k))
        .filter(Boolean)
        .slice(0, 5);

      return {
        modelUsed: model,
        area: cleanText(parsed.area) || null,
        legalThesis: cleanText(parsed.legalThesis) || null,
        keywords,
        searchTerms: keywords.length ? keywords.join(' ') : query,
        results
      };
    } catch (err) {
      lastError = err;
      console.error('[SEARCH_GROUNDING_ERROR]', {
        model,
        status: err.httpStatus || null,
        message: err.message
      });
      if (err.httpStatus === 401 || err.httpStatus === 403) break;
    }
  }

  throw lastError || new Error('Falha ao consultar a API do Gemini.');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Use POST ou GET.' });
  }

  let body = {};
  if (req.method === 'POST') {
    if (typeof req.body === 'string') {
      try {
        body = JSON.parse(req.body);
      } catch {
        return res.status(400).json({ error: 'JSON inválido no corpo da requisição.' });
      }
    } else if (req.body && typeof req.body === 'object') {
      body = req.body;
    }
  }

  const rawQuery = String(body.q ?? req.query.q ?? '').trim();
  const mode = String(body.mode ?? req.query.mode ?? 'natural').toLowerCase();
  const rawTribunais = body.tribunais ?? req.query.tribunais ?? VALID_COURTS;

  if (!rawQuery) {
    return res.status(400).json({ error: 'Informe os termos ou descreva a situação fática do processo.' });
  }

  if (rawQuery.length > MAX_QUERY_LENGTH) {
    return res.status(400).json({
      error: `Texto muito extenso. Limite máximo de ${MAX_QUERY_LENGTH} caracteres.`
    });
  }

  const listaTribunais = Array.isArray(rawTribunais)
    ? rawTribunais
    : String(rawTribunais).split(',');

  const selecionados = Array.from(
    new Set(
      listaTribunais
        .map(t => String(t).trim().toUpperCase())
        .filter(t => VALID_COURTS.includes(t))
    )
  );

  if (selecionados.length === 0) {
    return res.status(400).json({ error: 'Selecione ao menos um tribunal válido.' });
  }

  const apiKey = getSanitizedApiKey();
  if (!apiKey) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY não configurada nas Environment Variables da Vercel.'
    });
  }

  const startedAt = Date.now();

  try {
    const data = await searchWithGeminiGrounding({
      query: rawQuery,
      mode: mode === 'keywords' ? 'keywords' : 'natural',
      courts: selecionados,
      apiKey
    });

    const elapsedMs = Date.now() - startedAt;
    const diagnostics = selecionados.map(tribunal => {
      const count = data.results.filter(r => r.tribunal === tribunal).length;
      return {
        tribunal,
        status: 'ok',
        count,
        elapsedMs,
        message: null
      };
    });

    return res.status(200).json({
      queryOriginal: rawQuery,
      modeUsed: mode === 'keywords' ? 'keywords' : 'natural',
      searchTermsUsed: data.searchTerms,
      keywords: data.keywords,
      legalThesis: data.legalThesis,
      area: data.area,
      nlpStatus: 'ai',
      nlpMessage: null,
      total: data.results.length,
      diagnostics,
      results: data.results
    });
  } catch (err) {
    let msg = 'Falha ao consultar jurisprudências.';
    if (err.name === 'AbortError') msg = 'Tempo limite excedido na consulta.';
    else if (err.httpStatus === 401 || err.httpStatus === 403) msg = 'GEMINI_API_KEY inválida ou sem permissão.';
    else if (err.httpStatus === 429) msg = 'Limite de cota da API do Gemini atingido.';
    else if (err.httpStatus) msg = `Erro na API do Gemini (HTTP ${err.httpStatus}).`;

    return res.status(502).json({ error: msg });
  }
}
