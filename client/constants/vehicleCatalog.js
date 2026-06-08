export const VEHICLE_MAKE_MODELS = [
  { make: 'Toyota', models: ['Corolla', 'Auris', 'Yaris', 'Vitz', 'Belta', 'Wish', 'Premio', 'Allion', 'Mark X', 'Hilux', 'Fortuner', 'RAV4', 'Land Cruiser', 'Sienta', 'Noah', 'Voxy'] },
  { make: 'Honda', models: ['Fit', 'Jazz', 'Civic', 'Accord', 'CR-V', 'HR-V', 'Insight', 'Freed', 'Stepwgn'] },
  { make: 'Nissan', models: ['March', 'Note', 'Tiida', 'Sunny', 'Bluebird', 'Sylphy', 'X-Trail', 'Qashqai', 'Navara', 'Serena'] },
  { make: 'Mazda', models: ['Demio', 'Mazda2', 'Mazda3', 'Axela', 'Atenza', 'CX-3', 'CX-5', 'CX-7', 'BT-50', 'Bongo'] },
  { make: 'Mercedes-Benz', models: ['A-Class', 'B-Class', 'C-Class', 'E-Class', 'S-Class', 'GLA', 'GLC', 'GLE', 'V-Class', 'Sprinter'] },
  { make: 'BMW', models: ['1 Series', '3 Series', '5 Series', '7 Series', 'X1', 'X3', 'X5'] },
  { make: 'Volkswagen', models: ['Polo', 'Golf', 'Jetta', 'Passat', 'Tiguan', 'Touareg', 'Caddy', 'Kombi'] },
  { make: 'Subaru', models: ['Impreza', 'Legacy', 'Forester', 'Outback', 'XV'] },
  { make: 'Suzuki', models: ['Swift', 'Alto', 'Wagon R', 'Baleno', 'Vitara', 'Ertiga'] },
  { make: 'Ford', models: ['Fiesta', 'Focus', 'Mondeo', 'EcoSport', 'Escape', 'Ranger', 'Everest', 'Tourneo'] },
  { make: 'Hyundai', models: ['i10', 'i20', 'i30', 'Accent', 'Elantra', 'Tucson', 'Santa Fe', 'H-1'] },
  { make: 'Kia', models: ['Picanto', 'Rio', 'Cerato', 'Sportage', 'Sorento', 'Carens'] },
  { make: 'Lexus', models: ['CT', 'IS', 'ES', 'GS', 'RX', 'NX', 'LX'] },
  { make: 'Mitsubishi', models: ['Mirage', 'Lancer', 'ASX', 'Outlander', 'Pajero', 'Triton'] },
  { make: 'Isuzu', models: ['D-Max', 'MU-X', 'KB', 'N-Series'] },
];

export const VEHICLE_YEAR_OPTIONS = Array.from(
  { length: Math.max(new Date().getFullYear() - 2010 + 2, 1) },
  (_, index) => String(new Date().getFullYear() + 1 - index),
);

export function getVehicleModelsForMake(make) {
  const entry = VEHICLE_MAKE_MODELS.find((item) => item.make.toLowerCase() === String(make || '').trim().toLowerCase());
  return entry?.models || [];
}
