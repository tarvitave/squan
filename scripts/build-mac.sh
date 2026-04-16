#!/bin/bash
set -e

echo "🍎 Building Squan for macOS..."
echo ""

# Check we're on macOS
if [[ "$(uname)" != "Darwin" ]]; then
  echo "❌ This script must be run on macOS"
  exit 1
fi

# Check for required tools
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Install from https://nodejs.org"
  exit 1
fi

if ! command -v git &> /dev/null; then
  echo "❌ Git not found. Install with: xcode-select --install"
  exit 1
fi

cd "$(dirname "$0")/.."
PROJECT_ROOT=$(pwd)
echo "📁 Project root: $PROJECT_ROOT"

# Step 1: Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Step 2: Build client
echo ""
echo "🎨 Building client..."
cd client && npx vite build && cd ..

# Step 3: Build server
echo ""
echo "⚙️  Building server..."
cd server && npx tsc && cd ..

# Step 4: Package server for Electron
echo ""
echo "📦 Packaging server..."
if [ -f "scripts/package-server.mjs" ]; then
  node scripts/package-server.mjs
else
  # Manual server packaging
  rm -rf dist-server
  mkdir -p dist-server/dist
  cp -r server/dist/* dist-server/dist/
  cp server/package.json dist-server/
  cd dist-server && npm install --omit=dev && cd ..
fi

# Step 5: Generate macOS icon if missing
if [ ! -f "assets/icon.icns" ]; then
  echo ""
  echo "🎨 Generating macOS icon..."
  if [ -f "assets/icon.png" ]; then
    # Create iconset from PNG
    ICONSET="assets/icon.iconset"
    mkdir -p "$ICONSET"
    sips -z 16 16     assets/icon.png --out "$ICONSET/icon_16x16.png"
    sips -z 32 32     assets/icon.png --out "$ICONSET/icon_16x16@2x.png"
    sips -z 32 32     assets/icon.png --out "$ICONSET/icon_32x32.png"
    sips -z 64 64     assets/icon.png --out "$ICONSET/icon_32x32@2x.png"
    sips -z 128 128   assets/icon.png --out "$ICONSET/icon_128x128.png"
    sips -z 256 256   assets/icon.png --out "$ICONSET/icon_128x128@2x.png"
    sips -z 256 256   assets/icon.png --out "$ICONSET/icon_256x256.png"
    sips -z 512 512   assets/icon.png --out "$ICONSET/icon_256x256@2x.png"
    sips -z 512 512   assets/icon.png --out "$ICONSET/icon_512x512.png"
    sips -z 1024 1024 assets/icon.png --out "$ICONSET/icon_512x512@2x.png"
    iconutil -c icns "$ICONSET" -o assets/icon.icns
    rm -rf "$ICONSET"
    echo "✅ Created assets/icon.icns"
  else
    echo "⚠️  No icon.png found — app will use default Electron icon"
    echo "   Add a 1024x1024 PNG at assets/icon.png and re-run"
  fi
fi

# Step 6: Package with Electron Forge
echo ""
echo "📦 Packaging Electron app..."

# Detect architecture
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  ELECTRON_ARCH="arm64"
  echo "   Architecture: Apple Silicon (arm64)"
elif [ "$ARCH" = "x86_64" ]; then
  ELECTRON_ARCH="x64"
  echo "   Architecture: Intel (x64)"
else
  ELECTRON_ARCH="universal"
  echo "   Architecture: Universal"
fi

npx electron-forge package --platform darwin --arch "$ELECTRON_ARCH"

# Step 7: Create DMG
echo ""
echo "💿 Creating DMG installer..."
npx electron-forge make --platform darwin --arch "$ELECTRON_ARCH" --targets @electron-forge/maker-dmg

# Done!
echo ""
echo "════════════════════════════════════════════════"
echo "  ✅ Build complete!"
echo ""
echo "  📁 App:  out/Squan-darwin-${ELECTRON_ARCH}/Squan.app"

DMG_FILE=$(find out/make -name "*.dmg" 2>/dev/null | head -1)
if [ -n "$DMG_FILE" ]; then
  DMG_SIZE=$(du -h "$DMG_FILE" | cut -f1)
  echo "  💿 DMG:  $DMG_FILE ($DMG_SIZE)"
  echo ""
  echo "  To upload to GitHub Releases:"
  echo "    gh release upload v0.5.0 \"$DMG_FILE\" --repo tarvitave/squan"
fi

echo ""
echo "  To test:"
echo "    open out/Squan-darwin-${ELECTRON_ARCH}/Squan.app"
echo "════════════════════════════════════════════════"
