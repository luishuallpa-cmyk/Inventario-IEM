#!/usr/bin/env python3
"""
Actualiza imagen_url en Supabase para productos IEM.
Requisito previo (SQL Editor de Supabase, una sola vez):

  ALTER TABLE productos ADD COLUMN IF NOT EXISTS imagen_url text;

Uso:
  python3 sync-imagenes-supabase.py
"""
import json, urllib.request, time, os

URL = os.environ.get('SUPABASE_URL', 'https://rgqlkeuzzqrmmgxtmren.supabase.co')
KEY = os.environ.get('SUPABASE_ANON_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJncWxrZXV6enFybW1neHRtcmVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NDE5NzMsImV4cCI6MjEwMjIxNzk3M30.P-Y577WPIgckmqCcy77rm-R55TDj6McQFvGayd0_yq0')

MATCHES_FILE = os.path.join(os.path.dirname(__file__) or '.', 'matches-imagenes.json')

def main():
    with open(MATCHES_FILE, encoding='utf-8') as f:
        matches = json.load(f)
    print(f'Cargados {len(matches)} matches')

    # Probe column
    headers = {
        'apikey': KEY,
        'Authorization': f'Bearer {KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    }
    req = urllib.request.Request(
        f'{URL}/rest/v1/productos?select=codigo,imagen_url&limit=1',
        headers={**headers, 'Prefer': 'count=exact'}
    )
    try:
        with urllib.request.urlopen(req) as r:
            print('Columna imagen_url OK')
    except Exception as e:
        print('ERROR: la columna imagen_url no existe todavía.')
        print('Ejecuta en Supabase SQL Editor:')
        print('  ALTER TABLE productos ADD COLUMN IF NOT EXISTS imagen_url text;')
        print(e)
        return 1

    ok = 0
    err = 0
    for i, m in enumerate(matches):
        body = json.dumps({'imagen_url': m['imagen_url']}).encode()
        req = urllib.request.Request(
            f'{URL}/rest/v1/productos?codigo=eq.{urllib.request.quote(str(m["codigo"]))}',
            data=body,
            headers=headers,
            method='PATCH'
        )
        try:
            with urllib.request.urlopen(req) as r:
                ok += 1
        except Exception as e:
            err += 1
            if err <= 5:
                print(f'  Error {m["codigo"]}: {e}')
        if (i + 1) % 50 == 0:
            print(f'  ... {i+1}/{len(matches)} (ok={ok}, err={err})')
            time.sleep(0.2)
    print(f'Listo. Actualizados: {ok}  Errores: {err}')
    return 0 if err == 0 else 2

if __name__ == '__main__':
    raise SystemExit(main())
