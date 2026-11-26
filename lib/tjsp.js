import * as cheerio from 'cheerio';
import { fetchWithTimeout, cleanText, sanitizeHttpUrl, isBlockedHtml } from '../utils.js';

export async function searchTJSP(terms) {
  // Passo 1: Obtém cookie de sessão (JSESSIONID) do e-SAJ para evitar retorno vazio
  let cookieHeader = '';
  try {
    const initResp = await fetchWithTimeout('https://esaj.tjsp.jus.br/cjsg/consultaCompleta.do', {
      method: 'GET'
    }, 4000);
    const setCookie = initResp.headers.get('set-cookie');
    if (setCookie) {
      cookieHeader = setCookie
        .split(/,(?=[^;]+?=)/)
        .map(c => c.split(';')[0].trim())
        .join('; ');
    }
  } catch {
    // Segue sem cookie caso o handshake falhe
  }

  const body = new URLSearchParams({
    'dados.buscaInteiroTeor': terms,
    'dados.pesquisarComSinonimos': 'S',
    'dados.ordenarPor': 'dtPublicacao',
    'tipoDeDecisao': 'A'
  });

  const resp = await fetchWithTimeout('https://esaj.tjsp.jus.br/cjsg/resultadoCompleta.do', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': 'https://esaj.tjsp.jus.br/cjsg/consultaCompleta.do',
      ...(cookieHeader ? { 'Cookie': cookieHeader } : {})
    },
    body: body.toString()
  });

  if (!resp.ok) throw new Error(`TJSP HTTP ${resp.status}`);
  const html = await resp.text();
  if (isBlockedHtml(html)) {
    throw new Error('BLOCKED');
  }

  const $ = cheerio.load(html);
  const results = [];

  $('tr.fundocinza1').slice(0, 6).each((_, el) => {
    const $el = $(el);
    const processo = cleanText($el.find('a.esajLinkLogin').first().text());
    const detalhes = $el.text();
    const relatorMatch = detalhes.match(/Relator\(a\):\s*([^\n\r]+)/i);
    const dataMatch = detalhes.match(/Data do julgamento:\s*(\d{2}\/\d{2}\/\d{4})/i);
    const ementa = cleanText($el.find('div[align="justify"]').last().text());

    if (ementa) {
      results.push({
        tribunal: 'TJSP',
        processo: processo || 'Acórdão TJSP',
        relator: relatorMatch ? cleanText(relatorMatch[1]) : '',
        data: dataMatch ? dataMatch[1] : '',
        ementa,
        link: sanitizeHttpUrl('https://esaj.tjsp.jus.br/cjsg/consultaCompleta.do')
      });
    }
  });

  return results;
}
