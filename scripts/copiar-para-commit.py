"""
Prepara una copia para commitear con el final de linea que toca.

LA REGLA, y viene de romper un fichero: se NORMALIZA A LF PRIMERO y luego se
aplica el final deseado. El atajo `sed 's/$/\r/'` sobre un fichero que ya era
CRLF produce `\r\r\n` en cada linea: TypeScript lo compila sin rechistar
-el CR es espacio en blanco- pero el fichero queda con una linea en blanco
entre cada linea real y git lo marca entero como cambiado. Asi quedo su
`src/domain/metrics.ts` y no se vio hasta tres commits despues.
"""
import io, os, re, sys

destino = '/mnt/user-data/outputs/lote'
for arg in sys.argv[1:]:
    fichero, final = arg.split('=')
    t = io.open(fichero, encoding='utf-8', newline='').read()
    lf = re.sub(r'\r\n?|\n', '\n', t)            # cualquier cosa -> LF
    out = lf.replace('\n', '\r\n') if final == 'crlf' else lf
    d = os.path.join(destino, fichero)
    os.makedirs(os.path.dirname(d), exist_ok=True)
    io.open(d, 'w', encoding='utf-8', newline='').write(out)
    dobles = len(re.findall(r'\r\r', out))
    print(f'  {fichero:46} {final:4}  {len(out):7} bytes  CR dobles={dobles}')
    assert dobles == 0, f'{fichero} salio con CR dobles'
