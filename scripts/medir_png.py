"""Mide un PNG antes de creerlo: tamaño, brillo medio, mínimo/máximo y número de colores distintos.

    .venv/bin/python -I scripts/medir_png.py docs/pantalla-3.png docs/alta-3.png

Solo biblioteca estándar (zlib): PNG de 8 bits por canal, gris/RGB/RGBA, sin entrelazar (lo que da Chrome). Brillo =
luma Rec. 601 (0,299 R + 0,587 G + 0,114 B), de 0 a 255. Una captura en blanco o negro sale con min = max y 1 color.
"""
from __future__ import annotations

import struct
import sys
import zlib


def leer(ruta: str):
    with open(ruta, "rb") as f:
        datos = f.read()
    if datos[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{ruta}: no es PNG")
    pos, idat, cab = 8, [], None
    while pos < len(datos):
        largo, tipo = struct.unpack(">I4s", datos[pos:pos + 8])
        cuerpo = datos[pos + 8:pos + 8 + largo]
        if tipo == b"IHDR":
            cab = struct.unpack(">IIBBBBB", cuerpo)
        elif tipo == b"IDAT":
            idat.append(cuerpo)
        elif tipo == b"IEND":
            break
        pos += 12 + largo
    ancho, alto, bits, color, _, _, entrelazado = cab
    canales = {0: 1, 2: 3, 4: 2, 6: 4}.get(color)
    if bits != 8 or canales is None or entrelazado:
        raise ValueError(f"{ruta}: formato no soportado (bits={bits}, color={color}, entrelazado={entrelazado})")
    crudo = zlib.decompress(b"".join(idat))
    paso = ancho * canales
    filas, previa, i = [], bytearray(paso), 0
    for _ in range(alto):
        filtro, linea = crudo[i], bytearray(crudo[i + 1:i + 1 + paso])
        i += 1 + paso
        for x in range(paso):
            a = linea[x - canales] if x >= canales else 0
            b = previa[x]
            c = previa[x - canales] if x >= canales else 0
            if filtro == 1:
                linea[x] = (linea[x] + a) & 0xFF
            elif filtro == 2:
                linea[x] = (linea[x] + b) & 0xFF
            elif filtro == 3:
                linea[x] = (linea[x] + (a + b) // 2) & 0xFF
            elif filtro == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                linea[x] = (linea[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 0xFF
        filas.append(bytes(linea))
        previa = linea
    return ancho, alto, canales, filas


def medir(ruta: str) -> dict:
    ancho, alto, canales, filas = leer(ruta)
    suma, minimo, maximo, colores = 0.0, 255.0, 0.0, set()
    for fila in filas:
        for x in range(0, len(fila), canales):
            if canales >= 3:
                r, g, b = fila[x], fila[x + 1], fila[x + 2]
            else:
                r = g = b = fila[x]
            y = 0.299 * r + 0.587 * g + 0.114 * b
            suma += y
            minimo, maximo = min(minimo, y), max(maximo, y)
            colores.add((r, g, b))
    return {"ruta": ruta, "ancho": ancho, "alto": alto, "brillo_medio": round(suma / (ancho * alto), 1),
            "min": round(minimo, 1), "max": round(maximo, 1), "colores": len(colores)}


if __name__ == "__main__":
    for r in sys.argv[1:]:
        m = medir(r)
        print(f"{m['ruta']}: {m['ancho']}×{m['alto']} px · brillo medio {m['brillo_medio']} · "
              f"min {m['min']} · max {m['max']} · {m['colores']} colores")
