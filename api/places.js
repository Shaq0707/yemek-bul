// Vercel serverless: Google Geocoding + Places API (New) proxy.
// Env: GOOGLE_MAPS_API_KEY (Geocoding API + Places API (New) etkin olmalı)
const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
  'places.rating', 'places.userRatingCount', 'places.priceLevel', 'places.priceRange',
  'places.primaryType', 'places.primaryTypeDisplayName', 'places.types',
  'places.googleMapsUri', 'places.currentOpeningHours.openNow', 'places.editorialSummary'
].join(',');

const TYPE_GROUPS = [
  ['restaurant', 'meal_takeaway', 'meal_delivery', 'vegan_restaurant', 'vegetarian_restaurant'],
  ['cafe', 'fast_food_restaurant', 'bakery', 'sandwich_shop', 'pizza_restaurant', 'coffee_shop']
];

async function geocode(address, key) {
  const url = 'https://maps.googleapis.com/maps/api/geocode/json?region=gb&components=country:GB&address=' +
    encodeURIComponent(address) + '&key=' + key;
  const r = await fetch(url);
  const j = await r.json();
  if (j.status !== 'OK' || !j.results[0]) throw new Error('Adres bulunamadı (UK): ' + (j.status || ''));
  const g = j.results[0];
  return { lat: g.geometry.location.lat, lng: g.geometry.location.lng, label: g.formatted_address };
}

async function nearby(types, lat, lng, radius, key) {
  const r = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
    body: JSON.stringify({
      includedTypes: types,
      maxResultCount: 20,
      rankPreference: 'DISTANCE',
      languageCode: 'en',
      regionCode: 'GB',
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } }
    })
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || 'Places API hatası');
  return j.places || [];
}

module.exports = async (req, res) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY tanımlı değil (Vercel > Settings > Environment Variables).' });
  try {
    const q = req.query || {};
    let lat = parseFloat(q.lat), lng = parseFloat(q.lng), label = null;
    if (q.address) {
      const g = await geocode(String(q.address).slice(0, 200), key);
      lat = g.lat; lng = g.lng; label = g.label;
    }
    if (!isFinite(lat) || !isFinite(lng)) return res.status(400).json({ error: 'Konum veya adres gerekli.' });
    const radius = Math.min(Math.max(parseInt(q.radius) || 1000, 200), 5000);
    const groups = await Promise.all(TYPE_GROUPS.map(t => nearby(t, lat, lng, radius, key)));
    const seen = new Map();
    groups.flat().forEach(p => seen.set(p.id, p));
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ center: { lat, lng, label }, places: [...seen.values()] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
