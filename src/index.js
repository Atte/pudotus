const HEIGHTS = [4000, 3500, 3000, 2500, 2000, 1500, 1000, 600, 300, 0];
const PARAMS = {
    GeomHeight: 'GeomHeight',
    Temperature: 'Temperature',
    WindDirection: 'WindDirection',
    WindSpeedMS: 'WindSpeedMS',
};
const SURFACE_PARAMS = {
    MediumCloudCover: 'MediumCloudCover',
    LowCloudCover: 'LowCloudCover',
    WindGust: 'WindGust',
};
const CLOUD_HEIGHTS = {
    4000: SURFACE_PARAMS.MediumCloudCover,
    1500: SURFACE_PARAMS.LowCloudCover,
};
const MINUTES_ACCURACY = 5;

const REQUEST_TEMPLATE = `<?xml version="1.0" ?>
<wfs:GetFeature
    service="WFS"
    version="2.0.2"
    outputFormat="application/gml+xml; version=3.2"
    xmlns:wfs="http://www.opengis.net/wfs/2.0"
    xmlns:fes="http://www.opengis.net/fes/2.0"
    xmlns:gml="http://www.opengis.net/gml/3.2"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.opengis.net/wfs/2.0 http://schemas.opengis.net/wfs/2.0/wfs.xsd">
    <wfs:StoredQuery>
        <wfs:Parameter name="latlon">
            <gml:pos></gml:pos>
        </wfs:Parameter>
        <wfs:Parameter name="height"></wfs:Parameter>
        <wfs:Parameter name="starttime"></wfs:Parameter>
        <wfs:Parameter name="endtime"></wfs:Parameter>
        <wfs:Parameter name="timestep"></wfs:Parameter>
        <wfs:Parameter name="parameters"></wfs:Parameter>
    </wfs:StoredQuery>
</wfs:GetFeature>`;

class PrettyError extends Error {}

/**
 * @typedef {[number|string, number|string]} LatLon
 * @typedef {{[height: number]: {[key: string]: number}}} Datas
 */

/** @returns {string} */
function getDataTime() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = (now.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = now.getUTCDate().toString().padStart(2, '0');
    const hour = now.getUTCHours().toString().padStart(2, '0');
    const minute = (Math.floor(now.getUTCMinutes() / MINUTES_ACCURACY) * MINUTES_ACCURACY).toString().padStart(2, '0');
    return `${year}-${month}-${day}T${hour}:${minute}:00Z`;
}

/**
 * Removes the oldest entries from a map to bring it down to at most `size` elements.
 * @param {Map<any, any>} map
 * @param {number} size
 */
function capMapSize(map, size) {
    for (const key of Array.from(map.keys()).slice(-size)) {
        map.delete(key);
    }
}

/** @type {Map<string, Datas>} */
const dataCache = new Map();

/**
 * @param {string} time
 * @param {LatLon} latlon
 * @param {AbortController?} abortController
 * @returns {Promise<Datas>}
 */
async function getData(time, latlon, abortController) {
    const cacheKey = `${time} ${latlon.join(',')}`;
    const cached = dataCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    /** @type {XMLDocument} */
    const request = new DOMParser().parseFromString(REQUEST_TEMPLATE, 'text/xml');
    const queryTemplate = request.querySelector('StoredQuery');
    queryTemplate.remove();

    for (const height of HEIGHTS) {
        const query = queryTemplate.cloneNode(true);
        query.querySelector('[name="latlon"] > pos').textContent = latlon.join(' ');
        query.querySelector('[name="starttime"]').textContent = time;
        query.querySelector('[name="endtime"]').textContent = time;
        query.querySelector('[name="timestep"]').textContent = MINUTES_ACCURACY;
        if (height === 0) {
            query.id = 'fmi::forecast::harmonie::surface::point::simple';
            query.querySelector('[name="parameters"]').textContent = Object.values(PARAMS).concat(Object.values(SURFACE_PARAMS)).join(' ');
        } else {
            query.id = 'fmi::forecast::harmonie::hybrid::point::simple';
            query.querySelector('[name="parameters"]').textContent = Object.values(PARAMS).join(' ');
            query.querySelector('[name="height"]').textContent = height;
        }
        request.firstChild.appendChild(query);
    }

    const response = await fetch('https://opendata.fmi.fi/wfs', {
        method: 'POST',
        body: new XMLSerializer().serializeToString(request),
        headers: { 'Content-Type': 'text/xml' },
        mode: 'cors',
        credentials: 'omit',
        signal: abortController?.signal,
    });
    if (!response.ok) {
        const dom = new DOMParser().parseFromString(await response.text(), 'text/xml');
        const exception = dom.querySelector('ExceptionText');
        if (exception) {
            throw new PrettyError(exception.textContent);
        }
        throw new Error(`${response.status} ${response.statusText}`);
    }

    const dom = new DOMParser().parseFromString(await response.text(), 'text/xml');
    const datas = {};
    for (const collection of dom.querySelectorAll('member > FeatureCollection')) {
        const data = {};
        for (const element of collection.querySelectorAll('member > BsWfsElement')) {
            const value = parseFloat(element.querySelector('ParameterValue').textContent);
            if (Number.isFinite(value)) {
                data[element.querySelector('ParameterName').textContent] = value;
            }
        }
        datas[data[PARAMS.GeomHeight] ?? 0] = data;
    }

    capMapSize(dataCache, 10);
    dataCache.set(cacheKey, datas);
    return datas;
}

/** @type {Map<string, string>} */
const placeLabelCache = new Map();

/**
 * @param {LatLon} latlon
 * @param {AbortController?} abortController
 * @returns {Promise<string>}
 */
async function getPlaceLabel(latlon, abortController) {
    const cached = placeLabelCache.get(latlon.join(','));
    if (cached) {
        return cached;
    }

    const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&layer=address&zoom=13&addressdetails=0&lat=${latlon[0]}&lon=${latlon[1]}&email=pudotus@atte.fi`,
        {
            cache: 'force-cache',
            mode: 'cors',
            credentials: 'omit',
            signal: abortController?.signal,
        }
    );
    if (!response.ok) {
        const data = await response.json();
        if (data?.error?.message) {
            throw new PrettyError(data.error.message);
        }
        throw new Error(`${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    capMapSize(placeLabelCache, 100);
    placeLabelCache.set(latlon.join(','), data.name);
    return data.name;
}

/** @type {AbortController|null} */
let abortController = null;

/** @returns {Promise<void>} */
async function refresh() {
    abortController?.abort();
    const myAbortController = (abortController = new AbortController());

    /** @type {DocumentFragment} */
    const rowTemplate = document.getElementById('row-template').content;
    /** @type {DocumentFragment} */
    const cloudCoverTemplate = document.getElementById('cloud-cover-template').content;
    /** @type {DocumentFragment} */
    const windGustTemplate = document.getElementById('wind-gust-template').content;

    const status = document.getElementById('status');
    const statusContainer = document.getElementById('status-container');
    const placeLabel = document.getElementById('place-label');

    status.textContent = 'Geolocating';
    placeLabel.textContent = '';
    statusContainer.classList.add('loading');

    /** @type {GeolocationPosition} */
    let position;
    try {
        position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                maximumAge: 1000 * 60,
                enableHighAccuracy: false,
            });
        });
    } catch (err) {
        status.textContent = 'Error getting location';
        statusContainer.classList.remove('loading');
        throw err;
    }
    if (myAbortController.signal.aborted) {
        return;
    }
    const latlon = [position.coords.latitude.toFixed(2), position.coords.longitude.toFixed(2)];

    getPlaceLabel(latlon, myAbortController).then(
        (label) => {
            if (myAbortController.signal.aborted) {
                return;
            }
            placeLabel.textContent = label;
        },
        (err) => {
            if (err instanceof PrettyError) {
                placeLabel.textContent = err.message;
            }
            throw err;
        }
    );

    status.textContent = `Loading data`;
    const main = document.getElementById('main');
    const tbody = main.cloneNode(false);

    const updateTime = getDataTime();
    let datas;
    try {
        datas = await getData(updateTime, latlon, myAbortController);
    } catch (err) {
        if (err instanceof PrettyError) {
            status.textContent = err.message;
        } else {
            status.textContent = 'Error loading data';
        }
        statusContainer.classList.remove('loading');
        throw err;
    }
    if (myAbortController.signal.aborted) {
        return;
    }

    for (const height of HEIGHTS) {
        const data = datas[height];
        const tr = rowTemplate.cloneNode(true);
        tr.querySelector('tr').dataset.height = height;
        tr.querySelector('.height').textContent = height.toLocaleString('fi');
        tr.querySelector('.temperature').textContent = data[PARAMS.Temperature].toFixed(0);
        tr.querySelector('.wind-speed').textContent = data[PARAMS.WindSpeedMS].toFixed(0);
        tr.querySelector('.wind-direction').title = `Wind direction: ${data[PARAMS.WindDirection].toFixed(0)}°`;
        tr.querySelector('.wind-direction .arrow').style.setProperty('--wind-direction', `${data[PARAMS.WindDirection]}deg`);
        tbody.appendChild(tr);
    }

    for (const [height, param] of Object.entries(CLOUD_HEIGHTS)) {
        const td = cloudCoverTemplate.cloneNode(true);
        td.querySelector('.value').textContent = datas[0][param].toFixed(0);
        tbody.querySelector(`tr[data-height="${height}"]`).appendChild(td);
    }

    const td = windGustTemplate.cloneNode(true);
    td.querySelector('.wind-gust').textContent = datas[0][SURFACE_PARAMS.WindGust].toFixed(0);
    tbody.querySelector(`tr[data-height="0"]`).appendChild(td);

    if (abortController === myAbortController) {
        abortController = null;
    }

    main.replaceWith(tbody);
    status.textContent = new Date(updateTime).toLocaleString('fi', {
        dateStyle: 'short',
        timeStyle: 'short',
    });
    statusContainer.classList.remove('loading');
}

let timer = null;
function setupTimer() {
    const seconds = 60 * MINUTES_ACCURACY - ((new Date().getTime() / 1000) % (60 * MINUTES_ACCURACY)) + Math.random() * 60;
    console.log(`Next refresh in ${seconds.toFixed(0)} seconds`);

    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    timer = setTimeout(() => {
        if (timer) {
            clearTimeout(timer);
        }
        timer = null;

        refresh().finally(setupTimer);
    }, 1000 * seconds);
}

document.addEventListener('visibilitychange', () => {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }

    if (document.visibilityState === 'visible') {
        refresh().finally(setupTimer);
    }
});

addEventListener('unhandledrejection', (event) => {
    console.error(event);
});

refresh().finally(setupTimer);
