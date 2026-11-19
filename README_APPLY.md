# Teraye Fixes — How to Apply

Extract the files in this archive into your local `D:\Projects\teraye` root so they overwrite:
- `backend/src/app.js`
- `backend/src/middleware/auth.js`
- `backend/.env.example`
- `backend/sql/003_mysql_otp_columns.sql` (only run on fresh DBs without OTP columns)

## Two 1-Line Edits (Preserving Your Amharic UI/Seed Text)

1. **`frontend/src/components/AuthScreen.tsx` (line 108):**
   Change `'/auth/mobile/login'` to `'/auth/login'`:
   ```ts
   const data = await apiFetch<{ token: string }>('/auth/login', {
   ```

2. **`backend/sql/002_seed.sql` (line 16):**
   Fix the 10-digit typo `'+2519121319216'` to 9 digits `'+251921319216'`.

## Untrack `backend/.env`, Rebuild Frontend & Push

```bash
git rm --cached backend/.env
cd frontend && npm run build && cd ..
git add backend/src/app.js backend/src/middleware/auth.js backend/.env.example backend/sql/003_mysql_otp_columns.sql frontend/src/components/AuthScreen.tsx backend/sql/002_seed.sql backend/public
git commit -m "fix: resolve Express auth imports, requireRole export, health query, and login route"
git push origin main
```

On Plesk, set real values in `backend/.env` (`DB_HOST`, `DB_PORT=3306`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`, `DEV_BYPASS_AUTH=false`).
