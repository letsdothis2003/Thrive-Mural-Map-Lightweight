// ============================================================
// CONFIGURATION – THRIVE COLLECTIVE MURAL MAP
// ============================================================
// This file contains sensitive information (API keys, data URLs).
// DO NOT commit this file to public repositories.
// Copy this file to config.js and fill in your values.
// ============================================================

const CONFIG = {
    // ============================================================
    // DATA SOURCE – Google Sheets CSV
    // ============================================================
    // Publish your Google Sheet as CSV and paste the URL here.
    // To publish: File > Share > Publish to web > CSV
    csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGG7nJALaHS51jJ7BEcfeu-MqPPoTXUo5hkJd1NE-tTn9W76gduRp5dPDoOEsQMFbd8LYm4Oq8-R9_/pub?output=csv',

    // ============================================================
    // GEOCODING – OpenRouteService (ORS) + Nominatim Fallback
    // ============================================================
    geocoding: {
        // Primary: OpenRouteService (requires API key)
        // Get a free key at: https://openrouteservice.org/sign-up/
        primary: {
            endpoint: 'https://api.openrouteservice.org/geocode/search',
            apiKey: 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjMzMTkzMjU2M2NiYjRkOTc4ODE5ZmU2Y2IzNTg0OTBkIiwiaCI6Im11cm11cjY0In0=',
            delayBetweenRequests: 200 // milliseconds between requests
        },
        // Fallback: Nominatim (free, no API key required)
        // Used if ORS fails or rate limit is exceeded
        fallback: {
            endpoint: 'https://nominatim.openstreetmap.org/search',
            delayBetweenRequests: 1000 // slower to avoid being blocked
        }
    },

    // ============================================================
    // MAP SETTINGS – OpenStreetMap Tiles
    // ============================================================
    map: {
        initialView: [40.7128, -74.0060], // New York City center
        initialZoom: 11,
        maxZoom: 19,
        tileLayer: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    },

    // ============================================================
    // CSV COLUMN MAPPING
    // ============================================================
    // Map your CSV column names to the fields used in the app.
    // Column names are case-insensitive (they will be matched
    // against the actual CSV headers).
    columns: {
        name: 'mural_title',        // Mural title
        artist: 'artist_names',     // Artist name(s)
        description: 'tour_description', // Full description
        year: 'year',               // Year created
        borough: 'borough',         // Borough (Manhattan, Brooklyn, etc.)
        neighborhood: 'neighborhood', // Neighborhood name
        imageUrl: 'image_url',      // URL to mural image
        detailUrl: 'detail_url',    // URL to detail page
        streetAddress: 'street_address', // Street address for geocoding
        status: 'status'            // Exterior / Interior
    },

    // ============================================================
    // FILTERING – Skip rows that are not murals
    // ============================================================
    // Rows with titles containing these keywords will be skipped.
    skipRows: {
        keywords: ['digital download', 'not murals', 'online stuff'],
        emptyTitle: true // Skip rows with no title
    },

    // ============================================================
    // POPUP SETTINGS
    // ============================================================
    popup: {
        maxWidth: 320,               // Maximum width in pixels
        maxHeight: 400,              // Maximum height in pixels
        descriptionTruncate: 200     // Description truncation length
    },

    // ============================================================
    // MARKER STYLING – Green Dot
    // ============================================================
    marker: {
        color: '#4CAF50',            // Main green
        borderColor: '#2E7D32',      // Darker green border
        highlightColor: '#81C784',   // Light green highlight
        size: 32,                    // Size in pixels
        anchor: [16, 42],            // Anchor point [x, y]
        popupAnchor: [0, -38]        // Popup offset [x, y]
    },

    // ============================================================
    // LEGEND SETTINGS
    // ============================================================
    legend: {
        position: 'bottomright',
        title: 'Thrive Murals'
    }
};

// ============================================================
// EXPORT – for Node.js / module use
// ============================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
