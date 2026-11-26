import { fetchWithTimeout, cleanText } from './utils.js';

const STOPWORDS_PT = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das',
  'em', 'no', 'na', 'nos', 'nas', 'por', 'pelo', 'pela', 'pelos', 'pelas', 'para',
  'com', 'sem', 'sob', 'sobre', 'entre', 'apos', 'ate', 'contra', 'desde', 'que',
  'quem', 'qual', 'quais', 'cujo', 'cuja', 'onde', 'como', 'quando', 'porque',
  'mas', 'porem', 'contudo', 'todavia', 'entretanto', 'portanto', 'logo', 'pois',
  'e', 'ou', 'nem', 'se', 'caso', 'embora', 'conforme', 'segundo', 'mediante',
  'foi', 'era', 'sao', 'ser', 'esta', 'estao', 'este', 'esse', 'essa',
  'isso', 'isto', 'aquele', 'aquela', 'aquilo', 'seu', 'sua', 'seus', 'suas',
  'meu', 'minha', 'nosso', 'nossa', 'ele', 'ela', 'eles', 'elas', 'autor', 'autora',
  'reu', 're', 'parte', 'partes', 'processo', 'acao', 'juiz', 'juiza', 'cliente',
  'pessoa', 'empresa', 'banco', 'hoje', 'ontem', 'dias', 'meses', 'anos', 'valor',
  'valores', 'forma', 'modo', 'fatos', 'fato', 'situacao', 'pedido',
  'teve', 'tinha', 'tem', 'ter', 'fazer', 'fez', 'pode', 'poderia', 'deve', 'devia',
  'alega', 'alegando', 'informa', 'informou', 'requer', 'pede', 'pedindo', 'ainda',
  'ja', 'mais', 'menos', 'muito', 'muita', 'todo', 'toda', 'todos', 'todas', 'mesmo',
  'mesma', 'nao', 'sim', 'tambem', 'apenas', 'somente', 'agora', 'entao', 'assim'
]);

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

/**
 * Extrator heurístico local (fallback sem IA).
 * Remove stopwords comuns em PT-BR e mantém até 4 termos relevantes.
 */
function extractKeywordsLocally(rawText) {
  const tokens = rawText
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOPWORDS_PT.has(w) && !/^\d+$/.test(w));

  const freq = new Map();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) || 0) + 1);
  }

  const ranked = Array.from(freq.entries())
    .sort((a, b) => (b[1] - a[1]) || (b[0].length - a[0].length))
    .slice(0, 4)
    .map(([word]) => word);

  return ranked.length > 0 ? ranked : rawText.split(/\s+/).slice(0, 4);
}

/**
 * Higieniza e valida a API Key antes de enviá-la em headers HTTP.
 */
function getSanitizedApiKey() {
  const raw = process.env.GEMINI_API_KEY;
  if (!raw || typeof raw !== 'string') return '';
  return raw.replace(/[\r\n\t\s]+/g, '').trim();
}

/**
 * Extrai texto JSON seguro ignorando blocos de pensamento (thought: true)
 * e removendo eventuais cercas Markdown (```json ... ```).
 */
function extractJsonText(data) {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) return '';

  const textPart = parts.find(p => !p.thought && typeof p.text === 'string' && p.text.trim());
  if (!textPart) return '';

  return textPart.text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/**
 * Executa a chamada ao modelo Gemini especificado com Structured Output
 * e thinkingBudget: 0 para evitar truncamento e reduzir latência.
 */
async function callGeminiModel(model, apiKey, prompt) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const resp = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 512,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              keywords: {
                type: 'ARRAY',
                items: { type: 'STRING' }
              },
              legalThesis: { type: 'STRING' },
              area: { type: 'STRING' }
            },
            required: ['keywords', 'legalThesis', 'area']
          }
        }
      })
    },
    8000
  );

  if (!resp.ok) {
    let apiReason = '';
    try {
      const errBody = await resp.json();
      apiReason = errBody?.error?.status || errBody?.error?.message?.slice(0, 120) || '';
    } catch {
      // Ignora erro ao ler corpo de erro
    }
    const error = new Error(`HTTP ${resp.status}${apiReason ? ` (${apiReason})` : ''}`);
    error.httpStatus = resp.status;
    throw error;
  }

  const data = await resp.json();
  const finishReason = data?.candidates?.[0]?.finishReason;
  const rawJson = extractJsonText(data);

  if (!rawJson) {
    throw new Error(`Resposta vazia da IA (finishReason: ${finishReason || 'UNKNOWN'})`);
  }

  const parsed = JSON.parse(rawJson);
  const keywords = (Array.isArray(parsed.keywords) ? parsed.keywords : [])
    .map(k => cleanText(k).replace(/["'`]/g, ''))
    .filter(Boolean)
    .slice(0, 4);

  if (keywords.length === 0) {
    throw new Error('Nenhum termo jurídico retornado no JSON');
  }

  return {
    keywords,
    legalThesis: cleanText(parsed.legalThesis) || null,
    area: cleanText(parsed.area) || null
  };
}

/**
 * Converte uma situação fática em linguagem natural em termos jurídicos estruturados.
 */
export async function analyzeLegalQuery(rawQuery, mode = 'auto') {
  const clean = cleanText(rawQuery);
  const wordCount = clean.split(/\s+/).filter(Boolean).length;

  if (mode === 'keywords' || (mode === 'auto' && wordCount <= 5)) {
    return {
      modeUsed: 'keywords',
      searchTerms: clean,
      keywords: clean.split(/\s+/).filter(Boolean),
      legalThesis: null,
      area: null,
      nlpStatus: 'direct',
      nlpMessage: null
    };
  }

  const apiKey = getSanitizedApiKey();

  if (!apiKey) {
    const localKeywords = extractKeywordsLocally(clean);
    return {
      modeUsed: 'natural',
      searchTerms: localKeywords.join(' '),
      keywords: localKeywords,
      legalThesis: null,
      area: null,
      nlpStatus: 'fallback_local',
      nlpMessage: 'GEMINI_API_KEY não configurada — usado extrator local.'
    };
  }

  const prompt = [
    'Você é um pesquisador jurídico especialista em jurisprudência brasileira (STF, STJ e Tribunais de Justiça).',
    'Analise a situação fática abaixo descrita em linguagem natural e extraia os termos exatos que costumam constar em ementas de acórdãos.',
    'Regras:',
    '- keywords: array com 3 a 4 termos jurídicos técnicos objetivos (palavras simples ou compostas curtas, sem preposições, sem aspas, sem operadores booleanos). Ex.: ["impenhorabilidade", "conta salario", "sisbajud"].',
    '- legalThesis: resumo da tese jurídica central em até 12 palavras.',
    '- area: ramo principal do Direito (ex.: "Direito Civil", "Direito do Consumidor", "Processo Civil", "Direito Penal").',
    '',
    `Situação fática: "${clean}"`
  ].join('\n');

  let lastError = null;

  for (const model of GEMINI_MODELS) {
    try {
      const result = await callGeminiModel(model, apiKey, prompt);
      return {
        modeUsed: 'natural',
        searchTerms: result.keywords.join(' '),
        keywords: result.keywords,
        legalThesis: result.legalThesis,
        area: result.area,
        nlpStatus: 'ai',
        nlpMessage: null
      };
    } catch (err) {
      lastError = err;
      // Log estruturado sem vazar API Key nem dados PII da narrativa do usuário
      console.error('[NLP_ERROR]', {
        model,
        name: err.name,
        status: err.httpStatus || null,
        message: err.message
      });

      // Se a chave for inválida/sem permissão (401/403), não adianta tentar outro modelo
      if (err.httpStatus === 401 || err.httpStatus === 403) {
        break;
      }
    }
  }

  const localKeywords = extractKeywordsLocally(clean);
  let friendlyReason = 'Falha na IA';

  if (lastError?.name === 'AbortError') {
    friendlyReason = 'Tempo limite da IA excedido';
  } else if (lastError?.httpStatus === 400) {
    friendlyReason = 'Requisição ou chave rejeitada pela API (HTTP 400)';
  } else if (lastError?.httpStatus === 401 || lastError?.httpStatus === 403) {
    friendlyReason = 'Chave GEMINI_API_KEY inválida ou sem permissão (HTTP 403)';
  } else if (lastError?.httpStatus === 429) {
    friendlyReason = 'Cota da API do Gemini atingida (HTTP 429)';
  } else if (lastError?.httpStatus) {
    friendlyReason = `Erro na API do Gemini (HTTP ${lastError.httpStatus})`;
  }

  return {
    modeUsed: 'natural',
    searchTerms: localKeywords.join(' '),
    keywords: localKeywords,
    legalThesis: null,
    area: null,
    nlpStatus: 'fallback_local',
    nlpMessage: `${friendlyReason} — usado extrator local.`
  };
}
