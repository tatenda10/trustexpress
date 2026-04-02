import { Router } from 'express';
import { query } from '../db/connection.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';

const router = Router();

const DEFAULT_TIERS = [
  { tierKey: 'trust-express', tierName: 'Trust Express', sortOrder: 0 },
  { tierKey: 'trust-xl', tierName: 'Trust XL', sortOrder: 1 },
  { tierKey: 'trust-luxury', tierName: 'Trust Luxury', sortOrder: 2 },
];

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

    return res.json({
      currencyCode: region.currency_code || 'USD',
      tiers: rows.map(mapTier),
    });
  } catch (err) {
    console.error('GET /api/admin/pricing', err);
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
