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
 * @param {string} time
 * @param {[number|string, number|string]} latlon
 * @param {AbortController?} abortController
 * @returns {Promise<{[height: number]: {[key: string]: number}}>}
 */
async function getData(time, latlon, abortController) {
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
    return datas;
}

/** @type {AbortController|null} */
let abortController = null;

/** @returns {Promise<void>} */
async function refresh() {
    console.log('Refreshing...');

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

    status.textContent = 'Geolocating';
    statusContainer.classList.add('loading');

    /** @type {GeolocationPosition} */
    const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            maximumAge: 1000 * 60,
            enableHighAccuracy: false,
        });
    });
    if (myAbortController.signal.aborted) {
        return;
    }
    const latlon = [position.coords.latitude.toFixed(2), position.coords.longitude.toFixed(2)];

    status.textContent = `Loading data`;
    const main = document.getElementById('main');
    const tbody = main.cloneNode(false);

    const updateTime = getDataTime();
    const datas = await getData(updateTime, latlon, myAbortController);
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

for (const el of document.querySelectorAll('.keyboard-interactive')) {
    el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.target.click();
        }
    });
}
