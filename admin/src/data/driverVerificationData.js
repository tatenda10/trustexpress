export const driverVerificationRecords = [
  {
    id: 'drv-001',
    name: 'Tendai Moyo',
    phone: '+263 77 123 4567',
    email: 'tendai.moyo@gmail.com',
    submittedAt: '2026-02-28 09:15',
    verificationType: 'identity',
    verificationLabel: 'Identity Verification',
    status: 'incoming',
    docs: [
      {
        label: 'National ID Front',
        url: 'https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=1200&q=80',
      },
      {
        label: 'National ID Back',
        url: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1200&q=80',
      },
      {
        label: 'Driver License',
        url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
      },
      {
        label: 'Driver Selfie',
        url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=1200&q=80',
      },
    ],
    vehicle: null,
    notes: 'All identity docs uploaded. Awaiting admin approval.',
  },
  {
    id: 'drv-002',
    name: 'Sarah Chidza',
    phone: '+263 77 890 6543',
    email: 'sarah.chidza@gmail.com',
    submittedAt: '2026-02-28 08:51',
    verificationType: 'vehicle',
    verificationLabel: 'Vehicle Verification',
    status: 'incoming',
    docs: [
      {
        label: 'Vehicle Registration',
        url: 'https://images.unsplash.com/photo-1450101215322-bf5cd27642fc?auto=format&fit=crop&w=1200&q=80',
      },
      {
        label: 'Insurance Document',
        url: 'https://images.unsplash.com/photo-1556740749-887f6717d7e4?auto=format&fit=crop&w=1200&q=80',
      },
      {
        label: 'Car Front',
        url: 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=1200&q=80',
      },
      {
        label: 'Car Rear',
        url: 'https://images.unsplash.com/photo-1542362567-b07e54358753?auto=format&fit=crop&w=1200&q=80',
      },
    ],
    vehicle: {
      plateNumber: 'AEQ 2351',
      make: 'Toyota',
      model: 'Aqua',
      year: '2017',
      color: 'Silver',
    },
    notes: 'Vehicle docs submitted after identity approval.',
  },
  {
    id: 'drv-003',
    name: 'Kelvin Musona',
    phone: '+263 78 222 3333',
    email: 'kelvin.musona@gmail.com',
    submittedAt: '2026-02-27 17:33',
    verificationType: 'identity',
    verificationLabel: 'Identity Verification',
    status: 'verified',
    docs: [
      {
        label: 'National ID Front',
        url: 'https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=1200&q=80',
      },
      {
        label: 'National ID Back',
        url: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1200&q=80',
      },
      {
        label: 'Driver License',
        url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
      },
      {
        label: 'Driver Selfie',
        url: 'https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&w=1200&q=80',
      },
    ],
    vehicle: null,
    notes: 'Identity verification approved by Admin User.',
  },
  {
    id: 'drv-004',
    name: 'Blessing Ncube',
    phone: '+263 71 444 5555',
    email: 'blessing.ncube@gmail.com',
    submittedAt: '2026-02-27 16:10',
    verificationType: 'vehicle',
    verificationLabel: 'Vehicle Verification',
    status: 'verified',
    docs: [
      {
        label: 'Vehicle Registration',
        url: 'https://images.unsplash.com/photo-1450101215322-bf5cd27642fc?auto=format&fit=crop&w=1200&q=80',
      },
      {
        label: 'Insurance Document',
        url: 'https://images.unsplash.com/photo-1556740749-887f6717d7e4?auto=format&fit=crop&w=1200&q=80',
      },
      {
        label: 'Car Front',
        url: 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=1200&q=80',
      },
      {
        label: 'Car Rear',
        url: 'https://images.unsplash.com/photo-1542362567-b07e54358753?auto=format&fit=crop&w=1200&q=80',
      },
    ],
    vehicle: {
      plateNumber: 'AFJ 8732',
      make: 'Honda',
      model: 'Fit',
      year: '2018',
      color: 'Blue',
    },
    notes: 'Vehicle verification approved and driver is active.',
  },
]