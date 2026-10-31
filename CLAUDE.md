# CLAUDE.md — lee esto ANTES de tocar nada

Fichero de contexto del proyecto. Claude Code lo carga solo al abrir el repo.
**Está aquí para no tener que reconstruir el contexto cada sesión**: si algo de
lo que hay abajo deja de ser cierto, actualízalo en el momento.

- El README (43 KB) es el manual de la aplicación: **cómo** funciona cada cosa.
- Esto son las reglas de trabajo y las trampas: **qué no hay que volver a hacer**.
- Los documentos del proyecto de claude.ai (`claude/estado-del-sistema.md`,
  `claude/auditoria-cuenta-vs-diario.md`, `claude/hipotesis-medidas-octubre.md`)
  guardan las mediciones completas. Se leen cuando hace falta el detalle
  estadístico, no de rutina.

---

## Quién y cómo

Julian Ruiz (HackChain), Colombia, UTC−5. **Todo en español.** Sin emojis.

Diario de trading personal: Node 20 + TypeScript + Fastify + better-sqlite3 +
React + Vite, más tres indicadores de Quantower en C#.

**Ruta real del repo: `C:\Users\XDX\source\repos\trading-journal`.**
Lista la carpeta destino antes del primer commit de cada sesión.
`device_commit_files` **crea directorios que no existen sin avisar**: una vez se
escribieron diez commits en `...\repos\tj`, una carpeta fantasma, y se perdieron
tres turnos en teorías equivocadas (caché del navegador, build sin ejecutar)
antes de mirar la carpeta. Un commit que "funciona" no prueba que fuera al sitio.

---

## 🔒 Lo que no se toca

**Los tres indicadores de Quantower (KillZones, j_Flujo, j_Guardia) no se
modifican salvo que él lo pida explícitamente.** Ni mejoras, ni limpiezas, ni
«ya que estamos». Los usa a diario y están como él quiere. Él mismo lo dijo:

> «cuando digo que los dejes congelados... no es que no los esté usando, es que
> quiero que sigan como están sin que le hagas modificaciones a menos que te lo
> pida»

Regla autoimpuesta suya: **solo 3 indicadores activos**. No propongas un cuarto.

**El `.env` no se lee nunca.** Tiene sus claves de API. `scripts/doctor.mjs`
informa de si una clave está puesta, jamás de su valor, porque ese informe acaba
pegado en un chat.

---

## Convención de pantalla: verde arriba, rojo abajo

**Petición suya, del 31 de octubre, y vale para todo lo que se haga a partir de
ahora:**

> «resaltar los positivos con los números en verde y los negativos en rojo, eso
> tenerlo siempre presente en todo lo que hagas»

Cualquier cifra que pueda salir positiva o negativa se pinta por signo, con
`signClass()` de `client/src/format.ts` (`pos` / `neg`, y cadena vacía en el
cero exacto). No hace falta inventar clases: ya están en `styles.css` como
`var(--up)` y `var(--down)`.

Dónde ponerla: **en el `<td>` o en el contenedor**, no envolviendo el número en
otro `<span>`. Y si el valor pasa por un helper propio del panel —como el
`pct()` de `GlobalPanel`— el color va dentro del helper, que es lo que evita
tener que acordarse en cada llamada.

**Auditado el 31 de octubre: el resto de la app ya cumplía.** Lo único que
faltaba era la tabla de recuperación del panel de drawdown. Los seis paneles
que no salen en la lista (`MarketPanel`, `GridPanel`, `Diagnosis`, `OpTooltip`,
`OpeningsPanel`, `TrendStrip`) no enseñan dinero con signo.

**Las dos excepciones, las dos a propósito y las dos escritas en pantalla:**

- **Los bonos de News**, que van **sin color**. En un bono subir no es bueno: un
  10 años al alza es viento en contra del Nasdaq, así que el verde diría lo
  contrario de lo que dice el párrafo de al lado. El petróleo, en la misma
  tabla, sí lleva color.
- **`App.tsx`, el porcentaje de jornadas en verde**, que se pinta contra el
  50 % y no contra el cero. Ahí el signo no existe: un 40 % no es «negativo»,
  es malo.

Lo que el color **no** dice nunca es si una cifra es significativa. En la tabla
de recuperación del drawdown las dos cosas no coinciden —hay celdas muy verdes
con p = 0,9— y por eso ese pie lo deja escrito: el color es el signo, el
p-valor y el ✓ son el hallazgo.

---

## Las tres trampas de los ficheros

Cuestan turnos enteros cada vez que se olvidan.

**1. Tu copia local está vieja.** Él edita, y sesiones anteriores también
commitearon. **Antes de editar un fichero, `device_stage_files` y compara**
contra tu copia. Ya ha pasado con `SettingsPanel.tsx` (28.803 bytes locales
contra 29.567 suyos), con `server.ts` (le faltaba un filtro por `calendarDate`
que él había añadido) y con `DayCalendar.tsx` (le faltaba la prop `basis`).
Si no compruebas, pisas trabajo suyo.

**2. CRLF.** Muchos de sus `.ts`/`.tsx` son CRLF; los míos salen LF. Editar y
commitear sin más convierte un cambio de 40 líneas en un diff de 1.500. Flujo
correcto:

```
staged → normalizar a LF → aplicar los cambios → volver a escribir
         con el final de línea que tenía el suyo
```

`client/src/App.tsx` es **mixto** (CRLF con 4 líneas LF sueltas): hay que
restaurar esas cuatro por contenido, no por número de línea.

**3. `expectedMtimeMs` siempre.** Se saca del `device_stage_files`. Si rechaza
el commit, es que él tocó el fichero: re-stage y vuelve a aplicar, no fuerces.

**Y un commit aceptado tampoco es el final.** El 30 de octubre un commit se
escribió bien y media hora después el fichero estaba otra vez como antes, con
un retoque suyo encima (había borrado «y notas» de una pestaña). Pasa cuando
tiene el fichero abierto en el editor y guarda encima, o cuando descarta
cambios en git. Por eso el paso 1 no es opcional ni «por si acaso»: **se
re-stagea y se compara SIEMPRE, también cuando lo commiteaste tú hace veinte
minutos**, y los retoques suyos se respetan al volver a aplicar.

---

## Qué se puede y qué no en este entorno

| | |
|---|---|
| Internet desde el contenedor | **no** (proxy 403 en CONNECT) |
| WebSearch | **desactivado** para su organización (`PROXY_REJECTED`) |
| **Navegador integrado** (`Claude_Browser__*`) | **SÍ**, y es la vía que sí funciona |
| `device_bash` en su PC | **no existe**. Solo leer y escribir ficheros |
| Compilar C# | **no**. No hay .NET SDK |
| Borrar ficheros suyos | **no**. Hay que pedírselo |
| TypeScript | sí, de verdad: `strict` + `noUncheckedIndexedAccess` |
| Playwright + Chromium | sí, en el contenedor |
| Los datos externos | los aporta él (capturas, pegando texto) |

**HAY INTERNET, POR EL NAVEGADOR DE SU PC.** El contenedor está cortado y
WebSearch también, pero el navegador integrado corre dentro de la app de Claude
en su máquina, usa su conexión y **él aprueba cada sitio con un clic** — no pasa
por la política de la organización. Ya están concedidos `data.sec.gov` y
`sec.gov`.

Lo potente no es leer páginas: es `Claude_Browser__javascript_tool`. Abriendo
una página del dominio y lanzando `fetch()` desde ahí (mismo origen) se puede
recorrer una API entera en UNA sola llamada, sin traerse megas de JSON al
contexto. Así se midieron las horas de resultados de las diez empresas: una
navegación y un bucle.

Antes de decir «no tengo acceso a internet», **probar el navegador**.

**Para verificar C# sin compilador**: leer el IL del DLL de Quantower con
`dnfile`, comprobar balance de llaves, contrastar contra código que ya compila,
y **reimplementar el algoritmo en Python sobre los datos reales**. Esa última
destapó que el bucle de C# del picado contaba 29 transiciones donde el Python
contaba 30.

---

## Cómo se verifica aquí

Nada se da por bueno porque "parezca correcto".

```
npx tsc --noEmit && npx tsc --noEmit -p client   # las dos mitades
npx tsx scripts/prueba-pnl.ts                    # 10 casos, resultado de una operacion
npx tsx scripts/prueba-resultados.ts             # 31 casos, informes y alarmas
npx tsx scripts/prueba-scalper.ts                # 18 casos, salida fija por ticks
npx tsx scripts/prueba-drawdown.ts               # 40 casos, drawdown por killzone
npx tsx scripts/prueba-mercado.ts                # 35 casos, bloque de mercado sin red
node scripts/doctor.mjs                          # revision de la instalacion
```

**Banco de pruebas de la pantalla** (sin servidor, con `fetch` falseado):

```
npx vite build -c vite.preview.ts
# luego servir preview-out/ y abrir:
#   ?v=resultados&min=20   alarmas de informes
#   ?v=calendario          el calendario de jornadas
#   ?v=operaciones         el listado y el detalle
#   ?v=news                la tabla de acciones, el petroleo y los bonos
#   ?v=scalper             la salida fija por ticks
#   ?v=alineacion          la alineacion con las medias
#   ?v=drawdown            el drawdown por killzone y los huecos
#   ?v=curva               la curva de capital
#   &reloj=mercado         en cualquiera: pinta en hora de Nueva York
```

Playwright acepta `timezoneId`, así que el reloj local se prueba de verdad:
`newPage({ timezoneId: 'America/Bogota' })` y la misma operación tiene que
salir a las 09:11 en local y a las 10:11 en mercado.

Se conduce con Playwright desde `/opt/npm-tools/node_modules/playwright/index.js`
(es CommonJS: `import pw from ...; const { chromium } = pw`). Esto ha cazado
fallos reales que el typecheck no ve: un modal de alarma que se tragaba el aviso
de la segunda empresa, y tres bugs encadenados en `AlignmentPanel`.

Cuando escribas una prueba nueva, escribe **el caso que la hace fallar**, no el
que la hace pasar.

---

## El método, que es lo que da valor al proyecto

Se han medido diez hipótesis y **ocho han muerto**. Eso es el activo. Las
herramientas que lo consiguieron, y que no se abandonan:

- **Control emparejado por volatilidad**, no al azar. Convirtió `z=8,63` en
  `z=1,40` y mató el hallazgo de la manipulación en aperturas.
- **Benjamini-Hochberg al 10 %** para comparaciones múltiples.
- **Bootstrap por bloques** de 240 velas, y corrección del solape de ventanas.
- **Dentro/fuera de muestra**: el umbral se elige en una mitad, la nota se pone
  en la otra.
- **Buscar la mirada al futuro a propósito.** Ha aparecido dos veces.
- **Dosis-respuesta**: un efecto real se refuerza al subir la condición. Si se
  debilita, es ruido.
- **Meseta**: si solo funciona un valor exacto del parámetro, es suerte.
- **Mediana junto a la media**, y medias recortadas.

> Lección que costó tres iteraciones: con j_Guardia se construyeron teorías
> (reloj desajustado, deadlock del hilo de datos) en vez de mirar el log. **El
> log tenía el error literal desde el principio.** Mirar la evidencia primero.

---

## Hechos del dominio que no se deducen del código

**Contrato MNQ**: 1 tick = 0,25 puntos = **0,50 $**; 1 punto = **2 $**.
Símbolo `F.US.MNQZ26`. Bróker AMP Futures vía CQG, conexión demo.

**La hora de los informes de resultados está MEDIDA, no supuesta.** Sale de los
8-K con ítem 2.02 de EDGAR (`acceptanceDateTime`). La convención única de 16:30
solo valía para Apple: GOOGL publica a las 16:01, MU 16:02, MSFT 16:04, META
16:05, AMZN y TSLA 16:13, AMD 16:16, NVDA 16:21. Con las 16:30 para todas, la
alarma de los 15 minutos sonaba **después** de que cuatro hubieran publicado.
Tabla en `HORA_MEDIDA` (`src/domain/earnings.ts`), re-medible con
`node scripts/medir-horas-resultados.mjs`, que escribe `meta.earnings_hours` y
manda sobre el código.

**El reloj de la pantalla es configurable** (`chart_prefs.clock`, Ajustes >
Gráfico > Reloj), y por defecto es el **local del PC**. Solo presentación: las
killzones, el corte de jornada y las métricas se calculan siempre en hora de
mercado, en el servidor. Existe porque Nueva York cambia de hora dos veces al
año y Colombia no: de marzo a noviembre el diario iba una hora por delante del
reloj de Quantower sin que nada lo dijera. Un único punto de verdad en el
cliente: `displayOffsetAt()` en `client/src/format.ts`. Cualquier hora nueva
que se pinte pasa por ahí, nunca por `toLocaleString` ni por `marketOffsetAt`.

**La jornada rueda a las 18:00 de Nueva York** (`marketDate`), el mismo corte
que la mesa de fondeo. Con el corte a medianoche el **32 %** de las operaciones
caía en el día equivocado. La sesión que abre el domingo por la tarde y cierra
el lunes **es el lunes**; por eso el calendario va de lunes a viernes y no
existe el domingo. `calendarDate` solo donde se quiera el día natural.

**El PnL lo calculamos nosotros, desde los precios.** No se suma el `gross_pnl`
de Quantower: el 28 oct 2026, cerrando 40 contratos a mercado en dos segundos,
dejó ese campo a NULL en cuatro ejecuciones que sí cerraban posición, y se
perdían **622,50 $**. Reconstruido con el flujo de caja del ciclo cuadra al
céntimo con el saldo del bróker (300.000 → 301.490,50). Lo que decía Quantower
se guarda en `operations.broker_pnl` para poder contrastar.

**La demo NO cobra comisión**, confirmado por él contra el saldo. `fills.fee`
llega NULL en las 1.820 ejecuciones. La comisión de `cost_settings` (1 $ por
contrato ida y vuelta) es una **simulación**, encendida a propósito para saber
si una estrategia sobrevive a costes reales. Mientras esté en 1, el total del
diario no coincide con el saldo.

**Cuentas**: `17011740` (la activa) y `17011971` (parada desde el 9 oct,
−1.333 $). No hay una tercera.

**El volumen del histórico es falso.** 69.446 de 69.447 velas anteriores al
8 oct llevan `buy=171 sell=183`, y después sigue pasando en el 52 %. `buy`,
`sell`, `delta`, `buy_trades`, `sell_trades` y `avg_size` **no se pueden usar**
en análisis del histórico. El OHLC sí está limpio (0 velas incoherentes de
80.779). j_Flujo lleva `IsRepeatedVolume` y pinta `VOLUMEN REPETIDO: n velas`:
**cuando entre el dato de pago, ese contador debe caer a cero solo.**

**Línea divisoria: 1 de noviembre de 2026.** Todo lo medido hasta ahí es
periodo de aprendizaje. Ese día: `REAL_TRADING_SINCE=2026-11-01` en el `.env`.

---

## Lo medido: qué sobrevivió

| | estado |
|---|---|
| **Magnitud** (el rango de 15 min varía ×5 según la hora) | **firme** |
| **El picado** (cruces de la EMA21 en 30 min) | **provisional** |
| Order blocks | muerto: 40,7–43,7 % contra 43–48 % al azar |
| Dirección a 15 min | muerto: 0 de 40 pruebas sobreviven a FDR |
| Toques de EMA | muerto: 14 pruebas, ninguna aguanta el control |
| Manipulación en aperturas | muerto: `z=8,63` → `z=1,40` con control |
| Patrones de vela | muerto: 4 hallazgos contra 3,8 esperados por azar |
| Ajustar la vela proyectada por hora | empeora: 91,7 % → 90,0 % |

**El picado no predice al mercado: predice a Julian.** Con 0–4 cruces acierta
el 43,7 %; con 5+, el 20,3 %. Separación −23,5 puntos, `p=0,0004`. **Es un veto,
no una señal**: el rojo quita, el verde no añade. Hay que repetir la medición
entera con 3–4 semanas de noviembre antes de darlo por firme. **No toques el
umbral mientras tanto.**

---

## Dónde está cada cosa

```
src/ingest/      quantower.ts (fills + operaciones + PnL propio), context.ts,
                 market.ts (lo UNICO que sale a internet), calendar.ts, watch.ts
src/domain/      sessions.ts (marketDate/killzones), clock.ts (horario de verano),
                 metrics.ts, review.ts (banderas por operacion), costs.ts,
                 earnings.ts (informes y su convencion horaria), global.ts,
                 instruments.ts, alignment.ts, excursion.ts, study.ts
src/api/server.ts  todas las rutas
src/db/          schema.sql + index.ts (migraciones por PRAGMA table_info)
client/src/      App.tsx y components/
client/preview/  banco de pruebas de pantalla
scripts/         doctor.mjs, prueba-*.ts, compilar-indicadores.cmd,
                 velas-compartidas.mjs, setup-indicators.mjs
```

**Base**: ~188 MB. `context_snapshots` es el **77 %** y es el JSON crudo del que
sale `bars`; lo único que el JSON tiene y la tabla no son doce campos del libro.
Ahí hay un ahorro de ~140 MB esperando a que él decida.

**Migraciones**: `schema.sql` solo vale para instalación nueva. Toda columna
añadida va además como `ALTER TABLE` en `migrate()` de `src/db/index.ts`, y cada
paso tiene que poder ejecutarse mil veces.

**`INSERT OR IGNORE` no actualiza.** Si cambias cómo se calcula algo que ya está
guardado, hace falta una función de re-sellado que corra tras cada ingesta
(`restampReal`, `recomputarPnl`). Sin eso el cambio parece funcionar y las
métricas siguen idénticas, que es el fallo más caro de detectar.

---

## Reglas de Quantower (C#), verificadas en el IL

- Las series se declaran **en el constructor**, nunca en `OnInit`: Quantower
  vuelve a llamar a `OnInit` en cada cambio de ajuste y `AddLineSeries` **añade**.
- `Indicator.SetValue` indexa **sin comprobar límites**. Sin al menos una serie,
  revienta en cada tick. Así se llenó un log de 420 MB en un día.
- `IHistoryItem` **no tiene** OHLC: hay que castear a `HistoryItemBar`.
- `Alert` vive en `TradingPlatform.BusinessLayer.Utils`, que no está en los
  `using` de j_Guardia: hay que cualificarlo entero.
- j_Flujo **no tiene** `using System.Drawing.Drawing2D`: `DashStyle` cualificado.
- `Core.Instance.AdvancedTradingOperations.BreakEven(Position, int offsetTicks,
  string sendingSource)` **ya existe** (clase pública, no documentada en el XML).
- **Clean + Build siempre.** Los ficheros escritos por el puente llegan con
  marcas de tiempo inconsistentes y MSBuild decide por fechas. Los `.csproj`
  apuntan a v1.146.18 con v1.147.8 instalada;
  `scripts\compilar-indicadores.cmd` lo repunta, Visual Studio no.

---

## Pendiente (suyo)

1. Repetir la medición del picado con noviembre.
2. `REAL_TRADING_SINCE=2026-11-01` el día 1.
3. Comprobar que `VOLUMEN REPETIDO` cae a cero con el dato de pago.
4. Borrar `C:\Users\XDX\source\repos\tj` (carpeta fantasma; yo no puedo).
5. `git rm client/src/api-1.ts`.
6. Limpiar la etiqueta `test` (46 usos) y borrar `reentrada en misma vela m15`
   (ya se calcula sola).
7. Decidir QuaEmas en los gráficos 2 y 3; bajar el gráfico de 4h de 1 año a 1 mes.
8. El experimento del log: Quantower con un gráfico limpio, medir el crecimiento,
   y añadir los indicadores de uno en uno.
9. PC de Daniel: instalar j_Flujo en modo silencioso y activar "Guardar contexto
   para el diario" en un gráfico de 1m.

---

## Cómo responderle

Concreto y sin adornos. Las cifras con su unidad y su procedencia. Si algo no se
puede saber con los datos que hay, **se dice**, no se estima. Si una hipótesis
suya no aguanta la medición, se le enseña el número que la tumba.

Lo que más ha servido en este proyecto ha sido **dejar de buscar la cifra que
cuadra y recalcularla desde cero por otro camino**. Así se cerró la auditoría de
la cuenta: en vez de perseguir los 648,50 por el acumulado, se reconstruyó el
resultado entero desde los precios, sin usar el dato que se estaba auditando, y
cuadró al céntimo a la primera.
