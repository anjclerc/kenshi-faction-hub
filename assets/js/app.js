// Carte interactive Kenshi (Leaflet, CRS.Simple).
// Coordonnées = pixels de l'image 8192 x 8192 : x vers la droite, y vers le bas, origine en haut à gauche.
// Conversion depuis le monde du jeu : pixel = (coordonnée monde + 147456) / 36.

// Lieux du jeu (data/towns.json) : couleur et taille par catégorie.
const PLACE_STYLES = {
  town:     { color: '#f4e7c5', radius: 7 },
  village:  { color: '#7fd1d1', radius: 5 },
  ruin:     { color: '#e0a53a', radius: 5 },
  camp:     { color: '#e0603a', radius: 5 },
  fortress: { color: '#b02a2a', radius: 7 },
  nest:     { color: '#9b59b6', radius: 4 }
};

// Marqueurs posés par les joueurs (data/markers.json).
const MARKER_STYLES = {
  own_base:     '#3a8fe0',
  allied_city:  '#3ac46b',
  allied_base:  '#2a9150',
  enemy_base:   '#e03a3a',
  loot:         '#f2c94c',
  resource:     '#a0703a',
  danger:       '#9b59b6',
  other:        '#999999'
};

(async () => {
  const [config, places, markers] = await Promise.all(
    ['data/map.json', 'data/towns.json', 'data/markers.json'].map(u => fetch(u).then(r => r.json()))
  );
  const Z = config.maxNativeZoom;

  const map = L.map('map', { crs: L.CRS.Simple, minZoom: 0, maxZoom: Z + 1 });
  const toLatLng = (x, y) => map.unproject([x, y], Z);
  const toPixel = latlng => map.project(latlng, Z).round();
  const bounds = L.latLngBounds(toLatLng(0, config.size), toLatLng(config.size, 0));

  L.tileLayer(config.tiles, {
    bounds, noWrap: true, maxNativeZoom: Z, maxZoom: Z + 1,
    attribution: 'Kenshi © Lo-Fi Games'
  }).addTo(map);
  map.fitBounds(bounds);
  map.setMaxBounds(bounds.pad(0.2));

  const dot = (x, y, color, radius) => L.circleMarker(toLatLng(x, y), {
    radius, color: '#000', weight: 1, fillColor: color, fillOpacity: 0.9
  });

  // Un calque par catégorie de lieu.
  const layers = {};
  for (const [cat, s] of Object.entries(PLACE_STYLES)) {
    layers[`place.${cat}`] = { color: s.color, group: L.layerGroup(
      places.filter(p => p.category === cat)
            .map(p => dot(p.x, p.y, s.color, s.radius).bindTooltip(p.name))
    ), on: cat !== 'nest' };
  }

  // Marqueurs des joueurs.
  const markerLayer = L.layerGroup();
  const addMarker = m => dot(m.x, m.y, MARKER_STYLES[m.type] ?? MARKER_STYLES.other, 8)
    .bindTooltip(() => `${m.name} (${I18N.t('marker.' + m.type)})`).addTo(markerLayer);
  markers.forEach(addMarker);
  layers.markers = { color: '#ffffff', group: markerLayer, on: true };

  // Cases à cocher des calques.
  const box = document.getElementById('layers');
  for (const [key, l] of Object.entries(layers)) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" ${l.on ? 'checked' : ''}>
      <i class="swatch" style="background:${l.color}"></i> <span data-i18n="layers.${key}"></span>`;
    label.querySelector('input').addEventListener('change', e => {
      e.target.checked ? l.group.addTo(map) : l.group.remove();
    });
    if (l.on) l.group.addTo(map);
    box.appendChild(label);
  }

  // Ajout d'un marqueur : clic sur la carte -> ligne JSON à copier dans data/markers.json.
  const typeSelect = document.getElementById('marker-type');
  for (const t of Object.keys(MARKER_STYLES)) {
    const o = document.createElement('option');
    o.value = t; o.dataset.i18n = 'marker.' + t;
    typeSelect.appendChild(o);
  }
  let placing = false;
  document.getElementById('marker-place').addEventListener('click', () => {
    placing = true;
    document.getElementById('marker-hint').textContent = I18N.t('marker.click');
  });

  map.on('click', e => {
    const p = toPixel(e.latlng);
    const out = document.getElementById('marker-json');
    if (!placing) {
      out.value = `"x": ${p.x}, "y": ${p.y}`;
      return;
    }
    placing = false;
    const m = {
      name: document.getElementById('marker-name').value || I18N.t('marker.' + typeSelect.value),
      type: typeSelect.value, x: p.x, y: p.y
    };
    addMarker(m);
    out.value = JSON.stringify(m);
    document.getElementById('marker-hint').textContent = I18N.t('marker.copy');
  });

  // Langue.
  const select = document.getElementById('lang');
  select.value = I18N.initial();
  await I18N.load(select.value);
  select.addEventListener('change', () => I18N.load(select.value));
})();
