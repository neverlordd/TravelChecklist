import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { withSupabase } from "jsr:@supabase/server@^1"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function isAllowedGoogleUrl(value: string) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return false
    const host = url.hostname.toLowerCase()
    return host === 'maps.app.goo.gl'
      || host === 'goo.gl'
      || host === 'google.com'
      || host.endsWith('.google.com')
      || host.endsWith('.google.com.vn')
      || host.endsWith('.google.co.th')
  } catch {
    return false
  }
}

async function safeFetch(initialUrl: string) {
  let currentUrl = initialUrl
  for (let redirect = 0; redirect < 5; redirect += 1) {
    if (!isAllowedGoogleUrl(currentUrl)) throw new Error('Unsupported Maps URL')
    const response = await fetch(currentUrl, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TravelChecklist/1.0)',
        Accept: 'text/html,image/avif,image/webp,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error('Invalid redirect')
      currentUrl = new URL(location, currentUrl).href
      continue
    }
    return { response, finalUrl: currentUrl }
  }
  throw new Error('Too many redirects')
}

function findImage(html: string, pageUrl: string) {
  const patterns = [
    /<meta[^>]+(?:property|name|itemprop)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?|image)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?|image)["']/i,
    /["']image(?:Url)?["']\s*:\s*["'](https?:\\?\/\\?\/[^"']+)["']/i,
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (!match?.[1]) continue
    const decoded = match[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&')
    try {
      const url = new URL(decoded, pageUrl)
      if (['http:', 'https:'].includes(url.protocol)) return url.href
    } catch { /* try next candidate */ }
  }
  return null
}

export default {
  fetch: withSupabase({ auth: ['publishable', 'secret'] }, async (request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    try {
      const { url } = await request.json()
      if (typeof url !== 'string' || !isAllowedGoogleUrl(url)) throw new Error('Only Google Maps links are supported')
      const { response, finalUrl } = await safeFetch(url)
      if (!response.ok) throw new Error(`Source returned ${response.status}`)
      const contentType = response.headers.get('content-type') || ''
      if (contentType.startsWith('image/')) {
        return Response.json({ image_url: finalUrl, final_url: finalUrl }, { headers: corsHeaders })
      }
      const buffer = await response.arrayBuffer()
      const html = new TextDecoder().decode(buffer.slice(0, 1_500_000))
      return Response.json({ image_url: findImage(html, finalUrl), final_url: finalUrl }, { headers: corsHeaders })
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'Preview failed' }, { status: 400, headers: corsHeaders })
    }
  }),
}
