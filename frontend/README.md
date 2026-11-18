# Teraye (ተራየ) Brand & Logo Asset Pack

## Included Files
- `public/logo.png` — Full 1024x1024 logo on clean white background (ideal for Telegram Bot profile picture & login header).
- `public/logo-transparent.png` — Full 1024x1024 logo with transparent background (ideal for UI headers & cards).
- `public/icon-512.png` & `public/icon-192.png` — PWA / Android Capacitor app icons.
- `public/apple-touch-icon.png` — iOS / Mobile bookmark icon (180x180).
- `public/favicon.ico`, `public/favicon-32.png`, `public/favicon-64.png` — Browser tab favicons.
- `src/assets/teraye-logo.png` & `src/assets/teraye-logo-transparent.png` — Ready to import inside React components.

## How to Add to Your Teraye App
1. **Frontend & Public Folder:** Extract `public/*` into `frontend/public/` (and `backend/public/` if deploying pre-built files directly) and `src/assets/*` into `frontend/src/assets/`.
2. **React Component Usage:**
   ```tsx
   import terayeLogo from '../assets/teraye-logo-transparent.png';
   // <img src={terayeLogo} alt="ተራየ Teraye" className="h-12 w-auto" />
   ```
3. **Telegram Bot Profile Picture:** Open `@BotFather` in Telegram -> `/mybots` -> select your Teraye bot -> **Edit Bot** -> **Edit Botpic** -> upload `public/logo.png`.
