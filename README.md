# InvoiceVault

Desktop app for managing Vietnamese VAT invoices (hoa don GTGT). Watches folders for accounting documents (PDF, Excel, CSV, XML), auto-extracts structured data via AI, and stores results in a local SQLite database.

Built with Electron + TypeScript + React. Runs as a tray app with a Spotlight-style search overlay.

## Getting Started

```bash
pnpm install        # Install dependencies
pnpm start          # Launch in dev mode
```

## Building

```bash
pnpm run package    # Package the app
pnpm run make       # Build platform-specific installers (DMG, EXE, etc.)
```

## Testing

```bash
pnpm test           # Run tests (Vitest)
pnpm test:watch     # Run tests in watch mode
pnpm test:e2e       # Run end-to-end tests (Playwright)
```

## Releasing a New Version

The project uses a GitHub Actions workflow that automatically builds installers for **macOS (arm64 + x64)** and **Windows (x64)** when a version tag is pushed. It then creates a GitHub Release with all artifacts attached.

### Step-by-step

1. **Bump the version** in `package.json`:

   ```bash
   # Either edit package.json manually, or use npm version:
   npm version patch   # 1.0.0 → 1.0.1
   npm version minor   # 1.0.0 → 1.1.0
   npm version major   # 1.0.0 → 2.0.0
   ```

   `npm version` automatically creates a git commit and a `v*` tag.

2. **Push the commit and tag**:

   ```bash
   git push origin main --follow-tags
   ```

   This pushes both the version bump commit and the tag (e.g. `v1.0.1`) in one command.

3. **Watch the build**: Go to the [Actions tab](https://github.com/lesslucifer/InvPdfExtract/actions) to monitor progress. The workflow builds on 3 runners in parallel:

   | Runner | Platform | Artifact |
   |--------|----------|----------|
   | `macos-latest` | macOS arm64 | `.dmg` |
   | `macos-13` | macOS x64 | `.dmg` |
   | `windows-latest` | Windows x64 | `.exe` / `.nupkg` |

4. **Download the release**: Once all builds pass, a GitHub Release is automatically created at [Releases](https://github.com/lesslucifer/InvPdfExtract/releases) with auto-generated release notes and all installers attached.

### Creating a tag manually (without npm version)

```bash
git tag v1.2.0
git push origin v1.2.0
```

### Triggering a build without a tag

The workflow also supports `workflow_dispatch`, so you can trigger it manually from the Actions tab without creating a tag. Note: this will build artifacts but **will not** create a GitHub Release (releases only happen for `v*` tags).

### Code signing (optional)

To produce signed/notarized builds, add these secrets in your repo settings (**Settings → Secrets and variables → Actions**):

| Secret | Purpose |
|--------|---------|
| `APPLE_IDENTITY` | macOS signing identity |
| `APPLE_ID` | Apple ID email for notarization |
| `APPLE_ID_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `WIN_CERT_FILE` | Windows code signing certificate (base64) |
| `WIN_CERT_PASSWORD` | Certificate password |

Without these secrets, builds will still succeed — they just won't be signed.

## License

MIT
