#!/usr/bin/env python3
"""
Genera scripts/diario.ico, el icono del proyecto.

Esto NO hace falta ejecutarlo: el .ico ya esta en el repositorio. Esta aqui
para que el icono sea reproducible y modificable, en vez de un binario que
nadie sabe de donde salio.

Necesita Pillow:  pip install pillow

El dibujo son tres velas -caida, giro, impulso- sobre un nivel horizontal.
Los colores son los del propio dashboard. Cada tamano se dibuja por separado
con coordenadas enteras en lugar de reescalar uno grande: a 16 px, que es el
tamano al que de verdad se ve un icono en la barra de tareas, medio pixel de
error es media vela.
"""

from PIL import Image, ImageDraw

# Paleta del propio diario (los colores del dashboard)
FONDO   = (17, 20, 27, 255)
BORDE   = (46, 54, 70, 255)
VERDE   = (46, 204, 113, 255)
ROJO    = (231, 76, 60, 255)
NIVEL   = (120, 135, 165, 255)

# Tres velas: caida, giro, impulso. Es la forma que tiene cualquier entrada del
# diario, y se distingue a 16 px, que es donde se juega un icono.
# (apertura, cierre, maximo, minimo) en fraccion de alto, 0 = arriba
VELAS = [
    dict(cuerpo=(0.28, 0.58), mecha=(0.20, 0.70), color=ROJO),
    dict(cuerpo=(0.52, 0.74), mecha=(0.42, 0.86), color=VERDE),
    dict(cuerpo=(0.22, 0.52), mecha=(0.14, 0.60), color=VERDE),
]

def dibujar(S):
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    r = max(2, round(S * 0.18))
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=FONDO,
                        outline=BORDE, width=1 if S < 48 else 2)

    # Margenes y geometria en enteros: a 16 px, medio pixel es media vela.
    mx = max(1, round(S * 0.14))
    ancho_util = S - 2 * mx
    hueco = max(1, round(S * 0.055))
    w = max(2, (ancho_util - 2 * hueco) // 3)
    # Recentrar con el ancho ya redondeado
    total = 3 * w + 2 * hueco
    x = (S - total) // 2

    mecha_w = 1 if S < 32 else max(1, round(S * 0.045))

    my = max(1, round(S * 0.12))
    alto = S - 2 * my

    def y(f):
        return my + round(f * alto)

    # Linea de nivel: el guino a las killzones. Solo a partir de 32 px, por
    # debajo de eso solo ensucia.
    if S >= 32:
        yy = y(0.63)
        paso = max(2, round(S * 0.06))
        x0 = mx
        x1 = S - mx - 1
        for xx in range(x0, x1, paso * 2):
            d.line([xx, yy, min(xx + paso - 1, x1), yy], fill=NIVEL, width=1)

    for v in VELAS:
        cx = x + w // 2
        c0, c1 = y(v['cuerpo'][0]), y(v['cuerpo'][1])
        m0, m1 = y(v['mecha'][0]), y(v['mecha'][1])

        mx0 = cx - mecha_w // 2
        d.rectangle([mx0, m0, mx0 + mecha_w - 1, m1], fill=v['color'])
        d.rectangle([x, c0, x + w - 1, max(c1, c0 + 1)], fill=v['color'])

        x += w + hueco

    return im

tam = [16, 20, 24, 32, 40, 48, 64, 128, 256]
imgs = [dibujar(s) for s in tam]
imgs[-1].save('diario.ico', format='ICO', sizes=[(s, s) for s in tam])
print('diario.ico generado:', [i.size for i in imgs])
