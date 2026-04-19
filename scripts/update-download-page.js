const fs = require('fs')
const f = 'C:\\Users\\colin\\squan-www\\src\\pages\\Download.jsx'
let c = fs.readFileSync(f, 'utf8')

// Replace the macOS "Coming Soon" section with an active download card
const oldMac = `            className="bg-dark-800 rounded-xl p-6 border border-dark-700 opacity-60"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Apple className="w-6 h-6 text-dark-400" />
                <h3 className="text-xl font-bold text-dark-300">macOS</h3>
              </div>
              <div className="flex items-center gap-2 px-3 py-1 bg-dark-700 text-dark-400 rounded-full text-sm">
                <Clock className="w-4 h-4" />
                Coming Soon
              </div>
            </div>
            <p className="text-dark-400 text-sm">
              Native builds for Apple Silicon and Intel in development
            </p>`

const newMac = `            className="bg-dark-800 rounded-xl p-6 border border-dark-700"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Apple className="w-6 h-6 text-primary-400" />
                <h3 className="text-xl font-bold text-white">macOS</h3>
              </div>
              <div className="flex items-center gap-2 px-3 py-1 bg-green-500/10 text-green-400 rounded-full text-sm">
                <Check className="w-4 h-4" />
                Available
              </div>
            </div>
            <p className="text-dark-300 text-sm mb-4">
              Apple Silicon (M1/M2/M3/M4) native build. Uses tmux for persistent Claude Code sessions.
            </p>
            <button
              onClick={() => window.open('https://github.com/tarvitave/squan/releases/download/v0.5.0/Squan-0.5.0-arm64.dmg')}
              className="w-full px-4 py-3 bg-dark-700 text-white rounded-lg hover:bg-dark-600 transition-all duration-200 font-medium flex items-center justify-center gap-2 text-sm"
            >
              <DownloadIcon className="w-4 h-4" />
              Download DMG (116 MB)
            </button>
            <p className="text-xs text-dark-500 text-center mt-2">
              Apple Silicon • macOS 12+ • v0.5.0
            </p>
            <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <div className="text-xs text-dark-300">
                <strong className="text-yellow-400">First time?</strong> Right-click → Open → Open. Or run: <code className="text-primary-400">xattr -cr Squan.app</code>
              </div>
            </div>`

if (c.includes(oldMac)) {
  c = c.replace(oldMac, newMac)
  console.log('Updated macOS card to Available + download')
} else {
  console.log('macOS card not found')
}

// Update the section header
c = c.replace('{/* Coming Soon - macOS & Linux */}', '{/* macOS & Linux */}')

fs.writeFileSync(f, c)
console.log('Done')
