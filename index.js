const HEIGHTS = [4000, 3500, 3000, 2500, 2000, 1500, 1000, 600, 300, 0];
const PARAMS = {
    Temperature: 'Temperature',
    WindDirection: 'WindDirection',
    WindSpeedMS: 'WindSpeedMS',
};

/**
 * @param {[number|string, number|string]} latlon
 */
async function getData(latlon, height) {
    const now = new Date();
    const time = `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}T${now.getUTCHours()}:00:00Z`;

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

    const resp = await fetch(url, {
        mode: 'cors',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
    });
    const dom = new DOMParser().parseFromString(await resp.text(), 'text/xml');

    const data = {};
    for (const el of dom.querySelectorAll('member > BsWfsElement')) {
        const value = parseFloat(el.querySelector('ParameterValue').textContent);
        if (Number.isFinite(value)) {
            data[el.querySelector('ParameterName').textContent] = value;
        }
    }
    return data;
}

async function reload_impl() {
    /** @type {HTMLTableRowElement} */
    const rowTemplate = document.getElementById('row-template').content.querySelector('tr');
    const main = document.getElementById('main');
    const status = document.getElementById('status');
    const statusContainer = document.getElementById('status-container');

    status.textContent = 'Geolocating';
    statusContainer.classList.remove('hidden');
    main.innerHTML = '';

    /** @type {GeolocationPosition} */
    const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject));
    const latlon = [position.coords.latitude.toFixed(2), position.coords.longitude.toFixed(2)];

    for (const height of HEIGHTS) {
        status.textContent = `Loading ${height}m`;
        const data = await getData(latlon, height);

        const tr = rowTemplate.cloneNode(true);
        tr.querySelector('.height').textContent = height.toLocaleString('fi');
        tr.querySelector('.temperature').textContent = data[PARAMS.Temperature].toFixed(0);
        tr.querySelector('.wind-speed').textContent = data[PARAMS.WindSpeedMS].toFixed(0);
        tr.querySelector('.wind-direction .arrow').setAttribute('style', `--direction: ${data[PARAMS.WindDirection]}deg`);
        main.appendChild(tr);
    }

    statusContainer.classList.add('hidden');
}

function reload() {
    reload_impl().catch((err) => {
        console.error(err);
    });
}

let timer = null;
document.addEventListener('visibilitychange', () => {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }

    if (document.visibilityState == 'visible') {
        reload();
        timer = setInterval(reload, 1000 * 60 * 5);
    }
});

reload();
