import * as cheerio from 'cheerio';
import { fetchWithTimeout, cleanText, sanitizeHttpUrl, isBlockedHtml } from '../utils.js';

export async function searchTJMG(terms) {
  const params = new URLSearchParams({
    palavras: terms,
    pesquisaPalavras: 'Pesquisar',
    listaAcordao: 'true',
    linhasPorPagina: '6',
    paginaNumero: '1'
  });

  const url = `https://www5.tjmg.jus.br/jurisprudencia/pesquisaPalavrasEspelhoAcordao.do?${params.toString()}`;
  const resp = await fetchWithTimeout(url);
  if (!resp.ok) throw new Error(`TJMG HTTP ${resp.status}`);

  const buffer = await resp.arrayBuffer();
  const html = new TextDecoder('iso-8859-1').decode(buffer);
  if (isBlockedHtml(html)) {
    throw new Error('BLOCKED');
  }

  const $ = cheerio.load(html);
  const results = [];

  $('.caixa_processo').slice(0, 6).each((_, el) => {
    const $el = $(el);
    const processo = cleanText($el.find('.numero_processo').text());
    const relator = cleanText($el.find('.relator').text()).replace(/^Relator\(a\):?\s*/i, '');
    const data = cleanText($el.find('.data_julgamento').text()).replace(/^Data de Julgamento:?\s*/i, '');
    const ementa = cleanText($el.find('.ementa, .corpo').text());

    if (ementa) {
      results.push({
        tribunal: 'TJMG',
        processo: processo || 'Acórdão TJMG',
        relator,
        data,
        ementa,
        link: sanitizeHttpUrl(url)
      });
    }
  });

  return results;
}
