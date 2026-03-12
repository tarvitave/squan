import { useStore } from '../../store/index.js'

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, addTab, removeTab } = useStore((s) => ({
    tabs: s.tabs,
    activeTabId: s.activeTabId,
    setActiveTab: s.setActiveTab,
    addTab: s.addTab,
    removeTab: s.removeTab,
  }))

  return (
    <div style={styles.bar}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          style={{ ...styles.tab, ...(tab.id === activeTabId ? styles.tabActive : {}) }}
          onClick={() => setActiveTab(tab.id)}
        >
          <span style={styles.tabLabel}>{tab.label}</span>
          {tabs.length > 1 && (
            <button
              style={styles.closeBtn}
              onClick={(e) => {
                e.stopPropagation()
                removeTab(tab.id)
              }}
              title="Close tab"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <button
        style={styles.addTab}
        onClick={() => addTab(`Tab ${Date.now().toString(36).slice(-4)}`)}
        title="New tab"
      >
        +
      </button>
    </div>
  )
}

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    background: '#111',
    borderBottom: '1px solid #2d2d2d',
    flexShrink: 0,
    overflowX: 'auto' as const,
    height: 34,
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 12px',
    height: '100%',
    cursor: 'pointer',
    borderRight: '1px solid #2d2d2d',
    color: '#666',
    whiteSpace: 'nowrap' as const,
    userSelect: 'none' as const,
  },
  tabActive: {
    color: '#d4d4d4',
    borderBottom: '2px solid #4ec9b0',
    background: '#0d0d0d',
  },
  tabLabel: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#555',
    cursor: 'pointer',
    fontSize: 10,
    padding: '0 2px',
    lineHeight: 1,
  },
  addTab: {
    background: 'none',
    border: 'none',
    color: '#4ec9b0',
    fontSize: 18,
    cursor: 'pointer',
    padding: '0 10px',
    height: '100%',
  },
}
