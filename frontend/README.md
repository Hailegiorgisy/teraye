# Teraye Frontend Auth & Phone Format Components

## Included Files
- `src/utils/ethiopianPhone.ts` — Enforces and converts between 10-digit (`09...` / `07...`) and 13-character (`+2519...` / `+2517...`) Ethiopian phone numbers.
- `src/components/LoginCard.tsx` — Complete Login, Forgot PIN (Telegram OTP request), and Reset PIN component featuring your new Ethiopian taxi logo and dual phone format toggle.

## How to Use in `App.tsx`
1. Extract this ZIP into `D:\Projects\teraye\frontend` (so `src/utils/ethiopianPhone.ts` and `src/components/LoginCard.tsx` land inside `frontend/src/`).
2. In `frontend/src/App.tsx`, render `<LoginCard />` when the user is logged out:
```tsx
import { LoginCard } from './components/LoginCard';

// Inside App():
if (!token) {
  return (
    <LoginCard
      onLoginSuccess={(newToken, loggedInUser) => {
        localStorage.setItem('teraye_token', newToken);
        setToken(newToken);
        setUser(loggedInUser);
      }}
    />
  );
}
```
