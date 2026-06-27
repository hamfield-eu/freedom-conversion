'use strict';

/*
 * Freedom Units — client-side unit converter + Frankfurter-backed currency.
 *
 * Each converter is bidirectional: edit either field and the other updates.
 * `to`   maps the US/imperial value (a) -> metric value (b)
 * `from` maps metric value (b) -> US/imperial value (a)
 */

// Shared live USD->EUR rate, used by the fuel-price converter and the beer card.
// Fetched once; listeners recompute when it lands.
let usdEur = null;
const rateListeners = [];
async function loadUsdEur() {
  try {
    const res = await fetch('/api/rate?from=USD&to=EUR');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    const r = Number(d.rate);
    usdEur = (isFinite(r) && r > 0) ? r : null;
  } catch { usdEur = null; }
  rateListeners.forEach(fn => fn());
}

const L_PER_GAL = 3.785411784;

const CONVERTERS = [
  // --- Distance ---
  { cat: 'Distance', name: 'Miles', a: 'mi', b: 'km',
    to: x => x * 1.609344, from: y => y / 1.609344 },
  { cat: 'Distance', name: 'Feet', a: 'ft', b: 'm',
    to: x => x * 0.3048, from: y => y / 0.3048 },
  { cat: 'Distance', name: 'Inches', a: 'in', b: 'cm',
    to: x => x * 2.54, from: y => y / 2.54 },
  { cat: 'Distance', name: 'Yards', a: 'yd', b: 'm',
    to: x => x * 0.9144, from: y => y / 0.9144 },

  // --- Speed ---
  { cat: 'Speed', name: 'Speed', a: 'mph', b: 'km/h',
    to: x => x * 1.609344, from: y => y / 1.609344 },

  // --- Temperature ---
  { cat: 'Temperature', name: 'Temperature', a: '°F', b: '°C', decimals: 1,
    to: x => (x - 32) * 5 / 9, from: y => y * 9 / 5 + 32 },

  // --- Volume ---
  { cat: 'Liquid volume', name: 'Fluid ounces', a: 'fl oz', b: 'mL',
    to: x => x * 29.5735296, from: y => y / 29.5735296 },
  { cat: 'Liquid volume', name: 'Cups (US)', a: 'cup', b: 'mL',
    to: x => x * 236.5882365, from: y => y / 236.5882365 },
  { cat: 'Liquid volume', name: 'Pints (US)', a: 'pt', b: 'L', decimals: 3,
    to: x => x * 0.473176473, from: y => y / 0.473176473 },
  { cat: 'Liquid volume', name: 'Quarts (US)', a: 'qt', b: 'L', decimals: 3,
    to: x => x * 0.946352946, from: y => y / 0.946352946 },
  { cat: 'Liquid volume', name: 'Gallons (US)', a: 'gal', b: 'L',
    to: x => x * 3.785411784, from: y => y / 3.785411784 },
  { cat: 'Liquid volume', name: 'Tablespoons', a: 'tbsp', b: 'mL',
    to: x => x * 14.78676478, from: y => y / 14.78676478 },
  { cat: 'Liquid volume', name: 'Teaspoons', a: 'tsp', b: 'mL',
    to: x => x * 4.928921594, from: y => y / 4.928921594 },

  // --- Weight ---
  { cat: 'Weight & mass', name: 'Pounds', a: 'lb', b: 'kg',
    to: x => x * 0.45359237, from: y => y / 0.45359237 },
  { cat: 'Weight & mass', name: 'Ounces', a: 'oz', b: 'g',
    to: x => x * 28.34952312, from: y => y / 28.34952312 },

  // --- Fuel economy (reciprocal) ---
  { cat: 'Fuel economy', name: 'Fuel economy', a: 'mpg', b: 'L/100km', decimals: 1,
    to: x => 235.214583 / x, from: y => 235.214583 / y },

  // --- Fuel price (needs live USD->EUR rate) ---
  { cat: 'Fuel economy', name: 'Fuel price', a: '$/gal', b: '€/L', decimals: 3, needsRate: true,
    to: x => (usdEur == null ? NaN : x * usdEur / L_PER_GAL),
    from: y => (usdEur == null ? NaN : y * L_PER_GAL / usdEur) },
];

const CURRENCIES = [
  { code: 'USD', name: 'US Dollar', flag: '🇺🇸' },
  { code: 'EUR', name: 'Euro', flag: '🇪🇺' },
  { code: 'GBP', name: 'British Pound', flag: '🇬🇧' },
  { code: 'CAD', name: 'Canadian Dollar', flag: '🇨🇦' },
  { code: 'CNY', name: 'Chinese Yuan (RMB)', flag: '🇨🇳' },
  { code: 'MXN', name: 'Mexican Peso', flag: '🇲🇽' },
];

/* ---------- helpers ---------- */

function fmt(value, decimals) {
  if (value === '' || value === null || !isFinite(value)) return '';
  const d = decimals === undefined ? 2 : decimals;
  // Trim trailing zeros for a clean look, but keep it sensible.
  const rounded = Number(value.toFixed(d));
  return String(rounded);
}

// Small localStorage helper so the app remembers your last choices.
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

function parseNum(str) {
  if (str == null) return NaN;
  const cleaned = String(str).replace(',', '.').trim();
  if (cleaned === '') return NaN;
  return Number(cleaned);
}

/* ---------- unit converter (single card, category dropdown) ---------- */

const cardsEl = document.getElementById('cards');
const statusEl = document.getElementById('status');

// stable id per converter, for remembering the last selection
CONVERTERS.forEach(c => { c.id = `${c.cat}:${c.name}`; });

const unitsLabel = document.createElement('div');
unitsLabel.className = 'section-label';
unitsLabel.textContent = 'Units';

const unitCard = document.createElement('section');
unitCard.className = 'card';
unitCard.innerHTML = '<div class="card-title"><span class="name">Unit converter</span></div>';

// category-grouped selector (<optgroup> per category)
const unitSelect = document.createElement('select');
unitSelect.className = 'cur-select unit-select';
const groups = new Map();
for (const c of CONVERTERS) {
  if (!groups.has(c.cat)) {
    const og = document.createElement('optgroup');
    og.label = c.cat;
    unitSelect.appendChild(og);
    groups.set(c.cat, og);
  }
  const opt = document.createElement('option');
  opt.value = c.id;
  opt.textContent = `${c.name} · ${c.a} ↔ ${c.b}`;
  groups.get(c.cat).appendChild(opt);
}
const unitSelRow = document.createElement('div');
unitSelRow.className = 'cur-selectors single';
unitSelRow.appendChild(unitSelect);
unitCard.appendChild(unitSelRow);

// bidirectional amount inputs
const uInA = document.createElement('input');
uInA.type = 'text'; uInA.inputMode = 'decimal'; uInA.autocomplete = 'off'; uInA.placeholder = '0';
const uInB = uInA.cloneNode();
const uFieldA = document.createElement('div'); uFieldA.className = 'field';
const uUnitA = document.createElement('span'); uUnitA.className = 'unit';
uFieldA.append(uInA, uUnitA);
const uFieldB = document.createElement('div'); uFieldB.className = 'field';
const uUnitB = document.createElement('span'); uUnitB.className = 'unit';
uFieldB.append(uInB, uUnitB);
const uSwap = document.createElement('div'); uSwap.className = 'swap'; uSwap.textContent = '⇄';
const uRow = document.createElement('div'); uRow.className = 'row';
uRow.append(uFieldA, uSwap, uFieldB);
unitCard.appendChild(uRow);

// note line (shown for rate-dependent converters like fuel price)
const unitNote = document.createElement('div');
unitNote.className = 'meta unit-note';
unitCard.appendChild(unitNote);

cardsEl.append(unitsLabel, unitCard);

let conv = CONVERTERS[0];

function renderUnitNote() {
  if (!conv.needsRate) { unitNote.textContent = ''; return; }
  unitNote.textContent = usdEur == null
    ? 'live USD→EUR rate unavailable (offline?)'
    : `live rate: 1 USD = ${fmt(usdEur, 4)} EUR`;
}
function recomputeUnit(source) {
  if (source === 'b') {
    const v = parseNum(uInB.value);
    uInA.value = isNaN(v) ? '' : fmt(conv.from(v), conv.decimals);
  } else {
    const v = parseNum(uInA.value);
    uInB.value = isNaN(v) ? '' : fmt(conv.to(v), conv.decimals);
  }
}
function applyConverter() {
  uUnitA.textContent = conv.a;
  uUnitB.textContent = conv.b;
  renderUnitNote();
  recomputeUnit('a'); // keep the left value, refresh the right
}

uInA.addEventListener('input', () => recomputeUnit('a'));
uInB.addEventListener('input', () => recomputeUnit('b'));
unitSelect.addEventListener('change', () => {
  conv = CONVERTERS.find(c => c.id === unitSelect.value) || CONVERTERS[0];
  LS.set('fc.unit', conv.id);
  applyConverter();
});
// recompute when the shared USD->EUR rate lands
rateListeners.push(() => { if (conv.needsRate) { renderUnitNote(); recomputeUnit('a'); } });

// restore last-used converter
conv = CONVERTERS.find(c => c.id === LS.get('fc.unit', '')) || CONVERTERS[0];
unitSelect.value = conv.id;
applyConverter();

/* ---------- currency (Frankfurter via backend) ---------- */

let fromCur = LS.get('fc.from', 'USD');
let toCur = LS.get('fc.to', 'EUR');
let markup = Number(LS.get('fc.markup', '0')) || 0;       // card FX markup, %
let salesTax = Number(LS.get('fc.curTax', '0')) || 0;     // US sales tax, %
let baseRate = null;   // `to` per 1 `from`, before markup
let lastDate = '';
let nextRefreshAt = 0; // epoch ms; refresh button disabled until then

if (!CURRENCIES.some(c => c.code === fromCur)) fromCur = 'USD';
if (!CURRENCIES.some(c => c.code === toCur)) toCur = 'EUR';

const curLabel = document.createElement('div');
curLabel.className = 'section-label';
curLabel.textContent = 'Currency';

const card = document.createElement('section');
card.className = 'card currency';

// header + refresh button
const head = document.createElement('div');
head.className = 'card-title';
head.innerHTML = '<span class="name">Currency</span>';
const refreshBtn = document.createElement('button');
refreshBtn.className = 'refresh';
refreshBtn.textContent = '↻';
head.appendChild(refreshBtn);
card.appendChild(head);

// currency selectors
function buildSelect(selected) {
  const sel = document.createElement('select');
  sel.className = 'cur-select';
  for (const c of CURRENCIES) {
    const opt = document.createElement('option');
    opt.value = c.code;
    opt.textContent = `${c.flag} ${c.code}`;
    if (c.code === selected) opt.selected = true;
    sel.appendChild(opt);
  }
  return sel;
}
const fromSel = buildSelect(fromCur);
const toSel = buildSelect(toCur);
const swapBtn = document.createElement('button');
swapBtn.className = 'swap-btn';
swapBtn.textContent = '⇄';
swapBtn.title = 'Swap currencies';
const selRow = document.createElement('div');
selRow.className = 'cur-selectors';
selRow.append(fromSel, swapBtn, toSel);
card.appendChild(selRow);

// amount inputs (bidirectional)
const inFrom = document.createElement('input');
inFrom.type = 'text'; inFrom.inputMode = 'decimal'; inFrom.autocomplete = 'off'; inFrom.placeholder = '0';
const inTo = inFrom.cloneNode();
const fieldFrom = document.createElement('div'); fieldFrom.className = 'field';
const unitFrom = document.createElement('span'); unitFrom.className = 'unit';
fieldFrom.append(inFrom, unitFrom);
const fieldTo = document.createElement('div'); fieldTo.className = 'field';
const unitTo = document.createElement('span'); unitTo.className = 'unit';
fieldTo.append(inTo, unitTo);
const swapGlyph = document.createElement('div'); swapGlyph.className = 'swap'; swapGlyph.textContent = '⇄';
const amtRow = document.createElement('div'); amtRow.className = 'row';
amtRow.append(fieldFrom, swapGlyph, fieldTo);
card.appendChild(amtRow);

// markup + sales-tax inputs (both fold into the effective rate)
function feeInput(labelText, value) {
  const group = document.createElement('div');
  group.className = 'fee';
  const label = document.createElement('label');
  label.textContent = labelText;
  const inp = document.createElement('input');
  inp.type = 'text'; inp.inputMode = 'decimal'; inp.autocomplete = 'off';
  inp.className = 'markup-input'; inp.placeholder = '0';
  inp.value = value ? String(value) : '';
  group.append(label, inp);
  group.insertAdjacentHTML('beforeend', '<span class="pct">%</span>');
  return { group, inp };
}
const markupFee = feeInput('Card markup', markup);
const taxFee = feeInput('Sales tax', salesTax);
const inMarkup = markupFee.inp;
const inSalesTax = taxFee.inp;
const feesRow = document.createElement('div');
feesRow.className = 'fees-row';
feesRow.append(markupFee.group, taxFee.group);
card.appendChild(feesRow);

// rate detail line
const metaEl = document.createElement('div');
metaEl.className = 'meta cur-meta';
card.appendChild(metaEl);

cardsEl.insertBefore(card, cardsEl.firstChild);
cardsEl.insertBefore(curLabel, card);

// effective rate includes the card's FX markup (applied client-side so it
// updates instantly and doesn't fragment the shared server-side rate cache).
function effectiveRate() {
  return baseRate == null ? null : baseRate * (1 + markup / 100) * (1 + salesTax / 100);
}
function updateUnits() { unitFrom.textContent = fromCur; unitTo.textContent = toCur; }

function recompute(source) {
  const er = effectiveRate();
  if (er == null) return;
  if (source === 'to') {
    const v = parseNum(inTo.value);
    inFrom.value = isNaN(v) ? '' : fmt(v / er, 2);
  } else {
    const v = parseNum(inFrom.value);
    inTo.value = isNaN(v) ? '' : fmt(v * er, 2);
  }
}

function renderMeta(note) {
  if (baseRate == null) { metaEl.textContent = note || 'rate unavailable'; return; }
  let txt = `1 ${fromCur} = ${fmt(baseRate, 4)} ${toCur}`;
  const fees = [];
  if (markup) fees.push(`+${fmt(markup, 2)}% markup`);
  if (salesTax) fees.push(`+${fmt(salesTax, 2)}% tax`);
  if (fees.length) txt += ` · ${fees.join(' ')} → ${fmt(effectiveRate(), 4)}`;
  if (lastDate) txt += ` · ${lastDate}`;
  metaEl.textContent = txt;
}

function updateRefreshBtn() {
  const remaining = nextRefreshAt - Date.now();
  if (remaining > 0) {
    refreshBtn.disabled = true;
    refreshBtn.title = `Rate is current — refresh available in ~${Math.ceil(remaining / 60000)} min`;
  } else {
    refreshBtn.disabled = false;
    refreshBtn.title = 'Refresh rate (max once per hour)';
  }
}

async function loadRate(force) {
  metaEl.textContent = 'loading…';
  inFrom.disabled = inTo.disabled = true;
  try {
    if (fromCur === toCur) {
      baseRate = 1; lastDate = '';
    } else {
      const res = await fetch(`/api/rate?from=${fromCur}&to=${toCur}${force ? '&fresh=1' : ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const r = Number(data.rate);
      if (!isFinite(r) || r <= 0) throw new Error('bad rate');
      baseRate = r;
      lastDate = data.date || '';
      if (data.nextRefreshAt) nextRefreshAt = data.nextRefreshAt;
    }
    inFrom.disabled = inTo.disabled = false;
    renderMeta();
    recompute('from');
    setStatus('');
  } catch (err) {
    baseRate = null;
    renderMeta('rate unavailable');
    setStatus('Could not load currency rate (offline or API error). Unit conversions still work.', true);
  }
  updateRefreshBtn();
}

inFrom.addEventListener('input', () => recompute('from'));
inTo.addEventListener('input', () => recompute('to'));
inMarkup.addEventListener('input', () => {
  markup = parseNum(inMarkup.value);
  if (isNaN(markup) || markup < 0) markup = 0;
  LS.set('fc.markup', String(markup));
  renderMeta();
  recompute('from');
});
inSalesTax.addEventListener('input', () => {
  salesTax = parseNum(inSalesTax.value);
  if (isNaN(salesTax) || salesTax < 0) salesTax = 0;
  LS.set('fc.curTax', String(salesTax));
  renderMeta();
  recompute('from');
});
fromSel.addEventListener('change', () => {
  fromCur = fromSel.value; LS.set('fc.from', fromCur);
  updateUnits(); nextRefreshAt = 0; loadRate(false);
});
toSel.addEventListener('change', () => {
  toCur = toSel.value; LS.set('fc.to', toCur);
  updateUnits(); nextRefreshAt = 0; loadRate(false);
});
swapBtn.addEventListener('click', () => {
  [fromCur, toCur] = [toCur, fromCur];
  fromSel.value = fromCur; toSel.value = toCur;
  LS.set('fc.from', fromCur); LS.set('fc.to', toCur);
  updateUnits(); nextRefreshAt = 0; loadRate(false);
});
refreshBtn.addEventListener('click', () => loadRate(true));

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (isError ? ' error' : '');
}

updateUnits();
loadRate(false);
setInterval(updateRefreshBtn, 30000);

/* ---------- beer price check (US beer vs NL 'vaasje') ---------- */

// Common US beer pour/packaging sizes, with volume in mL.
const BEER_SIZES = [
  { id: '12oz', label: '12 fl oz bottle/can', ml: 12 * 29.5735296 },
  { id: '16oz', label: '16 fl oz pint (US)', ml: 16 * 29.5735296 },
  { id: '19oz', label: '19.2 fl oz tallboy', ml: 19.2 * 29.5735296 },
  { id: '22oz', label: '22 fl oz bomber', ml: 22 * 29.5735296 },
  { id: '24oz', label: '24 fl oz tallboy', ml: 24 * 29.5735296 },
  { id: '32oz', label: '32 fl oz crowler', ml: 32 * 29.5735296 },
  { id: '60oz', label: '60 fl oz pitcher', ml: 60 * 29.5735296 },
];
const VAASJE_ML = 250;            // a Dutch 'vaasje' is a 250 ml glass
const VAASJE_DEFAULT_EUR = 3.60;  // typical price

// Beer/wine-in-restaurant sales tax (%) per US state. 2-letter codes match the
// state-boundary data used for the "use my location" feature. Unknown -> 0%.
const STATES = [
  { code: 'AL', name: 'Alabama', tax: 4 },        { code: 'AK', name: 'Alaska', tax: 0 },
  { code: 'AZ', name: 'Arizona', tax: 6 },        { code: 'AR', name: 'Arkansas', tax: 7 },
  { code: 'CA', name: 'California', tax: 7 },      { code: 'CO', name: 'Colorado', tax: 3 },
  { code: 'CT', name: 'Connecticut', tax: 7 },    { code: 'DE', name: 'Delaware', tax: 0 },
  { code: 'FL', name: 'Florida', tax: 6 },        { code: 'GA', name: 'Georgia', tax: 4 },
  { code: 'HI', name: 'Hawaii', tax: 4 },         { code: 'ID', name: 'Idaho', tax: 6 },
  { code: 'IL', name: 'Illinois', tax: 6 },       { code: 'IN', name: 'Indiana', tax: 7 },
  { code: 'IA', name: 'Iowa', tax: 6 },           { code: 'KS', name: 'Kansas', tax: 7 },
  { code: 'KY', name: 'Kentucky', tax: 6 },       { code: 'LA', name: 'Louisiana', tax: 5 },
  { code: 'ME', name: 'Maine', tax: 8 },          { code: 'MD', name: 'Maryland', tax: 9 },
  { code: 'MA', name: 'Massachusetts', tax: 6 },  { code: 'MI', name: 'Michigan', tax: 6 },
  { code: 'MN', name: 'Minnesota', tax: 9 },      { code: 'MS', name: 'Mississippi', tax: 7 },
  { code: 'MO', name: 'Missouri', tax: 4 },       { code: 'MT', name: 'Montana', tax: 0 },
  { code: 'NE', name: 'Nebraska', tax: 6 },       { code: 'NV', name: 'Nevada', tax: 7 },
  { code: 'NH', name: 'New Hampshire', tax: 9 },  { code: 'NJ', name: 'New Jersey', tax: 7 },
  { code: 'NM', name: 'New Mexico', tax: 5 },     { code: 'NY', name: 'New York', tax: 4 },
  { code: 'NC', name: 'North Carolina', tax: 5 }, { code: 'ND', name: 'North Dakota', tax: 5 },
  { code: 'OH', name: 'Ohio', tax: 6 },           { code: 'OK', name: 'Oklahoma', tax: 5 },
  { code: 'OR', name: 'Oregon', tax: 0 },         { code: 'PA', name: 'Pennsylvania', tax: 6 },
  { code: 'RI', name: 'Rhode Island', tax: 8 },   { code: 'SC', name: 'South Carolina', tax: 6 },
  { code: 'SD', name: 'South Dakota', tax: 4 },   { code: 'TN', name: 'Tennessee', tax: 7 },
  { code: 'TX', name: 'Texas', tax: 8 },          { code: 'UT', name: 'Utah', tax: 5 },
  { code: 'VT', name: 'Vermont', tax: 10 },       { code: 'VA', name: 'Virginia', tax: 4 },
  { code: 'WA', name: 'Washington', tax: 7 },     { code: 'WV', name: 'West Virginia', tax: 6 },
  { code: 'WI', name: 'Wisconsin', tax: 5 },      { code: 'WY', name: 'Wyoming', tax: 4 },
  { code: 'DC', name: 'District of Columbia', tax: 10 },
];
const taxFor = code => { const s = STATES.find(s => s.code === code); return s ? s.tax : 0; };

let beerSize = BEER_SIZES.find(s => s.id === LS.get('fc.beerSize', '')) || BEER_SIZES[1];
let vaasjePrice = Number(LS.get('fc.vaasje', '')) || VAASJE_DEFAULT_EUR;
let beerState = LS.get('fc.state', ''); // '' = none / 0% tax

const beerLabel = document.createElement('div');
beerLabel.className = 'section-label';
beerLabel.textContent = 'Beer check';

const beerCard = document.createElement('section');
beerCard.className = 'card beer';
beerCard.innerHTML = '<div class="card-title"><span class="name">Beer price check 🍺</span></div>';

// size selector
const beerSel = document.createElement('select');
beerSel.className = 'cur-select unit-select';
for (const s of BEER_SIZES) {
  const opt = document.createElement('option');
  opt.value = s.id;
  opt.textContent = `${s.label} · ${Math.round(s.ml)} ml`;
  if (s.id === beerSize.id) opt.selected = true;
  beerSel.appendChild(opt);
}
const beerSelRow = document.createElement('div');
beerSelRow.className = 'cur-selectors single';
beerSelRow.appendChild(beerSel);
beerCard.appendChild(beerSelRow);

// state selector (for sales tax)
const stateSel = document.createElement('select');
stateSel.className = 'cur-select unit-select';
const noState = document.createElement('option');
noState.value = '';
noState.textContent = 'No state · 0% tax';
stateSel.appendChild(noState);
for (const s of STATES) {
  const opt = document.createElement('option');
  opt.value = s.code;
  opt.textContent = `${s.name} · ${s.tax}%`;
  if (s.code === beerState) opt.selected = true;
  stateSel.appendChild(opt);
}
const stateRow = document.createElement('div');
stateRow.className = 'cur-selectors single';
stateRow.appendChild(stateSel);
beerCard.appendChild(stateRow);

// "use my location" -> resolve GPS to a state (offline, via bundled polygons)
const locBtn = document.createElement('button');
locBtn.className = 'loc-btn';
locBtn.textContent = '📍 Use my location';
const locStatus = document.createElement('span');
locStatus.className = 'beer-loc';
const locRow = document.createElement('div');
locRow.className = 'loc-row';
locRow.append(locBtn, locStatus);
beerCard.appendChild(locRow);

// price inputs: US beer price (USD) and vaasje price (EUR)
function priceField(unit, placeholder) {
  const inp = document.createElement('input');
  inp.type = 'text'; inp.inputMode = 'decimal'; inp.autocomplete = 'off'; inp.placeholder = placeholder;
  const field = document.createElement('div'); field.className = 'field';
  const u = document.createElement('span'); u.className = 'unit'; u.textContent = unit;
  field.append(inp, u);
  return { inp, field };
}
const usPrice = priceField('US price (USD)', '0');
const nlPrice = priceField('Vaasje (EUR)', '3.60');
nlPrice.inp.value = String(vaasjePrice);
const vs = document.createElement('div'); vs.className = 'swap'; vs.textContent = 'vs';
const beerRow = document.createElement('div'); beerRow.className = 'row';
beerRow.append(usPrice.field, vs, nlPrice.field);
beerCard.appendChild(beerRow);

// comparison result
const beerResult = document.createElement('div');
beerResult.className = 'beer-result';
beerResult.innerHTML =
  '<div class="beer-col"><span class="beer-eur" id="beerUs">–</span>' +
  '<span class="beer-cap">US beer / vaasje</span></div>' +
  '<div class="beer-vs">vs</div>' +
  '<div class="beer-col"><span class="beer-eur" id="beerNl">–</span>' +
  '<span class="beer-cap">NL vaasje (250 ml)</span></div>';
beerCard.appendChild(beerResult);

const beerNote = document.createElement('div');
beerNote.className = 'meta beer-note';
beerCard.appendChild(beerNote);

const beerVerdict = document.createElement('div');
beerVerdict.className = 'beer-verdict';
beerCard.appendChild(beerVerdict);

const beerDisclaimer = document.createElement('div');
beerDisclaimer.className = 'beer-disclaimer';
beerDisclaimer.textContent = 'State rates only — local/city taxes may add a bit more.';
beerCard.appendChild(beerDisclaimer);

cardsEl.append(beerLabel, beerCard);

const beerUsEl = beerCard.querySelector('#beerUs');
const beerNlEl = beerCard.querySelector('#beerNl');

const money = v => (isFinite(v) ? v.toFixed(2) : '–'); // prices always show cents

function computeBeer() {
  beerNlEl.textContent = `€${money(vaasjePrice)}`;
  const usd = parseNum(usPrice.inp.value);
  if (usdEur == null) { beerUsEl.textContent = '–'; beerNote.textContent = 'currency rate unavailable'; beerVerdict.textContent = ''; return; }
  if (isNaN(usd) || usd <= 0) { beerUsEl.textContent = '–'; beerNote.textContent = ''; beerVerdict.textContent = ''; return; }

  const tax = taxFor(beerState);
  const usdTaxed = usd * (1 + tax / 100);           // add state sales tax
  const eur = usdTaxed * usdEur;                    // full beer in EUR
  const perVaasje = (eur / beerSize.ml) * VAASJE_ML; // normalized to 250 ml
  beerUsEl.textContent = `€${money(perVaasje)}`;
  const taxPart = tax > 0 ? ` +${tax}% tax = $${money(usdTaxed)}` : '';
  beerNote.textContent = `$${money(usd)}${taxPart} = €${money(eur)} for ${Math.round(beerSize.ml)} ml (€${money(eur / beerSize.ml * 1000)}/L)`;

  if (isNaN(vaasjePrice) || vaasjePrice <= 0) { beerVerdict.textContent = ''; return; }
  const diff = (perVaasje - vaasjePrice) / vaasjePrice * 100;
  if (Math.abs(diff) < 1) {
    beerVerdict.textContent = '≈ same price as a vaasje 🍻';
    beerVerdict.className = 'beer-verdict';
  } else if (diff < 0) {
    beerVerdict.textContent = `≈ ${fmt(-diff, 0)}% cheaper than a vaasje 🎉`;
    beerVerdict.className = 'beer-verdict good';
  } else {
    beerVerdict.textContent = `≈ ${fmt(diff, 0)}% pricier than a vaasje 😬`;
    beerVerdict.className = 'beer-verdict bad';
  }
}

beerSel.addEventListener('change', () => {
  beerSize = BEER_SIZES.find(s => s.id === beerSel.value) || BEER_SIZES[0];
  LS.set('fc.beerSize', beerSize.id);
  computeBeer();
});
stateSel.addEventListener('change', () => {
  beerState = stateSel.value;
  LS.set('fc.state', beerState);
  computeBeer();
});

// --- geolocation -> US state, via bundled boundary polygons (no external API) ---
let statesGeo = null;
async function ensureStatesGeo() {
  if (statesGeo) return statesGeo;
  const res = await fetch('/data/us-states.geojson');
  if (!res.ok) throw new Error(`geo ${res.status}`);
  statesGeo = await res.json();
  return statesGeo;
}
// ray-casting point-in-ring; coords are [lng, lat]
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function pointInPolygon(x, y, poly) { // poly = [outerRing, ...holes]
  if (!pointInRing(x, y, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) if (pointInRing(x, y, poly[k])) return false;
  return true;
}
function findState(lat, lng) {
  // 1) exact containment
  for (const f of statesGeo.features) {
    const g = f.geometry;
    if (g.type === 'Polygon') {
      if (pointInPolygon(lng, lat, g.coordinates)) return f.properties.code;
    } else { // MultiPolygon
      for (const poly of g.coordinates) if (pointInPolygon(lng, lat, poly)) return f.properties.code;
    }
  }
  // 2) fallback: nearest boundary vertex within ~0.6° (~60 km). Handles coastal
  // points and simplified shorelines (e.g. Honolulu) without matching far-away
  // non-US locations.
  let best = null, bestD = Infinity;
  for (const f of statesGeo.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) for (const pt of ring) {
      const dx = pt[0] - lng, dy = pt[1] - lat, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = f.properties.code; }
    }
  }
  return bestD <= 0.6 * 0.6 ? best : null;
}
function setLoc(msg, isError) {
  locStatus.textContent = msg;
  locStatus.className = 'beer-loc' + (isError ? ' error' : '');
}

locBtn.addEventListener('click', () => {
  if (!('geolocation' in navigator)) { setLoc('Location not supported — pick manually', true); return; }
  setLoc('Locating…');
  locBtn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        await ensureStatesGeo();
        const code = findState(pos.coords.latitude, pos.coords.longitude);
        if (!code) { setLoc('Not in a US state — pick manually', true); return; }
        beerState = code;
        stateSel.value = code;
        LS.set('fc.state', code);
        computeBeer();
        const s = STATES.find(s => s.code === code);
        setLoc(`📍 ${s.name} · ${s.tax}%`);
      } catch {
        setLoc('Could not load map data', true);
      } finally {
        locBtn.disabled = false;
      }
    },
    (err) => {
      locBtn.disabled = false;
      setLoc(err.code === 1 ? 'Permission denied — pick manually' : 'Location unavailable — pick manually', true);
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
  );
});
usPrice.inp.addEventListener('input', computeBeer);
nlPrice.inp.addEventListener('input', () => {
  vaasjePrice = parseNum(nlPrice.inp.value);
  if (!isNaN(vaasjePrice) && vaasjePrice > 0) LS.set('fc.vaasje', String(vaasjePrice));
  computeBeer();
});

// recompute the beer card whenever the shared USD->EUR rate updates
rateListeners.push(computeBeer);
computeBeer();

// kick off the single shared rate fetch (drives fuel-price + beer cards)
loadUsdEur();

/* ---------- "Add to Home Screen" prompt (only when not installed) ---------- */

// Shows a one-time, dismissible sheet explaining how to install the PWA.
// Skipped entirely when the app is already running standalone (from the home
// screen). On Chromium we offer a native one-tap install; on iOS/other browsers
// we show manual steps, since they don't fire `beforeinstallprompt`.
(function installPrompt() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true            // iOS Safari
    || document.referrer.startsWith('android-app://');  // Android TWA
  if (isStandalone) return; // already installed — nothing to nag about

  const DISMISS_KEY = 'fc.a2hs';     // 'dismissed' = never show again
  const SNOOZE_KEY = 'fc.a2hsSnooze'; // epoch ms; hidden until then
  if (LS.get(DISMISS_KEY, '') === 'dismissed') return;
  if (Date.now() < (Number(LS.get(SNOOZE_KEY, '0')) || 0)) return;

  const ua = navigator.userAgent || '';
  const isIOS = /iphone|ipad|ipod/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS
  const isAndroid = /android/i.test(ua);

  let deferredPrompt = null; // Chromium's captured beforeinstallprompt event
  let shown = false;
  let overlay, sheet, body, actions;

  function build() {
    overlay = document.createElement('div');
    overlay.className = 'a2hs-overlay';

    sheet = document.createElement('div');
    sheet.className = 'a2hs-sheet';

    const close = document.createElement('button');
    close.className = 'a2hs-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', () => dismiss('forever'));

    const icon = document.createElement('img');
    icon.className = 'a2hs-icon';
    icon.src = '/icons/icon-192.png';
    icon.alt = '';

    const title = document.createElement('h2');
    title.className = 'a2hs-title';
    title.textContent = 'Add Freedom Units to your Home Screen';

    body = document.createElement('div');
    body.className = 'a2hs-body';

    actions = document.createElement('div');
    actions.className = 'a2hs-actions';

    sheet.append(close, icon, title, body, actions);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    // tapping the dimmed backdrop snoozes (a soft "not now")
    overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss('snooze'); });
  }

  function addButton(label, fn, variant) {
    const b = document.createElement('button');
    b.className = 'a2hs-btn ' + variant;
    b.textContent = label;
    b.addEventListener('click', fn);
    actions.appendChild(b);
  }

  function renderNative() {
    body.innerHTML = '<p>Install the app for a full-screen, offline-ready experience — just one tap.</p>';
    addButton('Install', async () => {
      if (!deferredPrompt) { dismiss('snooze'); return; }
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch {}
      deferredPrompt = null;
      dismiss('forever');
    }, 'primary');
    addButton('Maybe later', () => dismiss('snooze'), 'ghost');
  }

  function renderIOS() {
    body.innerHTML =
      '<p>Install the app for a full-screen, offline-ready experience:</p>' +
      '<ol class="a2hs-steps">' +
        '<li>Tap the <strong>Share</strong> button ' +
          '<svg class="a2hs-glyph" viewBox="0 0 24 24" width="18" height="18" fill="none" ' +
          'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/>' +
          '<path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></svg> in the toolbar.</li>' +
        '<li>Scroll down and choose <strong>Add to Home Screen</strong> ' +
          '<span class="a2hs-glyph-box">+</span>.</li>' +
        '<li>Tap <strong>Add</strong> in the top-right corner.</li>' +
      '</ol>';
    addButton('Got it', () => dismiss('forever'), 'primary');
  }

  function renderManual() {
    body.innerHTML =
      '<p>Install the app for a full-screen, offline-ready experience:</p>' +
      '<ol class="a2hs-steps">' +
        '<li>Open the browser menu <span class="a2hs-glyph-box">⋮</span>.</li>' +
        '<li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>' +
      '</ol>';
    addButton('Got it', () => dismiss('forever'), 'primary');
  }

  function show(kind) {
    if (shown) return;
    if (!overlay) build();
    body.innerHTML = '';
    actions.innerHTML = '';
    if (kind === 'native') renderNative();
    else if (isIOS) renderIOS();
    else renderManual();
    shown = true;
    void overlay.offsetWidth; // force reflow so the slide-up transition runs
    overlay.classList.add('open');
  }

  function dismiss(mode) {
    if (mode === 'forever') LS.set(DISMISS_KEY, 'dismissed');
    else if (mode === 'snooze') LS.set(SNOOZE_KEY, String(Date.now() + 7 * 24 * 3600 * 1000));
    if (overlay) {
      overlay.classList.remove('open');
      const o = overlay;
      setTimeout(() => o.remove(), 280);
      overlay = null;
    }
    shown = false;
  }

  // Chromium offers a real install prompt — capture it for a one-tap button.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    show('native');
  });
  // If the user installs mid-session, drop the sheet for good.
  window.addEventListener('appinstalled', () => dismiss('forever'));

  // iOS (and some Android browsers) never fire beforeinstallprompt. Give
  // Chromium a moment to fire first, then fall back to manual instructions.
  setTimeout(() => {
    if (shown || deferredPrompt) return;
    if (isIOS || isAndroid) show('manual');
  }, 1500);
})();

/* ---------- service worker (offline support) ---------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
