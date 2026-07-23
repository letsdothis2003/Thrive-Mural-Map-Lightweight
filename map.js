// ============================================================
// THRIVE COLLECTIVE - MURAL MAP
// Three-tier geocoding: ORS + proxy -> Nominatim -> Direct parse
// Two-pass loading: instant cache + background geocoding
// ============================================================

// --- Global state ---
let map;
let allMurals = [];
let markerClusterGroup;
let currentLocation = null;
let currentTour = null;
let routingControl = null;
let userLocationMarker = null;
let youAreHereLabel = null;
let tourPolyline = null;
let narratorEnabled = false;
let savedMurals = JSON.parse(localStorage.getItem('savedMurals') || '[]');
let recentMurals = JSON.parse(localStorage.getItem('recentMurals') || '[]');
let isDarkMode = localStorage.getItem('theme') !== 'light';
let geocodingProgress = 0;

// --- DOM refs ---
const loadingEl = document.getElementById('map-loading');
const errorEl = document.getElementById('map-error');
const sidebar = document.getElementById('sidebar');
const sidebarHideBtn = document.getElementById('sidebarHideBtn');
const sidebarShowTab = document.getElementById('sidebarShowTab');
const themeToggle = document.getElementById('themeToggle');
const searchInput = document.getElementById('searchInput');
const manualAddressInput = document.getElementById('manual-address-input');
const startSearchBtn = document.getElementById('start-search-btn');
const useDeviceGpsBtn = document.getElementById('use-device-gps-btn');
const clearLocationBtn = document.getElementById('clearLocationBtn');
const nearestResults = document.getElementById('nearestResults');
const muralViewSlider = document.getElementById('muralViewSlider');
const muralViewLabel = document.getElementById('muralViewLabel');
const clearAllFiltersBtn = document.getElementById('clearAllFiltersBtn');
const toggleDistricts = document.getElementById('toggleDistricts');
const enableNarrator = document.getElementById('enableNarrator');
const yearFilter = document.getElementById('yearFilter');
const schoolsFilter = document.getElementById('schoolsFilter');
const boroughFilter = document.getElementById('boroughFilter');
const toggleSearchFiltersBtn = document.getElementById('toggleSearchFiltersBtn');
const searchFiltersContainer = document.getElementById('searchFiltersContainer');
const toggleSearchFiltersIcon = document.getElementById('toggleSearchFiltersIcon');
const recentMuralsList = document.getElementById('recentMuralsList');
const savedMuralsList = document.getElementById('savedMuralsList');
const featuredMuralsList = document.getElementById('featuredMuralsList');
const refreshFeaturedBtn = document.getElementById('refreshFeaturedMuralsBtn');
const createCustomTourBtn = document.getElementById('createCustomTourBtn');
const customTourRadius = document.getElementById('customTourRadius');
const customTourRadiusLabel = document.getElementById('customTourRadiusLabel');
const customTourLimit = document.getElementById('customTourLimit');
const customTourLimitLabel = document.getElementById('customTourLimitLabel');
const customTourSetting = document.getElementById('customTourSetting');
const customTourSummary = document.getElementById('customTourSummary');
const tourItinerary = document.getElementById('tourItinerary');
const tourStopsList = document.getElementById('tourStopsList');
const tourTitle = document.getElementById('tourTitle');
const endTourBtn = document.getElementById('endTourBtn');
const tourPrevBtn = document.getElementById('tourPrevBtn');
const tourNextBtn = document.getElementById('tourNextBtn');
const tourRouteBtn = document.getElementById('tourRouteBtn');
const viewAllModal = document.getElementById('viewAllModal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const modalClose = document.getElementById('modalClose');
const toast = document.getElementById('toast');

// --- Helper functions ---

function getValue(row, key) {
    var mappedKey = CONFIG.columns[key];
    if (!mappedKey) return null;
    var actualKey = null;
    var keys = Object.keys(row);
    for (var i = 0; i < keys.length; i++) {
        if (keys[i].toLowerCase().trim() === mappedKey.toLowerCase().trim()) {
            actualKey = keys[i];
            break;
        }
    }
    return actualKey ? row[actualKey] : null;
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/[&<>"]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        if (m === '"') return '&quot;';
        return m;
    });
}

function shouldSkipRow(row) {
    var title = getValue(row, 'name');
    if (!title) return true;
    var titleStr = String(title);
    if (titleStr.length === 0) return true;
    var lowerTitle = titleStr.toLowerCase();
    for (var i = 0; i < CONFIG.skipRows.keywords.length; i++) {
        if (lowerTitle.includes(CONFIG.skipRows.keywords[i])) return true;
    }
    return false;
}

function showToast(message, duration) {
    if (!duration) duration = 3000;
    toast.textContent = message;
    toast.classList.remove('hidden');
    if (toast._timeout) clearTimeout(toast._timeout);
    toast._timeout = setTimeout(function() {
        toast.classList.add('hidden');
    }, duration);
}

function updateLoadingProgress(current, total, message) {
    if (!message) message = 'Geocoding';
    var pct = Math.round((current / total) * 100);
    loadingEl.textContent = message + ' ' + current + ' / ' + total + ' (' + pct + '%)';
}

// --- Geocoding config extraction ---

var geoConfig = CONFIG.geocoding;
var primaryConfig = geoConfig.primary || { endpoint: null, apiKey: null, proxy: null };
var fallbackConfig = geoConfig.fallback || { endpoint: null };
var directParseEnabled = geoConfig.directParse && geoConfig.directParse.enabled !== false;

// --- Cache functions ---

var CACHE_VERSION = 'v3';
var CACHE_KEY = 'mural_geocode_cache';

function loadGeocodeCache() {
    try {
        var raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
            var data = JSON.parse(raw);
            if (data.version === CACHE_VERSION) {
                return data.map || {};
            }
        }
    } catch (e) { /* ignore */ }
    return {};
}

function saveGeocodeCache(cache) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
            version: CACHE_VERSION,
            map: cache
        }));
    } catch (e) { /* ignore */ }
}

function getCachedCoords(address) {
    if (!address) return null;
    var cache = loadGeocodeCache();
    var key = CACHE_VERSION + '_' + String(address).trim().toLowerCase().replace(/\s+/g, '_');
    return cache[key] || null;
}

function setCachedCoords(address, lat, lng) {
    if (!address) return;
    var cache = loadGeocodeCache();
    var key = CACHE_VERSION + '_' + String(address).trim().toLowerCase().replace(/\s+/g, '_');
    cache[key] = { lat: lat, lng: lng };
    saveGeocodeCache(cache);
}

// --- Option 3: Direct coordinate parsing (no API call) ---

function parseLatLng(text) {
    if (!text) return null;
    var str = String(text).trim();
    // Match "lat, lng" or "lat lng" with optional comma and spaces
    var m = str.match(/^(-?\d{1,3}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)$/);
    if (m) {
        var lat = parseFloat(m[1]);
        var lng = parseFloat(m[2]);
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && (lat !== 0 || lng !== 0)) {
            return { lat: lat, lng: lng };
        }
    }
    return null;
}

// --- Option 1 + 2: Geocode with three-tier fallback ---

async function geocodeAddress(address) {
    if (!address) return null;
    var addressStr = String(address).trim();
    if (addressStr.length < 5) return null;

    // Check cache first (fastest)
    var cached = getCachedCoords(addressStr);
    if (cached) {
        return cached;
    }

    // OPTION 3: Try direct coordinate parsing first (no API call)
    if (directParseEnabled) {
        var directCoords = parseLatLng(addressStr);
        if (directCoords) {
            setCachedCoords(addressStr, directCoords.lat, directCoords.lng);
            return directCoords;
        }
    }

    var cleanAddress = addressStr.replace(/\s*,\s*,/g, ',').replace(/,\s*$/, '').trim();

    // ------------------------------------------------------------------
    // OPTION 1: OpenRouteService (ORS) with optional CORS proxy
    // ------------------------------------------------------------------
    var primaryEndpoint = primaryConfig.endpoint;
    var primaryApiKey = primaryConfig.apiKey;
    var proxy = primaryConfig.proxy || '';

    if (primaryEndpoint && primaryApiKey) {
        try {
            var url = proxy + primaryEndpoint + '?api_key=' + primaryApiKey + '&text=' + encodeURIComponent(cleanAddress) + '&size=1';
            var response = await fetch(url);
            if (response.ok) {
                var data = await response.json();
                if (data.features && data.features.length > 0) {
                    var coords = data.features[0].geometry.coordinates;
                    var result = { lat: coords[1], lng: coords[0] };
                    setCachedCoords(addressStr, result.lat, result.lng);
                    return result;
                }
            }
            console.warn('ORS geocoder failed for "' + cleanAddress + '" (status: ' + response.status + ')');
        } catch (e) {
            console.warn('ORS geocoder error for "' + cleanAddress + '":', e.message);
        }
    } else {
        console.warn('ORS geocoder not configured (missing endpoint or apiKey)');
    }

    // ------------------------------------------------------------------
    // OPTION 2: Nominatim (OpenStreetMap) – free, no API key, no CORS
    // ------------------------------------------------------------------
    if (fallbackConfig && fallbackConfig.endpoint) {
        try {
            var fallbackUrl = fallbackConfig.endpoint + '?q=' + encodeURIComponent(cleanAddress) + '&format=json&limit=1';
            var fallbackResponse = await fetch(fallbackUrl, {
                headers: { 'User-Agent': 'MuralMapApp/1.0' }
            });
            if (fallbackResponse.ok) {
                var fallbackData = await fallbackResponse.json();
                if (fallbackData && fallbackData.length > 0) {
                    var fallbackResult = {
                        lat: parseFloat(fallbackData[0].lat),
                        lng: parseFloat(fallbackData[0].lon)
                    };
                    setCachedCoords(addressStr, fallbackResult.lat, fallbackResult.lng);
                    return fallbackResult;
                }
            }
            console.warn('Nominatim geocoder failed for "' + cleanAddress + '" (status: ' + fallbackResponse.status + ')');
        } catch (e) {
            console.warn('Nominatim geocoder error for "' + cleanAddress + '":', e.message);
        }
    } else {
        console.warn('Nominatim fallback not configured (missing endpoint)');
    }

    return null;
}

// --- Create green dot icon ---

function createGreenIcon() {
    var cfg = CONFIG.marker;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 42" width="' + cfg.size + '" height="' + (cfg.size + 10) + '">' +
        '<circle cx="16" cy="16" r="12" fill="' + cfg.color + '" stroke="' + cfg.borderColor + '" stroke-width="2"/>' +
        '<circle cx="16" cy="13" r="5" fill="' + cfg.highlightColor + '"/>' +
        '<path d="M16 28 Q16 35 16 38 Q16 35 16 28" fill="' + cfg.color + '"/>' +
        '</svg>';
    return L.icon({
        iconUrl: 'data:image/svg+xml;base64,' + btoa(svg),
        iconSize: [cfg.size, cfg.size + 10],
        iconAnchor: cfg.anchor,
        popupAnchor: cfg.popupAnchor
    });
}

// --- Build popup content ---

function buildPopupContent(mural) {
    var content = '<div style="max-width: ' + CONFIG.popup.maxWidth + 'px; max-height: ' + CONFIG.popup.maxHeight + 'px; overflow-y: auto; padding-right: 4px;">' +
        '<h3 style="margin: 0 0 4px 0; font-size: 16px; color: var(--heading-color, #1a1a1a);">' + escapeHtml(mural.title) + '</h3>' +
        '<p style="margin: 2px 0; font-weight: bold; font-size: 14px; color: #2E7D32;">' + escapeHtml(mural.artist) + '</p>';

    if (mural.year) {
        content += '<p style="margin: 2px 0; font-size: 12px; color: var(--text-muted, #666);">Year: ' + escapeHtml(mural.year) + '</p>';
    }

    if (mural.borough || mural.neighborhood) {
        var locationStr = [mural.neighborhood, mural.borough].filter(Boolean).join(', ');
        content += '<p style="margin: 2px 0; font-size: 12px; color: var(--text-muted, #666);">Location: ' + escapeHtml(locationStr) + '</p>';
    }

    if (mural.address) {
        content += '<p style="margin: 2px 0; font-size: 11px; color: var(--text-muted, #888);">' + escapeHtml(mural.address) + '</p>';
    }

    if (mural.imageUrl && String(mural.imageUrl).length > 10) {
        content += '<br><img src="' + escapeHtml(mural.imageUrl) + '" style="max-width: 100%; max-height: 180px; border-radius: 4px; object-fit: cover;" onerror="this.style.display=\'none\'">';
    }

    if (mural.description) {
        var descStr = String(mural.description);
        var shortDesc = descStr.length > CONFIG.popup.descriptionTruncate
            ? descStr.substring(0, CONFIG.popup.descriptionTruncate) + '...'
            : descStr;
        content += '<p class="mural-description" style="margin: 6px 0 0 0; font-size: 12px; line-height: 1.4; color: var(--text-main, #444);">' + escapeHtml(shortDesc) + '</p>';
    }

    if (mural.detailUrl) {
        content += '<p style="margin: 6px 0 0 0;"><a href="' + escapeHtml(mural.detailUrl) + '" target="_blank" style="color: #4CAF50; font-weight: bold; font-size: 13px; text-decoration: none; border: 1px solid #4CAF50; padding: 4px 12px; border-radius: 4px; display: inline-block;">Learn More</a></p>';
    }

    var isSaved = false;
    for (var i = 0; i < savedMurals.length; i++) {
        if (savedMurals[i].title === mural.title && savedMurals[i].address === mural.address) {
            isSaved = true;
            break;
        }
    }
    content += '<p style="margin: 8px 0 0 0;">' +
        '<button onclick="toggleSaveMural(\'' + escapeHtml(mural.title) + '\', \'' + escapeHtml(mural.address) + '\')" ' +
        'style="background: ' + (isSaved ? '#ef4444' : '#4CAF50') + '; color: white; border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">' +
        (isSaved ? 'Remove from Saved' : 'Save Mural') +
        '</button></p>';

    content += '</div>';
    return content;
}

// --- Toggle save ---
window.toggleSaveMural = function(title, address) {
    var index = -1;
    for (var i = 0; i < savedMurals.length; i++) {
        if (savedMurals[i].title === title && savedMurals[i].address === address) {
            index = i;
            break;
        }
    }
    if (index > -1) {
        savedMurals.splice(index, 1);
        showToast('Removed from saved murals');
    } else {
        var mural = null;
        for (var j = 0; j < allMurals.length; j++) {
            if (allMurals[j].title === title && allMurals[j].address === address) {
                mural = allMurals[j];
                break;
            }
        }
        if (mural) {
            savedMurals.push(mural);
            showToast('Saved!');
        }
    }
    localStorage.setItem('savedMurals', JSON.stringify(savedMurals));
    updateSavedList();
    refreshMarkers();
};

// --- Load CSV with two-pass strategy ---

async function loadMurals() {
    loadingEl.classList.remove('hidden');
    errorEl.classList.add('hidden');
    loadingEl.textContent = 'Loading mural data...';

    try {
        var response = await fetch(CONFIG.csvUrl);
        if (!response.ok) {
            throw new Error('HTTP error! status: ' + response.status);
        }
        var csvText = await response.text();

        var result = Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            trimHeaders: true,
            dynamicTyping: true
        });

        if (result.errors.length > 0) {
            console.warn('CSV parsing had errors:', result.errors);
        }

        var rows = result.data;
        console.log('Parsed ' + rows.length + ' rows from CSV');

        var validRows = rows.filter(function(row) { return !shouldSkipRow(row); });
        console.log('Found ' + validRows.length + ' valid mural entries');

        var geocodeCache = loadGeocodeCache();
        var cacheCount = Object.keys(geocodeCache).length;
        console.log('Cache has ' + cacheCount + ' geocoded addresses');

        // Show map immediately
        initMap();

        allMurals = [];
        var needsGeocoding = [];

        // ── PASS 1: instant load from direct coords or cache ──
        for (var k = 0; k < validRows.length; k++) {
            var row = validRows[k];
            var title = getValue(row, 'name') || 'Untitled Mural';
            var artist = getValue(row, 'artist') || 'Unknown Artist';
            var year = getValue(row, 'year') || '';
            var borough = getValue(row, 'borough') || '';
            var neighborhood = getValue(row, 'neighborhood') || '';
            var description = getValue(row, 'description') || '';
            var imageUrl = getValue(row, 'imageUrl') || '';
            var detailUrl = getValue(row, 'detailUrl') || '';
            var address = getValue(row, 'streetAddress') || '';
            var status = getValue(row, 'status') || '';
            var locationText = String(address || '').trim();

            var mural = {
                title: title, artist: artist, year: year, borough: borough,
                neighborhood: neighborhood, description: description,
                imageUrl: imageUrl, detailUrl: detailUrl,
                address: address, status: status, locationText: locationText
            };

            if (locationText.length > 3) {
                // Try direct parse first (no cache needed)
                var directCoords = parseLatLng(locationText);
                if (directCoords) {
                    mural.lat = directCoords.lat;
                    mural.lng = directCoords.lng;
                    // Cache the direct parse result
                    setCachedCoords(locationText, directCoords.lat, directCoords.lng);
                    allMurals.push(mural);
                    continue;
                }

                // Check cache
                var cacheKey = CACHE_VERSION + '_' + locationText.toLowerCase().replace(/\s+/g, '_');
                var cachedCoords = geocodeCache[cacheKey] || null;
                if (cachedCoords) {
                    mural.lat = cachedCoords.lat;
                    mural.lng = cachedCoords.lng;
                    allMurals.push(mural);
                    continue;
                }

                // Not cached — queue for Pass 2
                needsGeocoding.push({ mural: mural, locationText: locationText });
            }
        }

        console.log('Pass 1 complete: ' + allMurals.length + ' murals loaded instantly, ' + needsGeocoding.length + ' need geocoding');

        populateFilters();
        refreshMarkers();
        updateRecentList();
        updateSavedList();
        updateFeatured();
        updateTourSummary();

        if (allMurals.length === 0 && needsGeocoding.length === 0) {
            errorEl.textContent = 'No murals found. Please check your data source.';
            errorEl.classList.remove('hidden');
            loadingEl.classList.add('hidden');
            return;
        }

        if (needsGeocoding.length === 0) {
            loadingEl.classList.add('hidden');
            showToast('Loaded ' + allMurals.length + ' murals!');
            return;
        }

        loadingEl.textContent = allMurals.length + ' murals loaded — geocoding ' + needsGeocoding.length + ' more…';
        showToast('Showing ' + allMurals.length + ' murals. ' + needsGeocoding.length + ' more loading…');

        // ── PASS 2: geocode remaining with three-tier fallback ──
        var delay = (primaryConfig && primaryConfig.delayBetweenRequests) || 300;
        var geocodedCount = 0;
        var failedCount = 0;

        for (var i = 0; i < needsGeocoding.length; i++) {
            var item = needsGeocoding[i];
            var coords = await geocodeAddress(item.locationText);
            if (coords) {
                item.mural.lat = coords.lat;
                item.mural.lng = coords.lng;
                allMurals.push(item.mural);
                geocodedCount++;
            } else {
                failedCount++;
                // Still keep the mural but without coordinates (it won't show on map)
                // We could optionally add it with a flag, but we'll skip it for now
            }
            await new Promise(function(resolve) { setTimeout(resolve, delay); });

            if ((geocodedCount + failedCount) > 0 && (geocodedCount + failedCount) % 10 === 0) {
                refreshMarkers();
                updateLoadingProgress(i + 1, needsGeocoding.length, 'Geocoding');
            }
        }

        console.log('Pass 2 complete: geocoded ' + geocodedCount + ' of ' + needsGeocoding.length + ' addresses (' + failedCount + ' failed)');
        console.log('Total murals loaded: ' + allMurals.length);

        populateFilters();
        refreshMarkers();
        updateTourSummary();
        loadingEl.classList.add('hidden');
        showToast('All ' + allMurals.length + ' murals loaded!');

    } catch (error) {
        console.error('Error loading murals:', error);
        loadingEl.classList.add('hidden');
        errorEl.textContent = 'Error loading mural data: ' + error.message;
        errorEl.classList.remove('hidden');
    }
}

// --- Populate filters ---

function populateFilters() {
    var years = [];
    var schools = [];
    var boroughs = [];
    var yearSet = {};
    var schoolSet = {};
    var boroughSet = {};

    for (var i = 0; i < allMurals.length; i++) {
        var m = allMurals[i];
        if (m.year && !yearSet[m.year]) { yearSet[m.year] = true; years.push(m.year); }
        if (m.neighborhood && !schoolSet[m.neighborhood]) { schoolSet[m.neighborhood] = true; schools.push(m.neighborhood); }
        if (m.borough && !boroughSet[m.borough]) { boroughSet[m.borough] = true; boroughs.push(m.borough); }
    }

    years.sort();
    schools.sort();
    boroughs.sort();

    yearFilter.innerHTML = '<option value="">All Years</option>';
    for (var y = 0; y < years.length; y++) {
        yearFilter.innerHTML += '<option value="' + escapeHtml(String(years[y])) + '">' + escapeHtml(String(years[y])) + '</option>';
    }

    schoolsFilter.innerHTML = '<option value="">All Schools / Sites</option>';
    for (var s = 0; s < schools.length; s++) {
        schoolsFilter.innerHTML += '<option value="' + escapeHtml(schools[s]) + '">' + escapeHtml(schools[s]) + '</option>';
    }

    boroughFilter.innerHTML = '<option value="">All Boroughs</option>';
    for (var b = 0; b < boroughs.length; b++) {
        boroughFilter.innerHTML += '<option value="' + escapeHtml(boroughs[b]) + '">' + escapeHtml(boroughs[b]) + '</option>';
    }
}

// --- Init map ---

function initMap() {
    map = L.map('map', {
        center: CONFIG.map.initialView,
        zoom: CONFIG.map.initialZoom,
        zoomControl: true,
        fadeAnimation: true,
        attributionControl: true
    });

    L.tileLayer(CONFIG.map.tileLayer, {
        maxZoom: CONFIG.map.maxZoom,
        attribution: CONFIG.map.tileAttribution
    }).addTo(map);

    markerClusterGroup = L.markerClusterGroup({
        iconCreateFunction: function(cluster) {
            var count = cluster.getChildCount();
            return L.divIcon({
                html: '<div style="background-color: #3b82f6; color: white; border-radius: 50%; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">' + count + '</div>',
                className: '',
                iconSize: [34, 34]
            });
        },
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true
    });

    map.addLayer(markerClusterGroup);

    // Popup listener for narrator
    map.on('popupopen', function(e) {
        if (!narratorEnabled) return;
        var popup = e.popup;
        var content = popup.getContent();
        var tempDiv = document.createElement('div');
        tempDiv.innerHTML = content;
        var titleEl = tempDiv.querySelector('h3');
        var artistEl = tempDiv.querySelector('p[style*="font-weight: bold"]');
        var descEl = tempDiv.querySelector('.mural-description');
        var textToRead = '';
        if (titleEl) textToRead += titleEl.textContent + '. ';
        if (artistEl && artistEl.textContent.trim()) {
            var artistName = artistEl.textContent.trim();
            if (artistName !== 'Unknown Artist') {
                textToRead += 'by ' + artistName + '. ';
            }
        }
        if (descEl) {
            var descText = descEl.textContent.trim();
            if (descText.length > 0) textToRead += descText;
        }
        if (!descEl || descEl.textContent.trim().length === 0) {
            if (artistEl) textToRead += artistEl.textContent;
        }
        if (textToRead && window.speechSynthesis) {
            var utterance = new SpeechSynthesisUtterance(textToRead);
            utterance.rate = 0.9;
            utterance.pitch = 1;
            window.speechSynthesis.speak(utterance);
        }
    });

    setupEventListeners();
    applyTheme();

    console.log('Map initialized');
}

// --- Refresh markers ---

function refreshMarkers() {
    if (!markerClusterGroup) return;

    markerClusterGroup.clearLayers();

    var searchTerm = searchInput.value.toLowerCase().trim();
    var year = yearFilter.value;
    var school = schoolsFilter.value;
    var borough = boroughFilter.value;
    var viewPercent = parseInt(muralViewSlider.value) / 100;

    var filtered = allMurals.filter(function(mural) {
        if (searchTerm) {
            var titleMatch = mural.title.toLowerCase().includes(searchTerm);
            var artistMatch = mural.artist.toLowerCase().includes(searchTerm);
            var descMatch = (mural.description || '').toLowerCase().includes(searchTerm);
            if (!titleMatch && !artistMatch && !descMatch) return false;
        }
        if (year && String(mural.year) !== String(year)) return false;
        if (school && mural.neighborhood !== school) return false;
        if (borough && mural.borough !== borough) return false;
        return true;
    });

    if (viewPercent < 1) {
        var shuffled = filtered.slice().sort(function() { return Math.random() - 0.5; });
        var count = Math.max(1, Math.floor(filtered.length * viewPercent));
        filtered = shuffled.slice(0, count);
    }

    var greenIcon = createGreenIcon();

    for (var i = 0; i < filtered.length; i++) {
        var mural = filtered[i];
        if (mural.lat && mural.lng) {
            var popupContent = buildPopupContent(mural);
            var marker = L.marker([mural.lat, mural.lng], { icon: greenIcon })
                .bindPopup(popupContent, { maxWidth: CONFIG.popup.maxWidth });
            markerClusterGroup.addLayer(marker);
        }
    }

    if (currentLocation) {
        updateNearestResults(currentLocation.lat, currentLocation.lng);
    }
}

// --- Nearest results ---

function updateNearestResults(lat, lng) {
    if (!allMurals.length) return;

    var sorted = [];
    for (var i = 0; i < allMurals.length; i++) {
        var m = allMurals[i];
        if (m.lat && m.lng) {
            var distance = getDistance(lat, lng, m.lat, m.lng);
            sorted.push({ mural: m, distance: distance });
        }
    }
    sorted.sort(function(a, b) { return a.distance - b.distance; });
    sorted = sorted.slice(0, 10);

    if (sorted.length === 0) {
        nearestResults.innerHTML = '<p style="color: var(--text-muted);">No murals found nearby.</p>';
        nearestResults.classList.add('empty');
        return;
    }

    nearestResults.classList.remove('empty');
    var html = '';
    for (var j = 0; j < sorted.length; j++) {
        var item = sorted[j];
        var m = item.mural;
        html += '<div class="nearest-card" onclick="zoomToMural(\'' + escapeHtml(m.title) + '\', ' + m.lat + ', ' + m.lng + ')">' +
            '<header><h3>' + escapeHtml(m.title) + '</h3><span class="distance-pill">' + item.distance.toFixed(1) + ' mi</span></header>' +
            '<p>' + escapeHtml(m.artist) + (m.borough ? ' &middot; ' + escapeHtml(m.borough) : '') + '</p>' +
            '<footer>' +
            '<button onclick="event.stopPropagation(); zoomToMural(\'' + escapeHtml(m.title) + '\', ' + m.lat + ', ' + m.lng + ')">View on Map</button>' +
            '<button onclick="event.stopPropagation(); addToTour(' + j + ')">Add to Tour</button>' +
            '</footer></div>';
    }
    nearestResults.innerHTML = html;

    window._nearestMurals = sorted.map(function(item) { return item.mural; });
}

function getDistance(lat1, lng1, lat2, lng2) {
    var R = 3959;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

window.zoomToMural = function(title, lat, lng) {
    map.setView([lat, lng], 16);
    var mural = null;
    for (var i = 0; i < allMurals.length; i++) {
        if (allMurals[i].title === title && allMurals[i].lat === lat && allMurals[i].lng === lng) {
            mural = allMurals[i];
            break;
        }
    }
    if (mural) addToRecent(mural);
};

function addToRecent(mural) {
    var filtered = [];
    for (var i = 0; i < recentMurals.length; i++) {
        if (recentMurals[i].title !== mural.title || recentMurals[i].address !== mural.address) {
            filtered.push(recentMurals[i]);
        }
    }
    recentMurals = filtered;
    recentMurals.unshift(mural);
    if (recentMurals.length > 20) recentMurals.pop();
    localStorage.setItem('recentMurals', JSON.stringify(recentMurals));
    updateRecentList();
}

function updateRecentList() {
    if (recentMurals.length === 0) {
        recentMuralsList.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">No murals viewed yet.</p>';
        return;
    }
    var html = '';
    var count = Math.min(10, recentMurals.length);
    for (var i = 0; i < count; i++) {
        var m = recentMurals[i];
        html += '<div class="recent-card" onclick="zoomToMural(\'' + escapeHtml(m.title) + '\', ' + m.lat + ', ' + m.lng + ')">' +
            '<h4>' + escapeHtml(m.title) + '</h4>' +
            '<p>' + escapeHtml(m.artist) + (m.borough ? ' &middot; ' + escapeHtml(m.borough) : '') + '</p></div>';
    }
    recentMuralsList.innerHTML = html;
}

function updateSavedList() {
    if (savedMurals.length === 0) {
        savedMuralsList.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">No saved murals yet.</p>';
        return;
    }
    var html = '';
    var count = Math.min(10, savedMurals.length);
    for (var i = 0; i < count; i++) {
        var m = savedMurals[i];
        html += '<div class="recent-card" onclick="zoomToMural(\'' + escapeHtml(m.title) + '\', ' + m.lat + ', ' + m.lng + ')">' +
            '<h4>' + escapeHtml(m.title) + '</h4>' +
            '<p>' + escapeHtml(m.artist) + (m.borough ? ' &middot; ' + escapeHtml(m.borough) : '') + '</p></div>';
    }
    savedMuralsList.innerHTML = html;
}

function updateFeatured() {
    var shuffled = allMurals.slice().sort(function() { return Math.random() - 0.5; });
    featuredMurals = shuffled.slice(0, 5);
    var html = '';
    for (var i = 0; i < featuredMurals.length; i++) {
        var m = featuredMurals[i];
        html += '<div class="recent-card featured-card" onclick="zoomToMural(\'' + escapeHtml(m.title) + '\', ' + m.lat + ', ' + m.lng + ')">' +
            '<h4>' + escapeHtml(m.title) + '</h4>' +
            '<p>' + escapeHtml(m.artist) + (m.borough ? ' &middot; ' + escapeHtml(m.borough) : '') + '</p></div>';
    }
    featuredMuralsList.innerHTML = html;
}

// --- Theme ---

function applyTheme() {
    var toggleTextEl = document.getElementById('themeToggleText');
    if (isDarkMode) {
        document.documentElement.classList.remove('light-mode');
        document.documentElement.classList.add('dark-mode');
        if (toggleTextEl) toggleTextEl.textContent = 'Light Mode';
    } else {
        document.documentElement.classList.add('light-mode');
        document.documentElement.classList.remove('dark-mode');
        if (toggleTextEl) toggleTextEl.textContent = 'Dark Mode';
    }
}

function toggleTheme() {
    isDarkMode = !isDarkMode;
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
    applyTheme();
}

// --- Event listeners ---

function setupEventListeners() {
    themeToggle.addEventListener('click', toggleTheme);

    sidebarHideBtn.addEventListener('click', function() {
        sidebar.classList.add('hidden');
        sidebarShowTab.classList.remove('hidden');
    });

    sidebarShowTab.addEventListener('click', function() {
        sidebar.classList.remove('hidden');
        sidebarShowTab.classList.add('hidden');
    });

    startSearchBtn.addEventListener('click', handleAddressSearch);
    manualAddressInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') handleAddressSearch();
    });

    useDeviceGpsBtn.addEventListener('click', handleGpsSearch);
    clearLocationBtn.addEventListener('click', clearLocation);

    muralViewSlider.addEventListener('input', function() {
        var val = this.value;
        muralViewLabel.textContent = val + '%';
        this.style.setProperty('--val', val);
        refreshMarkers();
    });
    muralViewSlider.style.setProperty('--val', muralViewSlider.value);

    clearAllFiltersBtn.addEventListener('click', function() {
        searchInput.value = '';
        yearFilter.value = '';
        schoolsFilter.value = '';
        boroughFilter.value = '';
        muralViewSlider.value = 100;
        muralViewLabel.textContent = '100%';
        muralViewSlider.style.setProperty('--val', 100);
        refreshMarkers();
        showToast('All filters cleared');
    });

    searchInput.addEventListener('input', refreshMarkers);
    yearFilter.addEventListener('change', refreshMarkers);
    schoolsFilter.addEventListener('change', refreshMarkers);
    boroughFilter.addEventListener('change', refreshMarkers);
    toggleDistricts.addEventListener('change', refreshMarkers);

    toggleSearchFiltersBtn.addEventListener('click', function() {
        var isVisible = searchFiltersContainer.style.display !== 'none';
        searchFiltersContainer.style.display = isVisible ? 'none' : 'flex';
        toggleSearchFiltersIcon.textContent = isVisible ? '+' : '\u2212';
    });

    refreshFeaturedBtn.addEventListener('click', updateFeatured);

    enableNarrator.addEventListener('change', function(e) {
        narratorEnabled = e.target.checked;
        if (narratorEnabled) {
            showToast('Narrator enabled - popups will be read aloud');
        } else {
            showToast('Narrator disabled');
            if (window.speechSynthesis) window.speechSynthesis.cancel();
        }
    });

    customTourRadius.addEventListener('input', function() {
        var val = this.value;
        customTourRadiusLabel.textContent = val + ' mile' + (val > 1 ? 's' : '');
        this.style.setProperty('--val', (val / 5) * 100);
        updateTourSummary();
    });
    customTourRadius.style.setProperty('--val', (customTourRadius.value / 5) * 100);

    customTourLimit.addEventListener('input', function() {
        var val = this.value;
        customTourLimitLabel.textContent = val + ' stop' + (val > 1 ? 's' : '');
        this.style.setProperty('--val', ((val - 2) / 18) * 100);
        updateTourSummary();
    });
    customTourLimit.style.setProperty('--val', ((customTourLimit.value - 2) / 18) * 100);

    createCustomTourBtn.addEventListener('click', createTour);

    endTourBtn.addEventListener('click', endTour);
    tourPrevBtn.addEventListener('click', function() { navigateTour(-1); });
    tourNextBtn.addEventListener('click', function() { navigateTour(1); });
    tourRouteBtn.addEventListener('click', showTourRoute);

    modalClose.addEventListener('click', function() { viewAllModal.classList.add('hidden'); });
    viewAllModal.addEventListener('click', function(e) {
        if (e.target === viewAllModal) viewAllModal.classList.add('hidden');
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            viewAllModal.classList.add('hidden');
            if (tourItinerary.classList.contains('visible')) endTour();
        }
    });
}

// --- Location handlers ---

async function handleAddressSearch() {
    var address = manualAddressInput.value.trim();
    if (!address) {
        showToast('Please enter an address or zip code');
        return;
    }

    loadingEl.textContent = 'Searching for address...';
    loadingEl.classList.remove('hidden');

    var coords = await geocodeAddress(address);
    loadingEl.classList.add('hidden');

    if (coords) {
        currentLocation = coords;
        map.setView([coords.lat, coords.lng], 14);
        updateNearestResults(coords.lat, coords.lng);
        var nearbyCount = 0;
        for (var i = 0; i < allMurals.length; i++) {
            if (allMurals[i].lat && allMurals[i].lng) nearbyCount++;
        }
        showToast('Found ' + nearbyCount + ' murals nearby');
        addYouAreHereMarker(coords.lat, coords.lng);
    } else {
        showToast('Could not find that address. Please try again.');
    }
}

function handleGpsSearch() {
    if (!navigator.geolocation) {
        showToast('Geolocation is not supported by your browser');
        return;
    }

    loadingEl.textContent = 'Getting your location...';
    loadingEl.classList.remove('hidden');

    navigator.geolocation.getCurrentPosition(
        function(position) {
            loadingEl.classList.add('hidden');
            var coords = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            currentLocation = coords;
            map.setView([coords.lat, coords.lng], 14);
            updateNearestResults(coords.lat, coords.lng);
            showToast('Location found! Showing nearest murals.');
            addYouAreHereMarker(coords.lat, coords.lng);
        },
        function(error) {
            loadingEl.classList.add('hidden');
            showToast('Could not get your location: ' + error.message);
        },
        { enableHighAccuracy: true }
    );
}

function clearLocation() {
    currentLocation = null;
    if (userLocationMarker) {
        map.removeLayer(userLocationMarker);
        userLocationMarker = null;
    }
    if (youAreHereLabel) {
        map.removeLayer(youAreHereLabel);
        youAreHereLabel = null;
    }
    map.setView(CONFIG.map.initialView, CONFIG.map.initialZoom);
    nearestResults.innerHTML = '';
    nearestResults.classList.add('empty');
    manualAddressInput.value = '';
    updateTourSummary();
    showToast('Location cleared');
}

// --- YOU ARE HERE marker ---

function addYouAreHereMarker(lat, lng) {
    if (userLocationMarker) map.removeLayer(userLocationMarker);
    if (youAreHereLabel) map.removeLayer(youAreHereLabel);

    userLocationMarker = L.circleMarker([lat, lng], {
        radius: 12,
        fillColor: '#ef4444',
        color: '#ffffff',
        weight: 3,
        opacity: 1,
        fillOpacity: 0.9,
        className: 'you-are-here-pulse'
    }).addTo(map);

    if (!document.getElementById('you-are-here-style')) {
        var style = document.createElement('style');
        style.id = 'you-are-here-style';
        style.textContent = '.you-are-here-pulse { animation: pulse-ring 2s ease-out infinite; } @keyframes pulse-ring { 0% { r: 12; opacity: 1; } 50% { r: 22; opacity: 0.4; } 100% { r: 12; opacity: 1; } }';
        document.head.appendChild(style);
    }

    var labelIcon = L.divIcon({
        className: 'you-are-here-label',
        html: '<div style="background: #ef4444; color: white; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 12px; border: 2px solid white; box-shadow: 0 2px 12px rgba(239, 68, 68, 0.5); text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; pointer-events: none; margin-top: -20px; margin-left: -30px;">YOU ARE HERE</div>',
        iconSize: [80, 30],
        iconAnchor: [40, 30]
    });

    youAreHereLabel = L.marker([lat, lng], { icon: labelIcon, interactive: false }).addTo(map);
}

// --- Tour functions ---

function updateTourSummary() {
    if (!currentLocation) {
        customTourSummary.textContent = 'Set your location first to preview local tour stops.';
        return;
    }

    var radius = parseFloat(customTourRadius.value);
    var limit = parseInt(customTourLimit.value);
    var setting = customTourSetting.value;

    var nearby = [];
    for (var i = 0; i < allMurals.length; i++) {
        var m = allMurals[i];
        if (!m.lat || !m.lng) continue;
        if (setting === 'exterior' && m.status !== 'Exterior' && m.status !== '') continue;
        if (setting === 'interior' && m.status !== 'Interior') continue;
        var distance = getDistance(currentLocation.lat, currentLocation.lng, m.lat, m.lng);
        if (distance <= radius) {
            nearby.push({ mural: m, distance: distance });
        }
    }
    nearby.sort(function(a, b) { return a.distance - b.distance; });
    nearby = nearby.slice(0, limit);

    if (nearby.length === 0) {
        customTourSummary.textContent = 'No ' + setting + ' murals found within ' + radius + ' mile' + (radius > 1 ? 's' : '') + ' of your location.';
    } else {
        customTourSummary.textContent = 'Found ' + nearby.length + ' ' + setting + ' mural' + (nearby.length > 1 ? 's' : '') + ' within ' + radius + ' mile' + (radius > 1 ? 's' : '') + '. Click "Create Local Tour" to start.';
    }
}

function createTour() {
    if (!currentLocation) {
        showToast('Please set your location first (use GPS or enter an address)');
        return;
    }

    var radius = parseFloat(customTourRadius.value);
    var limit = parseInt(customTourLimit.value);
    var setting = customTourSetting.value;

    var nearby = [];
    for (var i = 0; i < allMurals.length; i++) {
        var m = allMurals[i];
        if (!m.lat || !m.lng) continue;
        if (setting === 'exterior' && m.status !== 'Exterior' && m.status !== '') continue;
        if (setting === 'interior' && m.status !== 'Interior') continue;
        var distance = getDistance(currentLocation.lat, currentLocation.lng, m.lat, m.lng);
        if (distance <= radius) {
            nearby.push({ mural: m, distance: distance });
        }
    }
    nearby.sort(function(a, b) { return a.distance - b.distance; });
    nearby = nearby.slice(0, limit).map(function(item) { return item.mural; });

    if (nearby.length < 2) {
        showToast('Need at least 2 murals for a tour. Try increasing the radius.');
        return;
    }

    currentTour = nearby;
    showTourItinerary(nearby);
    drawTourRoute(nearby);
    showToast('Tour created with ' + nearby.length + ' stops!');
}

function drawTourRoute(tour) {
    if (tourPolyline) {
        map.removeLayer(tourPolyline);
        tourPolyline = null;
    }

    if (!tour || tour.length < 2) return;

    var latlngs = [];
    for (var i = 0; i < tour.length; i++) {
        latlngs.push([tour[i].lat, tour[i].lng]);
    }
    tourPolyline = L.polyline(latlngs, {
        color: '#22c55e',
        weight: 4,
        opacity: 0.8,
        smoothFactor: 1,
        className: 'tour-route-line'
    }).addTo(map);

    var startIcon = L.divIcon({
        className: 'tour-start-marker',
        html: '<div style="background: #22c55e; color: white; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 10px; border: 2px solid white; box-shadow: 0 2px 8px rgba(34, 197, 94, 0.4);">START</div>',
        iconSize: [60, 22],
        iconAnchor: [30, 11]
    });

    var endIcon = L.divIcon({
        className: 'tour-end-marker',
        html: '<div style="background: #ef4444; color: white; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 10px; border: 2px solid white; box-shadow: 0 2px 8px rgba(239, 68, 68, 0.4);">END</div>',
        iconSize: [50, 22],
        iconAnchor: [25, 11]
    });

    if (tour.length > 0) {
        var first = tour[0];
        var last = tour[tour.length - 1];
        L.marker([first.lat, first.lng], { icon: startIcon, interactive: false }).addTo(map);
        L.marker([last.lat, last.lng], { icon: endIcon, interactive: false }).addTo(map);
    }

    var bounds = L.latLngBounds(latlngs);
    map.fitBounds(bounds, { padding: [60, 60] });
}

function showTourItinerary(tour) {
    tourItinerary.classList.add('visible');
    tourTitle.textContent = 'Mural Tour (' + tour.length + ' stops)';

    var html = '';
    for (var i = 0; i < tour.length; i++) {
        var m = tour[i];
        var distance = m.distance || 0;
        html += '<div class="tour-stop-item" data-index="' + i + '" onclick="navigateTourTo(' + i + ')">' +
            '<strong>' + (i + 1) + '.</strong> ' + escapeHtml(m.title) +
            ' <span style="color: var(--text-muted); font-size: 12px;">(' + distance.toFixed(1) + ' mi)</span></div>';
    }
    tourStopsList.innerHTML = html;

    var firstStop = tourStopsList.querySelector('.tour-stop-item');
    if (firstStop) firstStop.classList.add('active');
}

function navigateTour(direction) {
    if (!currentTour || currentTour.length === 0) return;
    var stops = tourStopsList.querySelectorAll('.tour-stop-item');
    var currentIndex = 0;
    for (var i = 0; i < stops.length; i++) {
        if (stops[i].classList.contains('active')) currentIndex = i;
    }
    var newIndex = Math.max(0, Math.min(currentIndex + direction, currentTour.length - 1));
    navigateTourTo(newIndex);
}

function navigateTourTo(index) {
    if (!currentTour || index < 0 || index >= currentTour.length) return;
    var stops = tourStopsList.querySelectorAll('.tour-stop-item');
    for (var i = 0; i < stops.length; i++) {
        stops[i].classList.toggle('active', i === index);
    }
    var mural = currentTour[index];
    map.setView([mural.lat, mural.lng], 16);
    var greenIcon = createGreenIcon();
    var popupContent = buildPopupContent(mural);
    var marker = L.marker([mural.lat, mural.lng], { icon: greenIcon })
        .addTo(map)
        .bindPopup(popupContent, { maxWidth: CONFIG.popup.maxWidth })
        .openPopup();
    setTimeout(function() { map.removeLayer(marker); }, 5000);
}

function showTourRoute() {
    if (!currentTour || currentTour.length < 2) {
        showToast('Need at least 2 stops to show a route');
        return;
    }
    if (routingControl) {
        map.removeControl(routingControl);
        routingControl = null;
    }
    var waypoints = [];
    for (var i = 0; i < currentTour.length; i++) {
        waypoints.push(L.latLng(currentTour[i].lat, currentTour[i].lng));
    }
    routingControl = L.Routing.control({
        waypoints: waypoints,
        routeWhileDragging: false,
        showAlternatives: false,
        fitSelectedRoutes: true,
        lineOptions: {
            styles: [{ color: '#3b82f6', weight: 4, opacity: 0.8 }]
        },
        altLineOptions: {
            styles: [{ color: '#f472b6', weight: 3, opacity: 0.6 }]
        },
        createMarker: function() { return null; }
    }).addTo(map);
    showToast('Route displayed on map');
}

function endTour() {
    currentTour = null;
    tourItinerary.classList.remove('visible');
    if (routingControl) {
        map.removeControl(routingControl);
        routingControl = null;
    }
    if (tourPolyline) {
        map.removeLayer(tourPolyline);
        tourPolyline = null;
    }
    showToast('Tour ended');
}

window.addToTour = function(index) {
    if (!window._nearestMurals) {
        showToast('No murals found nearby');
        return;
    }
    var mural = window._nearestMurals[index];
    if (!mural) return;
    if (!currentTour) currentTour = [];
    currentTour.push(mural);
    showTourItinerary(currentTour);
    drawTourRoute(currentTour);
    showToast('Added ' + mural.title + ' to tour');
};

// --- Start ---

document.addEventListener('DOMContentLoaded', function() {
    var savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') isDarkMode = false;
    else if (savedTheme === 'dark') isDarkMode = true;
    else isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme();

    enableNarrator.checked = false;
    narratorEnabled = false;

    loadMurals();
    setInterval(updateTourSummary, 5000);
});

// Expose globals
window.refreshMarkers = refreshMarkers;
window.zoomToMural = zoomToMural;
window.addToTour = addToTour;
window.toggleSaveMural = toggleSaveMural;
window.navigateTourTo = navigateTourTo;