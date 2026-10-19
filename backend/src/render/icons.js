"use strict";

// Fallback icons for domains added in the admin (the six original domains keep
// their own hand-drawn icons from the page markup).
module.exports = {
  tile: `<svg class="service-tile__icon" viewBox="0 0 30 30" width="30" height="30" aria-hidden="true">
    <rect x="6" y="6" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.4" />
    <path d="M6 12h18M12 6v18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
  </svg>`,
  quicknav: `<svg viewBox="0 0 22 22" width="22" height="22">
    <rect x="4" y="4" width="14" height="14" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.3" />
    <path d="M4 9h14M9 4v14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
  </svg>`,
};
