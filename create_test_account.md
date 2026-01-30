# Quick Test Account Setup for Local Development

## Option 1: Firebase Console (Fastest - 2 minutes)

1. Go to Firebase Console Authentication:
   https://console.firebase.google.com/project/stockism-abb28/authentication/users

2. Click "Add user" button

3. Enter:
   - Email: test@test.com
   - Password: testpass123
   - Click "Add user"

4. Done! Use these credentials to sign in on localhost

## Option 2: Using Firebase CLI (If Console is slow)

Run these commands:
```bash
firebase auth:import test_user.json --project stockism-abb28
```

Where test_user.json contains:
```json
{
  "users": [{
    "localId": "test123",
    "email": "test@test.com",
    "passwordHash": "password_hash_here",
    "emailVerified": true
  }]
}
```

## Enable Email/Password Auth (If not already enabled)

1. Go to: https://console.firebase.google.com/project/stockism-abb28/authentication/providers
2. Click "Email/Password"
3. Toggle "Enable"
4. Click "Save"

## Sign In

1. Go to http://localhost:5174/
2. Click "Sign In"
3. Use email/password tab
4. Enter: test@test.com / testpass123
5. You're in!

