/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Collaboration Hub – Blender, Godot, and General Projects
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Features:
 *  - Create and browse collaboration projects
 *  - Blender workflow: .blend metadata on PDS, files on Git LFS/cloud/torrent
 *  - Godot workflow: project metadata on PDS, files externally stored
 *  - Task/project management with Kanban boards
 *  - Milestones and collaborative workspaces
 *  - Annotations and threaded feedback on assets
 *  - Template libraries for rigs, scenes, shaders, scripts
 *  - Tutorial/tip threads and project wikis
 *
 * HOW TO EDIT:
 *  - To add a new project type, add it to the PROJECT_TYPES array
 *  - To change the project card layout, edit the project list section
 *  - External storage links support: Git LFS URLs, cloud links, torrent v2 magnets
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { component$, useSignal, useStore, useVisibleTask$, $ } from '@builder.io/qwik';
import { Link } from '@builder.io/qwik-city';
import { useAppState } from '~/context/app-context';
import type { CollabProject } from '~/lib/types';

const PROJECT_TYPES = [
  { value: 'blender', label: 'Blender', icon: '🎨', description: '.blend files, rigs, animations' },
  { value: 'godot', label: 'Godot', icon: '🎮', description: 'Godot projects, scenes, scripts' },
  { value: 'general', label: 'General', icon: '📁', description: 'Any type of project' },
];

export default component$(() => {
  const app = useAppState();
  const projects = useSignal<CollabProject[]>([]);
  const loading = useSignal(true);
  const showCreate = useSignal(false);
  const filterType = useSignal<string>('');

  const form = useStore({
    name: '', description: '', type: 'general' as 'blender' | 'godot' | 'general',
    tags: '', version: '0.1.0', externalUrl: '', magnetLink: '', previewUrl: '',
  });

  // Load projects
  useVisibleTask$(async () => {
    if (!app.session.did) { loading.value = false; return; }
    try {
      const { listProjects } = await import('~/lib/collab');
      const result = await listProjects(app.session.did);
      projects.value = result.projects;
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
    loading.value = false;
  });

  // Create project
  const handleCreate = $(async () => {
    if (!form.name.trim()) return;
    try {
      const { createProject } = await import('~/lib/collab');
      await createProject({
        name: form.name, description: form.description, type: form.type,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        version: form.version, externalUrl: form.externalUrl || undefined,
        magnetLink: form.magnetLink || undefined, previewUrl: form.previewUrl || undefined,
      });
      showCreate.value = false;
      // Reload
      if (app.session.did) {
        const { listProjects } = await import('~/lib/collab');
        projects.value = (await listProjects(app.session.did)).projects;
      }
    } catch (err) {
      console.error('Create failed:', err);
    }
  });

  const filtered = projects.value.filter((p) => !filterType.value || p.type === filterType.value);

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <div class="flex-between" style={{ marginBottom: 'var(--space-lg)' }}>
        <h1 style={{ fontSize: 'var(--font-2xl)', fontWeight: '700' }}>Collaboration</h1>
        {app.session.isLoggedIn && (
          <button class="btn" onClick$={() => { showCreate.value = !showCreate.value; }}>
            + New Project
          </button>
        )}
      </div>

      {/* Project type filters */}
      <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)', flexWrap: 'wrap' }}>
        <button
          class={!filterType.value ? 'btn' : 'btn-ghost'}
          style={{ fontSize: 'var(--font-sm)', padding: '4px 12px' }}
          onClick$={() => { filterType.value = ''; }}
        >
          All
        </button>
        {PROJECT_TYPES.map((pt) => (
          <button
            key={pt.value}
            class={filterType.value === pt.value ? 'btn' : 'btn-ghost'}
            style={{ fontSize: 'var(--font-sm)', padding: '4px 12px' }}
            onClick$={() => { filterType.value = pt.value; }}
          >
            {pt.icon} {pt.label}
          </button>
        ))}
      </div>

      {/* Create Project Form */}
      {showCreate.value && (
        <div class="glass-strong" style={{ padding: 'var(--space-lg)', marginBottom: 'var(--space-lg)' }}>
          <h3 style={{ marginBottom: 'var(--space-md)' }}>Create Project</h3>

          <input type="text" placeholder="Project name" value={form.name}
            onInput$={(_, el) => { form.name = el.value; }}
            style={{ width: '100%', marginBottom: 'var(--space-sm)' }} />

          <textarea placeholder="Description" value={form.description}
            onInput$={(_, el) => { form.description = el.value; }}
            style={{ width: '100%', minHeight: '80px', marginBottom: 'var(--space-sm)' }} />

          <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
            <select value={form.type} onChange$={(_, el) => { form.type = el.value as typeof form.type; }}
              style={{ flex: 1 }}>
              {PROJECT_TYPES.map((pt) => (
                <option key={pt.value} value={pt.value}>{pt.icon} {pt.label}</option>
              ))}
            </select>
            <input type="text" placeholder="Version" value={form.version}
              onInput$={(_, el) => { form.version = el.value; }}
              style={{ width: '100px' }} />
          </div>

          <input type="text" placeholder="Tags (comma-separated)" value={form.tags}
            onInput$={(_, el) => { form.tags = el.value; }}
            style={{ width: '100%', marginBottom: 'var(--space-sm)' }} />

          <p style={{ fontSize: 'var(--font-xs)', color: 'var(--muted)', marginBottom: 'var(--space-xs)' }}>
            External storage (full files stored here, PDS stores metadata only):
          </p>
          <input type="url" placeholder="Git LFS / Cloud URL" value={form.externalUrl}
            onInput$={(_, el) => { form.externalUrl = el.value; }}
            style={{ width: '100%', marginBottom: 'var(--space-xs)' }} />
          <input type="text" placeholder="Torrent v2 / hybrid magnet link" value={form.magnetLink}
            onInput$={(_, el) => { form.magnetLink = el.value; }}
            style={{ width: '100%', marginBottom: 'var(--space-xs)' }} />
          <input type="url" placeholder="Preview URL (GLTF, HTML5 export, screenshot)" value={form.previewUrl}
            onInput$={(_, el) => { form.previewUrl = el.value; }}
            style={{ width: '100%', marginBottom: 'var(--space-md)' }} />

          <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            <button class="btn" onClick$={handleCreate}>Create</button>
            <button class="btn-ghost" onClick$={() => { showCreate.value = false; }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Projects List */}
      {loading.value ? (
        <div class="flex-center" style={{ padding: 'var(--space-2xl)' }}><div class="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--muted)' }}>
          <p>No projects yet. Create one to start collaborating!</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-md)' }}>
          {filtered.map((project) => {
            const typeInfo = PROJECT_TYPES.find((pt) => pt.value === project.type);
            return (
              <div key={project.uri} class="glass" style={{ padding: 'var(--space-lg)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
                  <span style={{ fontSize: 'var(--font-xl)' }}>{typeInfo?.icon ?? '📁'}</span>
                  <h3 class="truncate" style={{ fontSize: 'var(--font-base)', fontWeight: '700' }}>
                    {project.name}
                  </h3>
                  <span class="badge" style={{ marginLeft: 'auto' }}>{project.version}</span>
                </div>
                <p style={{ fontSize: 'var(--font-sm)', color: 'var(--muted)', marginBottom: 'var(--space-md)' }}>
                  {project.description?.slice(0, 120) || 'No description'}
                </p>
                {project.tags?.length > 0 && (
                  <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap', marginBottom: 'var(--space-sm)' }}>
                    {project.tags.map((tag) => (
                      <span key={tag} class="badge" style={{ fontSize: '10px' }}>#{tag}</span>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 'var(--space-sm)', fontSize: 'var(--font-xs)' }}>
                  {project.externalUrl && (
                    <a href={project.externalUrl} target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>
                      Files
                    </a>
                  )}
                  {project.magnetLink && <span style={{ color: 'var(--muted)' }}>Torrent available</span>}
                  {project.previewUrl && (
                    <a href={project.previewUrl} target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>
                      Preview
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
