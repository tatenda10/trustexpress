import { query } from '../db/connection.js';

export const DEFAULT_INTERCITY_DISTANCE_KM = 80;
export const HIRE_COMMISSION_SOURCE_TYPE = 'hire_commission';

const SETTINGS_CACHE_TTL_MS = 15_000;

let settingsCache = null;
let settingsCacheLoadedAt = 0;

export const DEFAULT_HIRE_COMMISSION_BANDS = [
  {
    bandKey: 'local',
    label: 'Local vehicle hires and deliveries',
    description: 'Small local bookings. Commission is taken on the agreed hire charge only.',
    ratePercent: 9.9,
    minCommissionUsd: 0,
    matchTripType: 'local',
    categorySlugs: [],
    priority: 10,
    isDefault: true,
    sortOrder: 1,
  },
  {
    bandKey: 'intercity',
    label: 'Intercity hires',
    description: 'Longer trips between cities. Uses the intercity distance threshold when trip type is not set.',
    ratePercent: 8,
    minCommissionUsd: 0,
    matchTripType: 'intercity',
    categorySlugs: [],
    priority: 20,
    isDefault: false,
    sortOrder: 2,
  },
  {
    bandKey: 'large_vehicle',
    label: 'Large vehicles',
    description: 'Sprinters, Iveco, Hiace, 18-seaters and similar high-capacity vehicles.',
    ratePercent: 7,
    minCommissionUsd: 0,
    matchTripType: 'any',
    categorySlugs: ['sprinter', 'iveco', 'hiace', 'eighteen_seater_plus', 'bus', 'caravan'],
    priority: 30,
    isDefault: false,
    sortOrder: 3,
  },
  {
    bandKey: 'lorry_move',
    label: 'Lorries and major property moves',
    description: 'Trucks, lorries and moving vans. Higher-value jobs with a lower percent and a US$5 minimum.',
    ratePercent: 5,
    minCommissionUsd: 5,
    matchTripType: 'any',
    categorySlugs: ['lorry', 'truck', 'moving_van'],
    priority: 40,
    isDefault: false,
    sortOrder: 4,
  },
];

function normalizeMoney(value, fallback = 0) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return Math.round(amount * 100) / 100;
}

function clampRate(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(normalizeMoney(parsed), 0), 100);
}

function coerceBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
}

function slugifyKey(value, fallback = '') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback;
}

function parseCategorySlugs(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => slugifyKey(item)).filter(Boolean))];
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return [...new Set(parsed.map((item) => slugifyKey(item)).filter(Boolean))];
      }
    } catch {
      // comma-separated fallback
    }
    return [...new Set(
      trimmed
        .split(/[,\n]/)
        .map((item) => slugifyKey(item))
        .filter(Boolean)
    )];
  }
  return [];
}

function normalizeTripType(value, fallback = null) {
  const tripType = String(value || '').trim().toLowerCase();
  if (tripType === 'local' || tripType === 'intercity') return tripType;
  return fallback;
}

function normalizeMatchTripType(value, fallback = 'any') {
  const match = String(value || '').trim().toLowerCase();
  if (match === 'any' || match === 'local' || match === 'intercity') return match;
  return fallback;
}

function getDefaultSettings() {
  return {
    enabled: true,
    intercityDistanceKm: DEFAULT_INTERCITY_DISTANCE_KM,
    commissionBaseNote: 'Commission is calculated on the agreed transport charge only. Tolls, parking and other separately listed expenses are excluded.',
    bands: DEFAULT_HIRE_COMMISSION_BANDS.map((band) => ({ ...band })),
    updatedByAdminId: null,
    createdAt: null,
    updatedAt: null,
  };
}

function shapeBand(row, fallback = {}) {
  return {
    id: row?.id == null ? fallback.id || null : Number(row.id),
    bandKey: slugifyKey(row?.band_key || row?.bandKey, fallback.bandKey || ''),
    label: String(row?.label || fallback.label || '').trim(),
    description: String(row?.description || fallback.description || '').trim() || null,
    ratePercent: clampRate(row?.rate_percent ?? row?.ratePercent, fallback.ratePercent ?? 0),
    minCommissionUsd: Math.max(0, normalizeMoney(row?.min_commission_usd ?? row?.minCommissionUsd, fallback.minCommissionUsd ?? 0)),
    matchTripType: normalizeMatchTripType(row?.match_trip_type ?? row?.matchTripType, fallback.matchTripType || 'any'),
    categorySlugs: parseCategorySlugs(row?.category_slugs ?? row?.categorySlugs ?? fallback.categorySlugs),
    priority: Number.isFinite(Number(row?.priority ?? fallback.priority)) ? Number(row?.priority ?? fallback.priority) : 0,
    isDefault: coerceBoolean(row?.is_default ?? row?.isDefault, fallback.isDefault === true),
    sortOrder: Number.isFinite(Number(row?.sort_order ?? row?.sortOrder)) ? Number(row?.sort_order ?? row?.sortOrder) : 0,
  };
}

function shapeSettings(settingsRow, bandRows) {
  const defaults = getDefaultSettings();
  const bands = (Array.isArray(bandRows) && bandRows.length
    ? bandRows.map((row) => shapeBand(row))
    : defaults.bands
  )
    .filter((band) => band.bandKey && band.label)
    .sort((a, b) => (a.sortOrder - b.sortOrder) || (b.priority - a.priority));

  return {
    enabled: coerceBoolean(settingsRow?.enabled, defaults.enabled),
    intercityDistanceKm: Math.max(
      1,
      normalizeMoney(settingsRow?.intercity_distance_km, defaults.intercityDistanceKm) || defaults.intercityDistanceKm
    ),
    commissionBaseNote: defaults.commissionBaseNote,
    bands,
    updatedByAdminId: settingsRow?.updated_by_admin_id || null,
    createdAt: settingsRow?.created_at ? new Date(settingsRow.created_at).toISOString() : null,
    updatedAt: settingsRow?.updated_at ? new Date(settingsRow.updated_at).toISOString() : null,
  };
}

function setSettingsCache(settings) {
  settingsCache = settings;
  settingsCacheLoadedAt = Date.now();
  return settings;
}

async function ensureHireCommissionRows() {
  const defaults = getDefaultSettings();
  await query(
    `INSERT INTO hire_commission_settings (id, enabled, intercity_distance_km)
     SELECT 1, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM hire_commission_settings WHERE id = 1
     )`,
    [defaults.enabled ? 1 : 0, defaults.intercityDistanceKm]
  );

  for (const band of defaults.bands) {
    await query(
      `INSERT INTO hire_commission_bands (
         band_key, label, description, rate_percent, min_commission_usd,
         match_trip_type, category_slugs, priority, is_default, sort_order
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM hire_commission_bands WHERE band_key = ?
       )`,
      [
        band.bandKey,
        band.label,
        band.description,
        band.ratePercent,
        band.minCommissionUsd,
        band.matchTripType,
        JSON.stringify(band.categorySlugs),
        band.priority,
        band.isDefault ? 1 : 0,
        band.sortOrder,
        band.bandKey,
      ]
    );
  }
}

export function resolveHireTripType({
  tripType = null,
  distanceKm = null,
  intercityDistanceKm = DEFAULT_INTERCITY_DISTANCE_KM,
} = {}) {
  const explicit = normalizeTripType(tripType);
  if (explicit) return explicit;
  const distance = Number(distanceKm);
  const threshold = Number(intercityDistanceKm) > 0 ? Number(intercityDistanceKm) : DEFAULT_INTERCITY_DISTANCE_KM;
  if (Number.isFinite(distance) && distance >= threshold) return 'intercity';
  return 'local';
}

export function resolveHireCommissionBand({
  bands = DEFAULT_HIRE_COMMISSION_BANDS,
  category = null,
  tripType = 'local',
} = {}) {
  const list = Array.isArray(bands) && bands.length ? bands : DEFAULT_HIRE_COMMISSION_BANDS;
  const categorySlug = slugifyKey(category);
  const resolvedTripType = normalizeTripType(tripType, 'local');

  const categoryMatches = list
    .filter((band) => categorySlug && (band.categorySlugs || []).includes(categorySlug))
    .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
  if (categoryMatches[0]) return categoryMatches[0];

  const tripMatches = list
    .filter((band) => {
      const slugs = band.categorySlugs || [];
      if (slugs.length) return false;
      return band.matchTripType === resolvedTripType || band.matchTripType === 'any';
    })
    .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
  if (tripMatches[0]) return tripMatches[0];

  return list.find((band) => band.isDefault) || list[0] || DEFAULT_HIRE_COMMISSION_BANDS[0];
}

export function calculateHireCommission({
  transportAmount,
  expensesAmount = 0,
  band,
} = {}) {
  const transport = Math.max(0, normalizeMoney(transportAmount));
  const expenses = Math.max(0, normalizeMoney(expensesAmount));
  const commissionBase = Math.max(0, normalizeMoney(transport - expenses));
  const ratePercent = clampRate(band?.ratePercent, 0);
  const minCommission = Math.max(0, normalizeMoney(band?.minCommissionUsd));
  const percentAmount = normalizeMoney(commissionBase * (ratePercent / 100));
  const commissionAmount = commissionBase > 0
    ? normalizeMoney(Math.max(percentAmount, minCommission > 0 ? minCommission : 0))
    : 0;

  return {
    transportAmount: transport,
    expensesAmount: expenses,
    commissionBase,
    commissionRatePercent: ratePercent,
    minCommissionUsd: minCommission,
    commissionAmount,
    operatorReceives: normalizeMoney(Math.max(0, transport - commissionAmount)),
  };
}

export function previewHireCommission({
  settings,
  category = null,
  tripType = null,
  distanceKm = null,
  transportAmount,
  expensesAmount = 0,
} = {}) {
  const resolvedSettings = settings || getDefaultSettings();
  const resolvedTripType = resolveHireTripType({
    tripType,
    distanceKm,
    intercityDistanceKm: resolvedSettings.intercityDistanceKm,
  });
  const band = resolveHireCommissionBand({
    bands: resolvedSettings.bands,
    category,
    tripType: resolvedTripType,
  });
  const calc = calculateHireCommission({
    transportAmount,
    expensesAmount,
    band,
  });

  return {
    enabled: resolvedSettings.enabled !== false,
    tripType: resolvedTripType,
    category: slugifyKey(category) || null,
    band,
    ...calc,
  };
}

export async function getHireCommissionSettings({ force = false } = {}) {
  if (
    !force
    && settingsCache
    && (Date.now() - settingsCacheLoadedAt) < SETTINGS_CACHE_TTL_MS
  ) {
    return settingsCache;
  }

  try {
    await ensureHireCommissionRows();
    const [settingsRow] = await query(
      `SELECT * FROM hire_commission_settings WHERE id = 1 LIMIT 1`
    );
    const bandRows = await query(
      `SELECT * FROM hire_commission_bands ORDER BY sort_order ASC, priority DESC, id ASC`
    );
    return setSettingsCache(shapeSettings(settingsRow || null, bandRows));
  } catch (error) {
    console.warn('[hire-commission] Falling back to defaults', {
      message: error?.message || String(error),
    });
    return setSettingsCache(getDefaultSettings());
  }
}

export async function updateHireCommissionSettings({
  enabled,
  intercityDistanceKm,
  bands,
  adminUserId = null,
} = {}) {
  await ensureHireCommissionRows();
  const current = await getHireCommissionSettings({ force: true });

  const nextEnabled = enabled === undefined
    ? current.enabled
    : coerceBoolean(enabled, current.enabled);
  const nextThreshold = intercityDistanceKm === undefined
    ? current.intercityDistanceKm
    : normalizeMoney(intercityDistanceKm, NaN);

  if (!Number.isFinite(nextThreshold) || nextThreshold < 1) {
    const error = new Error('Intercity distance threshold must be at least 1 km');
    error.status = 400;
    throw error;
  }

  const incomingBands = Array.isArray(bands) ? bands : current.bands;
  const nextBands = incomingBands
    .map((band, index) => {
      const currentBand = current.bands.find((item) => item.bandKey === slugifyKey(band.bandKey || band.band_key))
        || DEFAULT_HIRE_COMMISSION_BANDS.find((item) => item.bandKey === slugifyKey(band.bandKey || band.band_key))
        || {};
      const shaped = shapeBand({
        ...band,
        band_key: band.bandKey || band.band_key,
        rate_percent: band.ratePercent ?? band.rate_percent,
        min_commission_usd: band.minCommissionUsd ?? band.min_commission_usd,
        match_trip_type: band.matchTripType ?? band.match_trip_type,
        category_slugs: band.categorySlugs ?? band.category_slugs,
        is_default: band.isDefault ?? band.is_default,
        sort_order: band.sortOrder ?? band.sort_order ?? index + 1,
      }, currentBand);
      return shaped;
    })
    .filter((band) => band.bandKey && band.label);

  if (!nextBands.length) {
    const error = new Error('At least one hire commission band is required');
    error.status = 400;
    throw error;
  }

  const defaultCount = nextBands.filter((band) => band.isDefault).length;
  if (defaultCount === 0) {
    nextBands[0].isDefault = true;
  }

  await query(
    `UPDATE hire_commission_settings
     SET enabled = ?,
         intercity_distance_km = ?,
         updated_by_admin_id = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [nextEnabled ? 1 : 0, nextThreshold, adminUserId]
  );

  const incomingKeys = new Set(nextBands.map((band) => band.bandKey));
  const existingRows = await query(`SELECT id, band_key FROM hire_commission_bands`);
  for (const row of existingRows) {
    if (!incomingKeys.has(slugifyKey(row.band_key))) {
      await query(`DELETE FROM hire_commission_bands WHERE id = ?`, [row.id]);
    }
  }

  for (const [index, band] of nextBands.entries()) {
    await query(
      `INSERT INTO hire_commission_bands (
         band_key, label, description, rate_percent, min_commission_usd,
         match_trip_type, category_slugs, priority, is_default, sort_order
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         label = VALUES(label),
         description = VALUES(description),
         rate_percent = VALUES(rate_percent),
         min_commission_usd = VALUES(min_commission_usd),
         match_trip_type = VALUES(match_trip_type),
         category_slugs = VALUES(category_slugs),
         priority = VALUES(priority),
         is_default = VALUES(is_default),
         sort_order = VALUES(sort_order),
         updated_at = CURRENT_TIMESTAMP`,
      [
        band.bandKey,
        band.label,
        band.description,
        band.ratePercent,
        band.minCommissionUsd,
        band.matchTripType,
        JSON.stringify(band.categorySlugs || []),
        Number.isFinite(Number(band.priority)) ? Number(band.priority) : (index + 1) * 10,
        band.isDefault ? 1 : 0,
        Number.isFinite(Number(band.sortOrder)) ? Number(band.sortOrder) : index + 1,
      ]
    );
  }

  return getHireCommissionSettings({ force: true });
}

export async function previewHireCommissionFromSettings(input = {}) {
  const settings = await getHireCommissionSettings();
  return previewHireCommission({ settings, ...input });
}
