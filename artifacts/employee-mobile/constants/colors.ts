/**
 * Semantic design tokens for the IHS employee app.
 * Synced from the staffing web app's index.css (soft sage green + cool slate).
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#24303F',
    tint: '#58A07C',

    // Core surfaces
    background: '#F5F7F9',
    foreground: '#24303F',

    // Cards / elevated surfaces
    card: '#FFFFFF',
    cardForeground: '#24303F',

    // Primary action color (buttons, links, active states)
    primary: '#58A07C',
    primaryForeground: '#FFFFFF',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#DCE3EA',
    secondaryForeground: '#24303F',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#EDF1F4',
    mutedForeground: '#586679',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#E4F2EA',
    accentForeground: '#295640',

    // Destructive actions (delete, error states)
    destructive: '#D22D2D',
    destructiveForeground: '#FFFFFF',

    // Borders and input outlines
    border: '#D8DEE4',
    input: '#CCD5DD',
  },

  dark: {
    text: '#E7EBEF',
    tint: '#4E9670',

    background: '#151A23',
    foreground: '#E7EBEF',

    card: '#1C222C',
    cardForeground: '#E7EBEF',

    primary: '#4E9670',
    primaryForeground: '#FFFFFF',

    secondary: '#2D3543',
    secondaryForeground: '#E7EBEF',

    muted: '#2A303C',
    mutedForeground: '#93A0AE',

    accent: '#264033',
    accentForeground: '#CCE6D8',

    destructive: '#D24040',
    destructiveForeground: '#FFFFFF',

    border: '#2E3542',
    input: '#38404E',
  },

  // Border radius (in px). Synced from the web app's --radius (0.5rem).
  radius: 8,
};

export default colors;
