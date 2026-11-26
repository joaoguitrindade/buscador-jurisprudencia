import * as cheerio from 'cheerio';
import { fetchWithTimeout, cleanText, sanitizeHttpUrl, isBlockedHtml } from '../utils.js';

export async function searchSTJ(terms) {
  const params = new URLSearchParams({
    aplicacao: 'jurisprudencia.ea',
    tipo_pesquisa: 'tipo_pesquisa_livre',
    operador: 'e',
    b: 'ACOR',
    livre: terms,
    thesaurus: 'JURIDICO',
    p: 'true',
    l: '6',
    i: '1'
  });

  const searchUrl = `https://scon.stj.jus.br/SCON/pesquisar.jsp?${params.toString()}`;
  const resp = await fetchWithTimeout(searchUrl);
  if (!resp.ok) throw new Error(`STJ HTTP ${resp.status}`);

  const html = await resp.text();
  if (isBlockedHtml(html)) {
    throw new Error('BLOCKED');
  }

  const $ = cheerio.load(html);
  const results = [];

  $('.documento').slice(0, 6).each((_, el) => {
    const $el = $(el);
    const processo = cleanText($el.find('.docTexto').first().text());

    let relator = '';
    let data = '';
    let ementa = '';

    $el.find('.paragrafoBRS').each((__, p) => {
      const titulo = cleanText($(p).find('.docTitulo').text()).toLowerCase();
      const texto = cleanText($(p).find('.docTexto').text());
      if (titulo.includes('relator')) relator = texto;
      else if (titulo.includes('data do julgamento')) data = texto;
      else if (titulo.includes('ementa')) ementa = texto;
    });

    if (!ementa) {
      ementa = cleanText($el.find('.ementa').text());
    }

    if (ementa) {
      results.push({
        tribunal: 'STJ',
        processo: processo || 'Acórdão STJ',
        relator,
        data,
        ementa,
        link: sanitizeHttpUrl(searchUrl)
      });
    }
  });

  return results;
}
