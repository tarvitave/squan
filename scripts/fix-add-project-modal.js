const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '..', 'client', 'src', 'components', 'Sidebar', 'index.tsx')
const lines = fs.readFileSync(file, 'utf8').split('\n')

// Find start: line containing "Add Project Panel"
const startIdx = lines.findIndex(l => l.includes('Add Project Panel'))
// Find end: the line with just "      )}" after the panel, before "Navigation"
const navIdx = lines.findIndex(l => l.includes('Navigation'))
// The closing "      )}" is 2 lines before Navigation comment
const endIdx = navIdx - 1  // blank line before navigation
// Actually find the exact `)}`
let closeIdx = startIdx
for (let i = navIdx - 1; i > startIdx; i--) {
  if (lines[i].trim() === ')}') { closeIdx = i; break }
}

console.log(`Replacing lines ${startIdx + 1} to ${closeIdx + 1} (${closeIdx - startIdx + 1} lines)`)

const modal = `      {/* ── Add Project Modal ────────────────────────────── */}
      {showAddProject && (
        <>
          {/* Backdrop */}
          <div
            style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000 }}
            onClick={closeAddProject}
          />
          {/* Modal */}
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 1001,
            width: 580, maxWidth: '90vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column',
            backgroundColor: '#ffffff', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #e3e6ea', flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#3f434b' }}>Add Project</div>
                <div style={{ fontSize: 12, color: '#a7b0b9', marginTop: 2 }}>Choose a GitHub repo, create a new one, or enter a URL</div>
              </div>
              <button onClick={closeAddProject} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#a7b0b9', padding: 4, borderRadius: 6 }}
                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#f4f6f7')}
                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>

            {/* Mode tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e3e6ea', flexShrink: 0, padding: '0 20px' }}>
              {(['pick', 'create', 'url'] as AddMode[]).map((mode) => {
                const labels = { pick: 'GitHub Repos', create: 'New Repo', url: 'URL' }
                const icons = { pick: '📂', create: '✨', url: '🔗' }
                const active = addMode === mode
                return (
                  <button key={mode} style={{
                    padding: '10px 16px', fontSize: 13, fontWeight: active ? 500 : 400, border: 'none', cursor: 'pointer',
                    borderBottom: active ? '2px solid #13bbaf' : '2px solid transparent',
                    color: active ? '#13bbaf' : '#878787', backgroundColor: 'transparent',
                  }} onClick={() => setAddMode(mode)}>
                    {icons[mode]} {labels[mode]}
                  </button>
                )
              })}
            </div>

            {/* Error */}
            {addError && (
              <div style={{ margin: '12px 20px 0', fontSize: 13, color: '#f94b4b', backgroundColor: '#f94b4b10', border: '1px solid #f94b4b30', borderRadius: 8, padding: '8px 12px' }}>
                {addError}
              </div>
            )}

            {/* Content area — scrollable */}
            <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>

              {/* ── Pick from GitHub ─────────────────────────────── */}
              {addMode === 'pick' && (
                <div>
                  {!ghHasToken && !ghLoading ? (
                    <div style={{ textAlign: 'center', padding: '40px 0' }}>
                      <GitBranch style={{ width: 32, height: 32, color: '#a7b0b9', margin: '0 auto 12px' }} />
                      <div style={{ fontSize: 15, color: '#3f434b', marginBottom: 4, fontWeight: 500 }}>Connect GitHub</div>
                      <div style={{ fontSize: 13, color: '#a7b0b9', marginBottom: 16 }}>Add a GitHub token in Settings to browse your repos</div>
                      <button
                        style={{ ...S.tealBtn(false), flex: 'none', display: 'inline-flex', padding: '8px 20px', fontSize: 14 }}
                        onClick={() => { closeAddProject(); setShowPreferences(true) }}
                      >
                        <Settings style={{ width: 16, height: 16 }} /> Open Settings
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Search */}
                      <div style={{ position: 'relative', marginBottom: 12 }}>
                        <Search style={{ width: 16, height: 16, position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#a7b0b9' }} />
                        <input
                          ref={searchRef}
                          style={{ ...S.input, paddingLeft: 36, padding: '10px 12px 10px 36px', fontSize: 14, borderRadius: 8 }}
                          placeholder="Search repositories…"
                          value={ghSearch}
                          onChange={(e) => setGhSearch(e.target.value)}
                          autoFocus
                        />
                        {ghSearch && (
                          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#a7b0b9' }}>
                            {filteredRepos.length} result{filteredRepos.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>

                      {/* Repo list — table layout for full names */}
                      <div style={{ borderRadius: 8, border: '1px solid #e3e6ea', overflow: 'hidden' }}>
                        {ghLoading ? (
                          <div style={{ padding: 32, textAlign: 'center' }}>
                            <Loader2 style={{ width: 20, height: 20, animation: 'spin 1s linear infinite', color: '#a7b0b9', margin: '0 auto 8px' }} />
                            <div style={{ fontSize: 13, color: '#a7b0b9' }}>Loading repositories…</div>
                          </div>
                        ) : filteredRepos.length === 0 ? (
                          <div style={{ padding: '24px 16px', fontSize: 13, color: '#a7b0b9', textAlign: 'center' }}>
                            {ghSearch ? 'No matching repos' : 'No repos found'}
                          </div>
                        ) : (
                          filteredRepos.map((repo, i) => {
                            const alreadyAdded = addedUrls.has(repo.cloneUrl)
                            const [owner, name] = repo.fullName.split('/')
                            return (
                              <button
                                key={repo.fullName}
                                disabled={alreadyAdded || addingProject}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 14px',
                                  textAlign: 'left', fontSize: 14, border: 'none', cursor: alreadyAdded ? 'default' : 'pointer',
                                  backgroundColor: alreadyAdded ? '#f9fafb' : '#ffffff', color: '#3f434b',
                                  borderBottom: i < filteredRepos.length - 1 ? '1px solid #f0f0f0' : 'none',
                                  opacity: alreadyAdded ? 0.5 : 1,
                                  transition: 'background-color 0.1s',
                                }}
                                onMouseOver={(e) => { if (!alreadyAdded) e.currentTarget.style.backgroundColor = '#f4f8ff' }}
                                onMouseOut={(e) => { e.currentTarget.style.backgroundColor = alreadyAdded ? '#f9fafb' : '#ffffff' }}
                                onClick={() => !alreadyAdded && addProject(repo.name, repo.cloneUrl)}
                              >
                                {/* Icon */}
                                <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: repo.private ? '#fef3c7' : '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                  {repo.private
                                    ? <Lock style={{ width: 14, height: 14, color: '#d97706' }} />
                                    : <Globe style={{ width: 14, height: 14, color: '#059669' }} />
                                  }
                                </div>

                                {/* Name + description — NO truncation */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: 12, color: '#a7b0b9' }}>{owner}/</span>
                                    <span style={{ fontWeight: 600, color: '#3f434b', wordBreak: 'break-word' }}>{name}</span>
                                  </div>
                                  {repo.description && (
                                    <div style={{ fontSize: 12, color: '#a7b0b9', marginTop: 2, lineHeight: 1.4 }}>
                                      {repo.description}
                                    </div>
                                  )}
                                </div>

                                {/* Meta */}
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                                  {repo.language && (
                                    <span style={{ fontSize: 11, color: '#878787', backgroundColor: '#f4f6f7', padding: '2px 8px', borderRadius: 10 }}>{repo.language}</span>
                                  )}
                                  {alreadyAdded ? (
                                    <span style={{ fontSize: 11, color: '#059669', fontWeight: 500 }}>✓ Added</span>
                                  ) : addingProject ? (
                                    <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite', color: '#13bbaf' }} />
                                  ) : (
                                    <ChevronRight style={{ width: 16, height: 16, color: '#e3e6ea' }} />
                                  )}
                                </div>
                              </button>
                            )
                          })
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── Create new GitHub repo ──────────────────────── */}
              {addMode === 'create' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {!ghHasToken ? (
                    <div style={{ textAlign: 'center', padding: '40px 0' }}>
                      <div style={{ fontSize: 13, color: '#a7b0b9', marginBottom: 16 }}>Add a GitHub token in Settings to create repos</div>
                      <button
                        style={{ ...S.tealBtn(false), flex: 'none', display: 'inline-flex', padding: '8px 20px' }}
                        onClick={() => { closeAddProject(); setShowPreferences(true) }}
                      >
                        <Settings style={{ width: 16, height: 16 }} /> Open Settings
                      </button>
                    </div>
                  ) : (
                    <>
                      <div>
                        <label style={{ ...S.label, fontSize: 13, marginBottom: 6 }}>Repository name</label>
                        <input style={{ ...S.input, padding: '10px 12px', fontSize: 14, borderRadius: 8 }} placeholder="my-awesome-project" value={newRepoName} onChange={(e) => setNewRepoName(e.target.value)} autoFocus
                          onKeyDown={(e) => e.key === 'Enter' && newRepoName.trim() && createAndAddRepo()}
                        />
                      </div>
                      <div>
                        <label style={{ ...S.label, fontSize: 13, marginBottom: 6 }}>Description (optional)</label>
                        <input style={{ ...S.input, padding: '10px 12px', fontSize: 14, borderRadius: 8 }} placeholder="A brief description…" value={newRepoDesc} onChange={(e) => setNewRepoDesc(e.target.value)} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <button
                          onClick={() => setNewRepoPrivate(!newRepoPrivate)}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, border: '1px solid #e3e6ea', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', backgroundColor: '#ffffff', color: '#3f434b' }}
                        >
                          {newRepoPrivate ? <Lock style={{ width: 14, height: 14 }} /> : <Globe style={{ width: 14, height: 14 }} />}
                          {newRepoPrivate ? 'Private' : 'Public'}
                        </button>
                        <span style={{ fontSize: 12, color: '#a7b0b9' }}>
                          {newRepoPrivate ? 'Only you can see this repo' : 'Anyone can see this repo'}
                        </span>
                      </div>
                      {newRepoName.trim() && (
                        <div style={{ fontSize: 13, color: '#a7b0b9', padding: '8px 12px', backgroundColor: '#f4f6f7', borderRadius: 8 }}>
                          Will create <span style={{ fontFamily: 'monospace', color: '#3f434b', fontWeight: 500 }}>{user?.email?.split('@')[0] ?? 'you'}/{newRepoName.trim()}</span> on GitHub and clone locally
                        </div>
                      )}
                      <button
                        style={{ ...S.tealBtn(addingProject || !newRepoName.trim()), padding: '10px 16px', fontSize: 14, borderRadius: 8 }}
                        onClick={createAndAddRepo}
                        disabled={addingProject || !newRepoName.trim()}
                      >
                        {addingProject ? <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> : <Plus style={{ width: 16, height: 16 }} />}
                        {addingProject ? 'Creating…' : 'Create & Add'}
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* ── Manual URL ─────────────────────────────────── */}
              {addMode === 'url' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ ...S.label, fontSize: 13, marginBottom: 6 }}>Project name</label>
                    <input style={{ ...S.input, padding: '10px 12px', fontSize: 14, borderRadius: 8 }} placeholder="e.g. Stock Price Dashboard" value={manualName} onChange={(e) => setManualName(e.target.value)} autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && manualName.trim() && manualUrl.trim() && addProject(manualName.trim(), manualUrl.trim())}
                    />
                  </div>
                  <div>
                    <label style={{ ...S.label, fontSize: 13, marginBottom: 6 }}>Git repository URL</label>
                    <div style={{ position: 'relative' }}>
                      <GitBranch style={{ width: 14, height: 14, position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#a7b0b9' }} />
                      <input style={{ ...S.input, paddingLeft: 34, padding: '10px 12px 10px 34px', fontSize: 14, borderRadius: 8 }} placeholder="https://github.com/user/repo.git" value={manualUrl} onChange={(e) => setManualUrl(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && manualName.trim() && manualUrl.trim() && addProject(manualName.trim(), manualUrl.trim())}
                      />
                    </div>
                  </div>
                  {manualName.trim() && (
                    <div style={{ fontSize: 13, color: '#a7b0b9', padding: '8px 12px', backgroundColor: '#f4f6f7', borderRadius: 8 }}>
                      Will clone to: <span style={{ fontFamily: 'monospace', color: '#3f434b' }}>{workspacePath(manualName.trim())}</span>
                    </div>
                  )}
                  <button
                    style={{ ...S.tealBtn(addingProject || !manualName.trim() || !manualUrl.trim()), padding: '10px 16px', fontSize: 14, borderRadius: 8 }}
                    onClick={() => addProject(manualName.trim(), manualUrl.trim())}
                    disabled={addingProject || !manualName.trim() || !manualUrl.trim()}
                  >
                    {addingProject ? <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> : <Plus style={{ width: 16, height: 16 }} />}
                    {addingProject ? 'Adding…' : 'Add Project'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}`

// Replace lines
const before = lines.length
lines.splice(startIdx, closeIdx - startIdx + 1, ...modal.split('\n'))
console.log(`Replaced ${closeIdx - startIdx + 1} lines with ${modal.split('\n').length} lines`)
console.log(`File: ${before} -> ${lines.length} lines`)

fs.writeFileSync(file, lines.join('\n'))
console.log('Done!')
