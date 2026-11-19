const MARKETS = {
  ZW: {
    countryCode: 'ZW',
    currencyCode: 'USD',
    locale: 'en-ZW',
    timeZone: 'Africa/Harare',
    supportsSmileCash: true,
    supportsSmilePay: true,
    emergencyContacts: [
      { key: 'police', label: 'Police', number: '995', icon: 'shield-checkmark-outline' },
      { key: 'ambulance', label: 'Ambulance', number: '994', icon: 'medkit-outline' },
      { key: 'fire', label: 'Fire brigade', number: '993', icon: 'flame-outline' },
    ],
  },
  ZA: {
    countryCode: 'ZA',
    currencyCode: 'ZAR',
    locale: 'en-ZA',
    timeZone: 'Africa/Johannesburg',
    supportsSmileCash: false,
    supportsSmilePay: false,
    emergencyContacts: [
      { key: 'emergency', label: 'Emergency services', number: '112', icon: 'alert-circle-outline' },
      { key: 'police', label: 'Police', number: '10111', icon: 'shield-checkmark-outline' },
      { key: 'ambulance', label: 'Ambulance', number: '10177', icon: 'medkit-outline' },
    ],
  },
};

let activeCountryCode = 'ZW';

export function configureMarket(countryCode) {
  activeCountryCode = String(countryCode || '').trim().toUpperCase() === 'ZA' ? 'ZA' : 'ZW';
  return getMarket();
}

export function getMarket(countryCode = activeCountryCode) {
  return MARKETS[String(countryCode || '').trim().toUpperCase()] || MARKETS.ZW;
}

export function formatMarketCurrency(value, currencyCode = null) {
  const market = getMarket();
  const currency = String(currencyCode || market.currencyCode).toUpperCase();
  try {
    return new Intl.NumberFormat(market.locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  } catch {
    return `${currency} ${Number(value || 0).toFixed(2)}`;
  }
}

