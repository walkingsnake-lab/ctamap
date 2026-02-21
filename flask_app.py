import os
import requests
from concurrent.futures import ThreadPoolExecutor
from flask import Flask, jsonify, send_from_directory

app = Flask(__name__, static_folder='.', static_url_path='')

CTA_KEY = '9e15fcfa75064b6db8ad034db11ea214'
CTA_BASE = 'http://lapi.transitchicago.com/api/1.0/ttpositions.aspx'
ROUTES = ['red', 'blue', 'brn', 'G', 'org', 'P', 'pink', 'Y']


def fetch_route(route):
    """Fetch train positions for a single route from the CTA API."""
    try:
        resp = requests.get(CTA_BASE, params={
            'key': CTA_KEY,
            'rt': route,
            'outputType': 'JSON',
        }, timeout=10)
        data = resp.json()
        ctatt = data.get('ctatt', {})
        if str(ctatt.get('errCd')) != '0':
            return []

        route_data = ctatt.get('route')
        if not route_data:
            return []
        if not isinstance(route_data, list):
            route_data = [route_data]

        trains = []
        for r in route_data:
            train_list = r.get('train')
            if not train_list:
                continue
            if not isinstance(train_list, list):
                train_list = [train_list]
            for t in train_list:
                t['rt'] = route
                trains.append(t)
        return trains
    except Exception:
        return []


@app.route('/api/trains')
def api_trains():
    """Fetch all train positions from CTA API in parallel."""
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = pool.map(fetch_route, ROUTES)
    trains = [t for batch in results for t in batch]
    return jsonify({'trains': trains})


@app.route('/api/geojson')
def api_geojson():
    """Proxy CTA line geometry GeoJSON to avoid CORS issues."""
    try:
        resp = requests.get(
            'https://data.cityofchicago.org/resource/xbyr-jnvx.geojson',
            params={'$limit': '5000'},
            timeout=15,
        )
        return resp.json()
    except Exception:
        return jsonify({'type': 'FeatureCollection', 'features': []}), 502


@app.route('/')
def index():
    return send_from_directory('.', 'index.html')


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3000))
    app.run(host='0.0.0.0', port=port, debug=True)
