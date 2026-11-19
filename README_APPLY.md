# Teraye Fixes — How to Apply

1. Extract this archive into `D:\Projects\teraye` (overwrites `backend/src/app.js`, `backend/src/middleware/auth.js`, `backend/.env.example`, `backend/sql/001_init.sql`, and adds `backend/sql/003_mysql_otp_columns.sql` + `apply_fixes.ps1`).
2. In PowerShell inside `D:\Projects\teraye`, run:
   ```powershell
   .\apply_fixes.ps1
   ```
3. Commit and push:
   ```bash
   git add backend/src/app.js backend/src/middleware/auth.js backend/.env.example backend/sql/ frontend/src/components/AuthScreen.tsx backend/public
   git commit -m "fix: resolve Express auth imports, requireRole, health query, MySQL schema, and login route"
   git push origin main
   ```
4. On Plesk, set real values in `backend/.env` (`DB_HOST`, `DB_PORT=3306`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`, `TELEGRAM_BOT_TOKEN`, `PUBLIC_API_URL`, `DEV_BYPASS_AUTH=false`) and restart the Node.js app.
