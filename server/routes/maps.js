import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { fetchCachedGoogleDirections } from '../lib/google-directions.js';
import {
  fetchCachedPlaceAutocomplete,
  fetchCachedPlaceDetails,
} from '../lib/google-places.js';

const router = Router();

router.post('/directions', requireAuth, async (req, res) => {
  try {
    const {
      origin,
      destination,
      includeTraffic = false,
      cachePrecision,
      cacheTtlSeconds,
    } = req.body || {};

    const route = await fetchCachedGoogleDirections({
      origin,
      destination,
      includeTraffic: includeTraffic === true,
      cachePrecision,
      cacheTtlSeconds,
    });

    return res.json({
      route: {
        polyline: route.polyline || '',
        coordinates: Array.isArray(route.coordinates) ? route.coordinates : [],
        distanceMeters: route.distanceMeters || 0,
        durationSeconds: route.durationSeconds || 0,
        distanceKm: route.distanceKm,
        durationMinutes: route.durationMinutes,
        nextInstruction: route.nextInstruction || '',
        includeTraffic: Boolean(route.includeTraffic),
      },
      cacheHit: Boolean(route.cacheHit),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    if (status >= 500) {
      console.error('POST /api/maps/directions', error);
    }
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error: error?.message || 'Could not load directions',
    });
  }
});

router.post('/places/autocomplete', requireAuth, async (req, res) => {
  try {
    const {
      query,
      originCoordinate,
      sessionToken,
      cacheTtlSeconds,
    } = req.body || {};

    const result = await fetchCachedPlaceAutocomplete({
      query,
      originCoordinate,
      sessionToken,
      cacheTtlSeconds,
    });

    return res.json({
      suggestions: Array.isArray(result.suggestions) ? result.suggestions : [],
      cacheHit: Boolean(result.cacheHit),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    if (status >= 500) {
      console.error('POST /api/maps/places/autocomplete', error);
    }
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error: error?.message || 'Could not load place suggestions',
    });
  }
});

router.post('/places/details', requireAuth, async (req, res) => {
  try {
    const {
      placeId,
      sessionToken,
      cacheTtlSeconds,
    } = req.body || {};

    const result = await fetchCachedPlaceDetails({
      placeId,
      sessionToken,
      cacheTtlSeconds,
    });

    return res.json({
      place: result.place || null,
      cacheHit: Boolean(result.cacheHit),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    if (status >= 500) {
      console.error('POST /api/maps/places/details', error);
    }
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error: error?.message || 'Could not load place details',
    });
  }
});

export default router;
