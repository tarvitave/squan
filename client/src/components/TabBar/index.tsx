import { useState, useRef, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import { cn } from '../../lib/utils.js'
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
    if (name === null) return
    addTab(name.trim() || 'New Tab')
  }

  return (
    <div className="flex items-center bg-bg-primary border-b border-border-primary shrink-0 overflow-x-auto h-[34px]">
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
      <button
        className="bg-transparent border-none text-block-teal text-lg cursor-pointer px-2.5 h-full hover:text-[#6ee0c8]"
        onClick={handleAdd}
        title="New tab"
      >
        <Plus className="w-4 h-4" />
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
      className={cn(
        'flex items-center gap-1.5 px-3 h-full cursor-pointer border-r border-border-primary whitespace-nowrap select-none',
        active ? 'text-text-primary border-b-2 border-b-block-teal bg-bg-primary' : 'text-text-tertiary'
      )}
      onClick={onActivate}
    >
      {editing ? (
        <input
          ref={inputRef}
          className="bg-bg-primary border border-block-teal text-text-primary text-xs font-mono px-1 py-px rounded-sm outline-none w-[100px]"
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
          className="text-xs font-mono"
          onDoubleClick={(e) => { e.stopPropagation(); onStartEdit() }}
          title="Double-click to rename"
        >
          {tab.label}
        </span>
      )}
      {onClose && (
        <button
          className="bg-transparent border-none text-text-tertiary cursor-pointer p-0 leading-none hover:text-text-danger"
          onClick={(e) => { e.stopPropagation(); onClose() }}
          title="Close tab"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  )
}
