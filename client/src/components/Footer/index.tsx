export function Footer() {
  return (
    <div style={styles.footer}>
      <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={styles.link}>Privacy</a>
      <span style={styles.sep}>·</span>
      <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={styles.link}>Terms</a>
      <span style={styles.sep}>·</span>
      <a href="https://squansq.com/blog" target="_blank" rel="noopener noreferrer" style={styles.link}>Blog</a>
      <span style={styles.sep}>·</span>
      <span style={styles.copy}>© {new Date().getFullYear()} Squansq</span>
    </div>
  )
}

const styles = {
  footer: {
    padding: '8px',
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '2px 0',
    alignItems: 'center',
    borderTop: '1px solid #2d2d2d',
    flexShrink: 0,
  },
  link: {
    color: '#555',
    fontSize: 10,
    fontFamily: 'monospace',
    textDecoration: 'none',
  },
  sep: {
    color: '#333',
    fontSize: 10,
    margin: '0 4px',
  },
  copy: {
    color: '#444',
    fontSize: 10,
    fontFamily: 'monospace',
  },
}
