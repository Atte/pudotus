const HEIGHTS = [4000, 3500, 3000, 2500, 2000, 1500, 1000, 600, 300, 0];
const PARAMS = {
    Temperature: 'Temperature',
    WindDirection: 'WindDirection',
    WindSpeedMS: 'WindSpeedMS',
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
 * @returns {Promise<{[key: string]: number}>}
 */
async function getData(time, latlon, height) {
    const url = new URL('https://opendata.fmi.fi/wfs');
    url.searchParams.set('request', 'GetFeature');
    url.searchParams.set('parameters', Object.values(PARAMS).join(','));
    url.searchParams.set('latlon', latlon.join(','));
    url.searchParams.set('starttime', time);
    url.searchParams.set('endtime', time);

    if (height == 0) {
        url.searchParams.set('storedquery_id', 'fmi::forecast::harmonie::surface::point::simple');
    } else {
        url.searchParams.set('storedquery_id', 'fmi::forecast::harmonie::hybrid::point::simple');
        url.searchParams.set('height', height);
    }

    const response = await fetch(url);
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

/** @type {string|null} */
let updateTime = null;

/** @returns {Promise<void>} */
async function refresh() {
    /** @type {HTMLTableRowElement} */
    const rowTemplate = document.getElementById('row-template').content.querySelector('tr');
    const main = document.getElementById('main');
    const status = document.getElementById('status');
    const statusContainer = document.getElementById('status-container');

    status.textContent = 'Geolocating';
    statusContainer.classList.add('loading');
    main.innerHTML = '';

    /** @type {GeolocationPosition} */
    const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject));
    const latlon = [position.coords.latitude.toFixed(2), position.coords.longitude.toFixed(2)];

    updateTime = getDataTime();
    for (const height of HEIGHTS) {
        status.textContent = `Loading ${height}m`;
        const data = await getData(updateTime, latlon, height);

        const tr = rowTemplate.cloneNode(true);
        tr.querySelector('.height').textContent = height.toLocaleString('fi');
        tr.querySelector('.temperature').textContent = data[PARAMS.Temperature].toFixed(0);
        tr.querySelector('.wind-speed').textContent = data[PARAMS.WindSpeedMS].toFixed(0);
        tr.querySelector('.wind-direction .arrow').setAttribute('style', `--direction: ${data[PARAMS.WindDirection]}deg`);
        main.appendChild(tr);
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
        await refresh();
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
        if (updateTime !== getDataTime()) {
            await refresh();
        }
        setupTimer();
    }
});

addEventListener('unhandledrejection', (event) => {
    console.error(event);
});

refresh();
