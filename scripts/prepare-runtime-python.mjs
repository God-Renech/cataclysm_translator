import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { basename, dirname, join, normalize, relative, resolve, sep } from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const runtimeRoot = join(projectRoot, "src-tauri", "runtime");
const runtimePythonRoot = join(runtimeRoot, "python");
const REQUIRED_DISTRIBUTIONS = ["polib", "luaparser"];
const EXCLUDED_SITE_PACKAGE_PREFIXES = [
  "pip",
  "pip-",
  "setuptools",
  "setuptools-",
  "wheel",
  "wheel-",
  "pkg_resources",
  "__pycache__",
];
const EXCLUDED_PATH_PARTS = new Set([
  "__pycache__",
  "tests",
  "test",
  "testing",
  "idle_test",
  "ensurepip",
  "tkinter",
  "turtledemo",
  "lib2to3",
  "unittest",
  "distutils",
  "site-packages/pip",
  "site-packages/setuptools",
  "site-packages/wheel",
]);
const PYTHON_DLL_NAMES = ["python3.dll", "python312.dll", "vcruntime140.dll", "vcruntime140_1.dll"];

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    stdio: options.stdio ?? "pipe",
    encoding: "utf8",
    env: options.env ?? process.env,
  });
  if (result.error) {
    throw result.error;
  }
  const code = result.status ?? 1;
  if (!options.allowFail && code !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    throw new Error(
      `Command failed (${code}): ${command} ${args.join(" ")}\n${stderr || stdout}`.trim()
    );
  }
  return result;
}

export function normalizeRelativePath(value) {
  return normalize(value).replaceAll("\\", "/");
}

function pathHasExcludedPart(relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath);
  if (normalizedPath.endsWith(".pyc") || normalizedPath.endsWith(".pyo")) {
    return true;
  }
  const segments = normalizedPath.split("/").filter(Boolean);
  return segments.some((segment, index) => {
    if (EXCLUDED_PATH_PARTS.has(segment)) {
      return true;
    }
    const partial = segments.slice(index).join("/");
    return EXCLUDED_PATH_PARTS.has(partial);
  });
}

function shouldExcludeSitePackagePath(relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath);
  if (pathHasExcludedPart(normalizedPath)) {
    return true;
  }
  const lower = normalizedPath.toLowerCase();
  return EXCLUDED_SITE_PACKAGE_PREFIXES.some((prefix) => lower.startsWith(prefix.toLowerCase() + "/"));
}

function shouldExcludeStdlibPath(relativePath) {
  return pathHasExcludedPart(relativePath);
}

function listFilesRecursive(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function uniqueEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = normalizeRelativePath(entry.relativeTargetPath);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function loadPythonContext(pythonExe) {
  const probeCode = `
import importlib.metadata as metadata
import json
import os
import sys
import sysconfig

required = ["polib", "luaparser"]
payload = {
  "executable": sys.executable,
  "base_executable": getattr(sys, "_base_executable", sys.executable),
  "prefix": sys.prefix,
  "base_prefix": sys.base_prefix,
  "stdlib": sysconfig.get_path("stdlib"),
  "platstdlib": sysconfig.get_path("platstdlib"),
  "purelib": sysconfig.get_path("purelib"),
  "platlib": sysconfig.get_path("platlib"),
  "scripts": sysconfig.get_path("scripts"),
  "distributions": {},
}
for name in required:
  dist = metadata.distribution(name)
  payload["distributions"][name] = {
    "name": dist.metadata["Name"],
    "requires": dist.requires or [],
    "files": [str(file) for file in (dist.files or [])],
    "location": str(dist.locate_file("")),
  }
print(json.dumps(payload, ensure_ascii=False))
`;
  const result = runCommand(pythonExe, ["-c", probeCode]);
  return JSON.parse(result.stdout.trim());
}

function resolveDependencyGraph(context) {
  const queue = [...REQUIRED_DISTRIBUTIONS];
  const resolved = new Map();
  while (queue.length > 0) {
    const distributionName = queue.shift();
    if (resolved.has(distributionName)) {
      continue;
    }
    const result = runCommand(context.executable, [
      "-c",
      `
import importlib.metadata as metadata
import json
try:
  dist = metadata.distribution(${JSON.stringify(distributionName)})
except metadata.PackageNotFoundError:
  print(json.dumps({"missing": True}, ensure_ascii=False))
else:
  print(json.dumps({
    "name": dist.metadata["Name"],
    "requires": dist.requires or [],
    "files": [str(file) for file in (dist.files or [])],
    "location": str(dist.locate_file("")),
  }, ensure_ascii=False))
      `,
    ]);
    const distribution = JSON.parse(result.stdout.trim());
    if (distribution.missing) {
      continue;
    }
    resolved.set(distribution.name.toLowerCase(), distribution);
    for (const requirement of distribution.requires || []) {
      const normalized = requirement.split(/[ ;(<>=!~\[]/, 1)[0].trim();
      if (normalized) {
        queue.push(normalized);
      }
    }
  }
  return [...resolved.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function buildCoreFileEntries(context) {
  const entries = [];
  const baseDir = dirname(context.base_executable);
  const stdlibDir = context.stdlib;
  const dllsDir = join(dirname(stdlibDir), "DLLs");
  const pythonExe = context.base_executable;
  const pythonwExe = join(baseDir, "pythonw.exe");

  entries.push({
    sourcePath: pythonExe,
    relativeTargetPath: "python.exe",
    kind: "core",
  });
  if (existsSync(pythonwExe)) {
    entries.push({
      sourcePath: pythonwExe,
      relativeTargetPath: "pythonw.exe",
      kind: "core",
    });
  }

  for (const dllName of PYTHON_DLL_NAMES) {
    const dllPath = join(baseDir, dllName);
    if (existsSync(dllPath)) {
      entries.push({
        sourcePath: dllPath,
        relativeTargetPath: dllName,
        kind: "core",
      });
    }
  }

  if (existsSync(dllsDir)) {
    for (const file of listFilesRecursive(dllsDir)) {
      const rel = relative(dllsDir, file);
      if (shouldExcludeStdlibPath(rel)) {
        continue;
      }
      entries.push({
        sourcePath: file,
        relativeTargetPath: join("DLLs", rel),
        kind: "dll",
      });
    }
  }

  for (const file of listFilesRecursive(stdlibDir)) {
    const rel = relative(stdlibDir, file);
    if (shouldExcludeStdlibPath(rel)) {
      continue;
    }
    entries.push({
      sourcePath: file,
      relativeTargetPath: join("Lib", rel),
      kind: "stdlib",
    });
  }

  return uniqueEntries(entries);
}

export function buildSitePackageEntries(context, distributions) {
  const sitePackagesRoot = context.purelib;
  const entries = [];
  for (const distribution of distributions) {
    for (const file of distribution.files || []) {
      const relativePath = normalizeRelativePath(file);
      if (!relativePath || relativePath.startsWith("../../Scripts/")) {
        continue;
      }
      if (shouldExcludeSitePackagePath(relativePath)) {
        continue;
      }
      const sourcePath = resolve(sitePackagesRoot, relativePath);
      if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
        continue;
      }
      entries.push({
        sourcePath,
        relativeTargetPath: join("Lib", "site-packages", relativePath),
        distributionName: distribution.name,
        kind: "site-package",
      });
    }
  }
  return uniqueEntries(entries);
}

export function collectRuntimePlanFromContext(context, distributions) {
  return {
    python: context,
    distributions,
    coreFiles: buildCoreFileEntries(context),
    sitePackagesEntries: buildSitePackageEntries(context, distributions),
  };
}

export async function collectRuntimePlan({ pythonExe = "python" } = {}) {
  const context = loadPythonContext(pythonExe);
  const distributions = resolveDependencyGraph(context);
  return collectRuntimePlanFromContext(context, distributions);
}

function copyEntries(entries, targetRoot) {
  for (const entry of entries) {
    const destination = join(targetRoot, entry.relativeTargetPath);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(entry.sourcePath, destination, { force: true });
  }
}

function writePythonPathBootstrap(targetRoot) {
  const pthPath = join(targetRoot, "python312._pth");
  const lines = [
    "python312.zip",
    ".",
    "DLLs",
    "Lib",
    "Lib/site-packages",
    "import site",
    "",
  ];
  writeFileSync(pthPath, lines.join("\r\n"), "utf8");
}

function validateRuntime(targetRoot) {
  const runtimePythonExe = join(targetRoot, "python.exe");
  const code = `
import polib
import luaparser
print("runtime-ok")
`;
  const result = runCommand(runtimePythonExe, ["-c", code]);
  if (!result.stdout.includes("runtime-ok")) {
    throw new Error("Runtime validation did not complete successfully.");
  }
}

export async function prepareRuntimePython({ pythonExe = "python", outputDir = runtimePythonRoot } = {}) {
  const plan = await collectRuntimePlan({ pythonExe });
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  copyEntries(plan.coreFiles, outputDir);
  copyEntries(plan.sitePackagesEntries, outputDir);
  writePythonPathBootstrap(outputDir);
  validateRuntime(outputDir);
  return plan;
}

function isDirectExecution() {
  const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
  return entryPath === __filename;
}

if (isDirectExecution()) {
  prepareRuntimePython()
    .then((plan) => {
      const summary = {
        python: plan.python.executable,
        distributions: plan.distributions.map((distribution) => distribution.name),
        coreFileCount: plan.coreFiles.length,
        sitePackageFileCount: plan.sitePackagesEntries.length,
      };
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
