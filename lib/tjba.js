import { fetchWithTimeout, cleanText, sanitizeHttpUrl } from '../utils.js';

export async function searchTJBA(terms) {
  const url = 'https://jurisprudencia.tjba.jus.br/api/jurisprudencia/pesquisar';
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      pesquisaLivre: terms,
      pagina: 1,
      tamanhoPagina: 6,
      tipoDocumento: ['ACORDAO']
    })
  });

  if (!resp.ok) throw new Error(`TJBA HTTP ${resp.status}`);
  const data = await resp.json();
  const lista = data?.content || data?.resultados || data?.data || [];

  return lista.slice(0, 6).map(item => ({
    tribunal: 'TJBA',
    processo: cleanText(item.numeroProcesso || item.classe || 'Acórdão TJBA'),
    relator: cleanText(item.relator || item.nomeRelator || ''),
    data: cleanText(item.dataJulgamento || item.dataPublicacao || ''),
    ementa: cleanText(item.ementa || item.textoEmenta || 'Ementa não disponibilizada.'),
    link: sanitizeHttpUrl(item.link || 'https://jurisprudencia.tjba.jus.br/')
  }));
}
