import { fetchWithTimeout, cleanText } from './utils.js';

const STOPWORDS_PT = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das',
  'em', 'no', 'na', 'nos', 'nas', 'por', 'pelo', 'pela', 'pelos', 'pelas', 'para',
  'com', 'sem', 'sob', 'sobre', 'entre', 'apos', 'ate', 'contra', 'desde', 'que',
  'quem', 'qual', 'quais', 'cujo', 'cuja', 'onde', 'como', 'quando', 'porque',
  'mas', 'porem', 'contudo', 'todavia', 'entretanto', 'portanto', 'logo', 'pois',
  'e', 'ou', 'nem', 'se', 'caso', 'embora', 'conforme', 'segundo', 'mediante',
  'foi', 'era', 'sao', 'ser', 'esta', 'estao', 'este', 'esta', 'esse', 'essa',
  'isso', 'isto', 'aquele', 'aquela', 'aquilo', 'seu', 'sua', 'seus', 'suas',
  'meu', 'minha', 'nosso', 'nossa', 'ele', 'ela', 'eles', 'elas', 'autor', 'autora',
  'reu', 're', 'parte', 'partes', 'processo', 'acao', 'juiz', 'juiza', 'cliente',
  'pessoa', 'empresa', 'banco', 'hoje', 'ontem', 'dias', 'meses', 'anos', 'valor',
  'valores', 'forma', 'modo', 'fatos', 'fato', 'situacao', 'caso', 'pedido',
  'teve', 'tinha', 'tem', 'ter', 'fazer', 'fez', 'pode', 'poderia', 'deve', 'devia',
  'alega', 'alegando', 'informa', 'informou', 'requer', 'pede', 'pedindo', 'ainda',
  'ja', 'mais', 'menos', 'muito', 'muita', 'todo', 'toda', 'todos', 'todas', 'mesmo',
  'mesma', 'nao', 'sim', 'tambem', 'apenas', 'somente', 'agora', 'entao', 'assim'
]);

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
 * Converte uma situação fática em linguagem natural em termos jurídicos estruturados
 * usando Gemini (Structured JSON Output via header x-goog-api-key).
 */
export async function analyzeLegalQuery(rawQuery, mode = 'auto') {
  const clean = cleanText(rawQuery);
  const wordCount = clean.split(/\s+/).filter(Boolean).length;

  // Modo direto por palavras-chave (ou consulta curta no modo auto)
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

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    const localKeywords = extractKeywordsLocally(clean);
    return {
      modeUsed: 'natural',
      searchTerms: localKeywords.join(' '),
      keywords: localKeywords,
      legalThesis: null,
      area: null,
      nlpStatus: 'fallback_local',
      nlpMessage: 'GEMINI_API_KEY não configurada — termos extraídos por heurística local.'
    };
  }

  try {
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

    const resp = await fetchWithTimeout(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
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
            maxOutputTokens: 256,
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
      5500
    );

    if (!resp.ok) {
      throw new Error(`Gemini HTTP ${resp.status}`);
    }

    const data = await resp.json();
    const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawJson) throw new Error('Resposta vazia da IA');

    const parsed = JSON.parse(rawJson);
    const keywords = (Array.isArray(parsed.keywords) ? parsed.keywords : [])
      .map(k => cleanText(k).replace(/["'`]/g, ''))
      .filter(Boolean)
      .slice(0, 4);

    if (keywords.length === 0) {
      throw new Error('Nenhum termo jurídico retornado');
    }

    return {
      modeUsed: 'natural',
      searchTerms: keywords.join(' '),
      keywords,
      legalThesis: cleanText(parsed.legalThesis) || null,
      area: cleanText(parsed.area) || null,
      nlpStatus: 'ai',
      nlpMessage: null
    };
  } catch (err) {
    const localKeywords = extractKeywordsLocally(clean);
    return {
      modeUsed: 'natural',
      searchTerms: localKeywords.join(' '),
      keywords: localKeywords,
      legalThesis: null,
      area: null,
      nlpStatus: 'fallback_local',
      nlpMessage: err.name === 'AbortError'
        ? 'Tempo limite da IA excedido — usado extrator local.'
        : 'Falha na IA — usado extrator local.'
    };
  }
}
