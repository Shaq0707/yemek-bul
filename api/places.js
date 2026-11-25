// Vercel serverless: OpenStreetMap (Nominatim + Overpass). API anahtarı gerekmez.
const UA = 'Mozilla/5.0 (compatible; yemek-bul/1.0; +https://yemek-bul.vercel.app)';
const OVERPASS = ['https://overpass.private.coffee/api/interpreter', 'https://overpass.osm.jp/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];

async function geocode(address) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=gb&q=' + encodeURIComponent(address);
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(8000) });
  const j = await r.json();
  if (!Array.isArray(j) || !j[0]) throw new Error('Adres bulunamadı (UK).');
  return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon), label: j[0].display_name };
}

async function overpass(query) {
  const errs = [];
  const one = ep => fetch(ep, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Referer': 'https://yemek-bul.vercel.app/', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: 'data=' + encodeURIComponent(query),
    signal: AbortSignal.timeout(20000)
  }).then(async r => {
    if (!r.ok) throw new Error(ep.split('/')[2] + ' HTTP ' + r.status);
    const j = await r.json();
    return j.elements || [];
  }).catch(e => { errs.push(ep.split('/')[2] + ': ' + e.message); throw e; });
  try { return await Promise.any(OVERPASS.map(one)); }
  catch (e) { throw new Error('Overpass ulaşılamadı → ' + errs.join(' | ')); }
}

// OSM'de fiyat verisi yok: mekân türü/mutfaktan tahmini seviye (1=£ ... 3=£££)
const CHEAP = ['fast_food', 'kebab', 'pizza', 'burger', 'chicken', 'fish_and_chips', 'chip_shop', 'sandwich', 'coffee_shop', 'ice_cream', 'bakery', 'cafe', 'noodle', 'wings', 'donut'];
const PRICEY = ['french', 'steak_house', 'steak', 'fine_dining', 'sushi', 'japanese', 'seafood', 'tapas'];
const CHAINS = ['mcdonald', 'kfc', 'burger king', 'subway', 'greggs', 'domino', 'papa john', 'pret', 'costa', 'starbucks', 'nando', 'five guys', 'popeyes', 'wimpy', 'wetherspoon'];
function priceEst(tags) {
  const name = (tags.name || '').toLowerCase();
  const keys = [tags.amenity, ...(tags.cuisine || '').split(/[;,]/)].map(s => s.trim().toLowerCase());
  if (CHAINS.some(c => name.includes(c))) return 1;
  if (keys.some(k => PRICEY.includes(k))) return 3;
  if (keys.some(k => CHEAP.includes(k))) return 1;
  return 2;
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    let lat = parseFloat(q.lat), lng = parseFloat(q.lng), label = null;
    if (q.address) {
      const g = await geocode(String(q.address).slice(0, 200));
      lat = g.lat; lng = g.lng; label = g.label;
    }
    if (!isFinite(lat) || !isFinite(lng)) return res.status(400).json({ error: 'Konum veya adres gerekli.' });
    const radius = Math.min(Math.max(parseInt(q.radius) || 1000, 200), 5000);
    const query = `[out:json][timeout:10];(nw["amenity"~"^(restaurant|cafe|fast_food)$"]["name"](around:${radius},${lat},${lng}););out center tags 120;`;
    const els = await overpass(query);
    const places = els.map(e => {
      const t = e.tags || {};
      const la = e.lat ?? (e.center && e.center.lat), lo = e.lon ?? (e.center && e.center.lon);
      if (la == null || lo == null) return null;
      const cuisines = (t.cuisine || '').split(/[;,]/).map(s => s.trim()).filter(Boolean);
      const types = [t.amenity, ...cuisines];
      if (t['diet:vegan'] === 'yes' || t['diet:vegan'] === 'only') types.push('vegan');
      if (t['diet:vegetarian'] === 'yes' || t['diet:vegetarian'] === 'only') types.push('vegetarian');
      const addr = [t['addr:housenumber'], t['addr:street'], t['addr:postcode']].filter(Boolean).join(' ');
      return {
        id: e.type + e.id,
        displayName: { text: t.name },
        formattedAddress: addr,
        location: { latitude: la, longitude: lo },
        primaryType: t.amenity,
        primaryTypeDisplayName: { text: (cuisines[0] || t.amenity || '').replace(/_/g, ' ') },
        types,
        priceEst: priceEst(t),
        mapsUri: `https://www.google.com/maps/search/?api=1&query=${la},${lo}`
      };
    }).filter(Boolean);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ center: { lat, lng, label }, places });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
