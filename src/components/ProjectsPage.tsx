import { useMemo, useState } from 'react'
import { House, LogOut, Plus, Star, Trash2, UserCircle } from 'lucide-react'
import type { User } from '../lib/auth'
import {
  createProject,
  deleteProject,
  listProjects,
  toggleFavorite,
  type ProjectRecord,
} from '../lib/projects'

function timeAgo(ts: number) {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function ProjectsPage({
  user,
  onHome,
  onOpenProject,
  onNewProject,
  onSignIn,
  onSignOut,
}: {
  user: User | null
  onHome: () => void
  onOpenProject: (project: ProjectRecord) => void
  onNewProject: (name?: string) => void
  onSignIn: () => void
  onSignOut: () => void
}) {
  const [tick, setTick] = useState(0)
  const projects = useMemo(() => (user ? listProjects(user.id) : []), [user, tick])
  const favorites = projects.filter((p) => p.favorite)
  const recent = projects.filter((p) => !p.favorite)

  const refresh = () => setTick((t) => t + 1)

  return (
    <div className="projects-page">
      <header className="projects-topbar">
        <div className="projects-top-left">
          <button type="button" className="icon-button" onClick={onHome} aria-label="Home">
            <House size={17} />
          </button>
          <div className="brand">
            <div className="logo-mark" aria-hidden="true">
              <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />
            </div>
            <div className="brand-type">
              <span className="brand-name">BIGNAC</span>
              <span className="brand-sub">PROJECTS</span>
            </div>
          </div>
        </div>
        <div className="projects-top-right">
          {user ? (
            <>
              <span className="user-chip">
                <UserCircle size={16} /> {user.name || user.email}
              </span>
              <button type="button" className="ghost-btn" onClick={onSignOut}>
                <LogOut size={14} /> Sign out
              </button>
            </>
          ) : (
            <button type="button" className="export-button" onClick={onSignIn}>
              Sign in
            </button>
          )}
        </div>
      </header>

      <main className="projects-main">
        <div className="projects-hero-row">
          <div>
            <h1>Projects</h1>
            <p>
              {user
                ? 'Pick up where you left off, or start something new.'
                : 'Sign in to save projects, favorites, and history on this device.'}
            </p>
          </div>
          <button
            type="button"
            className="export-button"
            onClick={() => {
              if (user) {
                const p = createProject(user.id)
                onNewProject(p.id)
              } else {
                onNewProject()
              }
            }}
          >
            <Plus size={16} /> New project
          </button>
        </div>

        {!user ? (
          <div className="projects-gate">
            <div className="gate-card">
              <h2>History & favorites are for accounts</h2>
              <p>
                You can start a new project anytime. To see past projects and mark favorites,
                create a free account stored locally in your browser.
              </p>
              <div className="gate-actions">
                <button type="button" className="export-button" onClick={onSignIn}>
                  Sign in / Create account
                </button>
                <button type="button" className="secondary-action" onClick={() => onNewProject()}>
                  Continue without account
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {favorites.length > 0 ? (
              <section className="projects-section">
                <h2>Favorites</h2>
                <ul className="projects-list">
                  {favorites.map((p) => (
                    <ProjectRow
                      key={p.id}
                      project={p}
                      onOpen={() => onOpenProject(p)}
                      onToggleFav={() => { toggleFavorite(p.id); refresh() }}
                      onDelete={() => { deleteProject(p.id); refresh() }}
                    />
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="projects-section">
              <h2>Recent projects</h2>
              {projects.length === 0 ? (
                <div className="projects-empty-min">
                  <p>No projects yet.</p>
                  <span>Create a new project to start editing.</span>
                </div>
              ) : recent.length === 0 ? (
                <div className="projects-empty-min">
                  <p>All projects are in Favorites.</p>
                </div>
              ) : (
                <ul className="projects-list">
                  {recent.map((p) => (
                    <ProjectRow
                      key={p.id}
                      project={p}
                      onOpen={() => onOpenProject(p)}
                      onToggleFav={() => { toggleFavorite(p.id); refresh() }}
                      onDelete={() => { deleteProject(p.id); refresh() }}
                    />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}

function ProjectRow({
  project,
  onOpen,
  onToggleFav,
  onDelete,
}: {
  project: ProjectRecord
  onOpen: () => void
  onToggleFav: () => void
  onDelete: () => void
}) {
  return (
    <li className="project-row">
      <button type="button" className="project-row-main" onClick={onOpen}>
        <span className="project-row-name">{project.name || 'Untitled project'}</span>
        <span className="project-row-time">{timeAgo(project.updatedAt)}</span>
      </button>
      <div className="project-row-actions">
        <button
          type="button"
          className={`icon-button subtle ${project.favorite ? 'is-fav' : ''}`}
          onClick={onToggleFav}
          aria-label={project.favorite ? 'Unfavorite' : 'Favorite'}
          title={project.favorite ? 'Unfavorite' : 'Favorite'}
        >
          <Star size={15} />
        </button>
        <button type="button" className="icon-button subtle" onClick={onDelete} aria-label="Delete project" title="Delete">
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  )
}
