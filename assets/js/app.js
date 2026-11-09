// Carte interactive Kenshi (Leaflet, repère simple en pixels de l'image).
(async () => {
  const config = await (await fetch('data/map.json')).json();
  const bounds = [[0, 0], [config.height, config.width]];

  const map = L.map('map', {
    crs: L.CRS.Simple,
    minZoom: -4,
    maxZoom: 2,
    attributionControl: true
  });
  map.attributionControl.addAttribution('Kenshi © Lo-Fi Games');

  // Image de la carte (si absente, on garde le fond uni).
  L.imageOverlay(config.image, bounds).addTo(map);
  map.fitBounds(bounds);

  // Calque des villes.
  const towns = await (await fetch('data/towns.json')).json();
  const townLayer = L.layerGroup(
    towns.map(t => L.marker([t.y, t.x]).bindPopup(`<b>${t.name}</b><br>${t.faction ?? ''}`))
  ).addTo(map);

  document.getElementById('layer-towns').addEventListener('change', e => {
    e.target.checked ? townLayer.addTo(map) : townLayer.remove();
  });

  // Aide au placement : coordonnées au clic.
  map.on('click', e => {
    const x = Math.round(e.latlng.lng);
    const y = Math.round(e.latlng.lat);
    document.getElementById('coords').textContent = `"x": ${x}, "y": ${y}`;
  });

  // Langue.
  const select = document.getElementById('lang');
  select.value = I18N.initial();
  await I18N.load(select.value);
  select.addEventListener('change', () => I18N.load(select.value));
})();
