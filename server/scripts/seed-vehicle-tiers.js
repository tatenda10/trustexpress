import 'dotenv/config';
import pool, { query } from '../db/connection.js';

const VEHICLE_TIERS = [
  {
    tierKey: 'trust-express',
    tierName: 'Trust Express',
    shortDescription: 'Standard 4-seat ride for everyday affordable city trips.',
    vehicleRequirements: [
      '4-door vehicle',
      '4 passenger seats',
      '2005 model or newer',
      'Clean interior and exterior',
      'Good mechanical condition',
      'Valid license, insurance, and registration',
      'Driver must have a valid driver\'s license',
      'Smartphone with the Trust Express driver app',
    ],
    passengerComfort: [],
    driverRequirements: [],
    useCases: [
      'Everyday affordable rides',
      'Short city trips',
    ],
    exampleVehicles: [],
    isActive: true,
    sortOrder: 0,
  },
  {
    tierKey: 'trust-xl',
    tierName: 'Trust XL',
    shortDescription: '6 to 7 seat vehicle tier for families, airport runs, and group transport.',
    vehicleRequirements: [
      'Vehicle must carry 6 to 7 passengers',
      '2010 model or newer',
      '4 doors or more',
      'Spacious legroom and comfortable seats',
      'Working air conditioning',
      'Clean interior and exterior',
      'Seatbelts for all passengers',
      'Large luggage space good for airport trips',
      'Sliding doors or easy passenger access preferred',
      'Strong suspension suitable for group transport',
    ],
    passengerComfort: [
      'Phone charging ports USB',
      'Optional in-car Wi-Fi',
      'Optional bottled water for passengers',
      'Music control for passengers',
      'Quiet and smooth ride',
    ],
    driverRequirements: [
      'Professional and respectful',
      'Good knowledge of the city',
      'High driver rating',
      'Neat appearance',
    ],
    useCases: [
      'Families',
      'Airport transfers',
      'Group travel',
      'Tour rides',
      'Business group trips',
    ],
    exampleVehicles: [
      'Toyota Avanza',
      'Suzuki Ertiga',
      'Toyota Rumion',
      'Honda BR-V',
      'Nissan Livina',
    ],
    isActive: true,
    sortOrder: 1,
  },
  {
    tierKey: 'trust-luxury',
    tierName: 'Trust Luxury',
    shortDescription: 'Premium ride option for executive and high-comfort trips.',
    vehicleRequirements: [
      '2015 model or newer',
      'High-end sedan or SUV',
      'Excellent interior condition',
      'Leather seats preferred',
      'Working air conditioning',
      'No body damage',
      'Quiet and smooth driving',
    ],
    passengerComfort: [
      'Free Wi-Fi',
      'Complimentary bottled water',
      'Phone charging ports',
      'Clean and fresh interior',
      'Passengers may choose music or quiet ride',
    ],
    driverRequirements: [
      'Well dressed and professional',
      'Excellent customer service',
      'High driver rating',
    ],
    useCases: [],
    exampleVehicles: [],
    isActive: true,
    sortOrder: 2,
  },
];

async function run() {
  try {
    await query('DELETE FROM vehicle_tier_rules');

    for (const tier of VEHICLE_TIERS) {
      await query(
        `INSERT INTO vehicle_tier_rules (
          tier_key,
          tier_name,
          short_description,
          vehicle_requirements_json,
          passenger_comfort_json,
          driver_requirements_json,
          use_cases_json,
          example_vehicles_json,
          is_active,
          sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tier.tierKey,
          tier.tierName,
          tier.shortDescription,
          JSON.stringify(tier.vehicleRequirements),
          JSON.stringify(tier.passengerComfort),
          JSON.stringify(tier.driverRequirements),
          JSON.stringify(tier.useCases),
          JSON.stringify(tier.exampleVehicles),
          tier.isActive ? 1 : 0,
          tier.sortOrder,
        ]
      );
    }

    console.log(`Seeded ${VEHICLE_TIERS.length} vehicle tiers.`);
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Vehicle tier seed failed:', err.message);
  process.exit(1);
});
