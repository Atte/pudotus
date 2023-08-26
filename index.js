const QUERY = 'fmi::forecast::harmonie::hybrid::point::simple';
const SURFACE_QUERY = 'fmi::forecast::harmonie::surface::point::simple';
const PARAMS = {
    Temperature: 'Temperature',
    WindDirection: 'WindDirection',
    WindSpeedMS: 'WindSpeedMS',
    // WindUMS: 'WindUMS',
    // WindVMS: 'WindVMS',
    // VerticalVelocityMMS: 'VerticalVelocityMMS',
};
const HEIGHTS = [
    4000,
    3500,
    3000,
    2500,
    2000,
    1500,
    1000,
    600,
    300,
    200,
    100,
    0,
];

const MAIN = document.getElementById('main');
const STATUS = document.getElementById('status');
const STATUS_CONTAINER = document.getElementById('status-container');

/** @type {HTMLTableRowElement} */
const ROW_TEMPLATE = document.getElementById('row-template').content.querySelector('tr');

async function getData(latlon, height) {
    const now = new Date();
    const time = `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}T${now.getUTCHours()}:00:00Z`;

    const query = height == 0 ? SURFACE_QUERY : QUERY;
    const params = Object.values(PARAMS).join(',');

    const resp = await fetch(`https://opendata.fmi.fi/wfs?request=GetFeature&storedquery_id=${query}&parameters=${params}&latlon=${latlon}&height=${height}&starttime=${time}&endtime=${time}`, {
        mode: 'cors',
        credentials: 'omit',
        referrerPolicy: 'no-referrer'
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
    STATUS.textContent = 'Geolocating';
    STATUS_CONTAINER.classList.remove('hidden');
    MAIN.innerHTML = '';

    /** @type {GeolocationPosition} */
    const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject));
    const latlon = [
        position.coords.latitude.toFixed(2),
        position.coords.longitude.toFixed(2),
    ];

    for (const height of HEIGHTS) {
        STATUS.textContent = `Loading ${height}m`;
        const data = await getData(latlon, height);

        const tr = ROW_TEMPLATE.cloneNode(true);
        tr.querySelector('.height').textContent = height;
        tr.querySelector('.temperature').textContent = data[PARAMS.Temperature].toFixed(0);
        tr.querySelector('.wind-speed').textContent = data[PARAMS.WindSpeedMS].toFixed(0);
        tr.querySelector('.wind-direction .arrow').setAttribute('style', `--direction: ${data[PARAMS.WindDirection]}deg`);
        MAIN.appendChild(tr);
    }

    STATUS_CONTAINER.classList.add('hidden');
}

function reload() {
    reload_impl().catch(err => {
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
