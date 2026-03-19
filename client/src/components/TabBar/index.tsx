import { useState, useRef, useEffect } from 'react'
import { useStore } from '../../store/index.js'

export function TabBar() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const addTab = useStore((s) => s.addTab)
  const removeTab = useStore((s) => s.removeTab)
  const [editingId, setEditingId] = useState<string | null>(null)

  const handleAdd = () => {
    const name = window.prompt('Tab name:', 'New Tab')
    if (name === null) return // cancelled
    addTab(name.trim() || 'New Tab')
  }

  return (
    <div style={styles.bar}>
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          active={tab.id === activeTabId}
          editing={editingId === tab.id}
          onActivate={() => setActiveTab(tab.id)}
          onClose={tabs.length > 1 ? () => removeTab(tab.id) : undefined}
          onStartEdit={() => setEditingId(tab.id)}
          onEndEdit={() => setEditingId(null)}
        />
      ))}
      <button style={styles.addTab} onClick={handleAdd} title="New tab">
        +
      </button>
    </div>
  )
}

interface TabItemProps {
  tab: { id: string; label: string }
  active: boolean
  editing: boolean
  onActivate: () => void
  onClose?: () => void
  onStartEdit: () => void
  onEndEdit: () => void
}

function TabItem({ tab, active, editing, onActivate, onClose, onStartEdit, onEndEdit }: TabItemProps) {
  const updateTabLabel = useStore((s) => s.updateTabLabel)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = (value: string) => {
    const trimmed = value.trim()
    if (trimmed) updateTabLabel(tab.id, trimmed)
    onEndEdit()
  }

  return (
    <div
      style={{ ...styles.tab, ...(active ? styles.tabActive : {}) }}
      onClick={onActivate}
    >
      {editing ? (
        <input
          ref={inputRef}
          style={styles.editInput}
          defaultValue={tab.label}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(e.currentTarget.value)
            if (e.key === 'Escape') onEndEdit()
            e.stopPropagation()
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          style={styles.tabLabel}
          onDoubleClick={(e) => { e.stopPropagation(); onStartEdit() }}
          title="Double-click to rename"
        >
          {tab.label}
        </span>
      )}
      {onClose && (
        <button
          style={styles.closeBtn}
          onClick={(e) => { e.stopPropagation(); onClose() }}
          title="Close tab"
        >
          ✕
        </button>
      )}
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
  editInput: {
    background: '#0d0d0d',
    border: '1px solid #4ec9b0',
    color: '#d4d4d4',
    fontSize: 12,
    fontFamily: 'monospace',
    padding: '1px 4px',
    borderRadius: 2,
    outline: 'none',
    width: 100,
  } as React.CSSProperties,
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
