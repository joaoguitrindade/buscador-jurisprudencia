import { analyzeLegalQuery } from '../lib/nlp.js';
import { searchSTF } from '../lib/scrapers/stf.js';
import { searchSTJ } from '../lib/scrapers/stj.js';
import { searchTJBA } from '../lib/scrapers/tjba.js';
import { searchTJMG } from '../lib/scrapers/tjmg.js';
import { searchTJSP } from '../lib/scrapers/tjsp.js';

const SCRAPERS = {
  STF: searchSTF,
  STJ: searchSTJ,
  TJBA: searchTJBA,
  TJMG: searchTJMG,
  TJSP: searchTJSP
};

const MAX_QUERY_LENGTH = 3000;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Use POST ou GET.' });
  }

  // Suporta POST JSON (ideal para situações fáticas longas) e GET querystring
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
  const mode = String(body.mode ?? req.query.mode ?? 'auto').toLowerCase();
  const rawTribunais = body.tribunais ?? req.query.tribunais ?? ['STF', 'STJ', 'TJBA', 'TJMG', 'TJSP'];

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
        .filter(t => Boolean(SCRAPERS[t]))
    )
  );

  if (selecionados.length === 0) {
    return res.status(400).json({ error: 'Selecione ao menos um tribunal válido.' });
  }

  const validMode = ['auto', 'keywords', 'natural'].includes(mode) ? mode : 'auto';
  const analysis = await analyzeLegalQuery(rawQuery, validMode);

  const tasks = selecionados.map(async (tribunal) => {
    const start = Date.now();
    try {
      const items = await SCRAPERS[tribunal](analysis.searchTerms);
      return {
        tribunal,
        status: 'ok',
        elapsedMs: Date.now() - start,
        items
      };
    } catch (err) {
      let message = 'Portal indisponível no momento';
      if (err.name === 'AbortError') message = 'Tempo limite excedido';
      else if (err.message === 'BLOCKED') message = 'Bloqueio antibot/CAPTCHA no portal';

      return {
        tribunal,
        status: 'error',
        elapsedMs: Date.now() - start,
        message,
        items: []
      };
    }
  });

  const settled = await Promise.all(tasks);
  const results = settled.flatMap(r => r.items);
  const diagnostics = settled.map(({ tribunal, status, elapsedMs, message, items }) => ({
    tribunal,
    status,
    count: items.length,
    elapsedMs,
    message: message || null
  }));

  return res.status(200).json({
    queryOriginal: rawQuery,
    modeUsed: analysis.modeUsed,
    searchTermsUsed: analysis.searchTerms,
    keywords: analysis.keywords,
    legalThesis: analysis.legalThesis,
    area: analysis.area,
    nlpStatus: analysis.nlpStatus,
    nlpMessage: analysis.nlpMessage,
    total: results.length,
    diagnostics,
    results
  });
}
