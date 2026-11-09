const CONFIG = {
  csvUrl: './ThriveFullScrape_2026.csv',
  geocoding: {
    primary: {
      endpoint: 'https://nominatim.openstreetmap.org/search',
      apiKey: '',
      delayBetweenRequests: 200
    },
    fallback: {
      endpoint: 'https://nominatim.openstreetmap.org/search',
      delayBetweenRequests: 1000
    },
    directParse: { enabled: true }
  },
  map: {
    initialView: [40.7128, -74.0060],
    initialZoom: 11,
    maxZoom: 19,
    tileLayer: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
    tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  },
  columns: {
    name: 'mural_title',
    siteName: 'site_name',
    artist: 'artist_names',
    studentsInvolved: 'students_involved',
    description: 'tour_description',
    year: 'year',
    borough: 'borough',
    neighborhood: 'neighborhood',
    imageUrl: 'image_url',
    detailUrl: 'detail_url',
    streetAddress: 'street_address',
    status: 'status'
  },
  skipRows: {
    keywords: ['digital download', 'not murals', 'online stuff'],
    emptyTitle: true
  },
  popup: {
    maxWidth: 320,
    maxHeight: 500,
    descriptionTruncate: 0
  },
  marker: {
    color: '#4CAF50',
    borderColor: '#2E7D32',
    highlightColor: '#81C784',
    size: 32,
    anchor: [16, 42],
    popupAnchor: [0, -38]
  },
  legend: {
    position: 'bottomright',
    title: 'Thrive Murals'
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
