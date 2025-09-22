# LinkDock: GitHub Releases Setup

## One-time
```bash
git clone https://github.com/TENET808/LinkDock.git
cd LinkDock
# Copy files from this patch into repo root (overwrite package.json, add .github/workflows/release.yml)
git add .
git commit -m "ci: GitHub Releases (nsis + portable) and electron-builder publish"
git push origin main
```

## Release both installers (NSIS + portable)
Increase version in package.json (e.g., 1.2.2), commit, then:
```bash
git tag v1.2.2
git push origin v1.2.2
```
Artifacts will appear in GitHub Releases:
- LinkDock-Setup-1.2.2.exe (with auto-updates)
- LinkDock-1.2.2-portable.exe (no auto-updates)
- latest.yml (auto-update manifest)
