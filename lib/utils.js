export async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
        ...(options.headers || {})
      }
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export function cleanText(str) {
  return String(str || '').replace(/\s+/g, ' ').trim();
}

export function sanitizeHttpUrl(rawUrl) {
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

export function isBlockedHtml(html) {
  if (!html) return false;
  const sample = html.slice(0, 4000).toLowerCase();
  return (
    sample.includes('captcha') ||
    sample.includes('cloudflare') ||
    sample.includes('cf-browser-verification') ||
    sample.includes('access denied') ||
    sample.includes('acesso negado') ||
    sample.includes('just a moment')
  );
}
