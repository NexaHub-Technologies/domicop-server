# Mobile App Authentication Examples

This directory contains example implementations for email/password authentication with Supabase.

## 📁 Files

| File | Purpose |
|------|---------|
| `authStore.ts` | Zustand store example for auth state management |

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install zustand expo-secure-store
```

### 2. Environment Variables

Create a `.env` file in your mobile app root:

```env
# Your backend API URL
EXPO_PUBLIC_API_URL=https://your-api.com
```

### 3. Basic Authentication Flow

#### Registration

```typescript
const handleRegister = async (email: string, password: string, fullName: string) => {
  const response = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      full_name: fullName,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Registration failed');
  }

  // Show success message - user needs to verify email
  Alert.alert(
    'Registration Successful',
    'Please check your email to verify your account before logging in.'
  );
};
```

#### Login

```typescript
const handleLogin = async (email: string, password: string) => {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    if (data.message?.includes('verify your email')) {
      // Offer to resend verification
      Alert.alert(
        'Email Not Verified',
        'Please verify your email first.',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Resend Email', 
            onPress: () => resendVerification(email)
          },
        ]
      );
    } else {
      throw new Error(data.message || 'Login failed');
    }
    return;
  }

  // Store tokens
  await SecureStore.setItemAsync('access_token', data.access_token);
  await SecureStore.setItemAsync('refresh_token', data.refresh_token);

  // Navigate based on user status
  if (!data.user.onboarding_done) {
    router.replace('/onboarding');
  } else if (data.user.status === 'pending') {
    router.replace('/pending-approval');
  } else {
    router.replace('/(tabs)');
  }
};
```

#### Password Reset

```typescript
const handleResetPassword = async (email: string) => {
  const response = await fetch(`${API_URL}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  const data = await response.json();

  // Always show success (don't leak if email exists)
  Alert.alert(
    'Password Reset',
    'If that email is registered, a reset link has been sent.'
  );
};
```

#### Resend Verification Email

```typescript
const resendVerification = async (email: string) => {
  const response = await fetch(`${API_URL}/auth/resend-verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  const data = await response.json();
  Alert.alert('Success', data.message);
};
```

### 4. Complete Login Screen Example

```typescript
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://your-api.com';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Login failed');
      }

      // Store tokens
      await SecureStore.setItemAsync('access_token', data.access_token);
      await SecureStore.setItemAsync('refresh_token', data.refresh_token);

      // Navigate based on user state
      if (!data.user.onboarding_done) {
        router.replace('/onboarding');
      } else if (data.user.status === 'pending') {
        router.replace('/pending-approval');
      } else {
        router.replace('/(tabs)');
      }
    } catch (error: any) {
      Alert.alert('Login Failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to DOMICOP</Text>
      
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      
      <TouchableOpacity 
        style={styles.button}
        onPress={handleLogin}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Sign In</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity 
        onPress={() => router.push('/forgot-password')}
        style={styles.link}
      >
        <Text style={styles.linkText}>Forgot Password?</Text>
      </TouchableOpacity>

      <TouchableOpacity 
        onPress={() => router.push('/register')}
        style={styles.link}
      >
        <Text style={styles.linkText}>
          Don't have an account? <Text style={styles.bold}>Sign Up</Text>
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 32,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  link: {
    marginTop: 16,
    alignItems: 'center',
  },
  linkText: {
    fontSize: 14,
    color: '#666',
  },
  bold: {
    fontWeight: '600',
    color: '#007AFF',
  },
});
```

## 📚 Backend API Endpoints

| Endpoint | Method | Auth Required | Description |
|----------|--------|---------------|-------------|
| `/auth/register` | POST | No | Create new account |
| `/auth/login` | POST | No | Login with email/password |
| `/auth/refresh` | POST | No | Refresh access token |
| `/auth/logout` | POST | No | Logout |
| `/auth/reset-password` | POST | No | Request password reset |
| `/auth/confirm-reset` | POST | No | Confirm password reset |
| `/auth/resend-verification` | POST | No | Resend verification email |
| `/auth/change-password` | POST | Yes | Change password (requires current) |
| `/auth/expo-token` | POST | Yes | Store Expo push token |

## 🔒 Security Features

- ✅ **Email verification required** before login (if enabled)
- ✅ **Account approval workflow** - new users are `pending` until admin approves
- ✅ **Pending users blocked** from financial operations
- ✅ **Password requirements** - minimum 8 characters
- ✅ **Secure token storage** with expo-secure-store
- ✅ **Rate limiting** on auth endpoints

## 🧪 Testing Checklist

- [ ] Register new account → receives verification email
- [ ] Try login without verification → error message
- [ ] Verify email → can login
- [ ] Login → redirects to onboarding (if new)
- [ ] Complete onboarding → status still `pending`
- [ ] Try to contribute → blocked with 403
- [ ] Admin approves → gets member number
- [ ] Can now contribute
- [ ] Password reset flow works

## 🔗 Related Documentation

- [Backend README](../README.md) - API documentation
- [Supabase Setup](../supabase/README.md) - Database configuration
