# Greenspot

*(antes «Diario de trading»; el nombre viejo todavía aparece en el lanzador de
Windows y en la descripción de `package.json`.)*

Ingiere las operaciones de Quantower y el contexto de order flow de los
indicadores propios, los normaliza en una base de datos propia y los expone por
API y dashboard: métricas, gráfico reconstruido de cada operación, MAE/MFE,
comisiones, calendario económico y tendencia de los marcos grandes.

Aparte, la pestaña **News** trae el contexto de fuera —petróleo, bonos,
cotizaciones de las empresas que mueven el Nasdaq, resultados y titulares— y es
**la única parte que sale a internet**. Necesita dos claves gratuitas y, sin
ellas, todo lo demás funciona igual.

---

## Montaje en un ordenador nuevo

### Resumen

```powershell
# 1. Instala Node 22 LTS desde https://nodejs.org
# 2. Clona o copia el proyecto
cd trading-journal
# 3. Un solo comando
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

El script instala dependencias, crea el `.env`, reapunta los proyectos de los
indicadores a la instalación de Quantower de esa máquina, compila el front,
hace la primera ingesta y termina con un diagnóstico que dice qué falta.

Si prefieres ir paso a paso, o no estás en Windows, sigue leyendo.

### 1. Qué hay que instalar

| Herramienta | Para qué | Obligatorio |
|---|---|---|
| **Node 22 LTS** (20 mínimo) | el diario entero | sí |
| **Quantower** | de donde salen las operaciones | sí, para capturar datos nuevos |
| **Visual Studio 2022** con *.NET desktop development* | compilar los tres indicadores | solo si vas a tocar o instalar los indicadores |
| **.NET 10 SDK** | lo exigen los `.csproj` | lo instala Visual Studio |
| pnpm | opcional, `npm` sirve igual | no |

**Node 20 es el mínimo real, no una recomendación.** Fastify 5 lo exige, Vite
necesita `styleText` de `node:util` y tsx depende de `tracingChannel`. Con Node
19 fallan los tres con errores que no mencionan la versión, y se pierde mucho
rato buscando por el sitio equivocado.

```bash
node -v    # v20.x o superior
```

### 2. Dependencias

```bash
pnpm install        # o npm install
pnpm run build      # compila el front de React a web/
```

> **Siempre con `run`.** `build`, `dev`, `ingest` y `typecheck` son scripts del
> `package.json`, no comandos del gestor. pnpm acepta el atajo sin `run`; **npm
> no**: `npm build` responde *Unknown command*. Con `run` delante funcionan los
> dos, así que es la forma que se usa en todo este documento.

> **Si al arrancar sale un error de `bindings`, es `better-sqlite3`.** Lleva un
> binario nativo que se construye al instalar, y si ese paso no corre el
> servidor revienta al primer import con un mensaje que no menciona la causa.
>
> Con pnpm hay que autorizarlo, y el permiso vive en `pnpm-workspace.yaml`
> **en dos formatos a la vez**: `onlyBuiltDependencies` (lista) para pnpm 10 y
> 11, y `allowBuilds` (mapa) para pnpm 12 en adelante. El
> `pnpm.onlyBuiltDependencies` del `package.json` ya no se lee.
> Si la instalación ya existía: `pnpm rebuild better-sqlite3`.
>
> **Ojo con pnpm 12: migra el fichero solo y puede dejar los paquetes en
> `false`.** El síntoma engaña — `pnpm approve-builds` responde «no packages
> awaiting approval» y `pnpm rebuild` responde «already up to date», porque
> para pnpm no hay nada *pendiente*: hay algo *prohibido*. Lo primero que hay
> que mirar cuando esto falle es que esos valores sigan en `true`.
>
> **Y si pnpm dice «already up to date» o «no packages awaiting approval» pero
> el error sigue**, no insistas con pnpm — cree que ya lo construyó. Cambia a
> npm en ese equipo, que no bloquea nada:
>
> ```powershell
> Remove-Item -Recurse -Force node_modules, pnpm-lock.yaml
> npm install
> ```
>
> **Los dos gestores valen y se pueden mezclar entre equipos.** `setup.ps1` y el
> lanzador miran con cuál se montó ESTE proyecto (`node_modules\.pnpm` frente a
> `node_modules\.package-lock.json`) en vez de mirar el PATH: un equipo puede
> tener pnpm instalado y haber montado el proyecto con npm, y llamar al que no
> es falla sin explicar nada.

### 3. Configuración

```bash
cp .env.example .env     # en Windows: copy .env.example .env
```

Todo tiene valores por defecto que funcionan en una instalación normal de
Quantower en Windows, así que el `.env` puede quedarse casi vacío. Lo que sí
conviene revisar:

- **`REAL_TRADING_SINCE`** — el día en que empezaste a operar de verdad en esa
  cuenta. Todo lo anterior queda marcado como prueba y fuera de las métricas.
  Mezclar pruebas de plataforma con operativa real distorsiona cualquier
  conclusión, y es un error que no se nota hasta que las cifras ya están mal.
- **`QUANTOWER_TRADES_DB`** — solo si tienes más de una cuenta. Ver abajo.
- **`FINNHUB_API_KEY`** y **`ALPHA_API_KEY`** — solo si quieres la pestaña
  **News**. Son gratuitas y no piden tarjeta. Ver el apartado siguiente.

La lista completa está comentada en `.env.example`.

#### Las claves de la pestaña News

Esta es la única parte del diario que sale a internet, y la única que necesita
que te des de alta en algo. **Sin las claves no pide nada, no falla y el resto
funciona igual**: solo esa pestaña se queda vacía.

| | Dónde | Qué trae | Límite gratuito |
|---|---|---|---|
| **Finnhub** | <https://finnhub.io/register> | cotizaciones, titulares y calendario de resultados | 60 peticiones **por minuto**, sin tope diario |
| **Alpha Vantage** | <https://www.alphavantage.co/support/#api-key> | petróleo (WTI y Brent) y tipos del Tesoro a 5, 10 y 30 años | **25 peticiones al día**, y 1 por segundo |

```ini
FINNHUB_API_KEY=tu_clave
ALPHA_API_KEY=tu_clave
```

Con eso basta: el resto tiene valores por defecto pensados para no acercarse a
esos límites. Lo que conviene **no** tocar sin leer por qué:

- **`MARKET_REFRESH_MIN` déjala comentada.** Si la pones, fija un intervalo
  constante y anula la cadencia que se adapta al reloj de Nueva York (5 min con
  el mercado abierto, 15 fuera de horas, 60 de noche y fines de semana). Pedir
  cada diez minutos a las tres de la madrugada gasta peticiones para recibir
  once veces el mismo precio, y deja la alerta sonora despierta toda la noche.
- **`ALPHA_DAILY_BUDGET` son 20 de las 25.** El diario lleva su propia cuenta y
  para al llegar ahí. Los cinco de margen existen porque su contador se
  reinicia a medianoche UTC y el nuestro puede no hacerlo a la vez. Importa
  porque Alpha Vantage, al quedarse sin cuota, **no devuelve un error**:
  devuelve un 200 con un texto dentro, así que sin contar las peticiones te
  quedarías sin datos creyendo que no hay novedades.

Para comprobar que todo responde, en la pestaña News hay un botón **«refrescar
ahora»** que pide los cuatro bloques y dice cuál falló, y debajo una tabla
**«Estado de las fuentes»** con cuándo trajo datos cada una por última vez. No
hace falta mirar la consola del servidor.

Y para tocar el código de esa parte sin gastar ni una petición:

```bash
npx tsx scripts/prueba-mercado.ts
```

Sustituye `fetch` por uno falso que imita lo que contestan los dos proveedores
—incluidos sus dos avisos reales, el del límite por segundo y el de «esto es de
pago»— y comprueba 35 cosas: la cadencia, el presupuesto, el filtrado de
titulares, el estado por fuente y el parseo de fechas.

### 4. Los indicadores

Los tres proyectos (`KillZones`, `j_Flujo`, `j_Guardia`) viven en carpetas
hermanas de esta, normalmente bajo `...\source\repos\`.

> `QuaEmas` fue el cuarto y **está retirado**: sus cuatro EMAs viven ahora
> dentro de KillZones. Si lo encuentras instalado, estarás viendo las medias
> dos veces. Sus `.csproj` llevan
**dos rutas absolutas con el número de versión de Quantower dentro**: la
referencia a `TradingPlatform.BusinessLayer.dll` y la carpeta donde dejan el
DLL compilado. Esas rutas cambian con cada actualización de Quantower y con
cada ordenador, y cuando están mal el error de Visual Studio habla de una
referencia que falta, no de una ruta, así que cuesta de encontrar.

```bash
pnpm setup:indicators            # las reapunta solas
pnpm setup:indicators -- --dry   # enseña qué cambiaría sin tocar nada
```

Busca la versión instalada (la mayor, comparando número a número, porque en
texto `v1.9` iría después de `v1.146`) y reescribe las dos rutas. Si los
proyectos están en otro sitio: `-- --repos "D:\codigo"`.

#### Compilarlos sin saber programar

Doble clic en:

```
scripts\compilar-indicadores.cmd
```

Hace todo solo: reapunta los proyectos a este Quantower, limpia, compila los
tres en Release y deja el resultado en pantalla y en `scripts\compilacion.log`.
Si algo falla, el log dice exactamente qué.

**Solo hace falta el SDK de .NET**, que son unos 200 MB:
<https://dotnet.microsoft.com/download> → elige **SDK**, no *Runtime*. No hace
falta Visual Studio (varios GB) salvo que vayas a editar el código.

El DLL cae directamente en `Settings\Scripts\Indicators\<nombre>\`, y
**Quantower los recoge al reiniciarlo**.

> **Siempre limpia antes de compilar.** El script ya lo hace. Si compilas a
> mano, usa *Clean* y luego *Build*: los ficheros copiados de otro ordenador
> llegan con la fecha descolocada, MSBuild decide por fechas si hay que
> recompilar, y se salta el trabajo dejándote el DLL viejo sin avisar de nada.

Si prefieres Visual Studio: abrir cada `.csproj` y compilar en **Release**.

#### Si en ese ordenador no se van a poner los indicadores

Pasa cuando opera otra persona con su propia plantilla. **Sus operaciones le
van a salir igual**: las escribe Quantower en su `user-trades.db` y el diario
las lee de ahí, sin que ningún indicador intervenga. Lo único que se queda
vacío es la pestaña **Mercado**, porque las velas las escribe `j_Flujo`.

Y eso se arregla pasándoselas, no montando nada: **una vela es dato de
mercado**. El OHLC del MNQ de las 10:00 es idéntico para los dos, así que
capturarla dos veces es duplicar trabajo.

En tu ordenador:

```bash
node scripts/velas-compartidas.mjs exportar
```

Deja un `velas-compartidas.db` de unos 17 MB —cabe en un correo— con las
velas y el calendario económico dentro, y **sin una sola fila tuya**: borra
`operations`, `fills`, notas y etiquetas, comprueba que quedaron a cero y, si
alguna no se vació, aborta y no genera el fichero. También tira
`context_snapshots`, que es el crudo del que ya salieron las velas y pesa el
85% del total.

En el de ella, con ese fichero al lado:

```bash
node scripts/velas-compartidas.mjs importar velas-compartidas.db
```

Entran solo velas y calendario; sus operaciones no se tocan. Las velas que ya
tuviera se respetan (`INSERT OR IGNORE`), así que **repetirlo no duplica
nada** y sirve para ir poniéndola al día cada pocas semanas.

> Lo que no resuelve: las velas llegan hasta el día que exportaste. Para ver
> el mercado de ayer hay que volver a exportar. Si quiere datos en vivo sin
> depender de ti, entonces sí toca instalarle `j_Flujo`.

### 5. Comprobar

```bash
pnpm run doctor
```

Revisa de una pasada: versión de Node, dependencias, binario nativo de
`better-sqlite3`, front compilado, instalación de Quantower, cuentas
encontradas, días de contexto capturados, DLL de cada indicador, tablas de la
base y ficheros de calendario. Cada cosa que falta viene con el comando que la
arregla.

### 6. Arrancar

```bash
pnpm run dev            # dashboard en http://127.0.0.1:4321
```

Para tocar el front con recarga en caliente, en dos terminales:

```bash
pnpm run dev            # API en 4321
pnpm run dev:web        # Vite en 5173, con proxy a la API
```

El `build` solo hace falta cuando cambias algo de `client/`. El backend lo
ejecuta tsx directamente, sin compilar.

> **Trampa que cuesta un rato.** `pnpm run build` compila **solo el front**
> (`"build": "vite build"`). Si cambia algo de `src/` —el servidor— hay que
> **reiniciar el proceso**: Ctrl+C en la terminal donde corre `pnpm run dev` y
> volver a arrancarlo.
>
> Cuando no se hace, el síntoma es desconcertante: la pantalla se ve nueva
> (porque el front sí se recompiló) pero el servidor sigue respondiendo con la
> forma antigua. Un ajuste nuevo aparece en la pantalla, lo guardas, y no se
> guarda — sin ningún error. Si algo de Ajustes no se guarda, esto es lo
> primero que hay que mirar.

### Arrancarlo con un icono en la barra de tareas (Windows)

Para no escribir comandos cada día:

```
scripts\anclar-a-la-barra.cmd      doble clic, una sola vez
```

Compila un lanzador (`Diario de trading.exe`, en la raíz del proyecto) y crea
un acceso directo con ese nombre en el escritorio y en el menú de inicio.
Después, botón derecho sobre él → *Anclar a la barra de tareas* (ese último paso
hay que darlo a mano: Windows no deja que un script ancle nada a la barra).

A partir de ahí, un clic en el icono compila el front, arranca el servidor y
abre el navegador cuando el servidor responde de verdad. Cerrar la ventana para
el servidor.

**Por qué hace falta un `.exe` para algo tan tonto.** El problema tiene dos
capas, y la segunda es la que engaña:

1. Windows no permite anclar un `.bat` ni un `.cmd` a la barra de tareas. Al
   intentarlo ancla el *Explorador de archivos*, porque el Explorador es el
   programa asociado a esos ficheros.
2. El arreglo obvio —un acceso directo a `cmd.exe` pasándole el `.cmd` como
   argumento— **tampoco funciona**, y falla de la peor manera: se deja anclar,
   parece correcto, y al pulsarlo abre una consola vacía en `C:\Users\<usuario>`.
   Windows trata `cmd.exe`, `explorer.exe` y `powershell.exe` como casos
   especiales: al anclar se queda con el programa y **tira los argumentos**.

Por eso el anclaje apunta a un `.exe` propio. No hace nada más que ejecutar
`scripts\trading.cmd`, pero al no ser un ejecutable del sistema, Windows lo
ancla como lo que es. Se compila con el compilador de C# que viene dentro de
.NET Framework —presente en cualquier Windows, no hay que instalar nada— y
busca el `.cmd` a partir de su propia ubicación, así que el proyecto se puede
mover o clonar sin recompilarlo. Está en `.gitignore`: es un binario generado.

**El icono.** `scripts\diario.ico`: tres velas —caída, giro, impulso— sobre un
nivel horizontal, con los colores del propio dashboard. Se incrusta *dentro*
del `.exe` al compilarlo (`/win32icon`), no se enlaza desde fuera: la barra de
tareas se queda con el icono del momento en que anclas, así que depender de un
`.ico` suelto significaría que moverlo o borrarlo deja el icono en blanco.

El `.ico` está en el repositorio ya generado, pero no es un binario caído del
cielo: `scripts\_crear-icono.py` lo dibuja, y ejecutarlo reproduce exactamente
el mismo fichero. Para cambiar el icono se edita ese script (necesita Pillow) y
se vuelve a ejecutar `anclar-a-la-barra.cmd`. Cada tamaño se dibuja por
separado con coordenadas enteras en lugar de reescalar uno grande: a 16 px, que
es como se ve de verdad en la barra, medio píxel es media vela.

Lo que hace `scripts\trading.cmd` además de `pnpm run build && pnpm run dev`:

- Se coloca solo en la raíz del proyecto, calculada desde su propia ruta, así
  que sigue funcionando si mueves el proyecto o lo clonas en otra máquina.
- Mata un servidor anterior que se haya quedado con el puerto cogido. Al cerrar
  la ventana con la X, node no siempre muere, y el siguiente arranque falla con
  un `EADDRINUSE` que no explica de dónde viene.
- Instala las dependencias si no están.
- Para si la compilación falla, en vez de arrancar un servidor que sirve el
  front viejo sin avisar.
- Abre el navegador **sondeando el puerto**, no tras una espera fija: el primer
  arranque del día tarda más y una espera fija abre la pestaña en un error.

Si cambias el puerto en `.env` (variable `PORT`), cámbialo también en la
primera línea de `scripts\trading.cmd`.

---

## De dónde salen los datos

Hay **cuatro fuentes** independientes. Que falte una no impide usar las otras.

```
Quantower user-trades.db  (solo lectura) ─┐
j_Flujo → context-YYYYMMDD.jsonl         ─┤
calendario .ics / .csv                   ─┼→ ingestor → journal.db → API → dashboard
Finnhub + Alpha Vantage  (internet)      ─┘
```

Las tres primeras son ficheros del propio ordenador. La cuarta es la única que
sale a la red, vive en sus propias tablas y **ninguna métrica tuya la lee**: si
mañana se borra entera, no se mueve ni una cifra del diario.

### Las operaciones: `user-trades.db`

Quantower guarda su caché de operaciones en una carpeta **por cuenta**, con un
nombre generado que incluye el identificador del bróker:

```
C:\Quantower\UserTradesCache\AMP47CQG (CQG-AMP47CQG-Default-AMP47CQG)\user-trades.db
```

Como ese nombre no se puede adivinar, el diario busca la primera carpeta que
contenga un `user-trades.db`. **Con más de una cuenta eso es elegir al azar**
(por orden alfabético de un nombre generado), así que hay que fijarla:

```
QUANTOWER_TRADES_DB=C:\Quantower\UserTradesCache\<la que sea>\user-trades.db
```

`pnpm run doctor` lista todas las que encuentra, para no tener que adivinar.

Esa base **se abre siempre en solo lectura**: el diario nunca escribe dentro de
Quantower.

En un ordenador nuevo el fichero no existe hasta que conectes la cuenta y
Quantower descargue el historial del bróker. Hasta entonces el diario arranca
igual, solo que sin operaciones. **Lo que el bróker devuelve suele estar
limitado a unas semanas**, así que no cuentes con recuperar por aquí todo tu
histórico: para eso está copiar `journal.db` (ver abajo).

El ingestor no se limita a copiar. Reconstruye las operaciones **por ciclos de
posición neta**: una operación empieza cuando la posición sale de cero y
termina cuando vuelve a cero. Emparejar entradas con salidas por orden de
llegada parece equivalente, pero deja de serlo en cuanto hay entradas parciales
o promedias a la baja, y produce duraciones que no tienen nada que ver con la
realidad.

**Una posición abierta no aparece hasta que se cierra.** Su resultado todavía
no existe.

#### El resultado lo calculamos nosotros, no lo copiamos

Quantower escribe un `gross_pnl` en cada ejecución, y durante meses el diario se
limitó a sumarlo. **Ese dato llega incompleto.** El 28 de octubre de 2026, al
cerrar cuarenta contratos a mercado en dos segundos, Quantower dejó el PnL a
`NULL` en cuatro ejecuciones que sí cerraban posición. El diario decía
**2.113,00 $** y el saldo del bróker **1.490,50 $**: los **622,50 $** de esos
cuatro fills.

Ahora el resultado sale del **flujo de caja del ciclo completo**. Como una
operación empieza y acaba en plano, no hace falta emparejar entradas con
salidas: cada venta ingresa `cantidad × precio`, cada compra lo paga, y lo que
sobra es el resultado en puntos × contrato. Por el valor del punto, dólares.

Es exacto donde `(salida − entrada)` falla: entradas parciales, promedios a la
baja, salidas en veinte trozos y vueltas de largo a corto dentro del mismo
ciclo. Y no depende de que el bróker se acuerde de rellenar una columna.

Lo que decía Quantower **se guarda igual**, en `operations.broker_pnl`, para
poder enfrentar las dos cifras. `pnpm run doctor` las compara y avisa si se
separan; `npx tsx scripts/prueba-pnl.ts` comprueba el cálculo contra ocho casos
preparados, incluido el del 28 de octubre.

Si el contrato no está en la tabla de instrumentos no se conoce el valor del
punto, y entonces **sí** se usa el número del bróker: calcular con un
multiplicador inventado sería peor.

### El contexto: `context-YYYYMMDD.jsonl`

El indicador `j_Flujo` escribe, al cerrar cada vela, el estado del mercado en
`C:\Quantower\journal\`. Se activa con **"Guardar contexto para el diario"** en
su configuración.

Sin esto no hay velas, y sin velas no hay gráfico por operación, ni MAE/MFE, ni
tendencia de los marcos grandes. Es la mitad del valor del proyecto.

Se graba siempre, no solo cuando operas: sin los momentos en que **no**
entraste no hay ejemplos negativos, y sin ellos no hay forma de distinguir
después qué situaciones valían la pena.

El indicador no sabe nada de posiciones. Solo registra el mercado; el cruce con
tus operaciones lo hace el diario buscando el último snapshot cerrado **antes**
de cada apertura (`src/domain/context.ts`). Nunca el posterior, aunque esté más
cerca: una vela que cerró después de que abrieras contiene información que no
existía cuando decidiste.

#### Una sola temporalidad

El indicador escribe al cerrar cada vela **del gráfico donde esté puesto**. Si
lo tienes en varios a la vez, los snapshots de 1m y de 4h acaban mezclados en
el mismo fichero describiendo cosas distintas: el "rango medio reciente" de un
gráfico de 4h son 200 velas de cuatro horas, o sea mes y medio.

Dos defensas, y conviene usar las dos:

- Activar "Guardar contexto para el diario" **solo en el gráfico con el que
  decides** las entradas.
- Poner `CONTEXT_BAR_SECONDS=60` para que el cruce ignore lo que no sea de un
  minuto. Los registros antiguos sin `barSeconds` se siguen aceptando, para no
  invalidar lo ya grabado.

#### Features crudas, nunca conclusiones

En el JSONL no aparece `"absorcion": true`. Aparecen el delta, el rango de la
vela, el rango medio reciente, el tamaño medio por operación y la forma del
libro. La absorción se **deriva** de ahí, con sus umbrales en el código del
diario.

Eso es lo que permite cambiar de opinión: el día que se afine qué cuenta como
absorción, se toca una función y los miles de snapshots ya grabados se releen
con la definición nueva. Si se guardara ya calculada, todo el histórico
quedaría inservible.

Una línea cortada (un cierre de Quantower a mitad de escritura) se descarta
sola y el resto del fichero sigue siendo válido.

### El calendario económico

Ficheros `.ics` o `.csv` en `C:\Quantower\journal\calendar\`. Quantower no trae
calendario económico, así que los eventos entran por aquí. Es opcional: sin
ellos la pestaña Calendario sale vacía y todo lo demás funciona igual. El formato
está documentado en `LEEME.txt` dentro de esa carpeta.

Ojo con la zona horaria: un CSV no la lleva dentro, y leer "08:30" de Nueva
York como UTC coloca el aviso cuatro horas antes. `CALENDAR_TZ_OFFSET_HOURS` lo
resuelve; por defecto asume hora de mercado.

#### Lo que no entra en el calendario, y por qué

**Los ficheros de ejemplo.** `plantilla.csv` es el que explica el formato, y estuvo
tres semanas **importándose como si fuera un calendario de verdad**: metió seis eventos
inventados en la base, uno de ellos un *Non-Farm Employment Change* el **sábado 17 de
octubre de 2026**.

Lo que lo hizo durar tres semanas es que **un evento de más no rompe nada**: sale
pintado igual que los buenos, el panel lo cuenta igual, y la única señal era que ese
sábado no había velas alrededor. Se descubrió construyendo la pestaña Reacción, no
mirando el calendario.

Ahora la ingesta se salta por nombre `plantilla`, `ejemplo`, `muestra`, `template`,
`example`, `sample` y `leeme` (sin extensión, sin distinguir mayúsculas) y **borra de la
base lo que esos ficheros hubieran metido antes**. Las dos cosas: dejar de importarlos
sin borrar habría dejado las seis filas ahí para siempre. Es el mismo criterio que ya se
aplicaba a `source = 'prueba'`.

**Los eventos en fin de semana.** La red general, que no depende de cómo se llame el
fichero. Los datos de Estados Unidos se publican de lunes a viernes sin excepción;
cuando una fila dice otra cosa, lo que ha pasado es una de tres: la plantilla traía
fechas inventadas, la zona horaria está mal, o el fichero venía en formato mes/día y se
leyó al revés. Las tres se arreglan en el fichero. Se descartan al importar y se cuentan
en el resultado.

Se mira con **el reloj de Nueva York, no en UTC**: un evento de las 20:00 de un viernes
en Nueva York es la una de la madrugada del sábado en UTC, y mirarlo en UTC lo
descartaría estando bien.

`npx tsx scripts/prueba-ingesta-calendario.ts` comprueba las dos cosas, y también que un
calendario legítimo no se toque — un filtro que se lleve por delante los datos buenos es
peor que el problema que arregla. Con el código anterior, esa prueba da 19 fallos.

#### El export de Investing viene en dos mitades

`eventos-investing.json` tenía **105 nombres de evento y ninguna fecha**, y la
importación lo daba por bueno en silencio.

Son dos cosas distintas:

| Parte | Qué trae | Sirve para |
|---|---|---|
| **catálogo** | `event_id`, nombre, importancia, categoría | ponerle nombre a las ocurrencias |
| **ocurrencias** | `occurrence_time`, `forecast`, `previous`, `actual` | **todo lo demás** |

Con solo el catálogo el calendario sigue siendo una agenda vacía: ni una previsión, ni
un dato real, y por tanto ninguna sorpresa que medir. Ahora la importación lo dice con
todas las letras, tanto en `pnpm run ingest` como en el botón **Importar calendario**.

### El contexto de fuera: Finnhub y Alpha Vantage

Lo que alimenta la pestaña **News**. Es la única fuente que no es un fichero
del ordenador, y por eso es la única con dos modos de fallo que las demás no
tienen: el proveedor se cae, o se acaba la cuota.

Dos reglas que gobiernan todo el bloque:

- **Nada de lo que llega sustituye a lo guardado si la petición falló.** Una
  pantalla con datos de hace veinte minutos es útil; una pantalla en blanco
  porque el proveedor se cayó, no.
- **La forma de los datos es nuestra, no del proveedor.** El adaptador traduce
  lo que devuelva cada servicio a nuestros tipos, así que cambiar de proveedor
  es reescribir un fichero y no toda la pantalla. Con APIs gratuitas que cambian
  de plan cada pocos meses eso no es una precaución teórica: `NEWS_SENTIMENT`
  de Alpha Vantage pasó a ser de pago estando ya integrado.

Cuatro bloques, con cadencias distintas porque sus límites y su naturaleza no
se parecen:

| Bloque | Proveedor | Cada cuánto | Coste |
|---|---|---|---|
| cotizaciones | Finnhub | 5 / 15 / 60 min según el reloj de NY | 11 peticiones |
| titulares | Finnhub | igual | 1 petición |
| calendario de resultados | Finnhub | cada `MARKET_SLOW_HOURS` | 10 peticiones, una por empresa |
| petróleo y bonos | Alpha Vantage | **una vez al día** | 5 peticiones de las 25 |

El petróleo y los bonos van una vez al día porque **son series diarias**: el
valor de las 10:00 y el de las 16:00 son el mismo número.

Son cinco series: WTI, Brent y el Tesoro a **5, 10 y 30 años**. El de 5 años
está porque la curva sólo se lee entera: cuando el 5 sube más deprisa que el
30, el susto del mercado es de **tipos a corto**, y eso se nota en el Nasdaq
antes que en ningún otro sitio.

En pantalla salen **en tabla**, no en fichas sueltas: serie, qué es, último,
1d, 5d y cuántas jornadas de cierre llevamos guardadas. Dos detalles que no
son cosméticos:

- **Los bonos van en puntos básicos, no en porcentaje.** Un 10 años que pasa
  de 4,98 a 5,05 ha subido **7 pb**. El «+1,4 %» que saldría de dividir es un
  porcentaje *de* un porcentaje y no lo usa nadie. El petróleo sí va en %.
- **Los bonos no se pintan de verde ni de rojo.** En un bono, subir no es
  bueno: un 10 años al alza es viento en contra del Nasdaq. El color diría lo
  contrario de lo que dice el texto de al lado.

Las dos variaciones se calculan con **nuestros propios cierres guardados**
(`global_daily_close`), porque Alpha manda la serie diaria sin variación. Por
eso la columna de histórico: hasta la sexta jornada el 5d **no existe**, y
sale rayado en lugar de inventado.

El calendario de resultados se pregunta **empresa por empresa** y no pidiendo
el calendario entero de la bolsa. La llamada global devuelve miles de empresas,
el plan gratuito la recorta, y las tuyas caen fuera del recorte por azar
alfabético: la tabla salía con nueve rayas y una sola fecha.

Si un proveedor contesta que un endpoint **es de pago**, ese bloque se apaga
solo y se recuerda en la base, para no reintentarlo cada hora para siempre. En
«Estado de las fuentes» aparece como `apagada` en vez de en rojo. Para
reactivarlo:

```sql
DELETE FROM meta WHERE key = 'bloque_apagado_<nombre>';
```

#### Qué titulares se enseñan, y cuáles no

El canal general de Finnhub no es un canal financiero: es el canal de todo. En
una muestra real de catorce titulares, doce eran un rescate de marineros en Sri
Lanka, una iglesia en Jordania y cómo alguien pagó once mil dólares de tarjeta.

El filtro **no prohíbe lo que no interesa, exige que hable de algo tuyo**. Una
lista de palabras prohibidas acaba tragándose una noticia que sí importaba y
nunca te enteras, porque lo que desaparece no deja rastro. Así, lo que se pierde
se pierde por no decir nada reconocible, y eso se arregla cambiando una lista
(`src/domain/news-topic.ts`, o `NEWS_KEYWORDS` en el `.env`).

Tres grupos: **empresa** (una de tus tickers, por símbolo o por nombre),
**macro** (tipos, inflación, bonos, petróleo, Nasdaq, el ciclo de la IA y los
chips) y **otra**. Por defecto se enseñan los dos primeros, con un selector
para ver todas. **Nada se borra**: se clasifica al leer, no al guardar, así que
afinar la lista reordena también el histórico.

#### QQQ no es el Nasdaq 100

En la tabla de cotizaciones el índice aparece como **QQQ**, el fondo que lo
replica, y vale unas cuarenta veces menos: con el Nasdaq 100 en 25.000, el QQQ
ronda los 700. Lo que sí coincide es la **variación del día**, que es para lo
que está. El valor del índice no lo da gratis ningún proveedor, y estimarlo
multiplicando sería inventárselo.

#### La variación a 5 días nos la hacemos nosotros

El endpoint de velas diarias de Finnhub salió del plan gratuito y pedirle diez
series a Alpha Vantage no cabe en su cuota. Así que cada refresco guarda el
último precio visto de la jornada en `global_daily_close`, y a la quinta sesión
la columna **5d %** sale sola sin depender de nadie. Antes de eso enseña `—`,
que es lo honesto: no tenemos el dato.

### Cuándo se cargan

Dejando el servidor levantado **se alimenta solo**: cada 15 segundos comprueba
si Quantower o los indicadores escribieron algo y, si hay novedades, las
ingiere. La página se refresca sola cada 30 segundos y muestra "en vivo" con la
hora de la última novedad.

`pnpm run ingest` hace una ingesta puntual sin levantar el servidor. Es idempotente:
se puede lanzar las veces que haga falta sin duplicar nada.

La detección de novedades mira la fecha de modificación de `user-trades.db` **y
también la de sus ficheros `-wal` y `-shm`**. Con WAL activo —que es como
trabaja Quantower— las escrituras van al `-wal` y el fichero principal puede
quedarse igual durante minutos, así que vigilar solo ese llega tarde.

---

## Llevarse el proyecto a otro ordenador

Qué copiar, por orden de importancia:

| Qué | Dónde | Por qué |
|---|---|---|
| **`data/journal.db`** (+ `-wal` si existe) | la base del diario | **es el sistema de registro**: operaciones, velas, notas, etiquetas. Lo único que no se puede reconstruir desde ningún otro sitio |
| El repositorio | el código | obvio |
| `C:\Quantower\journal\*.jsonl` | contexto crudo | permite volver a derivar `bars` si mañana se añade una columna. Son cientos de MB; si no caben, la base ya lleva lo derivado |
| `C:\Quantower\journal\calendar\` | calendario | pequeño, cómodo de llevar |
| Los tres proyectos de indicadores | `source\repos\KillZones`, `j_flujo`, `j_Guardia` | hay que recompilarlos allí con `scripts\compilar-indicadores.cmd` |

**No copies `node_modules` ni `web/`**: se regeneran, y `node_modules` lleva un
binario nativo compilado para esa máquina concreta.

Si copias el `-wal`, cópialo **junto** al `.db` y con el mismo nombre base. Es
donde SQLite guarda lo más reciente: la base sola puede ir minutos por detrás.

Orden en la máquina nueva:

1. `scripts\setup.ps1` con el proyecto ya copiado
2. pegar `data/journal.db` encima del que se haya creado
3. `scripts\compilar-indicadores.cmd` para los tres indicadores
4. reiniciar Quantower, para que recoja los DLL nuevos
5. `pnpm run doctor` para confirmar que las cuentas de las tablas cuadran

Si el paso 3 falla porque los indicadores están en otra carpeta, pásale la
ruta: `compilar-indicadores.cmd "D:\codigo"`.

### Antes del primer push a GitHub

Comprobado el 1 de noviembre de 2026 leyendo el índice de git: **hay once ficheros en
disco que git todavía no rastrea, y siete de ellos son imprescindibles.** Un clon
limpio no compilaría.

```bash
git status --short          # los untracked salen con ??
```

| Fichero | Sin él |
|---|---|
| `client/src/globo.ts` | **no compila**: lo importan `Charts`, `OpTooltip` y `DayCalendar` |
| `client/src/calendario.ts` | **no compila**: lo importa `DayCalendar` |
| `client/src/components/ReactionPanel.tsx` | **no compila**: lo importa `GlobalPanel` |
| `src/domain/reaction.ts` | **no compila**: lo importan el servidor y el panel |
| `client/src/components/ReportPanel.tsx` | **no compila**: lo importa `App.tsx` |
| `src/domain/report.ts` | **no compila**: lo importa el servidor |
| `client/public/greenspot.png` + `icono.png` | compila, pero sale el texto «Greenspot» en vez del logo y la pestaña sin icono |
| `scripts/prueba-ajustes.ts`, `prueba-informe.ts`, `prueba-calendario.ts`, `prueba-reaccion.ts`, `prueba-ingesta-calendario.ts` | 164 de los 263 casos de prueba no existen |
| `scripts/copiar-para-commit.py` | la rutina de finales de línea |

```bash
git add client/src/globo.ts client/src/calendario.ts \
        client/src/components/ReportPanel.tsx client/src/components/ReactionPanel.tsx \
        src/domain/report.ts src/domain/reaction.ts \
        client/public/greenspot.png client/public/icono.png \
        scripts/prueba-ajustes.ts scripts/prueba-informe.ts \
        scripts/prueba-calendario.ts scripts/prueba-reaccion.ts \
        scripts/prueba-ingesta-calendario.ts scripts/copiar-para-commit.py
```

**Y dos que hay que quitar:**

```bash
git rm --cached velas-compartidas.db     # 17 MB de binario dentro del repo
git rm client/src/api-1.ts               # copia muerta de api.ts
```

`velas-compartidas.db` está **rastreado desde antes** de que `*.db` entrara en el
`.gitignore`, y eso es la trampa: **el `.gitignore` no deja de rastrear lo que ya
estaba dentro**, solo evita que entren ficheros nuevos. Son 17 MB que se suben en cada
push y que además se regeneran con `node scripts/velas-compartidas.mjs`.

**Lo que NO conviene subir si el repositorio es público:**
`client/preview/dashboard.json` y `client/preview/informes.json` son los datos de
prueba de la vista en frío, y son **tus operaciones de verdad**: números de cuenta,
P&L día a día y las notas. (`client/preview/reaccion.json` también está sin rastrear,
pero ese solo lleva precios del MNQ y el calendario económico: no hay nada tuyo dentro.) Ahora mismo están sin rastrear, que es justo donde deben
quedarse. Si el repositorio es privado, da igual. Para dejarlo explícito:

```
# .gitignore
client/preview/*.json
```

El coste de dejarlos fuera es que `vite build --config vite.preview.ts` no funciona en
un clon limpio hasta que se genera un fixture. El `build` normal no los toca.

---

## Configuración

| Variable | Por defecto | Para qué |
|---|---|---|
| `QUANTOWER_ROOT` | `C:\Quantower` | raíz de la instalación |
| `QUANTOWER_TRADES_DB` | se busca sola | ruta a `user-trades.db` |
| `JOURNAL_DB` | `./data/journal.db` | nuestra base |
| `CONTEXT_DIR` | `C:\Quantower\journal` | carpeta del log de los indicadores |
| `CALENDAR_DIR` | `C:\Quantower\journal\calendar` | ficheros del calendario |
| `CONTEXT_BAR_SECONDS` | (vacío) | temporalidad del contexto: `60` para gráficos de 1 minuto |
| `CONTEXT_RETENTION_DAYS` | `0` (todo) | días de JSON crudo que se conservan |
| `REAL_TRADING_SINCE` | `2026-10-12` | antes de esta fecha son pruebas |
| `CALENDAR_TZ_OFFSET_HOURS` | hora de mercado | zona en la que viene escrito el calendario |
| `MARKET_UTC_OFFSET_HOURS` | `-4` | ancla; el cambio de hora se calcula solo |
| `MARKET_DAY_ROLL_HOUR` | `18` | hora de NY a la que cambia la jornada, como la mesa |
| `NEWS_BLACKOUT_BEFORE_MIN` | `5` | silencio antes del dato |
| `NEWS_BLACKOUT_AFTER_MIN` | `10` | silencio después |
| `PORT` | `4321` | puerto del servidor |
| `AUTO_INGEST` | `true` | `false` para desactivar la ingesta automática |
| `AUTO_INGEST_INTERVAL_MS` | `15000` | cada cuánto comprueba si hay novedades |

### Pestaña News

Todo esto es opcional: sin las dos claves, el bloque no pide nada.

| Variable | Por defecto | Para qué |
|---|---|---|
| `FINNHUB_API_KEY` | (vacío) | cotizaciones, titulares y resultados |
| `ALPHA_API_KEY` | (vacío) | petróleo y tipos del Tesoro |
| `MARKET_TICKERS` | las 10 mayores del QQQ | los símbolos que te importan |
| `MARKET_REFRESH_OPEN_MIN` | `5` | cada cuánto con el mercado abierto |
| `MARKET_REFRESH_EXT_MIN` | `15` | fuera de horas (04:00–09:30 y 16:00–20:00 NY) |
| `MARKET_REFRESH_CLOSED_MIN` | `60` | noches y fines de semana |
| `MARKET_REFRESH_MIN` | (vacío) | **anula las tres de arriba** con un intervalo fijo |
| `MARKET_SLOW_HOURS` | `6` | cada cuánto el calendario de resultados |
| `ALPHA_DAILY_BUDGET` | `20` | techo propio sobre las 25 diarias de Alpha Vantage |
| `MARKET_SENTIMENT_HOURS` | `3` | sentimiento, si algún día deja de ser de pago |
| `MARKET_MOVE_PCT` | `2` | movimiento del día, en %, que dispara la alerta |
| `NEWS_WINDOW_DAYS` | `3` | días de titulares que se enseñan (no se borra nada) |
| `NEWS_MAX` | `300` | tope de titulares que viajan a la pantalla |
| `NEWS_KEYWORDS` | (vacío) | palabras extra que hacen relevante un titular |
| `QQQ_WEIGHTS` | foto de oct-2026 | pesos en el QQQ, `NVDA:8.3,AAPL:7.4,…` |

> **`QQQ_WEIGHTS` es una foto a mano y se queda vieja.** El fichero de
> posiciones del ETF no lo da ninguna API gratuita, así que los pesos están
> copiados de la pantalla de octubre de 2026. Se mueven décimas al mes, así que
> sirven para lo que están —saber cuál de las diez mueve más el índice cuando
> publica resultados—, pero conviene repasarlos cada pocos meses.

Se leen del `.env` de la raíz, o del entorno. **El entorno manda sobre el
fichero**, para poder levantar una segunda instancia en otro puerto sin tocar
nada.

El cambio de horario de verano **ya no se configura**: `src/domain/clock.ts`
aplica las reglas reales de Estados Unidos (segundo domingo de marzo, primer
domingo de noviembre, a las 02:00 locales). Antes era una constante fija, y
habría empezado a clasificar mal las sesiones el 1 de noviembre sin avisar.

### Scalper: «¿y si saliera siempre en el mismo número de ticks?»

Coge tus entradas tal cual —las mismas, en el mismo instante— y les quita tu
gestión: objetivo fijo, stop fijo, y mira cuál tocaba primero recorriendo las
velas de 1 m desde la entrada. Sale el acierto que tendría esa regla sobre tus
operaciones, por killzone, con el objetivo y el stop ajustables.

Tres cosas sostienen que el número signifique algo:

- **El acierto solo no dice nada.** Objetivo 5 / stop 60 acierta el 71,6 % y
  pierde 13,5 ticks por operación. Por eso el porcentaje nunca sale solo:
  siempre con la expectativa al lado y del mismo tamaño.
- **La vela de 1 m no siempre puede desempatar.** Si en el mismo minuto el
  precio toca objetivo y stop, no hay forma de saber cuál fue primero. Se
  cuentan como pérdida —la hipótesis conservadora— y **aparte**: con objetivo
  10 y stop 10 son el 38 % de los casos, y ahí el resultado lo decide la regla
  de desempate, no el mercado. Por encima del 15 % la pantalla lo dice.
- **No hay mirada al futuro.** Solo velas posteriores a cada entrada, y la
  entrada es la tuya con su hora real.

`npx tsx scripts/prueba-scalper.ts` comprueba las tres con velas puestas a
mano, incluida la de media hora antes que no debe contar.

### News → Reacción: qué hacen las noticias, y qué no se puede saber

La pestaña se pidió como **«interpretaciones»**: algo que dijera si un dato de empleo
es bueno o malo para el Nasdaq. Se llama **Reacción** porque lo otro no se puede
construir con esta base, y el nombre es parte de lo que promete.

**El motivo está en la propia base.** De los 39 eventos de `economic_events`, **cero**
traen `forecast` y **cero** traen `actual`. El calendario es una agenda —dice cuándo
pasan las cosas— no un historial de resultados. Y sin previsión no hay sorpresa: lo
que mueve el precio no es que el paro sea del 4,2 %, es que se esperaba 4,0 %.

Así que el panel mide tres cosas y ninguna es una opinión.

**1. Si la dirección se puede anticipar.** Hoy no. 12 momentos distintos, 8 subidas y
4 bajadas; una binomial a dos colas da **p = 0,39**, indistinguible de una moneda. Esa
cifra está ahí a propósito: «6 y 6» se lee solo, pero «8 y 4» a ojo parece una
tendencia, y dejar que el lector decida cuánto es mucho es por donde vuelven a colarse
las interpretaciones.

**2. Cuánto se mueve, contra la línea base de esa misma hora.**

| Hora UTC | Con noticia | Sin noticia | | p |
|---|---|---|---|---|
| **12:30** (08:30 NY) | **238,8 pts** · n=7 | 100,6 pts · n=72 | **×2,37** | **< 0,0001** |
| 18:00 | 104,3 pts · n=5 | 78,5 pts · n=69 | ×1,33 | 0,13 |

Permutación de 20.000 remuestreos sobre la diferencia de medianas, a una cola.

Dos detalles que deciden si el contraste vale algo. **La comparación es contra el mismo
minuto del reloj**, no contra la media del día: a las 12:30 el mercado ya se mueve más
que de madrugada opere quien opere. Y **el fin de semana queda fuera** de la línea
base; si entrara, su rango cero la hundiría y cualquier noticia parecería moverlo todo.

Se resalta la fila con p < 0,05 **y** al menos cinco eventos. Las dos condiciones: un p
pequeño con tres casos es ruido con suerte.

**Lo que esto dice en una frase: se mueve mucho y no se sabe hacia dónde.** Las actas de
la Fed de las 18:00, en cambio, no se distinguen de un día normal, y el calendario las
pinta igual de rojas que un CPI.

**3. Qué le falta al calendario.** La tabla del final cuenta cuántos eventos traen
previsión y dato real, y de qué fichero vino cada uno. **No hace falta código nuevo**:
`src/ingest/investing.ts` ya lee `forecast`, `previous` y `actual`, y conserva el dato
real al reimportar (`actual = COALESCE(excluded.actual, …)`). Lo único que falta es
dejar un `.json` con esos campos en `CALENDAR_DIR`. Cuando lo haya, la sorpresa se mide
encima de esta misma tabla: el mismo movimiento, partido por el signo de la sorpresa.

#### Los eventos rotos no se esconden

El panel lista aparte, con el motivo escrito, los eventos del calendario que no se
pudieron medir, en vez de quitarlos de la tabla. Es la misma regla que el aviso de fin
de semana del calendario de días operados: **un evento que cae donde no hay mercado
casi siempre significa que la fila está mal fechada**, y esconderla deja el dato
inventado dentro de la base para siempre.

Así se encontró el caso que está contado en «Lo que no entra en el calendario, y por
qué»: seis eventos inventados que venían del fichero de ejemplo. Ahora la ingesta no
los deja entrar, así que el recuadro rojo debería estar vacío.

#### La marca del caché, que aquí va al revés

`reaccion()` depende de dos tablas y las trata de forma opuesta a propósito:

- **`bars`** → `barsVersion()`, el contador de `meta`. Contar las velas recorre el
  índice entero y eso costaba casi cinco segundos por carga (ver «Cómo se mantiene
  rápido»).
- **`economic_events`** → se resume la tabla **entera** en cada llamada.

Parece contradecir la lección anterior y no lo hace. Son decenas de filas, el resumen
tarda microsegundos, y sobre todo: `COUNT(*)` y `MAX(rowid)` **no cambian** cuando se
rellena el `forecast` de un evento que ya existía, que es exactamente lo que va a pasar
en cuanto se importe un calendario con previsiones. Con una marca así, el panel seguiría
diciendo que no hay previsiones mientras la base ya las tiene. Lo cazó
`prueba-reaccion.ts` rellenando un `forecast` y comprobando que se nota.

La lección de `bars.ts` no es «marcas baratas siempre», es **«mira lo que cuesta y lo
que detecta cada marca»**.

### El calendario de días operados

La lista de operaciones lleva un calendario de lunes a viernes con el resultado de cada
día pintado al fondo. **Cinco columnas y no siete**: las fechas son jornadas de mercado
—corte a las 18:00 de Nueva York— y con ese corte no existe el fin de semana. Lo operado
el domingo por la tarde, cuando el mercado acaba de abrir, pertenece al lunes, igual que
lo cuenta una mesa de fondeo. Si aun así llegara una jornada en sábado o domingo, no se
esconde: sale un aviso debajo con la fecha y la cifra.

**El fallo del 1 de noviembre de 2026, que conviene tener presente por su forma.** El
hueco inicial del mes se calculaba con el día de la semana del día 1 sin comprobar que
ese día cupiera en la rejilla:

```ts
const leading = weekdayMondayFirst(y, m, 1);   // domingo = 6, y solo hay 5 columnas
```

El 1 de noviembre de 2026 cae en domingo. Seis huecos en cinco columnas son una fila
entera vacía más uno, así que **el lunes 2 se pintó bajo la M y noviembre entero salió
corrido una columna**; el viernes 6 aparecía bajo la L. Octubre nunca lo enseñó porque
empieza en jueves: solo fallan los meses que abren en fin de semana, dos de doce.

Lo que lo hace peligroso no es el tamaño, es que **no rompe nada a la vista**. El número
de la casilla, la cifra y el color son todos correctos; lo único equivocado es la
columna, que se lee sin leerla. Por eso el reparto vive ahora en `client/src/calendario.ts`,
separado del componente y sin React, y `npx tsx scripts/prueba-calendario.ts` recorre los
84 meses de 2024 a 2030 comprobando que cada día cae en la columna de su día de la semana
y que no se pierde ninguno. Con el código viejo, esa prueba da 9 fallos.

El arreglo no es recortar el hueco a cuatro —eso pondría el lunes en el viernes— sino
contarlo desde el primer día que de verdad ocupa casilla: si el mes abre en fin de
semana, ese día siempre es un lunes y el hueco es cero.

### La marca: logo y favicon

| Fichero | Qué es | Dónde sale |
|---|---|---|
| `client/public/greenspot.png` | 285 × 72, fondo transparente | la cabecera del lateral |
| `client/public/icono.png` | 64 × 64 | la pestaña del navegador (`<link rel="icon">` en `client/index.html`) |

Están en `client/public/`, que Vite copia tal cual a `web/` al compilar: se piden
como `/greenspot.png` e `/icono.png`, sin importarlos desde ningún `.tsx`. Por eso
**no dan error de compilación si faltan** — simplemente sale el texto alternativo
«Greenspot» donde debería ir el logo. Si al clonar el proyecto ves eso, lo que falta
son los dos PNG.

El logo sustituyó al `<h1>` «Diario de trading» y manda el ancho del lateral, no al
revés: se escala al hueco que queda tras el padding.

### La navegacion: el lateral

Las once secciones viven en un lateral agrupadas por **la pregunta que
contestan**. Esa agrupación ya existía —la fila de pestañas estaba ordenada
así— pero vivía en el orden de los botones y no se veía.

```
  Resumen
  MERCADO        News · Calendario · Estudio
  MI OPERATIVA   Informe · Operaciones
  ANÁLISIS       Horarios · Disciplina · Scalper · Costes y recorrido
  Ajustes
```

El corte que importa es el de los dos últimos grupos: **Mi operativa es lo que
pasó; Análisis es qué habría pasado si**. Scalper y Costes son simulaciones
sobre las mismas entradas, no resultados. Mezclarlas con el informe invita a
leer una simulación como si fuera lo que ocurrió.

«Mercado» pasó a llamarse **Estudio** y se fue con News y Calendario: ese panel
no mira tus operaciones, es estudio de mercado puro. Estaba entre Scalper y
Costes, donde nadie podía adivinarlo.

Dos cosas que el lateral hizo posibles y antes no lo eran:

- **La barra de filtros solo sale donde sirve.** News, Calendario, Estudio y
  Ajustes no miran tus operaciones; la barra estaba ahí igualmente, invitando a
  poner un filtro que no hacía nada.
- **La sección va en la URL** (`#informe`): recargar devuelve donde estabas y se
  puede guardar un marcador.

En pantalla estrecha el lateral se pone arriba y en horizontal: 212 px de los
400 de un móvil serían media pantalla para un menú.

### Las cuentas que cuentan para las métricas

Hay **dos mandos, y hacen cosas distintas a propósito**:

| dónde | qué es | cuánto dura |
|---|---|---|
| Ajustes → Gráfico → **casillas de cuentas** | la marca permanente: las que entran en las métricas cada vez que abres la app | se guarda en la base |
| barra de arriba → **Cuenta** | el filtro de ahora mismo, para probar combinaciones | solo esta sesión |

El de arriba **también es de casillas** desde el 1 de noviembre. Era un desplegable
nativo: con dos cuentas bastaba —o una, o la otra, o todas— pero con tres ya no, porque
«las dos de verdad y la de pruebas no» no se puede pedir con un desplegable. El dominio
ya lo admitía (`Filter.accounts` es una lista y la consulta usa `account_id IN (...)`);
lo que faltaba era el mando. Se dibuja a mano porque el `multiple` de HTML es una caja
con scroll que hay que usar con Ctrl y nadie la usa bien.

Desmarcarlas todas vuelve a «todas», no a «ninguna»: un filtro vacío devolvería cero
operaciones y el tablero saldría en blanco.

Existe porque una cuenta que solo fue de pruebas arrastra un periodo que ya no describe
cómo operas, y dejarla dentro ensucia todas las cifras sin que se note.

**Son casillas y no un desplegable porque son varias.** Al abrir una cuenta demo nueva se
quiere medir **junto** con la de antes, no en lugar de ella: marcarlas las suma. Sin
marcar ninguna, entran todas.

Se resuelve en el **servidor** (`resolverCuentas()` en `src/domain/prefs.ts`), no en la
pantalla, por dos motivos: así vale para todas las rutas sin repetirlo, y el primer dibujo
ya viene filtrado en vez de llegar entero y filtrarse después.

Tiene **tres estados** y confundir dos de ellos rompe el mando:

| lo que llega | qué se filtra |
|---|---|
| el parámetro **no viene** | las cuentas marcadas en Ajustes |
| viene **vacío** | todas — es haber elegido «todas» a mano |
| viene con valores | esas, separadas por coma |

Sin el caso del medio, la cadena vacía y la ausencia serían lo mismo: elegir «todas»
volvería a filtrar por el ajuste y parecería que el control no hace nada.

Y hay una segunda trampa, del SQL: **una lista vacía significa «todas», pero traducida a
ciegas sería `account_id IN ()`, que no devuelve nada** — el tablero saldría en blanco y
parecería que no hay operaciones. `npx tsx scripts/prueba-ajustes.ts` comprueba las dos.

El ajuste **no se valida** contra las cuentas que existen, a propósito: el fichero viaja
entre ordenadores y una cuenta que aquí no está puede estar en la base del otro. Si no
existe, el mando cae en «todas» solo y el selector de Ajustes la sigue mostrando
marcada como «no está en esta base».

### El informe: diario y semanal

Pestaña **Informe**, con selector de periodo. Contesta las quince preguntas del bloque
diario y semanal de `claude/preguntas-del-informe.md`. **No hace falta ningún modelo**:
son consultas a la base y funciones que ya existían, así que la misma semana da la misma
respuesta hoy y dentro de un año.

**El reparto entre diario y semanal no es comodidad, es cuánta muestra hace falta.**

- **Diario → solo aritmética.** Una jornada son cuarenta operaciones y una sola mala mueve
  la media veinte dólares. Aquí no hay ni un porcentaje comparado contra nada ni un
  p-valor.
- **Semanal → ya se puede comparar** contra la semana anterior, pero sigue sin poder
  concluirse nada.
- **Mensual → a mano.** Decidir qué se prueba y con qué control no es algo que deba hacer
  un panel que se refresca cada treinta segundos.

**La cifra que manda es `ticks por contrato`**, y por eso es la segunda baldosa y no un
detalle al final. Es la única que mide *cómo* opera sin mezclarlo con *cuánto* arriesga.
En octubre el resultado en dólares fue **+$157,50** y el resultado por contrato fue
**−$1.144**: la diferencia entera era el lotaje de una sola operación. Un informe que solo
enseñe dólares esconde justo eso. La semana del 26 al 30 lo repite en pequeño: **+$450
netos con −1,7 ticks por contrato**.

**Hay histórico, y no hace falta guardarlo.** La barra de arriba lleva flechas para ir a la
jornada o la semana anterior, un botón de **Calendario** con todas las jornadas operadas
—de lunes a viernes, con su neto pintado— y un **Lo último** para volver. Cualquier día
pasado se **recalcula** desde las operaciones y las velas, que siguen ahí: no se guarda
ninguna copia del informe. Eso tiene una consecuencia que conviene tener clara — si el P&L
se recalcula, como pasó el 31 de octubre con las cuatro ejecuciones a NULL, **el histórico
se corrige solo** en vez de conservar la cifra equivocada.

El fin de semana el panel abre en **Semanal**: el sábado y el domingo no hay jornada que
mirar y lo que se quiere ver es la semana que acaba de cerrar. Es solo el valor inicial;
el selector manda en cuanto se toca.

Bloques, en orden de lo que se puede usar mañana a lo que solo se puede mirar:

1. **La jornada / la semana** — neto, ticks por contrato, operaciones, lote máximo, lo que
   queda del límite diario y el periodo anterior al lado.
2. **El tamaño** — por encima y por debajo del lote mediano, y el reparto completo por
   lotaje. Las filas con menos de 10 operaciones salen en gris.
3. **Dónde operaste** — por killzone y por hueco entre killzones.
4. **Las que movieron el periodo** — las cinco mejores y las cinco peores, con
   `tk/contrato` (¿respetó el stop?) al lado de `Factor` (¿cuánto multiplicó el tamaño?) y
   lo que habría costado con un contrato.
5. **Lo que hubo que aguantar** — el drawdown por franja.
6. **Solo en el semanal** — payoff contra el acierto de equilibrio, las entradas sin
   ninguna media a favor (el veto medido, p = 0,0098) y las reentradas en caliente.

Dos avisos que el panel lleva escritos: **el picado no sale** porque lo calcula el
indicador en Quantower y el diario no lo guarda con cada operación; y el drawdown de esta
pestaña va sobre el **neto**, mientras que el de Horarios va sobre el bruto, así que las
dos cifras no tienen por qué coincidir.

`npx tsx scripts/prueba-informe.ts` comprueba, entre otras cosas, las cuatro formas de que
este panel mienta:
los ticks multiplicados por los contratos —que convertirían la única cifra limpia en otra
sucia—, el bruto contado con la comisión ya quitada (`applyCosts` **sobrescribe**
`gross_pnl` con el neto), la semana rellenada con días de la anterior, y el límite diario
calculado con el acumulado del periodo en vez de con la última jornada. Y la navegación:
`prev` y `next` **no devuelven el mismo día** —hacia atrás sale el último del periodo
anterior y hacia delante el primero del siguiente—, así que hay un caso que comprueba que
ir y volver te deja donde estabas.

### El drawdown por killzone: «¿cuándo debo parar?»

En la pestaña **Cuándo**, justo debajo del P&L por sesión, porque es la misma
pregunta un nivel más abajo: una dice qué franja deja dinero y la otra cuánto
hay que aguantar para cobrarlo. Tres bloques, ordenados de lo que se puede usar
a lo que no.

**1. El drawdown de cada franja.** Aritmética, nada que demostrar. El *drawdown*
es cuánto bajaste desde tu mejor momento dentro de esa franja y ese día, con la
cuenta empezando **plana**: si arranca en la primera operación, una franja que
empieza perdiendo 300 sale con drawdown cero, que es justo la que más duele. Al
lado va el **drawdown acumulado**, que es otra cosa: la curva de la franja
encadenando todas sus jornadas. Una franja puede no haber tenido nunca un día
horrible y llevar mil de drawdown a base de días malos pequeños.

**2. Lo que esconde «Fuera».** Esto salió midiendo, y vale más que lo que se
fue a buscar. Un tercio de las operaciones de octubre —193 de 573— cae en
`OUTSIDE`, y **«Fuera» no es un sitio**: son cinco huecos entre killzones que
se portan de forma opuesta.

| Hora (NY) | Qué es | Ops | $/op |
|---|---|---|---|
| 00:00–02:00 | tras cerrar Asia | 37 | **+13,57** |
| 05:00–09:30 | entre Londres y NY AM | 27 | +5,22 |
| **11:00–12:00** | **entre NY AM y el almuerzo** | **50** | **−10,02** |
| 13:00–13:30 | entre el almuerzo y NY PM | 30 | +2,58 |
| 16:00–20:00 | entre NY PM y Asia | 49 | +8,44 |

La hora que sigue al cierre de NY AM cuesta **−501 dólares** en 50 operaciones:
la peor del mes con diferencia, y estaba escondida dentro de un cajón llamado
«fuera» cuyo total es **+633**. Los huecos se deducen de las ventanas del
indicador KillZones, así que si alguna vez las mueves ahí, se mueven solos.

Relacionado y vale la pena saberlo: **la ventana de Asia del indicador acaba a
medianoche**, no cruza. A las 00:01 ya estás en hueco. El comentario de
`sessions.ts` dice lo contrario y la condición que lo implementaría (`h < 0`)
no se cumple nunca, porque `marketHour` devuelve de 0 a 24. No se toca —las
ventanas son las del indicador y el indicador está congelado— pero explica
dónde acaban esas 37 operaciones de después de medianoche.

**3. ¿Existe un nivel al que parar?** Inferencia, y la única que hay que
demostrar. Mirar «cuando estuve 200 abajo, la franja acabó mal» no demuestra
nada: acabó mal *por estar 200 abajo*, que es la misma frase dos veces. Lo
único usable es lo que pasó **después** de cruzar el umbral, comparado con la
media normal de esa misma franja. Y aun así falta la prueba: cada celda se
contrasta **barajando 2.000 veces el orden** de las operaciones dentro de cada
jornada, conservando exactamente las mismas operaciones. Barajar destruye
cualquier «estar abajo predice lo siguiente» y deja intacto todo lo demás.

Medido el 31 de octubre de 2026: **30 celdas probadas, cero supervivientes** a
Benjamini-Hochberg al 10 %. La mejor es p = 0,013 y el listón del primer puesto
es 0,0033. Tampoco hay dosis-respuesta —en «Fuera», el umbral de 50 sale −7,43
y el de 100 sale +2,18—, y una regla que cambia de signo al mover el mando es
un número suelto, no una regla. **Hipótesis número once, muerta como las ocho
anteriores.**

En esa tabla, **el color dice el signo, no si la celda significa algo**: verde
es que seguir fue mejor que la media de la franja, rojo que fue peor. Es la
única pantalla del diario donde las dos cosas no coinciden —hay celdas muy
verdes con p = 0,9— así que lo que separa un hallazgo de un número bonito es el
**p-valor** de debajo y el **✓**, que hoy no lleva ninguna.

La regla de parada que **sí** vale no necesita estadística: el **límite de
pérdida diaria** de Ajustes → Costes. Si lo pones, la primera tabla añade una
columna con las veces que el drawdown de cada franja habría llegado a él. Eso no es
inferir, es contar.

`npx tsx scripts/prueba-drawdown.ts` comprueba las cuatro formas de que este
panel mienta: el pico que no arranca en cero, el cruce en la última operación
—ahí no seguiste, así que no puede contar como «seguir dio esto»—, la
comparación sin línea base, y el p-valor con semilla aleatoria que cambiaría de
color en cada recarga.

### De cuándo es cada precio

Finnhub manda, junto al precio, **la hora a la que se operó** (`t`). Antes se
tiraba y se guardaba la hora de *nuestra* petición, así que a las siete de la
mañana la tabla decía «actualizado hace dos minutos» enseñando el cierre de
ayer. Ahora se guarda en `global_quotes.quote_ts` y debajo de cada precio sale
en qué tramo cayó:

| tramo | hora de Nueva York |
|---|---|
| sesión regular | 09:30 – 16:00 |
| pre-mercado | 04:00 – 09:30 |
| after | 16:00 – 20:00 |
| fuera de horario | el resto |
| cierre diario | la serie no trae hora (petróleo y bonos) |

**Esto contesta solo si el plan gratuito trae pre-mercado y after**: si a las
07:30 el precio sigue marcando el cierre de la sesión anterior, no los trae.
No hace falta creerse la documentación de nadie — se ve en la tabla.

El tramo se calcula **siempre con el reloj de Nueva York**, lo defina el
mercado; lo que cambia con el ajuste de reloj es la hora que se escribe al
lado, no el tramo.

### La franja de resultados, y por qué la hora es una convención

Pegada a la barra de filtros, visible desde **cualquier** pestaña, con dos
avisos que dicen cosas distintas:

- **Ámbar** — quién presenta en **3 días o menos**, con la hora y una cuenta
  atrás que corre sola. Lo que queda más lejos vive en la pestaña News, en la
  columna «Próx. resultados»: ahí es contexto, no un aviso.
- **Rojo** — un resultado que salió **por debajo de lo esperado**, con el
  desvío en porcentaje. Es lo que explica un desplome.

**Ni Alpha Vantage ni Finnhub dan la hora**: dan el día y, como mucho, `bmo`
(antes de abrir) o `amc` (después del cierre). Durante un tiempo la franja usó
una **convención** única de 16:30 de Nueva York para todas. Esa convención
**estaba mal para nueve de cada diez empresas**.

La hora real sale de la **API pública de la SEC**, gratis y sin clave: cada 8-K
con el ítem 2.02 («Results of Operations and Financial Condition») lleva un
`acceptanceDateTime` con el segundo exacto en que entró en EDGAR. Medianas de
los seis últimos informes, medidas el 31 de octubre de 2026:

| | hora NY | rango |
|---|---|---|
| GOOGL / GOOG | **16:01** | 16:01–16:01 |
| MU | 16:02 | 16:02–16:03 |
| MSFT | 16:04 | 16:03–16:08 |
| META | 16:05 | 16:03–16:13 |
| AMZN | 16:13 | 16:05–16:25 |
| TSLA | 16:13 | 16:06–16:41 |
| AMD | 16:16 | 16:16–16:16 |
| NVDA | 16:21 | 16:20–16:31 |
| AAPL | **16:30** | 16:30–16:30 |

**Lo que arregla, y no era un detalle.** Con 16:30 para todas, la alarma de
«faltan 15 minutos» sonaba a las 16:15 — o sea **después** de que Google,
Micron, Microsoft y Meta hubieran publicado ya. El aviso llegaba tarde justo en
las que van más pegadas al cierre, y nada en pantalla lo decía.

Ahora cada hora sale etiquetada: **«medida · 6»** cuando viene de EDGAR, con el
rango en el aviso del ratón, y **«convención»** cuando no hay medición de esa
empresa. Un rango ancho es información: GOOGL es puntual al minuto diez de diez
veces; TSLA se mueve entre las 16:06 y las 16:41.

Se vuelve a medir con:

```
node scripts/medir-horas-resultados.mjs        # mide y guarda
node scripts/medir-horas-resultados.mjs --ver  # solo enseña
```

Una vez por trimestre basta. Guarda en `meta.earnings_hours`, que manda sobre
la tabla del código. La SEC **exige identificarse** en el `User-Agent` o
devuelve 403: ponlo en `SEC_CONTACT` del `.env`.

> Tesla usa el mismo ítem 2.02 para las cifras de producción y entregas, que
> publica sobre las 09:00. El script descarta las de la mañana: mezclarlas daba
> una mediana de las 16:11 que no describía ninguna de las dos cosas.

Para `bmo` sigue mandando la convención de **Ajustes → Avisos**: ninguna de las
diez publica antes de abrir, así que no hay nada medido.

La misma franja lleva una **tercera barra azul con el calendario económico**:
los eventos T1 de la mesa y lo importado de Investing, dentro de **7 días**. Es
una ventana más ancha que la de resultados a propósito: los T1 son mensuales
—nóminas, IPC, FOMC—, así que con tres días la barra estaría vacía cuatro
semanas de cada cinco y parecería rota. Lo que cae a más de tres días sale
apagado; dentro de tres, encendido.

Aquí **la hora es un dato, no una convención**: el calendario trae la hora
exacta de publicación. Por eso esa barra no lleva la palabra «convención» y el
aviso del ratón dice la ventana de silencio en vez de explicar de dónde sale la
hora.

Las dos agendas comparten cola de alarmas, recuerdo y modal, ordenadas por
cercanía: si un informe y unas nóminas caen el mismo día, suena primero el que
antes llega y el otro al cerrar ese modal. El color los separa — **ámbar** una
cita de resultados, **azul** una del calendario, **rojo** un resultado que ya
salió por debajo.

Sobre esa hora se cuentan **cuatro alarmas**: a 1 día, 6 horas, 1 hora y 15
minutos. Suenan con un pitido generado por el navegador —no hay ningún fichero
de sonido que distribuir— y abren un modal que **no se quita solo**. Tres
detalles que costaron sus pruebas:

- Si abres el diario con el informe ya encima, suena **solo el aviso más
  cercano** de los que te hayas perdido, no los cuatro seguidos.
- Si dos empresas presentan a la vez, el segundo modal sale **al cerrar el
  primero**. Marcar las dos como avisadas de golpe dejaba la segunda muda para
  siempre.
- La cuenta atrás corrige la diferencia entre el reloj del servidor y el del
  navegador. Con el PC dos minutos adelantado, la alarma de los 15 sonaría a
  los 17.

`npx tsx scripts/prueba-resultados.ts` comprueba el cálculo con 25 casos,
incluido el cambio de hora del 1 de noviembre y el `eps_actual = 0` que el
proveedor pone en lo que todavía no ha presentado (leído como resultado,
convierte a cualquier empresa pendiente en un desplome del 100 %).

Para ver la franja y las alarmas sin esperar:

```
npx vite build -c vite.preview.ts
# y abrir preview-out/index.html?min=20   (?min=10, ?min=2880, ?min=20&dos=1)
```

---

## Cómo está hecho

### Tablas

- `fills` — ejecuciones crudas tal como vinieron del bróker
- `operations` — operaciones reconstruidas, clasificadas por sesión killzone.
  `gross_pnl` lo calculamos desde los precios; `broker_pnl` es lo que sumaba
  Quantower, guardado aparte para poder contrastar
- `context_snapshots` — estado del mercado según los indicadores (JSON crudo)
- `bars` — el contexto pasado a columnas tipadas; de aquí salen los gráficos
- `economic_events` — calendario importado
- `operation_notes` / `operation_tags` — lo que escribes tú
- `meta`, `ingest_runs` — control

Y las del contexto de fuera, que **no las lee ninguna métrica tuya**:

- `global_quotes` — último precio de cada símbolo, materia prima y bono
- `global_earnings` — calendario de resultados
- `global_news` — titulares, con su puntuación cuando la traen
- `global_daily_close` — nuestro propio histórico de cierres, para el 5d %
- `global_blocks` — cuándo acertó y cuándo falló cada fuente por separado

Los `fills` se guardan sin interpretar a propósito: si mañana cambia la forma de
agrupar operaciones, se recalcula todo desde ahí sin volver a tocar Quantower.
Lo mismo con `context_snapshots` frente a `bars`.

### Revisión por operación

Cada operación pasa por un motor de reglas (`src/domain/review.ts`) que la marca
con banderas objetivas. Todo lo que sale de ahí es determinista y verificable:
cada bandera dice un hecho medible con su cifra al lado. No hay narrativa
inventada, a propósito — una explicación plausible sobre por qué falló una
entrada se lee igual de bien que una real, y eso es justo lo que la hace
peligrosa.

Las banderas se separan en dos tipos:

- **decisión** — solo miran lo que se podía saber al abrir (reentrada
  inmediata, racha de pérdidas, fuera de killzone, apertura de sesión, número
  de operación del día)
- **resultado** — miran cómo acabó (pérdida fuera de tamaño, se fue en contra
  al instante)

Separarlas evita juzgar una entrada por su desenlace: una buena decisión puede
perder y una mala puede ganar.

**Los umbrales de `DEFAULT_REVIEW_CONFIG` son inventados, no medidos.** Dos
minutos para la reentrada, tres pérdidas seguidas, doce operaciones al día: son
puntos de partida razonables, no conclusiones sacadas de ningún dato.
Ajústalos con el histórico delante.

El panel "qué cuesta dinero" suma el resultado de las operaciones que llevan
cada bandera. Es la forma de comprobar si una regla captura algo real: si una
bandera acumula P&L positivo, el umbral está mal puesto o la regla no sirve.

### Tendencia de los marcos grandes

`src/domain/trend.ts` arma velas semanales, diarias y de 4h agrupando las de un
minuto, y clasifica cada marco por el cociente **avance neto ÷ rango
recorrido**. Por debajo de 0,30 es rango; por encima de 0,60, tendencia clara.
Los cortes salen de medir 100 días de MNQ, no de un libro.

El día de futuros empieza a las 18:00 hora de mercado, como en CME y en
Quantower. Solo entran velas ya cerradas antes de la entrada: incluir la vela
en curso sería mirar el futuro.

---

## Cómo funciona por dentro

El proyecto son tres capas y una regla que las separa: **lo que llega, lo que se
deriva y lo que se enseña**. Nada de la capa de abajo sabe nada de la de arriba.

### 1. Ingesta — `src/ingest/`

| Fichero | Qué hace |
|---|---|
| `quantower.ts` | lee `user-trades.db` (solo lectura) y reconstruye las operaciones por ciclos de posición neta |
| `context.ts` | lee los `.jsonl` del indicador y los guarda tal cual en `context_snapshots` |
| `calendar.ts` | lee los `.ics` / `.csv` del calendario |
| `watch.ts` | vigila las fechas de modificación y lanza la ingesta cuando algo cambia |
| `run.ts` | lo mismo, pero a mano: `pnpm run ingest` |

Todo aquí es **idempotente**: lanzarlo mil veces no duplica nada.

### 2. Dominio — `src/domain/`

Donde está el conocimiento. Nada de esto toca HTTP ni sabe que existe una
pantalla.

**Lo básico**

- `clock.ts` — horario de verano de Estados Unidos. De aquí sale el desfase de cada instante
- `sessions.ts` — las killzones, y a cuál pertenece un momento
- `instruments.ts` — tick, valor del punto, multiplicador por contrato
- `bars.ts` — pasa el JSON crudo a la tabla `bars`, con columnas tipadas

**Sobre tus operaciones**

- `metrics.ts` — acierto, payoff, esperanza, rachas, desgloses, y la consulta con filtros
- `costs.ts` — ticks, comisión y neto
- `excursion.ts` — MAE, MFE, captura y lo devuelto
- `review.ts` — las banderas objetivas (reentrada, racha, fuera de killzone…)
- `narrative.ts` — las frases de la pestaña Lectura, armadas desde esos números
- `scratch.ts` — salidas en plano y qué habría pasado aguantando
- `sessionDrawdown.ts` — el drawdown dentro de cada killzone, y si existe un nivel al que parar
- `report.ts` — el informe diario y semanal: las preguntas que se contestan solas
- `notes.ts` — tus notas y etiquetas

**Sobre el mercado, no sobre ti**

Esta es la parte nueva y la más fiable, porque no depende de que acertaras:

- `trend.ts` — tendencia o rango en semanal, diaria y 4h
- `pattern.ts` — el patrón de la vela de 15m
- `sessionStats.ts` — cuánto se mueve cada killzone; de aquí salen el stop y el objetivo sugeridos
- `study.ts` — el estudio de patrones a favor de la 4h, con su línea base y su p-valor

**Servicio**

- `replay.ts` — arma el gráfico de una operación: velas, ejecuciones, killzones, tendencia, patrón y estadística de la franja
- `prefs.ts` — las preferencias de presentación
- `storage.ts` — tamaño de la base y purga del crudo

### Cómo se mantiene rápido

Lo que deriva de las velas —patrón de la vela de 15m, pila de medias, rejilla,
estadística por killzone, estudio y tendencia— se construye una vez y se cachea.
La parte delicada es **cuándo tirar ese caché**, y ahí había un error que costaba
casi cinco segundos en cada carga del tablero.

La marca de validez era `SELECT COUNT(*), MAX(ts) FROM bars WHERE symbol = ?`.
Suena barato y no lo es: recorre el índice entero del símbolo. Medido con
139.316 velas, **6,72 ms por llamada** — y la comprobación se hacía una vez por
operación, así que el panel de patrones gastaba 4,1 s en preguntar si podía usar
un caché que ya tenía. Construirlo eran 414 ms.

Ahora la marca es `barsVersion()`: un contador en `meta` que sube `refreshBars`,
compuesto con `MAX(ts)` por si la base se sustituye por debajo. Leerlo son
**0,01 ms**, y no crece con el histórico.

| | antes | después |
|---|---|---|
| `/api/dashboard` entero | 4.843 ms | **669 ms** |
| patrón de la vela | 4.434 ms | 425 ms (24 ms cacheado) |
| alineación con las medias | 4.132 ms | 232 ms |
| scalper | 5.533 ms | 435 ms |

El scalper era otra cosa: el barrido recorre catorce objetivos sobre las mismas
operaciones y volvía a pedir las mismas velas catorce veces. Se cargan una vez.

**Lo que no está resuelto**, y conviene saberlo: la reconstrucción en frío sigue
recorriendo todo el histórico. Con 2,3 M de velas son 9,5 s. El siguiente paso es
añadir por el final en vez de reconstruir.

**Regla para cualquier cambio de rendimiento:** se vuelcan a JSON todas las
salidas que dependen de las velas con el árbol viejo y con el nuevo y se comparan
byte a byte. Si mueve una cifra, no es una optimización.

### 3. API y pantalla

`src/api/server.ts` es la única capa que habla HTTP. `/api/dashboard` devuelve
todo de una vez para que la página cargue con una sola petición; el resto de
endpoints existen para lo que se pide aparte (el replay, el calendario, los
estudios).

El cliente (`client/src/`) es React con un componente por panel. `api.ts` tiene
los tipos y las llamadas, y es el único sitio que conoce las rutas.

### La regla que lo sostiene

**Crudo abajo, derivado arriba, y lo derivado se puede tirar y recalcular.**

- `fills` se guarda sin interpretar → si cambia cómo agrupamos operaciones, se recalcula sin volver a tocar Quantower
- `context_snapshots` se guarda sin interpretar → si cambia qué cuenta como absorción, se recalcula sin perder histórico
- `bars` se deriva de los snapshots → `pnpm run ingest` lo reconstruye
- Las métricas no se guardan: se calculan al pedirlas

Lo único irrecuperable es el crudo. Por eso `CONTEXT_RETENTION_DAYS` viene
apagado y la purga no se ejecuta sola.

---

## API

| Endpoint | Devuelve |
|---|---|
| `GET /api/dashboard` | todo de una vez (lo que consume la página) |
| `GET /api/summary` | métricas globales |
| `GET /api/operations` | listado paginado |
| `GET /api/operations/:id/replay` | velas, ejecuciones, killzones, tendencia, patrón y estadística de la franja |
| `GET /api/operations/:id/reading` | solo la lectura en prosa, sin velas |
| `GET /api/sessions/stats` | cuánto se mueve el mercado en cada killzone |
| `GET /api/study/patterns` | estudio de patrones a favor de la 4h |
| `GET /api/calendar/events` | búsqueda en el calendario (texto, impacto, fechas) |
| `GET`/`PUT` `/api/prefs/chart` | preferencias de presentación |
| `GET /api/breakdown` | desglose por sesión, día, hora y dirección |
| `GET /api/equity` | curva de capital |
| `GET /api/behaviour` | reentradas rápidas tras pérdida y rachas |
| `GET /api/alignment` | cómo te fue según con cuántos marcos estabas alineado |
| `GET /api/today` | la jornada en curso contra el límite de pérdida |
| `GET /api/report` | el informe diario o semanal (`periodo`, `ancla`) |
| `GET /api/scalper` | el barrido de salidas fijas sobre las mismas entradas |
| `GET /api/reaction` | cuánto movió el precio cada noticia, contra la línea base de esa hora |
| `GET /api/global` | contexto de mercado: lee de la base, **nunca** pide al proveedor |
| `POST /api/global/refresh` | fuerza un ciclo y dice qué bloque falló |

Filtros comunes por query string: `from`, `to` (YYYY-MM-DD, fecha de mercado),
`session`, `includeTests=true`, `accounts` (separadas por coma; **no mandarlo** y
mandarlo **vacío** significan cosas distintas, ver «Las cuentas que cuentan para las
métricas»).

No está toda la lista: hay treinta y ocho rutas. Las que faltan son las de
mantenimiento (`/api/bars/rebuild`, `/api/storage/prune`, `/api/calendar/import`) y las
de escritura de notas, etiquetas y ajustes. `src/api/server.ts` es la lista de verdad.

---

## Problemas conocidos

- **El volumen histórico es falso, y está medido.** Quantower devuelve el mismo
  `VolumeAnalysisData.Total` para miles de velas seguidas cuando el análisis de
  volumen no está calculado de verdad. En la base: **69.446 de 69.447 velas**
  anteriores al 8-oct-2026 llevan el valor idéntico `buy=171 sell=183`. Dos
  combinaciones distintas en setenta mil velas.

  Desde entonces j_Flujo lleva un guardia: si el volumen de una vela coincide
  exactamente con el de la anterior en las cuatro cifras, **no se guarda** y el
  panel lo avisa en pantalla (`VOLUMEN REPETIDO: n velas sin guardar`).

  Qué significa en la práctica:
  - **El OHLC es correcto** en los 90 días. Gráficos, MAE/MFE, rangos y todo lo
    que dependa solo de precio es fiable.
  - **Cualquier análisis con volumen, delta o absorción** tiene que empezar
    desde que recompilaste con el guardia. Antes de eso mide ruido.
- **En un disco externo o USB, `pnpm install` falla.** El error es
  `Failed to create symlink ... Funcion incorrecta. (os error 1)` y no menciona
  ni los enlaces ni el disco, asi que cuesta de identificar. La causa es que
  exFAT y FAT32 no admiten enlaces simbolicos, y pnpm instala creando symlinks.

  ```powershell
  pnpm install --node-linker=hoisted
  ```

  Copia en vez de enlazar, que es lo que hace npm. Ocupa algo mas de disco y ya
  esta. `scripts\setup.ps1` lo reintenta solo cuando detecta el fallo. Lo
  comodo de verdad es tener el proyecto en el disco `C:`, que es NTFS.

- **La muestra es pequeña.** Con un centenar de operaciones en pocos días y un
  solo instrumento, casi cualquier diferencia entre grupos cabe dentro del
  azar. Las cifras sirven para mirar operaciones concretas, no para sacar
  reglas.

- **Los dos proveedores de la pestaña News avisan de sus errores con un 200.**
  Ni código HTTP, ni campo `error`: un objeto normal con un texto dentro. Hay
  tres que conviene reconocer, porque significan cosas distintas:

  | Texto | Qué pasa |
  |---|---|
  | *«spreading out your free API requests more sparingly (1 request per second)»* | ibas demasiado rápido. Ya se espera 1,5 s entre llamadas a Alpha Vantage |
  | *«This is a premium endpoint»* | eso no entra en el plan gratuito. El bloque se apaga solo |
  | *«rate limit … 25 requests per day»* | se acabó la cuota hasta mañana |

  Por eso el diario lleva su propia cuenta de peticiones en vez de fiarse de
  los códigos de respuesta. Sin eso, quedarse sin cuota se guardaría como
  «cero resultados» y parecería un día tranquilo.

- **El sentimiento de las noticias ya no es gratis.** `NEWS_SENTIMENT` de Alpha
  Vantage —puntuación de −1 a +1 por titular y relevancia por ticker— pasó a
  ser premium estando ya integrado. El código sigue ahí y la columna
  `sentiment` también: si algún día pagas el plan, se reactiva borrando
  `bloque_apagado_sentimiento` de `meta`. Mientras tanto, los titulares llegan
  **sin puntuar**, que no es lo mismo que neutros, y por eso no se les pinta
  un cero.

- **Si recompilas y sigues viendo la pantalla de antes, mira la caché del
  navegador.** Vite pone un hash en cada `.js`, pero `index.html` se llama
  siempre igual y es el único fichero que dice qué hash cargar: con el index
  viejo cacheado, el navegador sigue pidiendo el JS viejo, que además todavía
  está en la carpeta. El resultado es una interfaz antigua sobre un servidor
  nuevo y ninguna pista. El servidor ya manda `Cache-Control: no-store` para
  el index, pero si vienes de una versión anterior, **Ctrl+F5** una vez.
