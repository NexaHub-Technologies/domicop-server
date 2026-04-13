# Sign-Up UI Implementation Guide

This guide walks you through implementing the user registration flow for the DOMICOP platform.

## Overview

The registration flow is now consolidated into a **single-step process** where all user information is collected during initial sign-up. There's no separate onboarding flow - everything happens in one API call.

## Registration Endpoints

### 1. Public Self-Registration
**Route:** `POST /auth/register`

Used by users signing up themselves through the website or mobile app.

### 2. Admin-Created Registration
**Route:** `POST /members/register` (requires admin authentication)

Used by administrators to create member accounts from the admin panel.

---

## Required Fields

| Field | Type | Validation | Required | Description |
|-------|------|------------|----------|-------------|
| `email` | string | Valid email format | Yes | User's email address |
| `password` | string | Min 8 characters | Yes | User's password |
| `full_name` | string | Min 2 characters | Yes | User's full name |
| `phone` | string | Non-empty | Yes | Phone number |
| `address` | string | Non-empty | Yes | Physical address |
| `bank_name` | string | Non-empty | Yes | Bank name |
| `bank_account` | string | Non-empty | Yes | Bank account number |
| `bank_code` | string | Non-empty | Yes | Bank code/identifier |
| `avatar_url` | string | Valid URL | No | Profile photo URL |
| `next_of_kin` | string | - | No | Emergency contact info |

---

## Example Implementation (React)

```tsx
// screens/SignUp.tsx
import { useState } from 'react';

interface SignUpData {
  email: string;
  password: string;
  full_name: string;
  phone: string;
  address: string;
  bank_name: string;
  bank_account: string;
  bank_code: string;
  avatar_url?: string;
  next_of_kin?: string;
}

export function SignUp() {
  const [formData, setFormData] = useState<SignUpData>({
    email: '',
    password: '',
    full_name: '',
    phone: '',
    address: '',
    bank_name: '',
    bank_account: '',
    bank_code: '',
    avatar_url: '',
    next_of_kin: ''
  });
  const [errors, setErrors] = useState<Partial<SignUpData>>({});
  const [isLoading, setIsLoading] = useState(false);

  const validate = (): boolean => {
    const newErrors: Partial<SignUpData> = {};
    
    if (!formData.email || !formData.email.includes('@')) {
      newErrors.email = 'Valid email is required';
    }
    if (!formData.password || formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }
    if (!formData.full_name || formData.full_name.length < 2) {
      newErrors.full_name = 'Full name must be at least 2 characters';
    }
    if (!formData.phone) {
      newErrors.phone = 'Phone number is required';
    }
    if (!formData.address) {
      newErrors.address = 'Address is required';
    }
    if (!formData.bank_name) {
      newErrors.bank_name = 'Bank name is required';
    }
    if (!formData.bank_account) {
      newErrors.bank_account = 'Account number is required';
    }
    if (!formData.bank_code) {
      newErrors.bank_code = 'Bank code is required';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          full_name: formData.full_name,
          phone: formData.phone,
          address: formData.address,
          bank_name: formData.bank_name,
          bank_account: formData.bank_account,
          bank_code: formData.bank_code,
          avatar_url: formData.avatar_url || undefined,
          next_of_kin: formData.next_of_kin || undefined
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Registration failed');
      }
      
      const data = await response.json();
      
      // Registration successful
      // Redirect to verification pending page or login
      navigate('/verify-email', { state: { email: data.email } });
    } catch (error) {
      setErrors({ email: (error as Error).message });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="signup-form">
      <h1>Create Your Account</h1>
      <p>Complete all fields to register for DOMICOP membership.</p>
      
      {/* Account Information */}
      <section>
        <h2>Account Information</h2>
        
        <div className="form-group">
          <label htmlFor="email">Email Address *</label>
          <input
            type="email"
            id="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            placeholder="your@email.com"
          />
          {errors.email && <span className="error">{errors.email}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="password">Password *</label>
          <input
            type="password"
            id="password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            placeholder="Min 8 characters"
          />
          {errors.password && <span className="error">{errors.password}</span>}
        </div>
      </section>

      {/* Personal Information */}
      <section>
        <h2>Personal Information</h2>
        
        <div className="form-group">
          <label htmlFor="full_name">Full Name *</label>
          <input
            type="text"
            id="full_name"
            value={formData.full_name}
            onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
            placeholder="Enter your full name"
          />
          {errors.full_name && <span className="error">{errors.full_name}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="phone">Phone Number *</label>
          <input
            type="tel"
            id="phone"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            placeholder="+234 123 456 7890"
          />
          {errors.phone && <span className="error">{errors.phone}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="address">Address *</label>
          <textarea
            id="address"
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            placeholder="Enter your full address"
            rows={3}
          />
          {errors.address && <span className="error">{errors.address}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="next_of_kin">Next of Kin (Optional)</label>
          <input
            type="text"
            id="next_of_kin"
            value={formData.next_of_kin}
            onChange={(e) => setFormData({ ...formData, next_of_kin: e.target.value })}
            placeholder="Name - Phone Number"
          />
          <small>Emergency contact information</small>
        </div>
      </section>

      {/* Bank Information */}
      <section>
        <h2>Bank Details</h2>
        <p>Required for dividend payments and withdrawals.</p>
        
        <div className="form-group">
          <label htmlFor="bank_name">Bank Name *</label>
          <input
            type="text"
            id="bank_name"
            value={formData.bank_name}
            onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
            placeholder="e.g., First Bank of Nigeria"
          />
          {errors.bank_name && <span className="error">{errors.bank_name}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="bank_account">Account Number *</label>
          <input
            type="text"
            id="bank_account"
            value={formData.bank_account}
            onChange={(e) => setFormData({ ...formData, bank_account: e.target.value })}
            placeholder="1234567890"
          />
          {errors.bank_account && <span className="error">{errors.bank_account}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="bank_code">Bank Code *</label>
          <input
            type="text"
            id="bank_code"
            value={formData.bank_code}
            onChange={(e) => setFormData({ ...formData, bank_code: e.target.value })}
            placeholder="e.g., 011"
          />
          {errors.bank_code && <span className="error">{errors.bank_code}</span>}
        </div>
      </section>

      {/* Profile Photo (Optional) */}
      <section>
        <h2>Profile Photo (Optional)</h2>
        <div className="form-group">
          <label htmlFor="avatar_url">Photo URL</label>
          <input
            type="url"
            id="avatar_url"
            value={formData.avatar_url}
            onChange={(e) => setFormData({ ...formData, avatar_url: e.target.value })}
            placeholder="https://example.com/photo.jpg"
          />
        </div>
      </section>

      <button type="submit" disabled={isLoading} className="submit-btn">
        {isLoading ? 'Creating Account...' : 'Create Account'}
      </button>
    </form>
  );
}
```

---

## Admin Registration (Create Member)

Administrators can create member accounts directly from the admin panel.

**Route:** `POST /members/register`

**Authentication:** Required (Admin only)

```tsx
// admin/CreateMember.tsx
import { useState } from 'react';

export function CreateMember() {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    full_name: '',
    phone: '',
    address: '',
    next_of_kin: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/members/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAdminToken()}`
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) throw new Error('Failed to create member');
      
      setMessage('Member created successfully!');
      setFormData({
        email: '',
        password: '',
        full_name: '',
        phone: '',
        address: '',
        next_of_kin: ''
      });
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>Create New Member</h2>
      {message && <div className="message">{message}</div>}
      
      <div className="form-group">
        <label>Email *</label>
        <input
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          required
        />
      </div>

      <div className="form-group">
        <label>Password *</label>
        <input
          type="password"
          value={formData.password}
          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
          minLength={8}
          required
        />
      </div>

      <div className="form-group">
        <label>Full Name *</label>
        <input
          type="text"
          value={formData.full_name}
          onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
          required
        />
      </div>

      <div className="form-group">
        <label>Phone *</label>
        <input
          type="tel"
          value={formData.phone}
          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          required
        />
      </div>

      <div className="form-group">
        <label>Address *</label>
        <textarea
          value={formData.address}
          onChange={(e) => setFormData({ ...formData, address: e.target.value })}
          required
        />
      </div>

      <div className="form-group">
        <label>Next of Kin (Optional)</label>
        <input
          type="text"
          value={formData.next_of_kin}
          onChange={(e) => setFormData({ ...formData, next_of_kin: e.target.value })}
        />
      </div>

      <button type="submit" disabled={isLoading}>
        {isLoading ? 'Creating...' : 'Create Member'}
      </button>
    </form>
  );
}
```

---

## Response Format

### Success Response (200)

```json
{
  "message": "Registration successful. Please check your email to verify your account.",
  "user_id": "uuid-string",
  "email": "user@example.com"
}
```

### Error Response (400)

```json
{
  "error": "User already registered"
}
```

---

## Important Notes

1. **Email Verification**: After registration, users must verify their email before they can log in (if `REQUIRE_EMAIL_VERIFICATION` is enabled)

2. **Account Status**: New accounts are created with `status: 'pending'` and require admin approval before they become active

3. **Complete Profile**: Unlike the old multi-step onboarding, all required information is collected in a single form

4. **Member Number**: When an admin activates a pending account, a unique member number (e.g., "DOMICOP-0001") is automatically generated

5. **No Onboarding State**: The old `onboarding_step` and `onboarding_done` fields have been removed from the database - registration is now atomic

---

## UI/UX Best Practices

### Form Organization
Group related fields into logical sections:
1. Account Information (email, password)
2. Personal Information (name, phone, address, next of kin)
3. Bank Details (bank name, account, code)
4. Profile Photo (optional)

### Validation
- Validate on blur for immediate feedback
- Show all validation errors before submission
- Disable submit button while loading

### Error Handling
```tsx
const handleSubmit = async () => {
  try {
    // ... submit logic
  } catch (error) {
    if (error.message.includes('already registered')) {
      showError('An account with this email already exists');
    } else {
      showError('Registration failed. Please try again.');
    }
  }
};
```

### Accessibility
- Use semantic HTML (`<form>`, `<label>`, `<input>`)
- Add `aria-required` to required fields
- Ensure proper focus management
- Support keyboard navigation

### Loading States
Show clear loading indicators during submission:
```tsx
<button disabled={isLoading}>
  {isLoading ? (
    <>
      <Spinner /> Creating Account...
    </>
  ) : (
    'Create Account'
  )}
</button>
```

---

## Migration from Old Onboarding

If you're updating from the previous 3-step onboarding flow:

1. **Remove** all onboarding step routes (`/onboarding/step-1`, etc.)
2. **Remove** status checking logic (`GET /onboarding/status`)
3. **Replace** with single registration form
4. **Update** navigation - redirect to `/signup` instead of onboarding steps
5. **Remove** token refresh after registration (no longer needed)

The user experience is now simpler: one form → one API call → done!
