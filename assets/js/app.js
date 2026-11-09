// Carte interactive Kenshi (Leaflet, CRS.Simple).
// Coordonnées des lieux = pixels de l'image 8192 x 8192 : x vers la droite, y vers le bas, origine en haut à gauche.
(async () => {
  const config = await (await fetch('data/map.json')).json();
  const Z = config.maxNativeZoom;

  const map = L.map('map', { crs: L.CRS.Simple, minZoom: 0, maxZoom: Z + 1 });
  const toLatLng = (x, y) => map.unproject([x, y], Z);
  const bounds = L.latLngBounds(toLatLng(0, config.size), toLatLng(config.size, 0));

  L.tileLayer(config.tiles, {
    bounds,
    noWrap: true,
    maxNativeZoom: Z,
    maxZoom: Z + 1,
    attribution: 'Kenshi © Lo-Fi Games'
  }).addTo(map);
  map.fitBounds(bounds);
  map.setMaxBounds(bounds.pad(0.2));

  // Calque des villes.
  const towns = await (await fetch('data/towns.json')).json();
  const townLayer = L.layerGroup(
    towns.map(t => L.marker(toLatLng(t.x, t.y)).bindPopup(`<b>${t.name}</b><br>${t.faction ?? ''}`))
  ).addTo(map);

  document.getElementById('layer-towns').addEventListener('change', e => {
    e.target.checked ? townLayer.addTo(map) : townLayer.remove();
  });

  // Aide au placement : coordonnées (pixels de l'image) au clic.
  map.on('click', e => {
    const p = map.project(e.latlng, Z);
    document.getElementById('coords').textContent = `"x": ${Math.round(p.x)}, "y": ${Math.round(p.y)}`;
  });

  // Langue.
  const select = document.getElementById('lang');
  select.value = I18N.initial();
  await I18N.load(select.value);
  select.addEventListener('change', () => I18N.load(select.value));
})();
