import * as cheerio from 'cheerio';
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';

if (getApps().length === 0) {
    initializeApp({
        credential: applicationDefault(),
    });
}

export const handler = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' })
    } 

    // [Optional] Verify Firebase ID token
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.split('Bearer ')[1] : null;

    if (!idToken) {
        return res.status(401).json({ error: 'Missing or invalid Authorization token' });
    }

    // Remove the code above if you don't have a API Gateway configured

    try {
        const { shared_link } = req.body
        console.log('Received shared_link:', shared_link)

        if (!shared_link ||
         typeof shared_link !== 'string' ||
         !shared_link.startsWith('https://maps.app.goo.gl/')) {
            return res.status(400).json({
                error: 'Missing or invalid shared_link. Must start with https://maps.app.goo.gl/'
            })
        }

    // Validate it's a valid URL
    try {
        new URL(shared_link)
    } catch {
        return res.status(400).json({ error: 'Invalid URL format' })
    }

    const axios = (await import('axios')).default

    const expanded = await axios.get(shared_link, { maxRedirects: 5 })
    const finalUrl = expanded.request.res.responseUrl
    const html = expanded.data

    const $ = cheerio.load(html)
    const script = $('script').toArray().map(el => $(el).html()).find(t => t?.includes('APP_INITIALIZATION_STATE='))
    const match = script?.match(/APP_INITIALIZATION_STATE=(\[.*?\]);/)
    if (!match) return res.status(500).json({ error: 'Failed to extract map data' })

    const data = JSON.parse(match[1])
    
    const encodedString = data?.[3]?.[16]
    const cleaned = encodedString.replace(/^\)\]\}'\n/, '')
    let parsed
    try {
        parsed = JSON.parse(cleaned)
    } catch (e) {
        console.error('Failed to parse JSON:', e)
        return res.status(500).json({ error: 'Invalid embedded JSON structure' })
    }

    const owner_display_name = parsed?.[0]?.[3]?.[0]
    const public_saved_list_name = parsed?.[0]?.[4]
    const raw_saved_places = parsed?.[0]?.[8]
    
    if (!Array.isArray(raw_saved_places)) {
        return res.status(500).json({ error: 'Failed to extract saved places' })
    }
    
    const places = raw_saved_places.map(place => {
        const loc = place[1]
        const owner = place[12]
        return {
            name: place[2] ?? 'Unnamed',
            address: loc?.[2] ?? '',
            short_address: loc?.[4] ?? '',
            latitude: loc?.[5]?.[2],
            longitude: loc?.[5]?.[3],
            place_id: loc?.[6]?.[0],
            addedBy: {
                name: owner?.[0]
            }
        }
    })

    res.status(200).json({ 
        source_url: finalUrl,
        owner_display_name: owner_display_name,
        public_saved_list_name: public_saved_list_name,
        places
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
}