# Cataclysm Translator

Cataclysm Translator is a desktop translation tool for Cataclysm-series mods and `lang` workflows.

This repository contains the application source code built with:

- TypeScript renderer
- Tauri (Rust backend)

## Main capabilities

- Extract translatable content from mod files
- Work with `POT`, `PO`, and `MO`
- Support both `CBN` and `CDDA` `lang` workflows
- Batch translation through OpenAI-compatible, Gemini, DeepSeek, SiliconFlow, and custom providers
- Write translations back to files
- Convert Simplified and Traditional Chinese in PO workflows

## Repository layout

```text
source/
|- src/                # TypeScript source
|- app/renderer/       # Generated renderer output
|- scripts/            # Build and helper scripts
|- src-tauri/          # Tauri backend and packaging config
|- package.json
|- tsconfig.json
```

## Requirements

### For frontend / TypeScript build

- Node.js 18+
- npm

### For Tauri desktop build on Windows

- Rust toolchain
- Microsoft Visual C++ build tools / Windows SDK
- WebView2 runtime

## Install

```powershell
npm install
```

## Development

Compile renderer and support files:

```powershell
npm run build
```

Watch TypeScript changes:

```powershell
npm run dev
```

Run Tauri in development mode:

```powershell
npx tauri dev
```

Fast build verification without installer bundling:

```powershell
npx tauri build --debug --no-bundle
```

Full package build:

```powershell
npm run tauri:build
```

## Runtime Python

The Tauri workflow can package a minimal embedded Python runtime.

This project includes a helper script that builds a reduced runtime from the current `python` environment:

```powershell
node scripts/prepare-runtime-python.mjs
```

The generated runtime is written to:

```text
src-tauri/runtime/python
```

This repository is prepared in a form that can include that minimal embedded Python runtime when you want to publish a build-ready source tree.

## Notes on `CBN` and `CDDA`

- `CBN` and `CDDA` use different `lang` toolchains and output conventions
- The app keeps compatibility logic in the application layer instead of modifying upstream external `lang` scripts
- `CDDA` `MO` output uses the `lang/mo/<lang>/LC_MESSAGES/<modid>.mo` layout

## What is intentionally not committed

- `node_modules/`
- `src-tauri/target/`
- generated renderer output under `app/renderer/`
- temporary test folders
- packaged zip files and local artifacts

## Publishing suggestion

- Keep source code in this repository
- Publish `.exe` installer builds through GitHub Releases
- Treat additional package formats as optional, not primary

## License

This repository is licensed under GPL-3.0. See [LICENSE](/E:/project/code/cataclysm_translator/source/LICENSE).
