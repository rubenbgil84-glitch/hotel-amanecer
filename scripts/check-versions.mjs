#!/usr/bin/env node
// Comprueba las versiones instaladas y las compara con las últimas disponibles.
//   node scripts/check-versions.mjs            -> solo informa
//   node scripts/check-versions.mjs --update   -> además actualiza lo que se puede actualizar solo
import {execSync, spawnSync} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wantUpdate = process.argv.includes("--update");

// Versión mínima que exige este proyecto (Angular 22 pide Node 22.22.3+, 24.15+ o 26+).
const MIN_NODE = "24.15.0";

const run = (cmd) => {
  try {
    return execSync(cmd, {cwd: root, stdio: ["ignore", "pipe", "ignore"]})
      .toString()
      .trim();
  } catch {
    return null;
  }
};
const semver = (text) => text?.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
const compare = (a, b) => {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
const readPkgVersion = (file) =>
  existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).version : null;

// --- Última versión disponible ---
async function latestNodeLts() {
  try {
    const res = await fetch("https://nodejs.org/dist/index.json", {
      signal: AbortSignal.timeout(8000),
    });
    const list = await res.json();
    return semver(list.find((v) => v.lts)?.version);
  } catch {
    return null;
  }
}
const latestNpm = (pkg) => semver(run(`npm view ${pkg} version`));

// --- Versión instalada ---
const globalCli = (() => {
  try {
    const out = run("npm ls -g @angular/cli --depth=0 --json");
    return out
      ? (JSON.parse(out).dependencies?.["@angular/cli"]?.version ?? null)
      : null;
  } catch {
    return null;
  }
})();
const local = (name) =>
  readPkgVersion(
    join(root, "frontend", "node_modules", ...name.split("/"), "package.json"),
  );

const [nodeLatest, npmLatest, cliLatest] = [
  await latestNodeLts(),
  latestNpm("npm"),
  latestNpm("@angular/cli"),
];

const rows = [
  {
    nombre: "Node.js",
    instalada: process.versions.node,
    ultima: nodeLatest,
    minima: MIN_NODE,
  },
  {nombre: "npm", instalada: semver(run("npm -v")), ultima: npmLatest},
  {
    nombre: "Angular CLI (global)",
    instalada: globalCli,
    ultima: cliLatest,
    opcional: true,
  },
  {
    nombre: "Angular CLI (proyecto)",
    instalada: local("@angular/cli"),
    ultima: cliLatest,
    opcional: true,
  },
  {
    nombre: "@angular/core (proyecto)",
    instalada: local("@angular/core"),
    ultima: latestNpm("@angular/core"),
    opcional: true,
  },
  {nombre: "Docker", instalada: semver(run("docker --version")), ultima: null},
  {
    nombre: "Docker Compose",
    instalada: semver(run("docker compose version")),
    ultima: null,
  },
];

function status(r) {
  if (!r.instalada) return r.opcional ? "no instalada" : "FALTA";
  if (r.minima && compare(r.instalada, r.minima) < 0)
    return `INCOMPATIBLE (mínimo ${r.minima})`;
  if (r.ultima && compare(r.instalada, r.ultima) < 0) return "actualizable";
  return r.ultima ? "al día" : "instalada";
}

console.table(
  rows.map((r) => ({
    Componente: r.nombre,
    Instalada: r.instalada ?? "-",
    "Última disponible": r.ultima ?? "no consultada",
    Estado: status(r),
  })),
);
console.log(
  'PostgreSQL 18 corre dentro de Docker: se actualiza con "docker compose pull db".\n',
);

if (!wantUpdate) {
  console.log(
    "Para actualizar lo que se pueda de forma automática: node scripts/check-versions.mjs --update",
  );
  process.exit(0);
}

// --- Actualización ---
const sh = (cmd, cwd = root) => {
  console.log(`\n> ${cmd}`);
  const r = spawnSync(cmd, {cwd, stdio: "inherit", shell: true});
  if (r.status !== 0)
    console.log(
      `  (falló con código ${r.status}; si es un error de permisos, repítelo como administrador)`,
    );
};

const [nodeRow, npmRow, cliRow] = rows;
if (
  npmRow.ultima &&
  npmRow.instalada &&
  compare(npmRow.instalada, npmRow.ultima) < 0
)
  sh("npm install -g npm@latest");
if (
  cliRow.instalada &&
  cliRow.ultima &&
  compare(cliRow.instalada, cliRow.ultima) < 0
)
  sh("npm install -g @angular/cli@latest");

for (const dir of ["backend", "gateway"])
  if (existsSync(join(root, dir, "node_modules")))
    sh("npm update", join(root, dir));
if (existsSync(join(root, "frontend", "node_modules"))) {
  sh(
    "npx ng update @angular/core @angular/cli --allow-dirty",
    join(root, "frontend"),
  );
}
if (run("docker --version")) sh("docker compose pull db");

if (
  compare(nodeRow.instalada, nodeRow.ultima ?? nodeRow.instalada) < 0 ||
  compare(nodeRow.instalada, MIN_NODE) < 0
) {
  console.log(`
Node.js no se actualiza desde este script, porque depende de cómo lo instalaste. Usa el que corresponda:
  nvm (Linux/macOS):   nvm install --lts && nvm alias default 'lts/*'
  nvm-windows:         nvm install lts && nvm use lts
  fnm:                 fnm install --lts && fnm default lts-latest
  Volta:               volta install node@lts
  Windows (winget):    winget upgrade OpenJS.NodeJS.LTS
  macOS (Homebrew):    brew upgrade node
  Instalador oficial:  https://nodejs.org (descarga la versión LTS)
Después abre una terminal nueva y vuelve a ejecutar este script.`);
}
