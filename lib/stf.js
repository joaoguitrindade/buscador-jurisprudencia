import { fetchWithTimeout, cleanText, sanitizeHttpUrl } from '../utils.js';

export async function searchSTF(terms) {
  const url = 'https://jurisprudencia.stf.jus.br/api/search/search';
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      query: {
        bool: {
          must: [{
            simple_query_string: {
              query: terms,
              default_operator: 'AND'
            }
          }],
          filter: [{ terms: { base: ['acordaos'] } }]
        }
      },
      size: 6,
      from: 0
    })
  });

  if (!resp.ok) throw new Error(`STF HTTP ${resp.status}`);
  const data = await resp.json();
  const hits = data?.result?.hits?.hits || [];

  return hits.map(hit => {
    const src = hit._source || {};
    return {
      tribunal: 'STF',
      processo: cleanText(src.titulo || src.processo_classe_processual_unificada_extenso || 'Acórdão STF'),
      relator: cleanText(src.relator_processo_nome || ''),
      data: cleanText(src.julgamento_data || src.publicacao_data || ''),
      ementa: cleanText(src.ementa_texto || 'Ementa não disponibilizada.'),
      link: sanitizeHttpUrl(
        src.id
          ? `https://jurisprudencia.stf.jus.br/pages/search/${encodeURIComponent(src.id)}/false`
          : 'https://jurisprudencia.stf.jus.br/'
      )
    };
  });
}
