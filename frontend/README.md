# Teraye (ተራየ) Complete Logo Assets + Integration Code Pack

## Folder Structure
- `public/` -> Copy all files into `D:\Projects\teraye\frontend\public\`
- `src/assets/` -> Copy all files into `D:\Projects\teraye\frontend\src\assets\`
- `snippets/index.html` -> Ready-to-use `frontend/index.html` with all favicon & Apple Touch icon links
- `snippets/TerayeLogoComponents.tsx` -> Ready-to-use React components for the Login card (`h-24`) and Dashboard top bar (`h-9`)
- `snippets/check_admin_user.sql` -> SQL query to inspect `teraye_users` in phpMyAdmin

## Build & Deploy Commands (PowerShell)
```powershell
cd D:\Projects\teraye\frontend
npm run build

cd ..
git add -f backend/public frontend/
git commit -m "feat(ui): add Teraye Ethiopian taxi logo and icons"
git push
```
