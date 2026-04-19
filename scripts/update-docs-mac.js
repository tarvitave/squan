const fs = require('fs')

// Update README
let readme = fs.readFileSync('README.md', 'utf8')
if (!readme.includes('macOS')) {
  // Add macOS to the downloads section
  readme = readme.replace(
    '## Download',
    '## Download\n\n| Platform | Download | Size |\n|----------|----------|------|\n| **macOS** (Apple Silicon) | [Squan-0.5.0-arm64.dmg](https://github.com/tarvitave/squan/releases/download/v0.5.0/Squan-0.5.0-arm64.dmg) | 116 MB |\n| **Windows** | Build from source | ~180 MB |\n| **Linux** | Coming soon | — |'
  )
  console.log('Updated README with macOS download')
}

// Also update the description
readme = readme.replace(
  'Windows desktop application',
  'Desktop application (macOS + Windows)'
)

fs.writeFileSync('README.md', readme)

// Update CHANGELOG
let changelog = fs.readFileSync('CHANGELOG.md', 'utf8')
if (!changelog.includes('macOS')) {
  changelog = changelog.replace(
    '## [0.5.0]',
    '## [0.5.0]\n\n### 🍎 macOS Support\n- Apple Silicon (M1/M2/M3/M4) DMG installer\n- tmux-based persistent Claude Code sessions\n- Gatekeeper bypass instructions included\n'
  )
  fs.writeFileSync('CHANGELOG.md', changelog)
  console.log('Updated CHANGELOG with macOS')
}

console.log('Done')
