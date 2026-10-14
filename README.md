# Diario de trading

Ingiere las operaciones de Quantower y el contexto de order flow de los indicadores
propios, los normaliza en una base de datos propia y los expone por API y dashboard.

## Requisitos

**Node 20 LTS o superior** (recomendado 22 LTS). No es opcional: Fastify 5 lo
exige, Vite necesita `styleText` de `node:util` (Node 20+) y tsx depende de
`tracingChannel` (Node 19.9+). Con Node 19 fallan los tres con errores que no
mencionan la versión y despistan mucho.

```bash
node -v    # debe decir v20.x o superior
```

## Arranque

```bash
pnpm install
pnpm build         # compila el front de React a web/
pnpm dev           # dashboard en http://127.0.0.1:4321
```

> **Con pnpm, `better-sqlite3` necesita permiso para ejecutar su postinstall.**
> pnpm bloquea los scripts de instalación por defecto desde la v10, y sin ese
> script el paquete se queda sin su binario nativo: el servidor falla al primer
> import con un error de bindings. Está autorizado en `pnpm-workspace.yaml`
> (`allowBuilds`), que es donde pnpm lo busca cuando hay un workspace — el
> `pnpm.onlyBuiltDependencies` del `package.json` solo se aplica si no lo hay.
>
> Si la instalación ya existía, repárala con `pnpm rebuild better-sqlite3`.
> Con npm no hace falta nada de esto.

Para tocar el front con recarga en caliente, en dos terminales:

```bash
pnpm dev           # API en 4321
pnpm dev:web       # Vite en 5173, con proxy a la API
```

El `build` solo hace falta cuando cambias algo de `client/`. El backend lo
ejecuta tsx directamente, sin compilar.

Con eso basta. El servidor **se alimenta solo**: cada 15 segundos comprueba si
Quantower o los indicadores escribieron algo y, si hay novedades, las ingiere.
La página se refresca sola cada 30 segundos y muestra "en vivo" con la hora de
la última novedad. Dejas esto levantado mientras operas y al terminar la sesión
ya está todo dentro.

`npm run ingest` sigue existiendo para una ingesta puntual sin levantar el
servidor. Es idempotente: se puede lanzar las veces que haga falta sin duplicar
nada.

**Una posición abierta no aparece hasta que se cierra.** Una operación se da por
terminada cuando la posición vuelve a plano, así que mientras tengas algo en
mercado no estará en las métricas. Es correcto: su resultado todavía no existe.

## Configuración

Todo tiene valores por defecto que funcionan en una instalación normal. Se ajusta
por variables de entorno:

| Variable | Por defecto | Para qué |
|---|---|---|
| `QUANTOWER_ROOT` | `C:\Quantower` | raíz de la instalación |
| `QUANTOWER_TRADES_DB` | se busca sola | ruta a `user-trades.db` |
| `JOURNAL_DB` | `./data/journal.db` | nuestra base |
| `CONTEXT_DIR` | `C:\Quantower\journal` | carpeta del log de los indicadores |
| `CONTEXT_BAR_SECONDS` | (vacío) | temporalidad del contexto a usar: `60` para gráficos de 1 minuto |
| `REAL_TRADING_SINCE` | `2026-10-12` | antes de esta fecha son pruebas |
| `MARKET_UTC_OFFSET_HOURS` | `-4` | NY: -4 en verano, -5 en invierno |
| `PORT` | `4321` | puerto del servidor |
| `AUTO_INGEST` | `true` | `false` para desactivar la ingesta automática |
| `AUTO_INGEST_INTERVAL_MS` | `15000` | cada cuánto comprueba si hay novedades |

**`REAL_TRADING_SINCE` importa.** Las operaciones anteriores quedan marcadas como
pruebas y fuera de las métricas. Mezclar pruebas de plataforma con operativa real
distorsiona cualquier conclusión.

**`MARKET_UTC_OFFSET_HOURS` hay que cambiarlo a `-5`** cuando termine el horario de
verano en Nueva York (primer domingo de noviembre), o las sesiones dejarán de
coincidir con las del indicador KillZones.

## Captura de contexto

El indicador `j_Flujo` escribe, **al cerrar cada vela**, el estado del mercado a
`C:\Quantower\journal\context-YYYYMMDD.jsonl`. Se activa con "Guardar contexto
para el diario" en su configuración.

Se graba siempre, no solo cuando operas: sin los momentos en que **no** entraste
no hay ejemplos negativos, y sin ellos no hay forma de distinguir después qué
situaciones valían la pena.

El indicador no sabe nada de posiciones. Solo registra el mercado; el cruce con
tus operaciones lo hace el diario buscando el último snapshot cerrado **antes**
de cada apertura (`src/domain/context.ts`). Nunca el posterior, aunque esté más
cerca: una vela que cerró después de que abrieras contiene información que no
existía cuando decidiste.

### Una sola temporalidad

El indicador escribe al cerrar **cada vela del gráfico donde esté puesto**. Si lo
tienes en varios gráficos a la vez, los snapshots de 1m y de 4h acaban mezclados
en el mismo fichero, y describen cosas distintas: el "rango medio reciente" de un
gráfico de 4h son 200 velas de cuatro horas, o sea mes y medio.

Dos formas de evitarlo, y conviene usar las dos:

- Activar "Guardar contexto para el diario" **solo en el gráfico con el que
  decides** las entradas.
- Fijar `CONTEXT_BAR_SECONDS=60` para que el cruce ignore todo lo que no sea de
  un minuto. Los registros antiguos sin `barSeconds` siguen aceptándose, para no
  invalidar lo ya grabado.

El parámetro "Contexto: mínimo entre escrituras (s)" (30 por defecto) limita el
volumen en gráficos rápidos. Con velas de un minuto o más no tiene efecto.

### Features crudas, no conclusiones

En el JSONL no aparece `"absorcion": true`. Aparecen el delta, el rango de la
vela, el rango medio reciente, el tamaño medio por operación y la forma del
libro. La absorción se **deriva** de ahí en `derive()`, con sus umbrales en el
código del diario.

Esto es lo que permite cambiar de opinión: el día que afinemos qué cuenta como
absorción, se toca una función y los miles de snapshots ya grabados se releen con
la definición nueva. Si se guardara ya calculada, todo el histórico quedaría
inservible.

Una línea cortada (un cierre de Quantower a mitad de escritura) se descarta sola
y el resto del fichero sigue siendo válido.

## Revisión por operación

Cada operación pasa por un motor de reglas (`src/domain/review.ts`) que la marca
con banderas objetivas. Todo lo que sale de ahí es determinista y verificable:
cada bandera dice un hecho medible con su cifra al lado. No hay interpretación ni
narrativa, a propósito — una explicación inventada sobre por qué falló una
entrada se lee igual de bien que una real, y eso es justo lo que la hace
peligrosa.

Las banderas se separan en dos tipos:

- **decisión** — solo miran lo que se podía saber al abrir (reentrada inmediata,
  racha de pérdidas, fuera de killzone, apertura de sesión, número de operación
  del día)
- **resultado** — miran cómo acabó (pérdida fuera de tamaño, se fue en contra al
  instante)

Separarlas evita juzgar una entrada por su desenlace: una buena decisión puede
perder y una mala puede ganar. Los umbrales están en `DEFAULT_REVIEW_CONFIG` y
conviene ajustarlos con los datos en la mano, no por intuición.

El panel "qué cuesta dinero" suma el resultado de las operaciones que llevan cada
bandera. Es la forma de comprobar si una regla captura algo real: si una bandera
acumula P&L positivo, el umbral está mal puesto o la regla no sirve.

## Arquitectura

```
Quantower user-trades.db (SQLite, solo lectura) ─┐
                                                 ├─→ ingestor ─→ journal.db ─→ API ─→ dashboard
indicadores → context.jsonl (pendiente)         ─┘
```

El ingestor no se limita a copiar: reconstruye las operaciones **por ciclos de
posición neta** — una operación empieza cuando la posición sale de cero y termina
cuando vuelve a cero. Emparejar entradas con salidas por orden de llegada parece
equivalente pero no lo es en cuanto hay entradas parciales, y produce duraciones
que no tienen nada que ver con la realidad.

### Tablas

- `fills` — ejecuciones crudas tal como vinieron del broker
- `operations` — operaciones reconstruidas, clasificadas por sesión killzone
- `context_snapshots` — estado del mercado según los indicadores (features crudas, JSON)
- `ingest_runs` — control de ingestas

La detección de novedades mira la fecha de modificación de `user-trades.db`
**y también la de sus ficheros `-wal` y `-shm`**. Con WAL activo —que es como
trabaja Quantower— las escrituras van al `-wal` y el fichero principal puede
quedarse igual durante minutos, así que vigilar solo ese llega tarde.

Los `fills` se guardan sin interpretar a propósito: si mañana cambia la forma de
agrupar operaciones, se recalcula todo desde ahí sin volver a tocar Quantower.

## API

| Endpoint | Devuelve |
|---|---|
| `GET /api/dashboard` | todo de una vez (lo que consume la página) |
| `GET /api/summary` | métricas globales |
| `GET /api/operations` | listado de operaciones |
| `GET /api/breakdown` | desglose por sesión, día, hora y dirección |
| `GET /api/equity` | curva de capital |
| `GET /api/behaviour` | reentradas rápidas tras pérdida y rachas |

Filtros comunes por query string: `from`, `to` (YYYY-MM-DD, fecha de mercado),
`session`, `includeTests=true`.

## Pendiente

1. **Captura de contexto en los indicadores** — que `j_Flujo` escriba a
   `context.jsonl` el estado del order flow en cada vela cerrada y en cada
   apertura o cierre de posición. Es la pieza que convierte esto en algo que
   ninguna plataforma comercial puede dar, y la base de cualquier modelo futuro.
2. Cálculo de etiquetas (MFE/MAE) sobre datos de velas, para tener objetivo
   independiente de cómo se gestionó cada operación.
3. Exportación a Parquet para análisis en Python.

### Dos reglas para que el dataset siga siendo entrenable

Guardar **features crudas, nunca conclusiones**: no `"absorcion": true`, sino el
delta, el rango, el tamaño medio y el estado del libro. La absorción es una
definición nuestra con umbrales que vamos a afinar, y si se guarda ya calculada,
todo el histórico queda inservible al cambiarla.

Registrar también los momentos **sin** operación. Si el log solo tiene las
entradas, no hay ejemplos negativos y no hay forma de aprender a distinguir.
