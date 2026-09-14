export const RATING_STAR_LABELS = {
  1: 'Very Poor',
  2: 'Poor',
  3: 'Average',
  4: 'Good',
  5: 'Excellent',
};

export const PASSENGER_DRIVER_RATING_GROUPS = [
  {
    key: 'positive',
    title: 'Positive feedback',
    tags: [
      'Safe and careful driving',
      'Polite, respectful and professional',
      'Clean and well-maintained vehicle',
      'Arrived at the pickup point on time',
      'Followed the correct route',
      'Communicated clearly',
      'Obeyed traffic laws',
      'Made me feel safe and comfortable',
      'Provided excellent service',
    ],
  },
  {
    key: 'safety',
    title: 'Safety and conduct concerns',
    tags: [
      'Driver appeared drunk or under the influence of drugs',
      'Driver consumed alcohol or used drugs during the trip',
      'Driver possessed or carried suspected prohibited drugs',
      'Driver attempted to sell, supply or transport suspected prohibited drugs',
      'Driver possessed, displayed or threatened me with a dangerous weapon',
      'A dangerous weapon was visible or discovered inside the vehicle',
      'Driver asked me to transport a suspicious or prohibited package',
      'Driver was driving dangerously or speeding',
      'Driver used a phone while driving',
      'Driver made threats or used abusive language',
      'Driver harassed or behaved inappropriately',
      'Driver made me feel unsafe',
      'Driver carried an unauthorised passenger',
      'Driver or vehicle did not match the details displayed in the app',
      'Vehicle appeared unsafe or had mechanical problems',
      'An accident or serious safety incident occurred',
    ],
  },
  {
    key: 'service',
    title: 'Service and payment concerns',
    tags: [
      'Driver arrived late',
      'Driver did not arrive at the pickup point',
      'Driver accepted the trip but did not respond',
      'Driver asked me to cancel the trip',
      'Driver asked for extra or incorrect payment',
      'Driver refused the selected payment method',
      'Driver took an unnecessarily longer route',
      'Driver refused to complete the trip',
      'Driver encouraged future trips outside the app',
      'Vehicle was dirty or in poor condition',
      'Sexual harassment',
      'Other issue',
    ],
  },
];

export const DRIVER_PASSENGER_RATING_GROUPS = [
  {
    key: 'positive',
    title: 'Positive feedback',
    tags: [
      'Polite, respectful and cooperative',
      'Ready at the pickup point',
      'Communicated clearly',
      'Confirmed the correct pickup location',
      'Followed safety instructions',
      'Wore a seat belt',
      'Treated the vehicle with care',
      'Paid the correct fare',
      'Excellent passenger',
    ],
  },
  {
    key: 'pickup',
    title: 'Pickup and trip concerns',
    tags: [
      'Passenger was late at the pickup point',
      'Passenger was not at the pickup location',
      'Passenger provided an incorrect or unclear pickup location',
      'Passenger did not respond to calls or messages',
      'Passenger cancelled after the Captain arrived',
      'Passenger requested unnecessary stops or route changes',
      'Passenger asked the Captain to speed or break traffic laws',
      'Passenger distracted the Captain while driving',
      'Passenger refused to wear a seat belt',
      'Passenger brought more people than the vehicle’s permitted capacity',
      'Passenger asked to travel outside the Trust Express App',
      'Passenger left an item in the vehicle',
    ],
  },
  {
    key: 'behaviour',
    title: 'Behaviour and vehicle concerns',
    tags: [
      'Passenger was rude, abusive or threatening',
      'Passenger behaved violently or attempted to fight',
      'Passenger damaged or attempted to damage the vehicle',
      'Passenger smoked or vaped in the vehicle',
      'Passenger ate or drank without permission',
      'Passenger left the vehicle excessively dirty',
      'Passenger brought an animal without informing the Captain',
      'Passenger brought an unauthorised person',
      'Passenger made the Captain feel unsafe',
    ],
  },
  {
    key: 'prohibited',
    title: 'Alcohol, drugs and weapons',
    tags: [
      'Passenger appeared drunk or under the influence of drugs',
      'Passenger consumed alcohol or used drugs inside the vehicle',
      'Passenger possessed or carried suspected prohibited drugs',
      'Passenger attempted to sell, supply or transport suspected prohibited drugs',
      'Passenger asked the Captain to transport a suspicious or prohibited package',
      'Passenger possessed or displayed a dangerous weapon',
      'Passenger threatened the Captain or another person with a weapon',
    ],
  },
  {
    key: 'harassment',
    title: 'Sexual harassment and inappropriate behaviour',
    tags: [
      'Passenger made unwanted sexual comments or jokes',
      'Passenger made inappropriate comments about the Captain’s body or appearance',
      'Passenger made unwanted sexual advances',
      'Passenger touched or attempted to touch the Captain inappropriately',
      'Passenger exposed themselves or performed a sexual act',
      'Passenger requested or offered sexual activity',
      'Passenger showed or sent sexually explicit content',
      'Passenger repeatedly requested the Captain’s personal contact details',
      'Passenger followed, stalked or intimidated the Captain',
      'Passenger threatened sexual violence',
      'Passenger committed or attempted sexual assault',
      'Passenger made the Captain feel sexually unsafe or uncomfortable',
      'Other sexual harassment or inappropriate behaviour',
    ],
  },
  {
    key: 'payment',
    title: 'Payment concerns',
    tags: [
      'Passenger refused to pay',
      'Passenger made an incomplete or incorrect payment',
      'Passenger attempted to use a false payment confirmation',
      'Passenger selected the wrong payment method',
      'Passenger asked to pay outside the app',
      'Passenger disputed the correct fare without a valid reason',
      'Passenger asked the Captain to end the trip early to reduce the fare',
      'Other payment issue',
    ],
  },
  {
    key: 'other',
    title: 'Other',
    tags: [
      'Lost property found in the vehicle',
      'Another issue not listed above',
    ],
  },
];

export const DRIVER_PASSENGER_RATING_SAFETY_NOTE =
  'For weapons, suspected prohibited drugs, violence, sexual assault or immediate danger, do not confront the passenger. Stop in a safe public place when possible, end the trip and contact the police or emergency services. Report the incident to Trust Express Support and preserve the trip details, messages, call records or other evidence.';

function flattenGroups(groups) {
  return (Array.isArray(groups) ? groups : []).flatMap((group) => group.tags || []);
}

export const PASSENGER_DRIVER_RATING_TAGS = flattenGroups(PASSENGER_DRIVER_RATING_GROUPS);
export const DRIVER_PASSENGER_RATING_TAGS = flattenGroups(DRIVER_PASSENGER_RATING_GROUPS);

export function getRatingStarLabel(rating) {
  return RATING_STAR_LABELS[Number(rating)] || '';
}

export function isRatingTagSelected(selectedTags, tag) {
  const normalizedTag = String(tag || '').trim();
  if (!normalizedTag) return false;
  return (Array.isArray(selectedTags) ? selectedTags : []).includes(normalizedTag);
}

export function toggleRatingTag(selectedTags, tag) {
  const normalizedTag = String(tag || '').trim();
  if (!normalizedTag) return Array.isArray(selectedTags) ? selectedTags : [];
  const current = Array.isArray(selectedTags) ? selectedTags : [];
  if (current.includes(normalizedTag)) {
    return current.filter((item) => item !== normalizedTag);
  }
  return [...current, normalizedTag];
}

function parseReviewSegments(review) {
  return String(review || '')
    .split(/(?:\.\s+|\n+)/)
    .map((part) => part.trim().replace(/\.$/, ''))
    .filter(Boolean);
}

export function isPassengerDriverReviewTagSelected(review, tag) {
  return isRatingTagSelected(parseReviewSegments(review), tag);
}

export function togglePassengerDriverReviewTag(currentReview, tag) {
  const nextTags = toggleRatingTag(parseReviewSegments(currentReview), tag);
  return nextTags.length ? `${nextTags.join('. ')}.` : '';
}

export function buildRatingReviewText(selectedTags, extraReview = '') {
  const tags = (Array.isArray(selectedTags) ? selectedTags : []).map((tag) => String(tag || '').trim()).filter(Boolean);
  const extra = String(extraReview || '').trim();
  const parts = [];
  if (tags.length) parts.push(tags.join('. ') + '.');
  if (extra) parts.push(extra);
  return parts.join('\n\n');
}
