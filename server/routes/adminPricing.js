import { Router } from 'express';
import { query, withTransaction } from '../db/connection.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import {
  getDynamicPricingSettings,
  listSurgeRules,
  PRICING_TIME_ZONE,
} from '../lib/surge-pricing.js';

const router = Router();

const DEFAULT_TIERS = [
  { tierKey: 'trust-express', tierName: 'Trust Express', sortOrder: 0 },
  { tierKey: 'trust-xl', tierName: 'Trust XL', sortOrder: 1 },
  { tierKey: 'trust-luxury', tierName: 'Trust Luxury', sortOrder: 2 },
];

function normalizeTime(value) {
  const match = String(value || '').trim().match(/^(\d{2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return `${match[1]}:${match[2]}`;
}

function normalizeDate(value) {
  const date = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function normalizeSurgeRule(rule, index) {
  const weekdays = [...new Set((Array.isArray(rule?.weekdays) ? rule.weekdays : [])
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
  const startTime = normalizeTime(rule?.startTime);
  const endTime = normalizeTime(rule?.endTime);
  const multiplier = Number(rule?.multiplier);
  const startsOn = normalizeDate(rule?.startsOn);
  const endsOn = normalizeDate(rule?.endsOn);

  if (!String(rule?.name || '').trim()) throw new Error(`Rule ${index + 1} needs a name`);
  if (!weekdays.length) throw new Error(`Rule ${index + 1} needs at least one weekday`);
  if (!startTime || !endTime || startTime === endTime) throw new Error(`Rule ${index + 1} needs different valid start and end times`);
  if (!(multiplier > 1 && multiplier <= 5)) throw new Error(`Rule ${index + 1} multiplier must be greater than 1 and no more than 5`);
  if (startsOn && endsOn && startsOn > endsOn) throw new Error(`Rule ${index + 1} end date must be after its start date`);

  return {
    name: String(rule.name).trim().slice(0, 120),
    tierKey: String(rule?.tierKey || '').trim().toLowerCase() || null,
    weekdays: weekdays.join(','),
    startTime,
    endTime,
    multiplier,
    startsOn,
    endsOn,
    isActive: rule?.isActive === false ? 0 : 1,
  };
}

function mapTier(row) {
  return {
    id: row.id,
    tierKey: row.tier_key,
    tierName: row.tier_name,
    pricePerKm: Number(row.price_per_km || 0),
    baseFare: Number(row.base_fare || 0),
    perMinuteRate: Number(row.per_minute_rate || 0),
    minimumFare: Number(row.minimum_fare || 0),
    isActive: !!row.is_active,
    sortOrder: Number(row.sort_order || 0),
  };
}

async function resolveUniversalRegion() {
  const regionRows = await query(
    `SELECT id, currency_code
     FROM operating_regions
     ORDER BY is_active DESC, id ASC
     LIMIT 1`
  );

  const region = regionRows[0];
  if (!region) {
    throw new Error('No operating region found');
  }

  return region;
}

router.get('/', requireAdminAuth, requirePermission('pricing.read'), async (req, res) => {
  try {
    const region = await resolveUniversalRegion();
    const rows = await query(
      `SELECT id, tier_key, tier_name, price_per_km, base_fare, per_minute_rate, minimum_fare, is_active, sort_order
       FROM operating_region_pricing_tiers
       WHERE region_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [region.id]
    );

    const dynamicPricing = await getDynamicPricingSettings();
    const surgeRules = (await listSurgeRules()).map((rule) => ({
      ...rule,
      isCurrentlyActive: dynamicPricing.isEnabled && rule.isCurrentlyActive,
    }));

    return res.json({
      currencyCode: region.currency_code || 'USD',
      tiers: rows.map(mapTier),
      surgeRules,
      dynamicPricing,
      pricingTimeZone: PRICING_TIME_ZONE,
    });
  } catch (err) {
    console.error('GET /api/admin/pricing', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/surge-settings', requireAdminAuth, requirePermission('pricing.manage'), async (req, res) => {
  try {
    const allowedModes = new Set(['peak', 'night', 'rain']);
    const requestedMode = String(req.body?.manualMode || '').trim().toLowerCase();
    const manualMode = allowedModes.has(requestedMode) ? requestedMode : null;
    const peakMultiplier = Number(req.body?.peakMultiplier);
    const nightMultiplier = Number(req.body?.nightMultiplier);
    const rainMultiplier = Number(req.body?.rainMultiplier);
    const multipliers = [peakMultiplier, nightMultiplier, rainMultiplier];

    if (multipliers.some((multiplier) => !(multiplier > 1 && multiplier <= 5))) {
      return res.status(400).json({ error: 'Every quick-mode multiplier must be greater than 1 and no more than 5' });
    }

    await query(
      `INSERT INTO dynamic_pricing_settings (
         id, is_enabled, manual_mode, peak_multiplier, night_multiplier,
         rain_multiplier, updated_by_admin_id
       ) VALUES (1, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         is_enabled = VALUES(is_enabled),
         manual_mode = VALUES(manual_mode),
         peak_multiplier = VALUES(peak_multiplier),
         night_multiplier = VALUES(night_multiplier),
         rain_multiplier = VALUES(rain_multiplier),
         updated_by_admin_id = VALUES(updated_by_admin_id)`,
      [
        req.body?.isEnabled === false ? 0 : 1,
        manualMode,
        peakMultiplier,
        nightMultiplier,
        rainMultiplier,
        req.admin?.id || null,
      ]
    );

    return res.json({
      dynamicPricing: await getDynamicPricingSettings(),
      pricingTimeZone: PRICING_TIME_ZONE,
    });
  } catch (err) {
    console.error('PUT /api/admin/pricing/surge-settings', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/surge-rules', requireAdminAuth, requirePermission('pricing.manage'), async (req, res) => {
  try {
    const rawRules = Array.isArray(req.body?.rules) ? req.body.rules : [];
    if (rawRules.length > 100) return res.status(400).json({ error: 'No more than 100 surge rules are allowed' });

    let rules;
    try {
      rules = rawRules.map(normalizeSurgeRule);
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    await withTransaction(async (connection) => {
      await connection.execute('DELETE FROM pricing_surge_rules');
      for (const rule of rules) {
        await connection.execute(
          `INSERT INTO pricing_surge_rules (
             name, tier_key, weekdays, start_time, end_time, multiplier,
             starts_on, ends_on, is_active, created_by_admin_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            rule.name,
            rule.tierKey,
            rule.weekdays,
            rule.startTime,
            rule.endTime,
            rule.multiplier,
            rule.startsOn,
            rule.endsOn,
            rule.isActive,
            req.admin?.id || null,
          ]
        );
      }
    });

    return res.json({
      rules: await listSurgeRules(),
      pricingTimeZone: PRICING_TIME_ZONE,
    });
  } catch (err) {
    console.error('PUT /api/admin/pricing/surge-rules', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/', requireAdminAuth, requirePermission('pricing.manage'), async (req, res) => {
  try {
    const region = await resolveUniversalRegion();
    const rawTiers = Array.isArray(req.body?.tiers) ? req.body.tiers : [];
    const tiers = rawTiers
      .map((tier, index) => ({
        tierKey: String(tier?.tierKey || '').trim().toLowerCase(),
        tierName: String(tier?.tierName || '').trim(),
        pricePerKm: Number(tier?.pricePerKm || 0),
        baseFare: Number(tier?.baseFare || 0),
        perMinuteRate: Number(tier?.perMinuteRate || 0),
        minimumFare: Number(tier?.minimumFare || 0),
        isActive: tier?.isActive === false ? 0 : 1,
        sortOrder: Number.isFinite(Number(tier?.sortOrder)) ? Number(tier.sortOrder) : index,
      }))
      .filter((tier) => tier.tierKey && tier.tierName);

    if (!tiers.length) {
      return res.status(400).json({ error: 'At least one pricing row is required' });
    }

    await query('UPDATE operating_regions SET currency_code = ? WHERE id = ?', [
      String(req.body?.currencyCode || region.currency_code || 'USD').trim().toUpperCase() || 'USD',
      region.id,
    ]);

    await query('DELETE FROM operating_region_pricing_tiers WHERE region_id = ?', [region.id]);

    for (const tier of tiers) {
      await query(
        `INSERT INTO operating_region_pricing_tiers (
          region_id,
          tier_key,
          tier_name,
          price_per_km,
          base_fare,
          per_minute_rate,
          minimum_fare,
          is_active,
          sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          region.id,
          tier.tierKey,
          tier.tierName,
          tier.pricePerKm,
          tier.baseFare,
          tier.perMinuteRate,
          tier.minimumFare,
          tier.isActive,
          tier.sortOrder,
        ]
      );
    }

    const rows = await query(
      `SELECT id, tier_key, tier_name, price_per_km, base_fare, per_minute_rate, minimum_fare, is_active, sort_order
       FROM operating_region_pricing_tiers
       WHERE region_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [region.id]
    );

    return res.json({
      currencyCode: String(req.body?.currencyCode || region.currency_code || 'USD').trim().toUpperCase() || 'USD',
      tiers: rows.map(mapTier),
    });
  } catch (err) {
    console.error('PUT /api/admin/pricing', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/reset-defaults', requireAdminAuth, requirePermission('pricing.manage'), async (req, res) => {
  try {
    const region = await resolveUniversalRegion();
    const existingRows = await query(
      `SELECT price_per_km, base_fare, per_minute_rate, minimum_fare
       FROM operating_region_pricing_tiers
       WHERE region_id = ?
       ORDER BY sort_order ASC, id ASC
       LIMIT 1`,
      [region.id]
    );

    const base = existingRows[0] || {
      price_per_km: 1,
      base_fare: 0,
      per_minute_rate: 0,
      minimum_fare: 1,
    };

    await query('DELETE FROM operating_region_pricing_tiers WHERE region_id = ?', [region.id]);

    for (const tier of DEFAULT_TIERS) {
      await query(
        `INSERT INTO operating_region_pricing_tiers (
          region_id,
          tier_key,
          tier_name,
          price_per_km,
          base_fare,
          per_minute_rate,
          minimum_fare,
          is_active,
          sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          region.id,
          tier.tierKey,
          tier.tierName,
          Number(base.price_per_km || 0),
          Number(base.base_fare || 0),
          Number(base.per_minute_rate || 0),
          Number(base.minimum_fare || 0),
          tier.sortOrder,
        ]
      );
    }

    const rows = await query(
      `SELECT id, tier_key, tier_name, price_per_km, base_fare, per_minute_rate, minimum_fare, is_active, sort_order
       FROM operating_region_pricing_tiers
       WHERE region_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [region.id]
    );

    return res.json({ currencyCode: region.currency_code || 'USD', tiers: rows.map(mapTier) });
  } catch (err) {
    console.error('POST /api/admin/pricing/reset-defaults', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
