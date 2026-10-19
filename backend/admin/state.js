import { api } from "./api.js";

/** Shared app state. Views read it; the shell (app.js) fills it in. */
export const state = {
  user: null,
  schemas: {},
  roles: {},
  pending: [],
  dirty: false, // an editor view has unsaved changes
  refreshChrome: () => {}, // set by the shell: re-draw pending badge etc.
};

export const canMedia = () => !!(state.user && state.user.permissions.media);
export const canEnquiries = () => !!(state.user && state.user.permissions.enquiries);
export const isOwner = () => !!(state.user && state.user.permissions.admin);

export async function refreshPending() {
  try {
    const { pending } = await api.get("/pending");
    state.pending = pending;
  } catch (_) { /* leave stale */ }
  state.refreshChrome();
}

export function go(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = hash;
}

/** Which public page best shows a given content type (for the Preview button). */
export const PREVIEW_PAGE = {
  projects: "projects.html",
  domains: "services.html",
  team: "about.html",
  people: "about.html",
  clients: "index.html",
  figures: "index.html",
  site: "index.html",
};
