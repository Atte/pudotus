const HEIGHTS = [4000, 3500, 3000, 2500, 2000, 1500, 1000, 600, 300, 0];
const PARAMS = {
    Temperature: 'Temperature',
    WindDirection: 'WindDirection',
    WindSpeedMS: 'WindSpeedMS',
};
const SURFACE_PARAMS = {
    MediumCloudCover: 'MediumCloudCover',
    LowCloudCover: 'LowCloudCover',
};
const CLOUD_HEIGHTS = {
    4000: SURFACE_PARAMS.MediumCloudCover,
    2000: SURFACE_PARAMS.LowCloudCover,
};

/** @returns {string} */
function getDataTime() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = (now.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = now.getUTCDate().toString().padStart(2, '0');
    const hour = now.getUTCHours().toString().padStart(2, '0');
    return `${year}-${month}-${day}T${hour}:00:00Z`;
}

/**
 * @param {string} time
 * @param {[number|string, number|string]} latlon
 * @param {number} height
 * @param {AbortController?} abortController
 * @returns {Promise<{[key: string]: number}>}
 */
async function getData(time, latlon, height, abortController) {
    const url = new URL('https://opendata.fmi.fi/wfs');
    url.searchParams.set('request', 'GetFeature');
    url.searchParams.set('latlon', latlon.join(','));
    url.searchParams.set('starttime', time);
    url.searchParams.set('endtime', time);

    if (height == 0) {
        url.searchParams.set('storedquery_id', 'fmi::forecast::harmonie::surface::point::simple');
        url.searchParams.set('parameters', Object.values(PARAMS).concat(Object.values(SURFACE_PARAMS)).join(','));
    } else {
        url.searchParams.set('storedquery_id', 'fmi::forecast::harmonie::hybrid::point::simple');
        url.searchParams.set('parameters', Object.values(PARAMS).join(','));
        url.searchParams.set('height', height);
    }

    const response = await fetch(url, {
        mode: 'cors',
        credentials: 'omit',
        keepalive: true,
        signal: abortController?.signal,
    });
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
    }

    const dom = new DOMParser().parseFromString(await response.text(), 'text/xml');

    const data = {};
    for (const el of dom.querySelectorAll('member > BsWfsElement')) {
        const value = parseFloat(el.querySelector('ParameterValue').textContent);
        if (Number.isFinite(value)) {
            data[el.querySelector('ParameterName').textContent] = value;
        }
    }
    return data;
}

/** @type {AbortController|null} */
let abortController = null;

/** @returns {Promise<void>} */
async function refresh() {
    /** @type {HTMLTableRowElement} */
    const rowTemplate = document.getElementById('row-template').content.querySelector('tr');
    /** @type {HTMLTableRowElement} */
    const cloudCoverTemplate = document.getElementById('cloud-cover-template').content.querySelector('td');

    const main = document.getElementById('main');
    const status = document.getElementById('status');
    const statusContainer = document.getElementById('status-container');

    status.textContent = 'Geolocating';
    statusContainer.classList.add('loading');
    main.innerHTML = '';

    /** @type {GeolocationPosition} */
    const position = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            maximumAge: 1000 * 60,
            enableHighAccuracy: false,
        })
    );
    const latlon = [position.coords.latitude.toFixed(2), position.coords.longitude.toFixed(2)];

    abortController?.abort();
    const myAbortController = (abortController = new AbortController());

    const updateTime = getDataTime();
    let data;
    for (const height of HEIGHTS) {
        status.textContent = `Loading ${height}m`;
        data = await getData(updateTime, latlon, height, myAbortController);

        if (myAbortController.signal.aborted) {
            return;
        }

        const tr = rowTemplate.cloneNode(true);
        tr.dataset.height = height;
        tr.querySelector('.height').textContent = height.toLocaleString('fi');
        tr.querySelector('.temperature').textContent = data[PARAMS.Temperature].toFixed(0);
        tr.querySelector('.wind-speed').textContent = data[PARAMS.WindSpeedMS].toFixed(0);
        tr.querySelector('.wind-direction .arrow').setAttribute('style', `--direction: ${data[PARAMS.WindDirection]}deg`);
        main.appendChild(tr);
    }

    for (const [height, param] of Object.entries(CLOUD_HEIGHTS)) {
        const tr = main.querySelector(`tr[data-height="${height}"]`);
        const td = cloudCoverTemplate.cloneNode(true);
        td.querySelector('.value').textContent = data[param].toFixed(0);
        tr.appendChild(td);
    }

    if (abortController === myAbortController) {
        abortController = null;
    }

    status.textContent = new Date(updateTime).toLocaleString('fi', {
        dateStyle: 'short',
        timeStyle: 'short',
    });
    statusContainer.classList.remove('loading');
}

let timer = null;
function setupTimer() {
    const minutes = 60 - new Date().getMinutes() + 1;
    timer = setTimeout(async () => {
        timer = null;
        if (document.visibilityState == 'visible') {
            await refresh();
        }
        if (!timer) {
            setupTimer();
        }
    }, 1000 * 60 * minutes);
}

document.addEventListener('visibilitychange', async () => {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }

    if (document.visibilityState == 'visible') {
        await refresh();
        setupTimer();
    }
});

addEventListener('unhandledrejection', (event) => {
    console.error(event);
});

refresh();