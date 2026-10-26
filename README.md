# Diario de trading

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
| **Alpha Vantage** | <https://www.alphavantage.co/support/#api-key> | petróleo (WTI y Brent) y tipos del Tesoro a 10 y 30 años | **25 peticiones al día**, y 1 por segundo |

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
| petróleo y bonos | Alpha Vantage | **una vez al día** | 4 peticiones de las 25 |

El petróleo y los bonos van una vez al día porque **son series diarias**: el
valor de las 10:00 y el de las 16:00 son el mismo número.

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

---

## Cómo está hecho

### Tablas

- `fills` — ejecuciones crudas tal como vinieron del bróker
- `operations` — operaciones reconstruidas, clasificadas por sesión killzone
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
| `GET /api/global` | contexto de mercado: lee de la base, **nunca** pide al proveedor |
| `POST /api/global/refresh` | fuerza un ciclo y dice qué bloque falló |

Filtros comunes por query string: `from`, `to` (YYYY-MM-DD, fecha de mercado),
`session`, `includeTests=true`.

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
