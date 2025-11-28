import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Pega o 'type' (feed ou tags) e o resto dos parametros
  const { type, ...queryParams } = req.query;

  if (!type || typeof type !== 'string') {
    return res.status(400).json({ error: 'Type (endpoint) is required' });
  }

  // Reconstrói a URL para a PeakD
  // Ex: converte /api/peakd-proxy?type=tags&tag=hive-123...
  // para https://peakd.com/api/public/snaps/tags?tag=hive-123...
  
  const queryString = new URLSearchParams(queryParams as any).toString();
  const targetUrl = `https://peakd.com/api/public/snaps/${type}?${queryString}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'HiveApp/1.0' // Boa prática identificar o app
      }
    });

    if (!response.ok) {
      throw new Error(`PeakD API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Repassa o status 200 e os dados para o seu frontend
    res.status(200).json(data);
  } catch (error: any) {
    console.error('Proxy Error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch data' });
  }
}