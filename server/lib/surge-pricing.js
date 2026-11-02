import { query } from '../db/connection.js';

export const PRICING_TIME_ZONE = String(process.env.PRICING_TIME_ZONE || 'Africa/Harare').trim() || 'Africa/Harare';

const WEEKDAY_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const MANUAL_MODE_LABELS = {
  peak: 'Peak hours',
  night: 'Night pricing',
  rain: 'Rainy weather',
};

function normalizeTierKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return key && key !== 'all' ? key : null;
}

function parseWeekdays(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
}

function timeToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return (hours * 60) + minutes;
}

function zonedParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PRICING_TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});

  return {
    weekday: WEEKDAY_INDEX[parts.weekday],
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: (Number(parts.hour) * 60) + Number(parts.minute),
  };
}

function normalizeRule(row) {
  return {
    id: Number(row.id),
    name: String(row.name || '').trim(),
    tierKey: normalizeTierKey(row.tier_key ?? row.tierKey),
    weekdays: parseWeekdays(row.weekdays),
    startTime: String(row.start_time ?? row.startTime ?? '').slice(0, 5),
    endTime: String(row.end_time ?? row.endTime ?? '').slice(0, 5),
    multiplier: Number(row.multiplier || 1),
    startsOn: row.starts_on ?? row.startsOn ?? null,
    endsOn: row.ends_on ?? row.endsOn ?? null,
    isActive: row.is_active === undefined ? row.isActive !== false : Boolean(row.is_active),
  };
}

export function isSurgeRuleActive(rawRule, now = new Date()) {
  const rule = normalizeRule(rawRule);
  if (!rule.isActive || !(rule.multiplier > 1) || !rule.weekdays.length) return false;

  const startMinutes = timeToMinutes(rule.startTime);
  const endMinutes = timeToMinutes(rule.endTime);
  if (startMinutes == null || endMinutes == null || startMinutes === endMinutes) return false;

  const current = zonedParts(now);
  let effective = current;
  let insideTimeWindow = false;

  if (startMinutes < endMinutes) {
    insideTimeWindow = current.minutes >= startMinutes && current.minutes < endMinutes;
  } else if (current.minutes >= startMinutes) {
    insideTimeWindow = true;
  } else if (current.minutes < endMinutes) {
    insideTimeWindow = true;
    effective = zonedParts(new Date(now.getTime() - (24 * 60 * 60 * 1000)));
  }

  if (!insideTimeWindow || !rule.weekdays.includes(effective.weekday)) return false;
  if (rule.startsOn && effective.date < String(rule.startsOn).slice(0, 10)) return false;
  if (rule.endsOn && effective.date > String(rule.endsOn).slice(0, 10)) return false;
  return true;
}

export async function listSurgeRules() {
  const rows = await query(
    `SELECT id, name, tier_key, weekdays, start_time, end_time, multiplier,
            DATE_FORMAT(starts_on, '%Y-%m-%d') AS starts_on,
            DATE_FORMAT(ends_on, '%Y-%m-%d') AS ends_on,
            is_active
     FROM pricing_surge_rules
     ORDER BY is_active DESC, id ASC`
  );

  return rows.map((row) => {
    const rule = normalizeRule(row);
    return { ...rule, isCurrentlyActive: isSurgeRuleActive(rule) };
  });
}

export async function getDynamicPricingSettings() {
  const rows = await query(
    `SELECT is_enabled, manual_mode, peak_multiplier, night_multiplier, rain_multiplier
     FROM dynamic_pricing_settings
     WHERE id = 1
     LIMIT 1`
  );
  const row = rows[0] || {};
  const manualMode = MANUAL_MODE_LABELS[row.manual_mode] ? row.manual_mode : null;
  return {
    isEnabled: row.is_enabled === undefined ? true : Boolean(row.is_enabled),
    manualMode,
    peakMultiplier: Math.max(Number(row.peak_multiplier || 1.25), 1),
    nightMultiplier: Math.max(Number(row.night_multiplier || 1.2), 1),
    rainMultiplier: Math.max(Number(row.rain_multiplier || 1.3), 1),
  };
}

export async function getActiveSurgeMap(tierKeys, now = new Date()) {
  const normalizedKeys = [...new Set((tierKeys || []).map(normalizeTierKey).filter(Boolean))];
  const result = new Map(normalizedKeys.map((key) => [key, { multiplier: 1, name: null, ruleId: null }]));
  if (!normalizedKeys.length) return result;

  const settings = await getDynamicPricingSettings();
  if (!settings.isEnabled) return result;

  if (settings.manualMode) {
    const multiplier = Number(settings[`${settings.manualMode}Multiplier`] || 1);
    if (multiplier > 1) {
      for (const tierKey of normalizedKeys) {
        result.set(tierKey, {
          multiplier,
          name: MANUAL_MODE_LABELS[settings.manualMode],
          ruleId: null,
          manualMode: settings.manualMode,
        });
      }
    }
  }

  const rules = (await listSurgeRules()).filter((rule) => isSurgeRuleActive(rule, now));
  for (const tierKey of normalizedKeys) {
    for (const rule of rules) {
      if (rule.tierKey && rule.tierKey !== tierKey) continue;
      const current = result.get(tierKey);
      if (rule.multiplier > current.multiplier) {
        result.set(tierKey, { multiplier: rule.multiplier, name: rule.name, ruleId: rule.id });
      }
    }
  }
  return result;
}

export async function attachActiveSurgeToTier(tier, now = new Date()) {
  if (!tier) return tier;
  const tierKey = normalizeTierKey(tier.tier_key ?? tier.tierKey);
  const surgeMap = await getActiveSurgeMap([tierKey], now);
  const surge = surgeMap.get(tierKey) || { multiplier: 1, name: null, ruleId: null };
  return {
    ...tier,
    surge_multiplier: surge.multiplier,
    surge_name: surge.name,
    surge_rule_id: surge.ruleId,
  };
}
