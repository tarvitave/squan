export function Footer() {
  return (
    <footer className="flex items-center justify-center gap-2 py-2 text-text-tertiary">
      <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="text-text-tertiary text-[10px] no-underline hover:text-text-secondary">
        Privacy
      </a>
      <span className="text-text-disabled text-[10px]">·</span>
      <a href="/terms.html" target="_blank" rel="noopener noreferrer" className="text-text-tertiary text-[10px] no-underline hover:text-text-secondary">
        Terms
      </a>
      <span className="text-text-disabled text-[10px]">·</span>
      <a href="https://squan.dev" target="_blank" rel="noopener noreferrer" className="text-text-tertiary text-[10px] no-underline hover:text-text-secondary">
        squan.dev
      </a>
      <span className="text-text-disabled text-[10px]">·</span>
    </footer>
  )
}
