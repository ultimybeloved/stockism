// Fixed manhwa colors (light mode only) shared by the ladder components.
export const bgMain = '#d4c4a8';
export const bgCard = '#e6dbc5';
export const bgCardInner = '#e9e3d2';
export const bgDark = '#3b3624';
export const textDark = '#2a2a2a';
export const textLight = '#666';
export const btnGray = '#b4ac99';
export const cornerBrown = '#715a3b';

// Injected once by LadderGame. The class names double as hooks for the DOM
// animation in src/hooks/ladder/, which toggles them by id — keep in sync.
export const LADDER_CSS = `
  .ladder-x-selected {
    background: #a9a18e !important;
    box-shadow: 0 0 0 3px rgba(138, 126, 110, 0.3) !important;
  }
  .ladder-x-active-odd {
    background: #2286f6 !important;
  }
  .ladder-x-active-even {
    background: #f22431 !important;
  }
  .ladder-result-winner {
    transform: scale(1.1) !important;
    z-index: 20 !important;
    opacity: 1 !important;
  }
  #oddBtn.ladder-result-winner {
    background: #2286f6 !important;
  }
  #evenBtn.ladder-result-winner {
    background: #f22431 !important;
  }

  @media (max-width: 600px) {
    .ladder-layout {
      flex-direction: column !important;
    }
    .ladder-side-panel {
      width: 100% !important;
    }
    .ladder-instruction {
      font-size: 16px !important;
      height: 21px !important;
    }
    .ladder-footer-text {
      font-size: 10px !important;
    }
    .ladder-init-banner {
      padding: 15px 55px !important;
    }
  }
`;
