const fs = require('fs')
const f = 'client/src/components/ClaudeCodeView/index.tsx'
let c = fs.readFileSync(f, 'utf8')

// Add CSS import at top
if (!c.includes("import 'xterm/css/xterm.css'")) {
  c = "import 'xterm/css/xterm.css'\n" + c
  console.log('Added xterm CSS import')
}

// Remove the inline style tag
c = c.replace(
  `      {/* Import xterm CSS */}
      <style>{\`
        @import url('node_modules/xterm/css/xterm.css');
        .xterm { height: 100% !important; }
        .xterm-viewport { overflow-y: auto !important; }
      \`}</style>`,
  ''
)
console.log('Removed inline xterm CSS')

fs.writeFileSync(f, c)
console.log('Done')
