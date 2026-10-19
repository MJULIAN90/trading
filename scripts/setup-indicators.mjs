#!/usr/bin/env node
/**
 * Reapunta los proyectos de los indicadores a la instalacion de Quantower de
 * ESTA maquina.
 *
 * Los .csproj llevan dos rutas absolutas con el numero de version dentro:
 *
 *   <HintPath>C:\Quantower\TradingPlatform\v1.146.18\bin\...BusinessLayer.dll
 *   <OutputPath>C:\Quantower\...\Settings\Scripts\Indicators\j_Flujo
 *
 * Visual Studio las necesita, pero cambian con cada actualizacion de Quantower
 * y con cada ordenador. En otro PC el proyecto no compila y el error habla de
 * una referencia que falta, no de la ruta, asi que cuesta de ver. Esto las
 * reescribe solas buscando la version instalada.
 *
 *   node scripts/setup-indicators.mjs [--repos <ruta>] [--quantower <ruta>] [--dry]
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const dry = args.includes('--dry');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Por defecto los indicadores son hermanos del diario: ...\repos\trading-journal
// y ...\repos\j_flujo.
const repos = resolve(flag('repos', resolve(ROOT, '..')));
const qwRoot = resolve(flag('quantower', process.env.QUANTOWER_ROOT ?? 'C:\\Quantower'));

const platform = join(qwRoot, 'TradingPlatform');

if (!existsSync(platform)) {
  console.error(`No encuentro ${platform}`);
  console.error('Pasa la ruta buena con:  node scripts/setup-indicators.mjs --quantower "D:\\Quantower"');
  process.exit(1);
}

/**
 * La carpeta de version se llama v1.146.18 y similares. Si hay varias (pasa al
 * actualizar sin limpiar) se coge la MAYOR comparando numero a numero, no
 * alfabeticamente: en texto, "v1.9" va despues de "v1.146".
 */
const versions = readdirSync(platform, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^v\d+(\.\d+)*$/.test(d.name))
  .map((d) => d.name)
  .sort((a, b) => {
    const pa = a.slice(1).split('.').map(Number);
    const pb = b.slice(1).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });

if (versions.length === 0) {
  console.error(`No hay ninguna carpeta de version dentro de ${platform}`);
  process.exit(1);
}

const version = versions[versions.length - 1];
const businessLayer = join(platform, version, 'bin', 'TradingPlatform.BusinessLayer.dll');

if (!existsSync(businessLayer)) {
  console.error(`La version ${version} no tiene ${businessLayer}`);
  process.exit(1);
}

console.log(`Quantower: ${qwRoot}`);
console.log(`Version:   ${version}${versions.length > 1 ? `  (habia ${versions.length}, cojo la mayor)` : ''}`);
console.log(`Proyectos: ${repos}`);
console.log('');

const INDICATORS = [
  { name: 'j_Flujo', dirs: ['j_flujo', 'j_Flujo'] },
  { name: 'KillZones', dirs: ['KillZones'] },
  { name: 'QuaEmas', dirs: ['QuaEmas'] },
  { name: 'j_Guardia', dirs: ['j_Guardia', 'j_guardia'] },
];

let changed = 0;
let missing = 0;

for (const ind of INDICATORS) {
  const dir = ind.dirs.map((d) => join(repos, d)).find((d) => existsSync(d));

  if (!dir) {
    console.log(`  ${ind.name}: no encuentro la carpeta del proyecto, lo salto`);
    missing++;
    continue;
  }

  const csproj = join(dir, `${ind.name}.csproj`);
  if (!existsSync(csproj)) {
    console.log(`  ${ind.name}: no hay ${ind.name}.csproj en ${dir}, lo salto`);
    missing++;
    continue;
  }

  const before = readFileSync(csproj, 'utf8');
  const output = join(qwRoot, 'Settings', 'Scripts', 'Indicators', ind.name);

  const after = before
    .replace(/<HintPath>[^<]*<\/HintPath>/g, `<HintPath>${businessLayer}</HintPath>`)
    .replace(/<OutputPath>[^<]*<\/OutputPath>/g, `<OutputPath>${output}</OutputPath>`);

  if (after === before) {
    console.log(`  ${ind.name}: ya estaba bien`);
    continue;
  }

  if (dry) {
    console.log(`  ${ind.name}: CAMBIARIA ${csproj}`);
  } else {
    writeFileSync(csproj, after, 'utf8');
    console.log(`  ${ind.name}: actualizado`);
  }
  changed++;
}

console.log('');
if (dry) console.log('Prueba en seco, no se ha escrito nada. Quita --dry para aplicarlo.');
else if (changed === 0) console.log('No habia nada que cambiar.');
else console.log(`${changed} proyecto(s) actualizados. Abrelos en Visual Studio y compila en Release.`);

if (missing > 0) {
  console.log(`${missing} indicador(es) sin carpeta. Si estan en otro sitio:  --repos "<ruta>"`);
}
